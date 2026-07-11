import type { RuleCategory, RuleDefinition } from '../rules/types';
import type { EditableSettings, ExtensionSettings } from '../storage/settings';

const GROUPS: readonly {
  category: Exclude<RuleCategory, 'custom'>;
  label: string;
  description: string;
}[] = [
  { category: 'core', label: '核心认证', description: '统一身份认证等基础入口。' },
  { category: 'important', label: '重要站点', description: '随扩展发布并经过验证的重要域名。' },
  { category: 'ip', label: 'IP 名单', description: '仅包含开发者验证过的完整 IP 与端口。' },
  { category: 'addon', label: '附加修正', description: '不经过 aTrust 的校内链接格式修正。' },
] as const;

export interface OptionsRuleModel extends RuleDefinition {
  enabled: boolean;
  locked: boolean;
  lockReason: string | null;
}

export interface OptionsGroupModel {
  category: Exclude<RuleCategory, 'custom'>;
  label: string;
  description: string;
  rules: OptionsRuleModel[];
}

export interface OptionsModel {
  groups: OptionsGroupModel[];
}

export function buildOptionsModel(
  settings: ExtensionSettings,
  builtInRules: readonly RuleDefinition[],
): OptionsModel {
  const disabled = new Set(settings.disabledRuleIds);
  return {
    groups: GROUPS.map((group) => ({
      ...group,
      rules: builtInRules
        .filter((rule) => rule.category === group.category)
        .map((rule) => ({
          ...structuredClone(rule),
          enabled: rule.defaultEnabled && !disabled.has(rule.id),
          locked: !rule.defaultEnabled,
          lockReason: rule.defaultEnabled
            ? null
            : '此内置规则由当前版本默认关闭，暂不支持手动启用。',
        })),
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
