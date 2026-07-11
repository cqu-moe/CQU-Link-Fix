import type { Browser } from 'wxt/browser';
import { decideRegisteredRewrite, getEnabledRules } from '../src/rules/registry';
import { reconcileDynamicRules } from '../src/rules/dnr';
import { loadSettings } from '../src/storage/settings';

let reconciliationQueue = Promise.resolve();

function scheduleReconciliation(): void {
  reconciliationQueue = reconciliationQueue
    .then(reconcileDynamicRules, reconcileDynamicRules)
    .catch((error: unknown) => {
      console.error('Failed to reconcile dynamic DNR rules', error);
    });
}

async function rewriteQueriedYouthNavigation(
  details: Browser.webNavigation.WebNavigationBaseCallbackDetails,
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

  const decision = decideRegisteredRewrite(details.url, getEnabledRules(settings));
  if (!decision || decision.targetUrl === details.url) return;
  await browser.tabs.update(details.tabId, { url: decision.targetUrl });
}

function scheduleQueriedYouthRewrite(
  details: Browser.webNavigation.WebNavigationBaseCallbackDetails,
): void {
  void rewriteQueriedYouthNavigation(details).catch((error: unknown) => {
    console.error('Failed to rewrite queried Youth navigation', error);
  });
}

export default defineBackground(() => {
  scheduleReconciliation();
  browser.runtime.onInstalled.addListener(scheduleReconciliation);
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.settings) scheduleReconciliation();
  });
  browser.webNavigation.onBeforeNavigate.addListener(scheduleQueriedYouthRewrite);
});
