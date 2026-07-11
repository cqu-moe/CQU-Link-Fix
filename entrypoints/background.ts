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
  allocateNavigationSequence,
  clearCommittedNavigation,
  commitNavigation,
  getCommittedNavigationSequence,
} from '../src/background/navigation-state';
import {
  loadSettingsSnapshot,
  loadSettings,
  replaceSettingsAtRevision,
  SettingsRevisionConflict,
  updateSettingsSnapshot,
} from '../src/storage/settings';
import {
  acquireCustomPermissionLease,
  releaseCustomPermissionLease,
  renewCustomPermissionLease,
} from '../src/background/custom-permission-leases';

let reconciliationQueue = Promise.resolve();
const latestTopFrameNavigation = new Map<number, symbol>();
const tabFinalizationQueues = new Map<number, Promise<void>>();
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
  const navigationToken = Symbol('top-frame-navigation');
  latestTopFrameNavigation.set(details.tabId, navigationToken);
  void allocateNavigationSequence()
    .then((navigationSequence) => rewriteTopFrameNavigation(details, navigationToken, navigationSequence))
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
  if (message.type === 'acquire-custom-permission-lease') {
    const lease = await acquireCustomPermissionLease(message.origins);
    return { ok: true, leaseNonce: lease.nonce };
  }
  if (message.type === 'renew-custom-permission-lease') {
    const lease = await renewCustomPermissionLease(message.nonce, message.origins);
    return { ok: true, leaseExpiresAt: lease.expiresAt };
  }
  if (message.type === 'release-custom-permission-lease') {
    const released = await releaseCustomPermissionLease(message.nonce);
    return { ok: true, requiredOrigins: released.requiredOrigins };
  }
  if (message.type === 'replace-settings') {
    const snapshot = await replaceSettingsAtRevision(message.settings, message.expectedRevision);
    return { ok: true, revision: snapshot.revision };
  }
  if (message.type === 'get-settings-snapshot') {
    return { ok: true, snapshot: await loadSettingsSnapshot() };
  }
  if (message.type === 'persist-all-cqu-mode') {
    if (typeof message.enabled !== 'boolean') {
      throw new Error('All-CQU mode must be a boolean');
    }
    const snapshot = await updateSettingsSnapshot((current) => ({
      ...current,
      enableAllCquDomains: message.enabled,
    }));
    return { ok: true, revision: snapshot.revision };
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
  const isExtensionPage = typeof sender.url === 'string' &&
    sender.url.startsWith(browser.runtime.getURL(''));
  if (
    !isBackgroundMessage(message) ||
    sender.id !== browser.runtime.id ||
    ('tabId' in message
      ? sender.tab !== undefined && sender.tab.id !== message.tabId && !isExtensionPage
      : sender.tab !== undefined && !isExtensionPage)
  ) {
    return undefined;
  }
  return dispatchBackgroundMessage(message).catch((error: unknown) => {
    if (error instanceof SettingsRevisionConflict) {
      return { ok: false, code: 'settings-conflict', error: error.message };
    }
    return { ok: false, code: 'operation-failed', error: 'Background operation failed' };
  });
}

function handleCommittedNavigation(
  details: Browser.webNavigation.WebNavigationTransitionCallbackDetails,
): void {
  if (details.frameId !== 0 || details.tabId < 0 || details.tabId > MAX_BYPASS_TAB_ID) return;
  scheduleSafely('Failed to finalize committed navigation', () =>
    queueTabFinalization(details.tabId, async () => {
      await commitNavigation(details.tabId);
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
      const committedSequence = await getCommittedNavigationSequence(details.tabId);
      if (
        !record ||
        committedSequence > record.navigationSequence ||
        !sameRequestUrl(details.url, record.targetUrl)
      ) {
        return;
      }
      const generation = record.generation;
      await recordRewrite({ ...record, error: details.error });
      const latestBeforeBadge = await getTabState(details.tabId);
      const committedBeforeBadge = await getCommittedNavigationSequence(details.tabId);
      if (
        latestBeforeBadge?.generation !== generation ||
        committedBeforeBadge > record.navigationSequence
      ) {
        return;
      }
      await Promise.all([
        browser.action.setBadgeBackgroundColor({ tabId: details.tabId, color: '#b42318' }),
        browser.action.setBadgeText({ tabId: details.tabId, text: '!' }),
      ]);
      const latestAfterBadge = await getTabState(details.tabId);
      const committedAfterBadge = await getCommittedNavigationSequence(details.tabId);
      if (
        latestAfterBadge?.generation !== generation ||
        committedAfterBadge > record.navigationSequence
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
    queueTabFinalization(tabId, async () => {
      try {
        await clearTabSession(tabId);
      } finally {
        await clearCommittedNavigation(tabId);
      }
    }),
  );
}

export default defineBackground(() => {
  latestTopFrameNavigation.clear();
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
