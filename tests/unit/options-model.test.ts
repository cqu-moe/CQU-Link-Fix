import { describe, expect, it } from 'vitest';
import { BUILT_IN_RULES } from '../../src/rules/builtins';
import { DEFAULT_SETTINGS } from '../../src/storage/settings';
import { buildOptionsModel, toEditableSettings } from '../../src/ui/options-model';

describe('options model', () => {
  it('always exposes the four built-in groups, including empty groups', () => {
    const model = buildOptionsModel(DEFAULT_SETTINGS, BUILT_IN_RULES);

    expect(model.groups.map((group) => [group.category, group.rules.length])).toEqual([
      ['core', 1],
      ['important', 0],
      ['ip', 0],
      ['addon', 1],
    ]);
  });

  it('derives enabled state from saved built-in overrides', () => {
    const model = buildOptionsModel({
      ...DEFAULT_SETTINGS,
      disabledBuiltInRuleIds: ['core-sso'],
    }, BUILT_IN_RULES);

    expect(model.groups[0]!.rules[0]).toMatchObject({ id: 'core-sso', enabled: false });
  });

  it('keeps a default-disabled built-in disabled without an override', () => {
    const defaultDisabled = { ...BUILT_IN_RULES[0]!, id: 'default-disabled', defaultEnabled: false };

    const model = buildOptionsModel(DEFAULT_SETTINGS, [defaultDisabled]);

    expect(model.groups[0]!.rules[0]).toMatchObject({
      id: 'default-disabled',
      enabled: false,
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
      disabledBuiltInRuleIds: [],
      customRules: [],
      excludedHosts: ['one.cqu.edu.cn'],
    });
    expect(editable).not.toHaveProperty('enableAllCquDomains');
  });
});
