import type { RuleDefinition } from '../rules/types';
import type { RuleValidationError } from '../rules/dnr-status';
import type { EditableSettings, ExtensionSettings } from '../storage/settings-types';

export interface OptionsRuleModel extends RuleDefinition {
  enabled: boolean;
  locked: boolean;
  lockReason: string | null;
  validationError: string | null;
}

export interface OptionsModel {
  rules: OptionsRuleModel[];
}

export function buildOptionsModel(
  settings: ExtensionSettings,
  builtInRules: readonly RuleDefinition[],
  validationErrors: readonly RuleValidationError[] = [],
): OptionsModel {
  const disabled = new Set(settings.disabledRuleIds);
  const validationByRuleId = new Map(
    validationErrors.map((error) => [error.ruleId, error.message]),
  );
  return {
    rules: builtInRules.map((rule) => ({
      ...structuredClone(rule),
      enabled: rule.defaultEnabled && !disabled.has(rule.id),
      locked: !rule.defaultEnabled,
      lockReason: rule.defaultEnabled
        ? null
        : '此内置规则由当前版本默认关闭，暂不支持手动启用。',
      validationError: validationByRuleId.get(rule.id) ?? null,
    })),
  };
}

export function toEditableSettings(settings: ExtensionSettings): EditableSettings {
  return structuredClone({
    enabled: settings.enabled,
    disabledRuleIds: settings.disabledRuleIds,
    customRules: settings.customRules,
    excludedHosts: settings.excludedHosts,
  });
}
