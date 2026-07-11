import type { CustomRule } from '../rules/types';
import type { BackgroundResponse } from '../messages';

export interface ExtensionSettings {
  enabled: boolean;
  enableAllCquDomains: boolean;
  disabledBuiltInRuleIds: string[];
  customRules: CustomRule[];
  excludedHosts: string[];
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  enabled: true,
  enableAllCquDomains: false,
  disabledBuiltInRuleIds: [],
  customRules: [],
  excludedHosts: [],
};

const SETTINGS_KEY = 'settings';
const CQU_OPTIONAL_ORIGINS = {
  origins: ['*://cqu.edu.cn/*', '*://*.cqu.edu.cn/*'],
};
const MAX_DNR_RULE_ID = 2_147_483_647;
const BUILT_IN_DNR_IDS = new Set([1_001, 2_001]);
const EXCLUSION_DNR_ID_START = 80_000;
let settingsWriteQueue = Promise.resolve();

export async function loadSettings(): Promise<ExtensionSettings> {
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  const merged = {
    ...DEFAULT_SETTINGS,
    ...(stored[SETTINGS_KEY] as Partial<ExtensionSettings> | undefined),
  };
  return structuredClone(merged);
}

export async function saveSettings(next: ExtensionSettings): Promise<void> {
  const snapshot = structuredClone(next);
  await queueSettingsWrite(async () => {
    await writeSettings(snapshot);
  });
}

export async function replaceSettingsViaBackground(
  next: ExtensionSettings,
): Promise<boolean> {
  return sendSettingsMessage({
    type: 'replace-settings',
    settings: structuredClone(next),
  });
}

async function persistAllCquModeViaBackground(enabled: boolean): Promise<boolean> {
  return sendSettingsMessage({ type: 'persist-all-cqu-mode', enabled });
}

async function sendSettingsMessage(message: unknown): Promise<boolean> {
  try {
    const response = (await browser.runtime.sendMessage(message)) as
      | BackgroundResponse
      | undefined;
    return response?.ok === true;
  } catch {
    return false;
  }
}

async function writeSettings(next: ExtensionSettings): Promise<void> {
  await browser.storage.local.set({ [SETTINGS_KEY]: structuredClone(next) });
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
  return queueSettingsWrite(async () => {
    const current = await loadSettings();
    const next = structuredClone(await mutator(current));
    await writeSettings(next);
    return structuredClone(next);
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
  if (typeof value.enabled !== 'boolean' || typeof value.enableAllCquDomains !== 'boolean') {
    throw new Error('Settings switches must be booleans');
  }
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
  const customRules = value.customRules.map(parseCustomRule);
  const ruleIds = new Set<string>();
  const dnrIds = new Set<number>();
  const exclusionIds = new Set(excludedHosts.map((_, index) => EXCLUSION_DNR_ID_START + index));
  for (const rule of customRules) {
    if (ruleIds.has(rule.id)) throw new Error(`Duplicate custom rule ID: ${rule.id}`);
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
    enableAllCquDomains: value.enableAllCquDomains,
    disabledBuiltInRuleIds,
    customRules,
    excludedHosts: [...new Set(excludedHosts)].sort(),
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
    if (!host || !host.includes('.') || isCanonicalIpv4(host) || value.transformer !== 'atrust-domain') {
      throw new Error('Custom host rule is invalid');
    }
    matcher = { kind: 'host', host };
  } else if (value.matcher.kind === 'host-port') {
    if (!hasExactKeys(value.matcher, ['host', 'kind', 'port'])) {
      throw new Error('Custom host-port matcher has an invalid shape');
    }
    if (
      typeof value.matcher.host !== 'string' ||
      !isCanonicalIpv4(value.matcher.host) ||
      !Number.isInteger(value.matcher.port) ||
      (value.matcher.port as number) < 1 ||
      (value.matcher.port as number) > 65_535 ||
      value.transformer !== 'atrust-ip-port'
    ) {
      throw new Error('Custom host-port rule is invalid');
    }
    matcher = {
      kind: 'host-port',
      host: value.matcher.host,
      port: value.matcher.port as number,
    };
  } else if (value.matcher.kind === 'youth-article') {
    if (!hasExactKeys(value.matcher, ['host', 'kind'])) {
      throw new Error('Custom Youth matcher has an invalid shape');
    }
    if (
      value.matcher.host !== 'youth.cqu.edu.cn' ||
      value.transformer !== 'youth-public'
    ) {
      throw new Error('Custom Youth rule is invalid');
    }
    matcher = { kind: 'youth-article', host: 'youth.cqu.edu.cn' };
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

function isCanonicalIpv4(host: string): boolean {
  return (
    /^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(host) &&
    host.split('.').every((octet) => Number(octet) <= 255)
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}
