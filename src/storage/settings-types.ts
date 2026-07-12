import type { CustomRule } from '../rules/types';

export interface ExtensionSettings {
  enabled: boolean;
  enableAllCquDomains: boolean;
  disabledRuleIds: string[];
  customRules: CustomRule[];
  excludedHosts: string[];
}

export type EditableSettings = Omit<ExtensionSettings, 'enableAllCquDomains'>;

export interface SettingsSnapshot {
  settings: ExtensionSettings;
  revision: number;
}

export type ReplaceSettingsResult =
  | { ok: true; revision: number }
  | {
      ok: false;
      code: 'settings-conflict' | 'settings-apply-failed' | 'operation-failed';
      error: string;
    };

export interface SettingsMutationHooks {
  apply: (next: ExtensionSettings) => Promise<void>;
  afterApply?: (
    next: ExtensionSettings,
    previous: ExtensionSettings,
  ) => Promise<void>;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  enabled: true,
  enableAllCquDomains: false,
  disabledRuleIds: [],
  customRules: [],
  excludedHosts: [],
};
