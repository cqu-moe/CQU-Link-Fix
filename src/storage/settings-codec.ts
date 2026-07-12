import type { CustomRule } from '../rules/types';
import { BUILT_IN_RULES } from '../rules/builtins';
import {
  assertCustomDnrId,
  isBuiltInSourceHost,
  normalizeDnsHost,
} from '../rules/custom-rule-policy';
import { parsePersistedCustomMatcher } from '../rules/matcher';
import {
  DEFAULT_SETTINGS,
  type EditableSettings,
  type ExtensionSettings,
  type ReplaceSettingsResult,
  type SettingsSnapshot,
} from './settings-types';

const BUILT_IN_RULE_IDS = new Set(BUILT_IN_RULES.map((rule) => rule.id));
const BUILT_IN_DNR_IDS = new Set(BUILT_IN_RULES.map((rule) => rule.dnrId));
const EXCLUSION_DNR_ID_START = 80_000;

export function isSafeSettingsRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

export function decodeStoredSettings(value: unknown): ExtensionSettings {
  if (!isPlainObject(value)) return structuredClone(DEFAULT_SETTINGS);
  const allowed = new Set(Object.keys(DEFAULT_SETTINGS));
  if (!Object.keys(value).every((key) => allowed.has(key))) {
    return structuredClone(DEFAULT_SETTINGS);
  }
  const merged = { ...DEFAULT_SETTINGS, ...value } as Record<string, unknown>;
  if (
    typeof merged.enabled !== 'boolean' ||
    typeof merged.enableAllCquDomains !== 'boolean' ||
    !Array.isArray(merged.disabledRuleIds) ||
    !merged.disabledRuleIds.every((item) => typeof item === 'string') ||
    !Array.isArray(merged.customRules) ||
    !Array.isArray(merged.excludedHosts) ||
    !merged.excludedHosts.every((item) => typeof item === 'string')
  ) return structuredClone(DEFAULT_SETTINGS);
  return structuredClone(merged) as unknown as ExtensionSettings;
}

export function parseSettingsSnapshotResponse(value: unknown): SettingsSnapshot | null {
  if (
    !isPlainObject(value) ||
    value.ok !== true ||
    !hasExactKeys(value, ['ok', 'snapshot'])
  ) return null;
  try {
    return validateSettingsSnapshot(value.snapshot);
  } catch {
    return null;
  }
}

export function parseSettingsMutationResponse(value: unknown): ReplaceSettingsResult {
  if (
    isPlainObject(value) &&
    value.ok === true &&
    hasExactKeys(value, ['ok', 'revision']) &&
    isSafeSettingsRevision(value.revision)
  ) return { ok: true, revision: value.revision };
  if (
    isPlainObject(value) &&
    value.ok === false &&
    typeof value.error === 'string' &&
    value.error.trim() &&
    (value.code === undefined ||
      value.code === 'settings-conflict' ||
      value.code === 'settings-apply-failed' ||
      value.code === 'operation-failed')
  ) return {
    ok: false,
    code: value.code === 'settings-conflict' || value.code === 'settings-apply-failed'
      ? value.code
      : 'operation-failed',
    error: value.error.trim(),
  };
  return { ok: false, code: 'operation-failed', error: 'Background operation failed' };
}

export function parseAllCquModeResponse(value: unknown, requested: boolean): boolean {
  return isPlainObject(value) &&
    hasExactKeys(value, ['enabled', 'ok', 'revision']) &&
    value.ok === true &&
    typeof value.enabled === 'boolean' &&
    isSafeSettingsRevision(value.revision) &&
    value.enabled === requested;
}

export function validateExtensionSettings(value: unknown): ExtensionSettings {
  if (!isPlainObject(value) || !hasExactKeys(value, [
    'customRules',
    'disabledRuleIds',
    'enableAllCquDomains',
    'enabled',
    'excludedHosts',
  ])) {
    throw new Error('Settings payload has an invalid shape');
  }
  if (typeof value.enableAllCquDomains !== 'boolean') {
    throw new Error('Settings switches must be booleans');
  }
  const editable = validateEditableSettings({
    enabled: value.enabled,
    disabledRuleIds: value.disabledRuleIds,
    customRules: value.customRules,
    excludedHosts: value.excludedHosts,
  });
  return { ...editable, enableAllCquDomains: value.enableAllCquDomains };
}

export function validateSettingsSnapshot(value: unknown): SettingsSnapshot {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, ['revision', 'settings']) ||
    !isSafeSettingsRevision(value.revision)
  ) {
    throw new Error('Settings snapshot has an invalid shape');
  }
  return {
    settings: validateExtensionSettings(value.settings),
    revision: value.revision,
  };
}

export function validateEditableSettings(value: unknown): EditableSettings {
  if (!isPlainObject(value) || !hasExactKeys(value, [
    'customRules', 'disabledRuleIds', 'enabled', 'excludedHosts',
  ])) throw new Error('Editable settings payload has an invalid shape');
  if (typeof value.enabled !== 'boolean') throw new Error('Settings switches must be booleans');
  const disabledRuleIds = parseStringArray(value.disabledRuleIds, 'disabled rule IDs');
  const excludedHosts = parseStringArray(value.excludedHosts, 'excluded hosts')
    .map((host) => {
      const normalized = normalizeDnsHost(host);
      if (!normalized) throw new Error(`Invalid excluded host: ${host}`);
      return normalized;
    });
  if (!Array.isArray(value.customRules)) throw new Error('Custom rules must be an array');
  const normalizedExcludedHosts = [...new Set(excludedHosts)].sort();
  const customRules = value.customRules.map(parseCustomRule);
  const ruleIds = new Set<string>(BUILT_IN_RULE_IDS);
  const dnrIds = new Set<number>();
  const exclusionIds = new Set(
    normalizedExcludedHosts.map((_, index) => EXCLUSION_DNR_ID_START + index),
  );
  const customHosts = new Set<string>();
  for (const rule of customRules) {
    if (ruleIds.has(rule.id)) throw new Error(`Colliding custom rule ID: ${rule.id}`);
    if (
      dnrIds.has(rule.dnrId) ||
      BUILT_IN_DNR_IDS.has(rule.dnrId) ||
      exclusionIds.has(rule.dnrId)
    ) throw new Error(`Colliding custom DNR rule ID: ${rule.dnrId}`);
    const host = rule.matcher.host;
    if (isBuiltInSourceHost(host)) {
      throw new Error(`Custom host duplicates a built-in source: ${host}`);
    }
    if (customHosts.has(host)) throw new Error(`Duplicate custom source host: ${host}`);
    ruleIds.add(rule.id);
    dnrIds.add(rule.dnrId);
    customHosts.add(host);
  }
  return {
    enabled: value.enabled,
    disabledRuleIds: [...new Set(disabledRuleIds.map((id) => id.trim()))].sort(),
    customRules,
    excludedHosts: normalizedExcludedHosts,
  };
}

function parseCustomRule(value: unknown): CustomRule {
  if (!isPlainObject(value) || !hasExactKeys(value, [
    'category',
    'defaultEnabled',
    'description',
    'dnrId',
    'id',
    'matcher',
    'name',
    'transformer',
  ])) throw new Error('Custom rule has an invalid shape');
  if (
    typeof value.id !== 'string' ||
    !value.id.trim() ||
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    typeof value.description !== 'string' ||
    value.category !== 'custom' ||
    typeof value.defaultEnabled !== 'boolean' ||
    !isPlainObject(value.matcher)
  ) throw new Error('Custom rule fields are invalid');

  let dnrId: number;
  try {
    dnrId = assertCustomDnrId(value.dnrId);
  } catch {
    throw new Error('Custom DNR rule ID is invalid');
  }
  const matcher = parsePersistedCustomMatcher(value.matcher, value.transformer);
  return {
    id: value.id.trim(),
    dnrId,
    name: value.name,
    description: value.description,
    category: 'custom',
    defaultEnabled: value.defaultEnabled,
    matcher,
    transformer: value.transformer as CustomRule['transformer'],
  };
}

function parseStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`Settings ${label} must contain non-empty strings`);
  }
  return structuredClone(value);
}
