import type { Browser } from 'wxt/browser';
import { updateSettings } from '../storage/settings';

export interface RewriteRecord {
  tabId: number;
  ruleId: string;
  originalUrl: string;
  targetUrl: string;
  recordedAt: number;
  generation: string;
  navigationSequence: number;
  error?: string;
}

interface BypassRuleIdentity {
  id: number;
  priority: number;
  regexFilter: string;
  tabId: number;
  actionType: 'allow';
  resourceType: 'main_frame';
  isUrlFilterCaseSensitive: true;
}

interface OriginalBypass {
  tabId: number;
  originalRequestUrl: string;
  recordGeneration: string;
  nonce: string;
  rule: BypassRuleIdentity;
}

const BYPASS_RULE_ID_START = 1_000_000_000;
const MAX_DNR_RULE_ID = 2_147_483_647;
export const MAX_BYPASS_TAB_ID = MAX_DNR_RULE_ID - BYPASS_RULE_ID_START;
const BYPASS_PRIORITY = 1_000_000;
const MAIN_FRAME: NonNullable<Browser.declarativeNetRequest.RuleCondition['resourceTypes']> = [
  'main_frame',
];

const recordKey = (tabId: number): string => `rewrite:${tabId}`;
const bypassKey = (tabId: number): string => `bypass:${tabId}`;
const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function assertTabId(tabId: number): void {
  if (
    !Number.isInteger(tabId) ||
    tabId < 0 ||
    tabId > MAX_BYPASS_TAB_ID
  ) {
    throw new Error(`Invalid tab ID: ${tabId}`);
  }
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
    (record.tabId as number) <= MAX_BYPASS_TAB_ID &&
    (tabId === undefined || record.tabId === tabId) &&
    typeof record.ruleId === 'string' &&
    record.ruleId.length > 0 &&
    typeof record.originalUrl === 'string' &&
    typeof record.targetUrl === 'string' &&
    typeof record.recordedAt === 'number' &&
    Number.isFinite(record.recordedAt) &&
    typeof record.generation === 'string' &&
    record.generation.length > 0 &&
    Number.isInteger(record.navigationSequence) &&
    (record.navigationSequence as number) >= 0 &&
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
  let expectedRegex: string;
  try {
    expectedRegex = `^${escapeRegex(canonicalRequestUrl(bypass.originalRequestUrl ?? ''))}$`;
  } catch {
    return false;
  }
  return (
    bypass.tabId === tabId &&
    typeof bypass.originalRequestUrl === 'string' &&
    sameRequestUrl(bypass.originalRequestUrl, bypass.originalRequestUrl) &&
    typeof bypass.recordGeneration === 'string' &&
    bypass.recordGeneration.length > 0 &&
    typeof bypass.nonce === 'string' &&
    bypass.nonce.length > 0 &&
    isBypassRuleIdentity(bypass.rule, tabId) &&
    bypass.rule.id === bypassRuleId(tabId) &&
    bypass.rule.regexFilter === expectedRegex
  );
}

function isBypassRuleIdentity(
  value: unknown,
  tabId: number,
): value is BypassRuleIdentity {
  if (!value || typeof value !== 'object') return false;
  const rule = value as Partial<BypassRuleIdentity>;
  return (
    Number.isInteger(rule.id) &&
    (rule.id as number) >= 1 &&
    (rule.id as number) <= MAX_DNR_RULE_ID &&
    Number.isInteger(rule.priority) &&
    (rule.priority as number) > BYPASS_PRIORITY &&
    (rule.priority as number) <= MAX_DNR_RULE_ID &&
    typeof rule.regexFilter === 'string' &&
    rule.regexFilter.length > 0 &&
    rule.tabId === tabId &&
    rule.actionType === 'allow' &&
    rule.resourceType === 'main_frame' &&
    rule.isUrlFilterCaseSensitive === true
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

function ownsBypassRule(
  rule: Browser.declarativeNetRequest.Rule,
  identity: BypassRuleIdentity,
): boolean {
  return (
    hasExactKeys(rule, ['action', 'condition', 'id', 'priority']) &&
    hasExactKeys(rule.action, ['type']) &&
    hasExactKeys(rule.condition, [
      'isUrlFilterCaseSensitive',
      'regexFilter',
      'resourceTypes',
      'tabIds',
    ]) &&
    rule.id === identity.id &&
    rule.priority === identity.priority &&
    rule.action.type === 'allow' &&
    rule.condition.regexFilter === identity.regexFilter &&
    rule.condition.isUrlFilterCaseSensitive === identity.isUrlFilterCaseSensitive &&
    rule.condition.tabIds?.length === 1 &&
    rule.condition.tabIds[0] === identity.tabId &&
    rule.condition.resourceTypes?.length === 1 &&
    rule.condition.resourceTypes[0] === identity.resourceType
  );
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export async function getOriginalBypassNonce(
  tabId: number,
  url: string,
): Promise<string | null> {
  const bypass = await getOriginalBypass(tabId);
  if (!bypass || !sameRequestUrl(url, bypass.originalRequestUrl)) return null;
  const rules = await browser.declarativeNetRequest.getSessionRules();
  const latest = await getOriginalBypass(tabId);
  if (!latest || latest.nonce !== bypass.nonce) return null;
  return rules.some((rule) => ownsBypassRule(rule, bypass.rule)) ? bypass.nonce : null;
}

export async function isOriginalBypass(tabId: number, url: string): Promise<boolean> {
  return (await getOriginalBypassNonce(tabId, url)) !== null;
}

export async function openOriginalOnce(tabId: number): Promise<void> {
  const record = await getTabState(tabId);
  if (!record) throw new Error('No rewrite is recorded for this tab');

  const originalRequestUrl = canonicalRequestUrl(record.originalUrl);
  const id = bypassRuleId(tabId);
  const previousBypass = await getOriginalBypass(tabId);
  const existing = (await browser.declarativeNetRequest.getSessionRules()).find((rule) =>
    rule.id === id,
  );
  if (
    existing &&
    (!Number.isInteger(existing.priority) ||
      !previousBypass ||
      !ownsBypassRule(existing, previousBypass.rule))
  ) {
    throw new Error(`Session DNR rule ID collision: ${id}`);
  }

  const priority = existing ? existing.priority! + 1 : BYPASS_PRIORITY + 1;
  if (!Number.isInteger(priority) || priority > MAX_DNR_RULE_ID) {
    throw new Error(`Bypass priority is outside the DNR range: ${priority}`);
  }
  const regexFilter = `^${escapeRegex(originalRequestUrl)}$`;
  const bypass: OriginalBypass = {
    tabId,
    originalRequestUrl,
    recordGeneration: record.generation,
    nonce: crypto.randomUUID(),
    rule: {
      id,
      priority,
      regexFilter,
      tabId,
      actionType: 'allow',
      resourceType: 'main_frame',
      isUrlFilterCaseSensitive: true,
    },
  };
  await browser.storage.session.set({ [bypassKey(tabId)]: bypass });
  try {
    await browser.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [id],
      addRules: [
        {
          id,
          priority,
          action: { type: 'allow' },
          condition: {
            regexFilter,
            isUrlFilterCaseSensitive: true,
            resourceTypes: MAIN_FRAME,
            tabIds: [tabId],
          },
        },
      ],
    });
  } catch (error) {
    if (previousBypass) {
      await browser.storage.session.set({ [bypassKey(tabId)]: previousBypass });
    } else {
      await browser.storage.session.remove(bypassKey(tabId));
    }
    throw error;
  }

  try {
    await browser.tabs.update(tabId, { url: record.originalUrl });
  } catch (error) {
    await clearOwnedBypass(tabId, bypass.nonce, false);
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

  await updateSettings((latest) => {
    const excludedHosts = [...latest.excludedHosts, host]
      .map(normalizeHost)
      .filter((candidate): candidate is string => candidate !== null);
    return {
      ...latest,
      excludedHosts: [...new Set(excludedHosts)].sort(),
    };
  });
}

async function clearOwnedBypass(
  tabId: number,
  expectedNonce?: string,
  removeRecord = true,
): Promise<void> {
  assertTabId(tabId);
  const bypass = await getOriginalBypass(tabId);
  if (!bypass) {
    if (expectedNonce) return;
    if (removeRecord) {
      await browser.storage.session.remove([bypassKey(tabId), recordKey(tabId)]);
    }
    return;
  }
  if (expectedNonce && bypass.nonce !== expectedNonce) return;

  const rules = await browser.declarativeNetRequest.getSessionRules();
  const latestBeforeRemoval = await getOriginalBypass(tabId);
  if (!latestBeforeRemoval || latestBeforeRemoval.nonce !== bypass.nonce) return;
  const candidate = rules.find((rule) => rule.id === bypass.rule.id);
  if (candidate && ownsBypassRule(candidate, bypass.rule)) {
    await browser.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [bypass.rule.id],
    });
    const rulesAfterRemoval = await browser.declarativeNetRequest.getSessionRules();
    const ownerAfterRemoval = await getOriginalBypass(tabId);
    if (!ownerAfterRemoval || ownerAfterRemoval.nonce !== bypass.nonce) return;
    if (rulesAfterRemoval.some((rule) => ownsBypassRule(rule, bypass.rule))) {
      throw new Error(`Owned bypass rule ${bypass.rule.id} is still installed`);
    }
  }

  const latestAfterRemoval = await getOriginalBypass(tabId);
  if (!latestAfterRemoval || latestAfterRemoval.nonce !== bypass.nonce) return;
  await browser.storage.session.remove(bypassKey(tabId));
  if (removeRecord) {
    const currentRecord = await getTabState(tabId);
    if (currentRecord?.generation === bypass.recordGeneration) {
      await clearRewriteRecord(tabId);
    }
  }
}

export async function clearTabSession(
  tabId: number,
  expectedNonce?: string,
): Promise<void> {
  await clearOwnedBypass(tabId, expectedNonce, true);
}
