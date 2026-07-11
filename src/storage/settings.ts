import type { CustomRule } from '../rules/types';

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

export async function loadSettings(): Promise<ExtensionSettings> {
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  const merged = {
    ...DEFAULT_SETTINGS,
    ...(stored[SETTINGS_KEY] as Partial<ExtensionSettings> | undefined),
  };
  return structuredClone(merged);
}

export async function saveSettings(next: ExtensionSettings): Promise<void> {
  await browser.storage.local.set({ [SETTINGS_KEY]: next });
}

async function persistAllCquMode(enabled: boolean): Promise<boolean> {
  try {
    const latest = await loadSettings();
    await saveSettings({ ...latest, enableAllCquDomains: enabled });
    return true;
  } catch {
    return false;
  }
}

export async function setAllCquMode(enabled: boolean): Promise<boolean> {
  if (enabled) {
    let alreadyGranted: boolean;
    try {
      alreadyGranted = await browser.permissions.contains(CQU_OPTIONAL_ORIGINS);
    } catch {
      await persistAllCquMode(false);
      return false;
    }

    let newlyAcquired = false;
    if (!alreadyGranted) {
      try {
        newlyAcquired = await browser.permissions.request(CQU_OPTIONAL_ORIGINS);
      } catch {
        await persistAllCquMode(false);
        return false;
      }
      if (!newlyAcquired) {
        await persistAllCquMode(false);
        return false;
      }
    }

    if (await persistAllCquMode(true)) return true;

    if (newlyAcquired) {
      try {
        await browser.permissions.remove(CQU_OPTIONAL_ORIGINS);
      } catch {
        // Best-effort rollback; the false result below reports incomplete enablement.
      }
    }
    await persistAllCquMode(false);
    return false;
  }

  let removed = false;
  try {
    removed = await browser.permissions.remove(CQU_OPTIONAL_ORIGINS);
  } catch {
    // Persist the disabled mode even when Chromium cannot remove the grant.
  }
  const persisted = await persistAllCquMode(false);
  return removed && persisted;
}
