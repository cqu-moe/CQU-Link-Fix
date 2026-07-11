import type { Browser } from 'wxt/browser';
import { decideAllCquRewrite } from '../src/background/navigation';
import {
  clearRewriteRecord,
  clearTabSession,
  excludeCurrentHost,
  getOriginalBypassNonce,
  getTabState,
  isOriginalBypass,
  MAX_BYPASS_TAB_ID,
  openOriginalOnce,
  recordRewrite,
  sameRequestUrl,
  type RewriteRecord,
} from '../src/background/session';
import {
  isBackgroundMessage,
  type BackgroundMessage,
  type BackgroundResponse,
} from '../src/messages';
import { decideRegisteredRewrite, getEnabledRules } from '../src/rules/registry';
import { compareRulePrecedence, reconcileDynamicRules } from '../src/rules/dnr';
import type { RuleDefinition } from '../src/rules/types';
import {
  loadSettings,
  saveSettings,
  updateSettings,
  validateExtensionSettings,
} from '../src/storage/settings';

let reconciliationQueue = Promise.resolve();
const latestTopFrameNavigation = new Map<number, symbol>();
const tabFinalizationQueues = new Map<number, Promise<void>>();
const latestCommittedNavigationSequence = new Map<number, number>();
const latestTabEventSequence = new Map<number, number>();
let recordGeneration = 0;

function scheduleReconciliation(): void {
  reconciliationQueue = reconciliationQueue
    .then(reconcileDynamicRules, reconcileDynamicRules)
    .catch((error: unknown) => {
      console.error('Failed to reconcile dynamic DNR rules', error);
    });
}

function isExcludedHost(host: string, excludedHosts: readonly string[]): boolean {
  return excludedHosts.some((excluded) => excluded.trim().toLowerCase() === host);
}

function isHandledByDnr(rule: RuleDefinition, url: URL): boolean {
  return rule.matcher.kind !== 'youth-article' || !url.search;
}

function scheduleSafely(label: string, operation: () => Promise<unknown>): void {
  void Promise.resolve()
    .then(operation)
    .catch((error: unknown) => {
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
    try {
      await browser.action.setBadgeText({ tabId: record.tabId, text: '' });
    } catch (error) {
      console.error('Failed to clear stale rewrite badge', error);
    }
    if (latestTopFrameNavigation.get(record.tabId) !== navigationToken) {
      await restoreRewriteRecord(record.tabId, previous);
      return;
    }
    if (targetToNavigate) {
      await browser.tabs.update(record.tabId, { url: targetToNavigate });
    }
  });
}

function nextTabEventSequence(tabId: number): number {
  const sequence = (latestTabEventSequence.get(tabId) ?? 0) + 1;
  latestTabEventSequence.set(tabId, sequence);
  return sequence;
}

function nextRecordGeneration(details: { tabId: number }, sequence: number): string {
  recordGeneration += 1;
  return `${details.tabId}:${sequence}:${recordGeneration}:${crypto.randomUUID()}`;
}

async function rewriteTopFrameNavigation(
  details: Browser.webNavigation.WebNavigationBaseCallbackDetails,
  navigationToken: symbol,
  navigationSequence: number,
): Promise<void> {
  if (details.frameId !== 0 || details.tabId < 0 || details.tabId > MAX_BYPASS_TAB_ID) return;

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

  const enabledRules = getEnabledRules(settings).sort(compareRulePrecedence);
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
      generation: nextRecordGeneration(details, navigationSequence),
      navigationSequence,
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
        generation: nextRecordGeneration(details, navigationSequence),
        navigationSequence,
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
  if (details.frameId !== 0 || details.tabId < 0 || details.tabId > MAX_BYPASS_TAB_ID) return;
  const navigationSequence = nextTabEventSequence(details.tabId);
  const navigationToken = Symbol('top-frame-navigation');
  latestTopFrameNavigation.set(details.tabId, navigationToken);
  void rewriteTopFrameNavigation(details, navigationToken, navigationSequence)
    .catch((error: unknown) => {
      console.error('Failed to rewrite top-frame navigation', error);
    })
    .finally(() => {
      if (latestTopFrameNavigation.get(details.tabId) === navigationToken) {
        latestTopFrameNavigation.delete(details.tabId);
      }
    });
}

async function dispatchBackgroundMessage(
  message: BackgroundMessage,
): Promise<BackgroundResponse> {
  if (message.type === 'replace-settings') {
    await saveSettings(validateExtensionSettings(message.settings));
    return { ok: true };
  }
  if (message.type === 'persist-all-cqu-mode') {
    if (typeof message.enabled !== 'boolean') {
      throw new Error('All-CQU mode must be a boolean');
    }
    await updateSettings((current) => ({
      ...current,
      enableAllCquDomains: message.enabled,
    }));
    return { ok: true };
  }
  if (message.type === 'get-tab-state') {
    return { ok: true, state: await getTabState(message.tabId) };
  }
  if (message.type === 'open-original-once') {
    await queueTabFinalization(message.tabId, () => openOriginalOnce(message.tabId));
    return { ok: true };
  }
  await excludeCurrentHost(message.tabId);
  return { ok: true };
}

function handleRuntimeMessage(
  message: unknown,
  sender: Browser.runtime.MessageSender,
): Promise<BackgroundResponse> | undefined {
  if (
    !isBackgroundMessage(message) ||
    sender.id !== browser.runtime.id ||
    ('tabId' in message
      ? sender.tab !== undefined && sender.tab.id !== message.tabId
      : sender.tab !== undefined)
  ) {
    return undefined;
  }
  return dispatchBackgroundMessage(message).catch(() => {
    return { ok: false, error: 'Background operation failed' };
  });
}

function handleCommittedNavigation(
  details: Browser.webNavigation.WebNavigationTransitionCallbackDetails,
): void {
  if (details.frameId !== 0 || details.tabId < 0 || details.tabId > MAX_BYPASS_TAB_ID) return;
  latestCommittedNavigationSequence.set(
    details.tabId,
    nextTabEventSequence(details.tabId),
  );
  scheduleSafely('Failed to finalize committed navigation', () =>
    queueTabFinalization(details.tabId, async () => {
      const nonce = await getOriginalBypassNonce(details.tabId, details.url);
      if (nonce) await clearTabSession(details.tabId, nonce);
      await browser.action.setBadgeText({ tabId: details.tabId, text: '' });
    }),
  );
}

function handleNavigationError(
  details: Browser.webNavigation.WebNavigationFramedErrorCallbackDetails,
): void {
  if (details.frameId !== 0 || details.tabId < 0 || details.tabId > MAX_BYPASS_TAB_ID) return;
  scheduleSafely('Failed to record navigation error', async () => {
    await queueTabFinalization(details.tabId, async () => {
      const bypassNonce = await getOriginalBypassNonce(details.tabId, details.url);
      if (bypassNonce) {
        await clearTabSession(details.tabId, bypassNonce);
        await browser.action.setBadgeText({ tabId: details.tabId, text: '' });
        return;
      }

      const record = await getTabState(details.tabId);
      if (
        !record ||
        (latestCommittedNavigationSequence.get(details.tabId) ?? -Infinity) >
          record.navigationSequence ||
        !sameRequestUrl(details.url, record.targetUrl)
      ) {
        return;
      }
      const generation = record.generation;
      await recordRewrite({ ...record, error: details.error });
      const latestBeforeBadge = await getTabState(details.tabId);
      if (
        latestBeforeBadge?.generation !== generation ||
        (latestCommittedNavigationSequence.get(details.tabId) ?? -Infinity) >
          record.navigationSequence
      ) {
        return;
      }
      await Promise.all([
        browser.action.setBadgeBackgroundColor({ tabId: details.tabId, color: '#b42318' }),
        browser.action.setBadgeText({ tabId: details.tabId, text: '!' }),
      ]);
      const latestAfterBadge = await getTabState(details.tabId);
      if (
        latestAfterBadge?.generation !== generation ||
        (latestCommittedNavigationSequence.get(details.tabId) ?? -Infinity) >
          record.navigationSequence
      ) {
        await browser.action.setBadgeText({ tabId: details.tabId, text: '' });
      }
    });
  });
}

function handleTabRemoved(tabId: number): void {
  if (tabId < 0 || tabId > MAX_BYPASS_TAB_ID) return;
  latestTopFrameNavigation.delete(tabId);
  scheduleSafely('Failed to clear removed tab session', () =>
    queueTabFinalization(tabId, () => clearTabSession(tabId)),
  );
  latestCommittedNavigationSequence.delete(tabId);
  latestTabEventSequence.delete(tabId);
}

export default defineBackground(() => {
  latestTopFrameNavigation.clear();
  latestCommittedNavigationSequence.clear();
  latestTabEventSequence.clear();
  recordGeneration = 0;
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
