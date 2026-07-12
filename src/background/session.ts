import type { Browser } from 'wxt/browser';
import {
  MAX_REWRITE_TAB_ID,
  canonicalRequestUrl,
  isRewriteRecord,
  sameRequestUrl,
  type RewriteRecord,
} from '../rewrite-record';
import { updateSettings } from '../storage/settings-repository';
import type { SettingsMutationHooks } from '../storage/settings-types';

export { canonicalRequestUrl, sameRequestUrl, type RewriteRecord } from '../rewrite-record';

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
const BYPASS_RULE_ID_CAPACITY = MAX_DNR_RULE_ID - BYPASS_RULE_ID_START + 1;
export const MAX_BYPASS_TAB_ID = MAX_REWRITE_TAB_ID;
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

function firstBypassRuleId(tabId: number): number {
  assertTabId(tabId);
  return BYPASS_RULE_ID_START + (tabId % BYPASS_RULE_ID_CAPACITY);
}

function allocateBypassRuleId(
  tabId: number,
  rules: readonly Browser.declarativeNetRequest.Rule[],
): number {
  const occupied = new Set(rules.map((rule) => rule.id));
  let candidate = firstBypassRuleId(tabId);
  for (let attempts = 0; attempts <= occupied.size; attempts += 1) {
    if (!occupied.has(candidate)) return candidate;
    candidate = candidate === MAX_DNR_RULE_ID ? BYPASS_RULE_ID_START : candidate + 1;
  }
  throw new Error('No session DNR rule ID is available for the original bypass');
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
    expectedRegex = `^${escapeRegex(canonicalRequestUrl(bypass.originalRequestUrl ?? ''))}(?:#.*)?$`;
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
    bypass.rule.id >= BYPASS_RULE_ID_START &&
    bypass.rule.id <= MAX_DNR_RULE_ID &&
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
  const previousBypass = await getOriginalBypass(tabId);
  const sessionRules = await browser.declarativeNetRequest.getSessionRules();
  const previousRule = previousBypass
    ? sessionRules.find((rule) => rule.id === previousBypass.rule.id)
    : undefined;
  const existing = previousRule && previousBypass && ownsBypassRule(previousRule, previousBypass.rule)
    ? previousRule
    : undefined;
  const id = existing?.id ?? allocateBypassRuleId(tabId, sessionRules);

  const priority = existing ? existing.priority! + 1 : BYPASS_PRIORITY + 1;
  if (!Number.isInteger(priority) || priority > MAX_DNR_RULE_ID) {
    throw new Error(`Bypass priority is outside the DNR range: ${priority}`);
  }
  const regexFilter = `^${escapeRegex(originalRequestUrl)}(?:#.*)?$`;
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

export async function excludeCurrentHost(
  tabId: number,
  hooks?: SettingsMutationHooks,
): Promise<void> {
  assertTabId(tabId);
  const tabUrl = (await browser.tabs.get(tabId)).url;
  if (!tabUrl) throw new Error('The tab has no URL');
  const record = await getTabState(tabId);
  const source = record && sameRequestUrl(tabUrl, record.targetUrl)
    ? record.originalUrl
    : tabUrl;
  const host = hostFromHttpUrl(source);

  await updateSettings((latest) => {
    const excludedHosts = [...latest.excludedHosts, host]
      .map(normalizeHost)
      .filter((candidate): candidate is string => candidate !== null);
    return {
      ...latest,
      excludedHosts: [...new Set(excludedHosts)].sort(),
    };
  }, hooks);
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
