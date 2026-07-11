import type { CustomRule } from '../rules/types';
import type { BackgroundResponse } from '../messages';
import { BUILT_IN_RULES } from '../rules/builtins';

export interface ExtensionSettings {
  enabled: boolean;
  enableAllCquDomains: boolean;
  disabledBuiltInRuleIds: string[];
  customRules: CustomRule[];
  excludedHosts: string[];
}

export type EditableSettings = Omit<ExtensionSettings, 'enableAllCquDomains'>;
export interface SettingsSnapshot { settings: ExtensionSettings; revision: number }
export type ReplaceSettingsResult =
  | { ok: true; revision: number }
  | { ok: false; code: 'settings-conflict' | 'operation-failed'; error: string };

export const DEFAULT_SETTINGS: ExtensionSettings = {
  enabled: true,
  enableAllCquDomains: false,
  disabledBuiltInRuleIds: [],
  customRules: [],
  excludedHosts: [],
};

const SETTINGS_KEY = 'settings';
const SETTINGS_REVISION_KEY = 'settingsRevision';
const CQU_OPTIONAL_ORIGINS = {
  origins: ['*://cqu.edu.cn/*', '*://*.cqu.edu.cn/*'],
};
const MAX_DNR_RULE_ID = 2_147_483_647;
const BUILT_IN_RULE_IDS = new Set(BUILT_IN_RULES.map((rule) => rule.id));
const BUILT_IN_DNR_IDS = new Set(BUILT_IN_RULES.map((rule) => rule.dnrId));
const EXCLUSION_DNR_ID_START = 80_000;
let settingsWriteQueue = Promise.resolve();

export async function loadSettings(): Promise<ExtensionSettings> {
  return (await loadSettingsSnapshot()).settings;
}

export async function loadSettingsSnapshot(): Promise<SettingsSnapshot> {
  const stored = await browser.storage.local.get([SETTINGS_KEY, SETTINGS_REVISION_KEY]);
  const merged = {
    ...DEFAULT_SETTINGS,
    ...(stored[SETTINGS_KEY] as Partial<ExtensionSettings> | undefined),
  };
  const revision = stored[SETTINGS_REVISION_KEY];
  return {
    settings: structuredClone(merged),
    revision: Number.isSafeInteger(revision) && (revision as number) >= 0 ? revision as number : 0,
  };
}

export async function saveSettings(next: ExtensionSettings): Promise<void> {
  const snapshot = structuredClone(next);
  await queueSettingsWrite(async () => {
    const current = await loadSettingsSnapshot();
    await writeSettings(snapshot, current.revision + 1);
  });
}

export async function replaceSettingsViaBackground(
  next: EditableSettings,
  expectedRevision: number,
): Promise<ReplaceSettingsResult> {
  return sendSettingsMutationMessage({
    type: 'replace-settings',
    settings: structuredClone(next),
    expectedRevision,
  });
}

export async function getSettingsSnapshotViaBackground(): Promise<SettingsSnapshot | null> {
  try {
    const response = await browser.runtime.sendMessage({ type: 'get-settings-snapshot' }) as BackgroundResponse | undefined;
    return response?.ok === true && 'snapshot' in response ? structuredClone(response.snapshot) : null;
  } catch { return null; }
}

async function persistAllCquModeViaBackground(enabled: boolean): Promise<boolean> {
  return (await sendSettingsMutationMessage({ type: 'persist-all-cqu-mode', enabled })).ok;
}

async function sendSettingsMutationMessage(message: unknown): Promise<ReplaceSettingsResult> {
  try {
    const response = (await browser.runtime.sendMessage(message)) as
      | BackgroundResponse
      | undefined;
    if (response?.ok === true) {
      return { ok: true, revision: 'revision' in response ? response.revision : 0 };
    }
    if (response?.ok === false) return {
      ok: false,
      code: response.code === 'settings-conflict' ? 'settings-conflict' : 'operation-failed',
      error: response.error,
    };
    return { ok: false, code: 'operation-failed', error: 'Background operation failed' };
  } catch {
    return { ok: false, code: 'operation-failed', error: 'Background operation failed' };
  }
}

async function writeSettings(next: ExtensionSettings, revision: number): Promise<void> {
  await browser.storage.local.set({
    [SETTINGS_KEY]: structuredClone(next),
    [SETTINGS_REVISION_KEY]: revision,
  });
}

function queueSettingsWrite<T>(operation: () => Promise<T>): Promise<T> {
  const current = settingsWriteQueue.then(operation, operation);
  settingsWriteQueue = current.then(
    () => undefined,
    () => undefined,
  );
  return current;
}

export async function updateSettings(
  mutator: (current: ExtensionSettings) => ExtensionSettings | Promise<ExtensionSettings>,
): Promise<ExtensionSettings> {
  return (await updateSettingsSnapshot(mutator)).settings;
}

export async function updateSettingsSnapshot(
  mutator: (current: ExtensionSettings) => ExtensionSettings | Promise<ExtensionSettings>,
): Promise<SettingsSnapshot> {
  return queueSettingsWrite(async () => {
    const snapshot = await loadSettingsSnapshot();
    const next = structuredClone(await mutator(snapshot.settings));
    const revision = snapshot.revision + 1;
    await writeSettings(next, revision);
    return { settings: structuredClone(next), revision };
  });
}

export class SettingsRevisionConflict extends Error {
  constructor() { super('Settings changed since they were loaded'); this.name = 'SettingsRevisionConflict'; }
}

export async function replaceSettingsAtRevision(
  editable: EditableSettings,
  expectedRevision: number,
): Promise<SettingsSnapshot> {
  return queueSettingsWrite(async () => {
    const current = await loadSettingsSnapshot();
    if (current.revision !== expectedRevision) throw new SettingsRevisionConflict();
    const validated = validateEditableSettings(editable);
    const settings = { ...validated, enableAllCquDomains: current.settings.enableAllCquDomains };
    const revision = current.revision + 1;
    await writeSettings(settings, revision);
    return { settings: structuredClone(settings), revision };
  });
}

export async function setAllCquMode(enabled: boolean): Promise<boolean> {
  if (enabled) {
    let alreadyGranted: boolean;
    try {
      alreadyGranted = await browser.permissions.contains(CQU_OPTIONAL_ORIGINS);
    } catch {
      await persistAllCquModeViaBackground(false);
      return false;
    }

    let newlyAcquired = false;
    if (!alreadyGranted) {
      try {
        newlyAcquired = await browser.permissions.request(CQU_OPTIONAL_ORIGINS);
      } catch {
        await persistAllCquModeViaBackground(false);
        return false;
      }
      if (!newlyAcquired) {
        await persistAllCquModeViaBackground(false);
        return false;
      }
    }

    if (await persistAllCquModeViaBackground(true)) return true;

    if (newlyAcquired) {
      try {
        await browser.permissions.remove(CQU_OPTIONAL_ORIGINS);
      } catch {
        // Best-effort rollback; the false result below reports incomplete enablement.
      }
    }
    await persistAllCquModeViaBackground(false);
    return false;
  }

  let removed = false;
  try {
    removed = await browser.permissions.remove(CQU_OPTIONAL_ORIGINS);
  } catch {
    // Persist the disabled mode even when Chromium cannot remove the grant.
  }
  const persisted = await persistAllCquModeViaBackground(false);
  return removed && persisted;
}

export function validateExtensionSettings(value: unknown): ExtensionSettings {
  if (!isPlainObject(value) || !hasExactKeys(value, [
    'customRules',
    'disabledBuiltInRuleIds',
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
    disabledBuiltInRuleIds: value.disabledBuiltInRuleIds,
    customRules: value.customRules,
    excludedHosts: value.excludedHosts,
  });
  return { ...editable, enableAllCquDomains: value.enableAllCquDomains };
}

export function validateEditableSettings(value: unknown): EditableSettings {
  if (!isPlainObject(value) || !hasExactKeys(value, [
    'customRules', 'disabledBuiltInRuleIds', 'enabled', 'excludedHosts',
  ])) throw new Error('Editable settings payload has an invalid shape');
  if (typeof value.enabled !== 'boolean') throw new Error('Settings switches must be booleans');
  const disabledBuiltInRuleIds = parseStringArray(
    value.disabledBuiltInRuleIds,
    'disabled rule IDs',
  );
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
  for (const rule of customRules) {
    if (ruleIds.has(rule.id)) throw new Error(`Colliding custom rule ID: ${rule.id}`);
    if (
      dnrIds.has(rule.dnrId) ||
      BUILT_IN_DNR_IDS.has(rule.dnrId) ||
      exclusionIds.has(rule.dnrId)
    ) {
      throw new Error(`Colliding custom DNR rule ID: ${rule.dnrId}`);
    }
    ruleIds.add(rule.id);
    dnrIds.add(rule.dnrId);
  }
  return {
    enabled: value.enabled,
    disabledBuiltInRuleIds: [...new Set(disabledBuiltInRuleIds.map((id) => id.trim()))].sort(),
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
  ])) {
    throw new Error('Custom rule has an invalid shape');
  }
  if (
    typeof value.id !== 'string' ||
    !value.id.trim() ||
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    typeof value.description !== 'string' ||
    value.category !== 'custom' ||
    typeof value.defaultEnabled !== 'boolean' ||
    !Number.isInteger(value.dnrId) ||
    (value.dnrId as number) < 1 ||
    (value.dnrId as number) > MAX_DNR_RULE_ID ||
    !isPlainObject(value.matcher)
  ) {
    throw new Error('Custom rule fields are invalid');
  }

  let matcher: CustomRule['matcher'];
  if (value.matcher.kind === 'host') {
    if (!hasExactKeys(value.matcher, ['host', 'kind'])) {
      throw new Error('Custom host matcher has an invalid shape');
    }
    const host = normalizeDnsHost(value.matcher.host);
    if (
      !host ||
      !(host === 'cqu.edu.cn' || host.endsWith('.cqu.edu.cn')) ||
      host === 'atrust.cqu.edu.cn' ||
      host.endsWith('.atrust.cqu.edu.cn') ||
      value.transformer !== 'atrust-domain'
    ) {
      throw new Error('Custom host rule is invalid');
    }
    matcher = { kind: 'host', host };
  } else {
    throw new Error('Custom matcher kind is invalid');
  }

  return {
    id: value.id.trim(),
    dnrId: value.dnrId as number,
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

function normalizeDnsHost(value: unknown): string | null {
  if (typeof value !== 'string') return null;
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}
