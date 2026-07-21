import { describe, expect, it } from 'vitest';
import { BUILT_IN_RULES } from '../../src/rules/builtins';
import { DEFAULT_SETTINGS } from '../../src/storage/settings';
import { buildOptionsModel, toEditableSettings } from '../../src/ui/options-model';

describe('options model', () => {
  it('exposes built-in rules as one continuous list in definition order', () => {
    const model = buildOptionsModel(DEFAULT_SETTINGS, BUILT_IN_RULES);

    expect(model.rules.map((rule) => rule.id)).toEqual([
      'core-sso',
      'addon-youth-public',
    ]);
    expect(model.rules[1]!.name).toBe('团委官网链接');
  });

  it('derives enabled state from saved built-in overrides', () => {
    const model = buildOptionsModel({
      ...DEFAULT_SETTINGS,
      disabledRuleIds: ['core-sso'],
    }, BUILT_IN_RULES);

    expect(model.rules[0]).toMatchObject({ id: 'core-sso', enabled: false });
  });

  it('attaches validation errors to their stable rule IDs', () => {
    const model = buildOptionsModel(DEFAULT_SETTINGS, BUILT_IN_RULES, [{
      ruleId: 'core-sso',
      message: 'Chromium 不支持该规则正则',
    }]);

    expect(model.rules[0]).toMatchObject({
      id: 'core-sso',
      validationError: 'Chromium 不支持该规则正则',
    });
    expect(model.rules[1]).toMatchObject({
      id: 'addon-youth-public',
      validationError: null,
    });
  });

  it('keeps a default-disabled built-in disabled without an override', () => {
    const defaultDisabled = { ...BUILT_IN_RULES[0]!, id: 'default-disabled', defaultEnabled: false };

    const model = buildOptionsModel(DEFAULT_SETTINGS, [defaultDisabled]);

    expect(model.rules[0]).toMatchObject({
      id: 'default-disabled',
      enabled: false,
      locked: true,
      lockReason: expect.stringContaining('默认关闭'),
    });
  });

  it('removes permission-backed all-CQU state from editable settings', () => {
    const editable = toEditableSettings({
      ...DEFAULT_SETTINGS,
      enableAllCquDomains: true,
      excludedHosts: ['one.cqu.edu.cn'],
    });

    expect(editable).toEqual({
      enabled: true,
      disabledRuleIds: [],
      customRules: [],
      excludedHosts: ['one.cqu.edu.cn'],
    });
    expect(editable).not.toHaveProperty('enableAllCquDomains');
  });
});
