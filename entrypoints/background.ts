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
import { BUILT_IN_RULES } from '../src/rules/builtins';
import {
  compareRulePrecedence,
  persistedDnrOwnsRewrite,
  reconcileDynamicRules,
  type DnrReconciliationEvidence,
} from '../src/rules/dnr';
import { getDnrReconciliationStatus } from '../src/rules/dnr-status';
import { isYouthArticleMatcher, matcherDnrHandlesUrl } from '../src/rules/matcher';
import { hasTopLevelCasTicket } from '../src/rules/transform';
import {
  allocateNavigationSequence,
  clearCommittedNavigation,
  commitNavigation,
  getCommittedNavigationSequence,
} from '../src/background/navigation-state';
import {
  loadCommittedSettingsSnapshot,
  loadCommittedSettings,
  replaceSettingsAtRevision,
  SettingsApplyFailed,
  SettingsRevisionConflict,
  updateSettingsSnapshot,
} from '../src/storage/settings-repository';
import { CQU_OPTIONAL_ORIGINS } from '../src/storage/settings-permissions';
import {
  acquireCustomPermissionLease,
  cleanupDeletedCustomRulePermissions,
  releaseCustomPermissionLease,
  retryPendingCustomPermissionCleanup,
  renewCustomPermissionLease,
} from '../src/background/custom-permission-leases';
import { queueBackgroundOperation } from '../src/background/coordination';

const latestTopFrameNavigation = new Map<number, symbol>();
const tabFinalizationQueues = new Map<number, Promise<void>>();
let recordGeneration = 0;
let startupReconciliation: Promise<DnrReconciliationEvidence | null> = Promise.resolve({
  previousDynamicRules: [],
  compiledDynamicRules: [],
  validationErrors: [],
});
let startupReconciliationPending = false;

const settingsMutationHooks = {
  apply: async (settings: Parameters<typeof reconcileDynamicRules>[0]) => {
    await reconcileDynamicRules(settings);
  },
  afterApply: cleanupDeletedCustomRulePermissions,
};

function scheduleReconciliation(label = 'Failed to reconcile dynamic DNR rules'): Promise<void> {
  const operation = queueBackgroundOperation(async () => {
    await reconcileDynamicRules();
  });
  void operation.catch((error: unknown) => console.error(label, error));
  return operation;
}

function isExcludedHost(host: string, excludedHosts: readonly string[]): boolean {
  return excludedHosts.some((excluded) => excluded.trim().toLowerCase() === host);
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
  startedBeforeDnrReady: boolean,
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
    url.password ||
    hasTopLevelCasTicket(url)
  ) {
    return;
  }

  if (await isOriginalBypass(details.tabId, details.url)) return;

  let startupEvidence: DnrReconciliationEvidence | null = null;
  if (startedBeforeDnrReady) {
    startupEvidence = await startupReconciliation;
    if (latestTopFrameNavigation.get(details.tabId) !== navigationToken) return;
  }

  const settings = await loadCommittedSettings();
  const host = url.hostname.toLowerCase();
  if (isExcludedHost(host, settings.excludedHosts)) return;

  const enabledRules = getEnabledRules(settings).sort(compareRulePrecedence);
  const decision = decideRegisteredRewrite(details.url, enabledRules);
  const winningRule = enabledRules.find((rule) => rule.id === decision?.ruleId);
  let targetToNavigate: string | null = null;
  let record: RewriteRecord | null = null;

  if (decision && winningRule) {
    const packagedStaticOwnsRewrite = BUILT_IN_RULES.some((builtIn) =>
      builtIn.id === winningRule.id && builtIn.dnrId === winningRule.dnrId,
    ) && matcherDnrHandlesUrl(winningRule.matcher, url);
    const needsStartupFallback = startedBeforeDnrReady &&
      !packagedStaticOwnsRewrite &&
      (startupEvidence === null || !persistedDnrOwnsRewrite(
        startupEvidence.previousDynamicRules,
        startupEvidence.compiledDynamicRules,
        details.url,
        winningRule.dnrId,
        decision.targetUrl,
      ));
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
      needsStartupFallback ||
      !matcherDnrHandlesUrl(winningRule.matcher, url) &&
      isYouthArticleMatcher(winningRule.matcher) &&
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
  const needsStartupFallback = startupReconciliationPending;
  latestTopFrameNavigation.set(details.tabId, navigationToken);
  void allocateNavigationSequence()
    .then((navigationSequence) => rewriteTopFrameNavigation(
      details,
      navigationToken,
      navigationSequence,
      needsStartupFallback,
    ))
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
  switch (message.type) {
    case 'acquire-custom-permission-lease': {
      const lease = await acquireCustomPermissionLease(message.origins);
      return { ok: true, leaseNonce: lease.nonce };
    }
    case 'renew-custom-permission-lease': {
      const lease = await renewCustomPermissionLease(message.nonce, message.origins);
      return { ok: true, leaseExpiresAt: lease.expiresAt };
    }
    case 'release-custom-permission-lease':
      await releaseCustomPermissionLease(message.nonce, {
        cleanupOrigins: message.cleanupOrigins,
      });
      return { ok: true };
    case 'replace-settings': {
      const snapshot = await replaceSettingsAtRevision(
        message.settings,
        message.expectedRevision,
        settingsMutationHooks,
      );
      return { ok: true, revision: snapshot.revision };
    }
    case 'get-settings-snapshot':
      return { ok: true, snapshot: await loadCommittedSettingsSnapshot() };
    case 'get-dnr-status':
      await startupReconciliation;
      return { ok: true, dnrStatus: getDnrReconciliationStatus() };
    case 'reconcile-all-cqu-mode': {
      const snapshot = await updateSettingsSnapshot(async (current) => {
        if (!message.requested) {
          try { await browser.permissions.remove(CQU_OPTIONAL_ORIGINS); } catch { /* Recheck below. */ }
        }
        let granted = false;
        try { granted = await browser.permissions.contains(CQU_OPTIONAL_ORIGINS); } catch { granted = false; }
        if (current.enableAllCquDomains === granted) return current;
        return { ...current, enableAllCquDomains: granted };
      }, settingsMutationHooks);
      return {
        ok: true,
        revision: snapshot.revision,
        enabled: snapshot.settings.enableAllCquDomains,
      };
    }
    case 'get-tab-state':
      return { ok: true, state: await getTabState(message.tabId) };
    case 'open-original-once':
      await queueTabFinalization(message.tabId, () => openOriginalOnce(message.tabId));
      return { ok: true };
    case 'exclude-current-host':
      await excludeCurrentHost(message.tabId, settingsMutationHooks);
      return { ok: true };
    default:
      return assertNeverBackgroundMessage(message);
  }
}

function assertNeverBackgroundMessage(message: never): never {
  throw new Error(`Unsupported background message: ${JSON.stringify(message)}`);
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
    if (error instanceof SettingsApplyFailed) {
      return { ok: false, code: 'settings-apply-failed', error: error.message };
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
  startupReconciliationPending = true;
  startupReconciliation = queueBackgroundOperation(() => reconcileDynamicRules())
    .catch((error: unknown) => {
      console.error('Failed to reconcile dynamic DNR rules at startup', error);
      return null;
    })
    .finally(() => {
      startupReconciliationPending = false;
    });
  void startupReconciliation.then(() => retryPendingCustomPermissionCleanup()).catch(
    (error: unknown) => console.error('Failed to retry custom permission cleanup at startup', error),
  );
  browser.runtime.onInstalled.addListener(() => {
    void scheduleReconciliation('Failed to reconcile dynamic DNR rules after install');
  });
  const reconcilePermissionState = (permissions: Browser.permissions.Permissions): void => {
    const changedOrigins = permissions.origins ?? [];
    if (!CQU_OPTIONAL_ORIGINS.origins.some((origin) => changedOrigins.includes(origin))) return;
    scheduleSafely('Failed to reconcile all-CQU permission state', async () => {
      await updateSettingsSnapshot(async (current) => {
        let granted = false;
        try { granted = await browser.permissions.contains(CQU_OPTIONAL_ORIGINS); } catch { granted = false; }
        if (current.enableAllCquDomains === granted) return current;
        return { ...current, enableAllCquDomains: granted };
      }, settingsMutationHooks);
    });
  };
  try {
    browser.permissions.onAdded.addListener(reconcilePermissionState);
    browser.permissions.onRemoved.addListener(reconcilePermissionState);
  } catch {
    // Some test doubles do not implement optional-permission events.
  }
  browser.runtime.onMessage.addListener(handleRuntimeMessage);
  browser.webNavigation.onBeforeNavigate.addListener(scheduleTopFrameRewrite);
  browser.webNavigation.onCommitted.addListener(handleCommittedNavigation);
  browser.webNavigation.onErrorOccurred.addListener(handleNavigationError);
  browser.tabs.onRemoved.addListener(handleTabRemoved);
});
