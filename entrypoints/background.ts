import type { Browser } from 'wxt/browser';
import { decideAllCquRewrite } from '../src/background/navigation';
import { decideRegisteredRewrite, getEnabledRules } from '../src/rules/registry';
import { getRulePriority, reconcileDynamicRules } from '../src/rules/dnr';
import type { RuleDefinition } from '../src/rules/types';
import { loadSettings } from '../src/storage/settings';

let reconciliationQueue = Promise.resolve();
const latestTopFrameNavigation = new Map<number, symbol>();

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

  const settings = await loadSettings();
  const host = url.hostname.toLowerCase();
  if (isExcludedHost(host, settings.excludedHosts)) return;

  const enabledRules = getEnabledRules(settings).sort(compareNavigationPrecedence);
  const decision = decideRegisteredRewrite(details.url, enabledRules);
  const winningRule = enabledRules.find((rule) => rule.id === decision?.ruleId);
  let target: string | null = null;

  if (decision && winningRule) {
    if (isHandledByDnr(winningRule, url)) return;
    if (
      winningRule.matcher.kind === 'youth-article' &&
      winningRule.transformer === 'youth-public'
    ) {
      target = decision.targetUrl;
    }
  } else {
    target = decideAllCquRewrite(details, settings);
  }

  if (!target || target === details.url) return;
  if (latestTopFrameNavigation.get(details.tabId) !== navigationToken) return;
  await browser.tabs.update(details.tabId, { url: target });
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

export default defineBackground(() => {
  scheduleReconciliation();
  browser.runtime.onInstalled.addListener(scheduleReconciliation);
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.settings) scheduleReconciliation();
  });
  browser.webNavigation.onBeforeNavigate.addListener(scheduleTopFrameRewrite);
  browser.tabs.onRemoved.addListener((tabId) => latestTopFrameNavigation.delete(tabId));
});
