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

export async function setAllCquMode(enabled: boolean): Promise<boolean> {
  const settings = await loadSettings();

  if (enabled) {
    const alreadyGranted = await browser.permissions.contains(CQU_OPTIONAL_ORIGINS);
    const granted = alreadyGranted || await browser.permissions.request(CQU_OPTIONAL_ORIGINS);
    if (!granted) {
      await saveSettings({ ...settings, enableAllCquDomains: false });
      return false;
    }
    await saveSettings({ ...settings, enableAllCquDomains: true });
    return true;
  }

  await saveSettings({ ...settings, enableAllCquDomains: false });
  try {
    return await browser.permissions.remove(CQU_OPTIONAL_ORIGINS);
  } catch {
    return false;
  }
}
