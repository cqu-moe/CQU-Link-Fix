import type { Browser } from 'wxt/browser';
import { decideAllCquRewrite } from '../src/background/navigation';
import {
  clearRewriteRecord,
  clearTabSession,
  excludeCurrentHost,
  getTabState,
  isOriginalBypass,
  openOriginalOnce,
  recordRewrite,
  sameRequestUrl,
  type RewriteRecord,
} from '../src/background/session';
import {
  isBackgroundMessage,
  type BackgroundMessage,
} from '../src/messages';
import { decideRegisteredRewrite, getEnabledRules } from '../src/rules/registry';
import { getRulePriority, reconcileDynamicRules } from '../src/rules/dnr';
import type { RuleDefinition } from '../src/rules/types';
import { loadSettings } from '../src/storage/settings';

let reconciliationQueue = Promise.resolve();
const latestTopFrameNavigation = new Map<number, symbol>();
const tabFinalizationQueues = new Map<number, Promise<void>>();

function scheduleReconciliation(): void {
  reconciliationQueue = reconciliationQueue
    .then(reconcileDynamicRules, reconcileDynamicRules)
    .catch((error: unknown) => {
      console.error('Failed to reconcile dynamic DNR rules', error);
    });
}

function compareNavigationPrecedence(
  left: RuleDefinition,
  right: RuleDefinition,
): number {
  const priorityDifference = getRulePriority(right) - getRulePriority(left);
  if (priorityDifference !== 0) return priorityDifference;

  const leftHandledByDnr = left.matcher.kind !== 'youth-article';
  const rightHandledByDnr = right.matcher.kind !== 'youth-article';
  if (leftHandledByDnr !== rightHandledByDnr) return leftHandledByDnr ? -1 : 1;
  return left.dnrId - right.dnrId || left.id.localeCompare(right.id);
}

function isExcludedHost(host: string, excludedHosts: readonly string[]): boolean {
  return excludedHosts.some((excluded) => excluded.trim().toLowerCase() === host);
}

function isHandledByDnr(rule: RuleDefinition, url: URL): boolean {
  return rule.matcher.kind !== 'youth-article' || !url.search;
}

function scheduleSafely(label: string, operation: () => Promise<unknown>): void {
  void operation().catch((error: unknown) => {
    console.error(label, error);
  });
}

function queueTabFinalization(tabId: number, operation: () => Promise<void>): Promise<void> {
  const previous = tabFinalizationQueues.get(tabId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  tabFinalizationQueues.set(tabId, current);
  void current.then(
    () => {
      if (tabFinalizationQueues.get(tabId) === current) tabFinalizationQueues.delete(tabId);
    },
    () => {
      if (tabFinalizationQueues.get(tabId) === current) tabFinalizationQueues.delete(tabId);
    },
  );
  return current;
}

async function restoreRewriteRecord(
  tabId: number,
  previous: RewriteRecord | null,
): Promise<void> {
  if (previous) await recordRewrite(previous);
  else await clearRewriteRecord(tabId);
}

async function finalizeWinningRewrite(
  record: RewriteRecord,
  navigationToken: symbol,
  targetToNavigate: string | null,
): Promise<void> {
  await queueTabFinalization(record.tabId, async () => {
    if (latestTopFrameNavigation.get(record.tabId) !== navigationToken) return;
    const previous = await getTabState(record.tabId);
    if (latestTopFrameNavigation.get(record.tabId) !== navigationToken) return;

    await recordRewrite(record);
    if (latestTopFrameNavigation.get(record.tabId) !== navigationToken) {
      await restoreRewriteRecord(record.tabId, previous);
      return;
    }
    if (targetToNavigate) {
      await browser.tabs.update(record.tabId, { url: targetToNavigate });
    }
  });
}

async function rewriteTopFrameNavigation(
  details: Browser.webNavigation.WebNavigationBaseCallbackDetails,
  navigationToken: symbol,
): Promise<void> {
  if (details.frameId !== 0 || details.tabId < 0) return;

  let url: URL;
  try {
    url = new URL(details.url);
  } catch {
    return;
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password
  ) {
    return;
  }

  if (await isOriginalBypass(details.tabId, details.url)) return;

  const settings = await loadSettings();
  const host = url.hostname.toLowerCase();
  if (isExcludedHost(host, settings.excludedHosts)) return;

  const enabledRules = getEnabledRules(settings).sort(compareNavigationPrecedence);
  const decision = decideRegisteredRewrite(details.url, enabledRules);
  const winningRule = enabledRules.find((rule) => rule.id === decision?.ruleId);
  let targetToNavigate: string | null = null;
  let record: RewriteRecord | null = null;

  if (decision && winningRule) {
    record = {
      tabId: details.tabId,
      ruleId: decision.ruleId,
      originalUrl: decision.originalUrl,
      targetUrl: decision.targetUrl,
      recordedAt: Date.now(),
    };
    if (
      !isHandledByDnr(winningRule, url) &&
      winningRule.matcher.kind === 'youth-article' &&
      winningRule.transformer === 'youth-public'
    ) {
      targetToNavigate = decision.targetUrl;
    }
  } else {
    const target = decideAllCquRewrite(details, settings);
    if (target && target !== details.url) {
      record = {
        tabId: details.tabId,
        ruleId: 'all-cqu-domains',
        originalUrl: details.url,
        targetUrl: target,
        recordedAt: Date.now(),
      };
      targetToNavigate = target;
    }
  }

  if (!record || record.targetUrl === record.originalUrl) return;
  await finalizeWinningRewrite(record, navigationToken, targetToNavigate);
}

function scheduleTopFrameRewrite(
  details: Browser.webNavigation.WebNavigationBaseCallbackDetails,
): void {
  if (details.frameId !== 0 || details.tabId < 0) return;
  const navigationToken = Symbol('top-frame-navigation');
  latestTopFrameNavigation.set(details.tabId, navigationToken);
  void rewriteTopFrameNavigation(details, navigationToken)
    .catch((error: unknown) => {
      console.error('Failed to rewrite top-frame navigation', error);
    })
    .finally(() => {
      if (latestTopFrameNavigation.get(details.tabId) === navigationToken) {
        latestTopFrameNavigation.delete(details.tabId);
      }
    });
}

async function dispatchBackgroundMessage(message: BackgroundMessage): Promise<unknown> {
  if (message.type === 'get-tab-state') return getTabState(message.tabId);
  if (message.type === 'open-original-once') return openOriginalOnce(message.tabId);
  return excludeCurrentHost(message.tabId);
}

function handleRuntimeMessage(message: unknown): Promise<unknown> | undefined {
  if (!isBackgroundMessage(message)) return undefined;
  return dispatchBackgroundMessage(message).catch((error: unknown) => {
    console.error('Failed to handle background message', error);
    return undefined;
  });
}

function handleCommittedNavigation(
  details: Browser.webNavigation.WebNavigationTransitionCallbackDetails,
): void {
  if (details.frameId !== 0 || details.tabId < 0) return;
  scheduleSafely('Failed to clear navigation badge', () =>
    browser.action.setBadgeText({ tabId: details.tabId, text: '' }),
  );
  scheduleSafely('Failed to consume original navigation bypass', async () => {
    if (await isOriginalBypass(details.tabId, details.url)) {
      await clearTabSession(details.tabId);
    }
  });
}

function handleNavigationError(
  details: Browser.webNavigation.WebNavigationFramedErrorCallbackDetails,
): void {
  if (details.frameId !== 0 || details.tabId < 0) return;
  scheduleSafely('Failed to record navigation error', async () => {
    const record = await getTabState(details.tabId);
    if (!record || !sameRequestUrl(details.url, record.targetUrl)) return;
    await recordRewrite({ ...record, error: details.error });
    const badgeResults = await Promise.allSettled([
      browser.action.setBadgeBackgroundColor({ tabId: details.tabId, color: '#b42318' }),
      browser.action.setBadgeText({ tabId: details.tabId, text: '!' }),
    ]);
    const failures = badgeResults.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((failure) => failure.reason),
        'Failed to update navigation error badge',
      );
    }
  });
}

function handleTabRemoved(tabId: number): void {
  latestTopFrameNavigation.delete(tabId);
  scheduleSafely('Failed to clear removed tab session', () =>
    queueTabFinalization(tabId, () => clearTabSession(tabId)),
  );
}

export default defineBackground(() => {
  scheduleReconciliation();
  browser.runtime.onInstalled.addListener(scheduleReconciliation);
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.settings) scheduleReconciliation();
  });
  browser.runtime.onMessage.addListener(handleRuntimeMessage);
  browser.webNavigation.onBeforeNavigate.addListener(scheduleTopFrameRewrite);
  browser.webNavigation.onCommitted.addListener(handleCommittedNavigation);
  browser.webNavigation.onErrorOccurred.addListener(handleNavigationError);
  browser.tabs.onRemoved.addListener(handleTabRemoved);
});
