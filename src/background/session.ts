import type { Browser } from 'wxt/browser';
import { loadSettings, saveSettings } from '../storage/settings';

export interface RewriteRecord {
  tabId: number;
  ruleId: string;
  originalUrl: string;
  targetUrl: string;
  recordedAt: number;
  error?: string;
}

interface OriginalBypass {
  tabId: number;
  originalRequestUrl: string;
}

const BYPASS_RULE_ID_START = 1_000_000_000;
const MAX_DNR_RULE_ID = 2_147_483_647;
const BYPASS_PRIORITY = 1_000_000;
const MAIN_FRAME: NonNullable<Browser.declarativeNetRequest.RuleCondition['resourceTypes']> = [
  'main_frame',
];

const recordKey = (tabId: number): string => `rewrite:${tabId}`;
const bypassKey = (tabId: number): string => `bypass:${tabId}`;
const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function assertTabId(tabId: number): void {
  if (!Number.isInteger(tabId) || tabId < 0) throw new Error(`Invalid tab ID: ${tabId}`);
}

function bypassRuleId(tabId: number): number {
  assertTabId(tabId);
  const id = BYPASS_RULE_ID_START + tabId;
  if (id > MAX_DNR_RULE_ID) throw new Error(`Tab ID is outside the bypass rule range: ${tabId}`);
  return id;
}

export function canonicalRequestUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Rewrite URL must be a valid HTTP(S) URL');
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    !url.hostname
  ) {
    throw new Error('Rewrite URL must be a safe HTTP(S) URL');
  }
  url.hash = '';
  return url.toString();
}

export function sameRequestUrl(left: string, right: string): boolean {
  try {
    return canonicalRequestUrl(left) === canonicalRequestUrl(right);
  } catch {
    return false;
  }
}

function isRewriteRecord(value: unknown, tabId?: number): value is RewriteRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<RewriteRecord>;
  return (
    Number.isInteger(record.tabId) &&
    (record.tabId as number) >= 0 &&
    (tabId === undefined || record.tabId === tabId) &&
    typeof record.ruleId === 'string' &&
    record.ruleId.length > 0 &&
    typeof record.originalUrl === 'string' &&
    typeof record.targetUrl === 'string' &&
    typeof record.recordedAt === 'number' &&
    Number.isFinite(record.recordedAt) &&
    (record.error === undefined || typeof record.error === 'string')
  );
}

function assertRewriteRecord(record: RewriteRecord): void {
  if (!isRewriteRecord(record)) throw new Error('Invalid rewrite record');
  canonicalRequestUrl(record.originalUrl);
  canonicalRequestUrl(record.targetUrl);
}

function isOriginalBypassState(value: unknown, tabId: number): value is OriginalBypass {
  if (!value || typeof value !== 'object') return false;
  const bypass = value as Partial<OriginalBypass>;
  return (
    bypass.tabId === tabId &&
    typeof bypass.originalRequestUrl === 'string' &&
    sameRequestUrl(bypass.originalRequestUrl, bypass.originalRequestUrl)
  );
}

async function getOriginalBypass(tabId: number): Promise<OriginalBypass | null> {
  assertTabId(tabId);
  const key = bypassKey(tabId);
  const stored = await browser.storage.session.get(key);
  const value = stored[key];
  return isOriginalBypassState(value, tabId) ? structuredClone(value) : null;
}

export async function recordRewrite(record: RewriteRecord): Promise<void> {
  assertRewriteRecord(record);
  await browser.storage.session.set({
    [recordKey(record.tabId)]: structuredClone(record),
  });
}

export async function getTabState(tabId: number): Promise<RewriteRecord | null> {
  assertTabId(tabId);
  const key = recordKey(tabId);
  const stored = await browser.storage.session.get(key);
  const value = stored[key];
  return isRewriteRecord(value, tabId) ? structuredClone(value) : null;
}

export async function clearRewriteRecord(tabId: number): Promise<void> {
  assertTabId(tabId);
  await browser.storage.session.remove(recordKey(tabId));
}

function ownsBypassRule(rule: Browser.declarativeNetRequest.Rule, tabId: number): boolean {
  return (
    rule.action.type === 'allow' &&
    rule.condition.tabIds?.length === 1 &&
    rule.condition.tabIds[0] === tabId &&
    rule.condition.resourceTypes?.length === 1 &&
    rule.condition.resourceTypes[0] === 'main_frame'
  );
}

export async function isOriginalBypass(tabId: number, url: string): Promise<boolean> {
  const bypass = await getOriginalBypass(tabId);
  return bypass !== null && sameRequestUrl(url, bypass.originalRequestUrl);
}

export async function openOriginalOnce(tabId: number): Promise<void> {
  const record = await getTabState(tabId);
  if (!record) throw new Error('No rewrite is recorded for this tab');

  const originalRequestUrl = canonicalRequestUrl(record.originalUrl);
  const id = bypassRuleId(tabId);
  const existing = (await browser.declarativeNetRequest.getSessionRules()).find(
    (rule) => rule.id === id,
  );
  if (existing && !ownsBypassRule(existing, tabId)) {
    throw new Error(`Session DNR rule ID collision: ${id}`);
  }

  const bypass: OriginalBypass = { tabId, originalRequestUrl };
  await browser.storage.session.set({ [bypassKey(tabId)]: bypass });
  try {
    await browser.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [id],
      addRules: [
        {
          id,
          priority: BYPASS_PRIORITY,
          action: { type: 'allow' },
          condition: {
            regexFilter: `^${escapeRegex(originalRequestUrl)}$`,
            isUrlFilterCaseSensitive: true,
            resourceTypes: MAIN_FRAME,
            tabIds: [tabId],
          },
        },
      ],
    });
    await browser.tabs.update(tabId, { url: record.originalUrl });
  } catch (error) {
    await Promise.allSettled([
      browser.declarativeNetRequest.updateSessionRules({ removeRuleIds: [id] }),
      browser.storage.session.remove(bypassKey(tabId)),
    ]);
    throw error;
  }
}

function normalizeHost(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (
    !normalized ||
    normalized.length > 253 ||
    !normalized.split('.').every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(label),
    )
  ) {
    return null;
  }
  return normalized;
}

function hostFromHttpUrl(value: string): string {
  canonicalRequestUrl(value);
  const host = normalizeHost(new URL(value).hostname);
  if (!host) throw new Error('The tab has no valid HTTP(S) host');
  return host;
}

export async function excludeCurrentHost(tabId: number): Promise<void> {
  assertTabId(tabId);
  const record = await getTabState(tabId);
  const source = record?.originalUrl ?? (await browser.tabs.get(tabId)).url;
  if (!source) throw new Error('The tab has no URL');
  const host = hostFromHttpUrl(source);

  const latest = await loadSettings();
  const excludedHosts = [...latest.excludedHosts, host]
    .map(normalizeHost)
    .filter((candidate): candidate is string => candidate !== null);
  await saveSettings({
    ...latest,
    excludedHosts: [...new Set(excludedHosts)].sort(),
  });
}

export async function clearTabSession(tabId: number): Promise<void> {
  const id = bypassRuleId(tabId);
  const results = await Promise.allSettled([
    browser.declarativeNetRequest.updateSessionRules({ removeRuleIds: [id] }),
    browser.storage.session.remove([recordKey(tabId), bypassKey(tabId)]),
  ]);
  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((failure) => failure.reason),
      `Failed to clear session state for tab ${tabId}`,
    );
  }
}
