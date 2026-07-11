import type { Browser } from 'wxt/browser';
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

function compareQueriedNavigationPrecedence(
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

async function rewriteQueriedYouthNavigation(
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
    url.hostname.toLowerCase() !== 'youth.cqu.edu.cn' ||
    !/^\/info\/\d+\/\d+\.htm$/.test(url.pathname) ||
    !url.search
  ) {
    return;
  }

  const settings = await loadSettings();
  const host = url.hostname.toLowerCase();
  if (settings.excludedHosts.some((excluded) => excluded.trim().toLowerCase() === host)) return;

  const enabledRules = getEnabledRules(settings).sort(compareQueriedNavigationPrecedence);
  const decision = decideRegisteredRewrite(details.url, enabledRules);
  const winningRule = enabledRules.find((rule) => rule.id === decision?.ruleId);
  if (
    !decision ||
    winningRule?.matcher.kind !== 'youth-article' ||
    winningRule.transformer !== 'youth-public' ||
    decision.targetUrl === details.url
  ) {
    return;
  }
  if (latestTopFrameNavigation.get(details.tabId) !== navigationToken) return;
  await browser.tabs.update(details.tabId, { url: decision.targetUrl });
}

function scheduleQueriedYouthRewrite(
  details: Browser.webNavigation.WebNavigationBaseCallbackDetails,
): void {
  if (details.frameId !== 0 || details.tabId < 0) return;
  const navigationToken = Symbol('top-frame-navigation');
  latestTopFrameNavigation.set(details.tabId, navigationToken);
  void rewriteQueriedYouthNavigation(details, navigationToken)
    .catch((error: unknown) => {
      console.error('Failed to rewrite queried Youth navigation', error);
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
  browser.webNavigation.onBeforeNavigate.addListener(scheduleQueriedYouthRewrite);
  browser.tabs.onRemoved.addListener((tabId) => latestTopFrameNavigation.delete(tabId));
});
