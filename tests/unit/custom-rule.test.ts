import { describe, expect, it } from 'vitest';
import { BUILT_IN_RULES } from '../../src/rules/builtins';
import type { CustomRule } from '../../src/rules/types';
import {
  CUSTOM_DNR_ID_MAX,
  CUSTOM_DNR_ID_MIN,
  customRulePermissions,
  parseCustomRule,
  selectNextCustomDnrId,
} from '../../src/ui/custom-rule';

function existingCustom(host = 'library.cqu.edu.cn', dnrId = CUSTOM_DNR_ID_MIN): CustomRule {
  return {
    id: crypto.randomUUID(),
    dnrId,
    name: host,
    description: `通过 aTrust 打开 ${host}`,
    category: 'custom',
    defaultEnabled: true,
    matcher: { kind: 'host', host },
    transformer: 'atrust-domain',
  };
}

describe('custom rule parser', () => {
  it.each([
    ['SSO2.CQU.EDU.CN', 'sso2.cqu.edu.cn'],
    [' cqu.edu.cn ', 'cqu.edu.cn'],
  ])('accepts and canonicalizes a bare CQU DNS host %s', (input, host) => {
    const rule = parseCustomRule(input, CUSTOM_DNR_ID_MIN);

    expect(rule).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      dnrId: CUSTOM_DNR_ID_MIN,
      name: host,
      description: `通过 aTrust 打开 ${host}`,
      category: 'custom',
      defaultEnabled: true,
      matcher: { kind: 'host', host },
      transformer: 'atrust-domain',
    });
  });

  it.each([
    'https://sso2.cqu.edu.cn',
    'sso2.cqu.edu.cn/login',
    'sso2.cqu.edu.cn:443',
    '1.1.1.1',
    '1.1.1.1:8000',
    '[::1]:8000',
    'user@sso2.cqu.edu.cn',
    '*.cqu.edu.cn',
    'sso2.cqu.edu.cn.',
    'bad..cqu.edu.cn',
    '-bad.cqu.edu.cn',
    'bad-.cqu.edu.cn',
    'bad_name.cqu.edu.cn',
    'example.com',
  ])('rejects unsupported custom input %s', (input) => {
    expect(() => parseCustomRule(input, CUSTOM_DNR_ID_MIN)).toThrow();
  });

  it.each([
    'atrust.cqu.edu.cn',
    'x.atrust.cqu.edu.cn',
    'sso-cqu-edu-cn-s.atrust.cqu.edu.cn',
  ])('rejects aTrust source host %s', (input) => {
    expect(() => parseCustomRule(input, CUSTOM_DNR_ID_MIN)).toThrow(/aTrust/);
  });

  it.each(BUILT_IN_RULES.map((rule) => rule.matcher.host))(
    'rejects built-in source duplicate %s',
    (host) => expect(() => parseCustomRule(host, CUSTOM_DNR_ID_MIN)).toThrow(/内置/),
  );

  it('rejects an existing custom source duplicate', () => {
    expect(() => parseCustomRule(
      'LIBRARY.CQU.EDU.CN',
      CUSTOM_DNR_ID_MIN + 1,
      [existingCustom()],
    )).toThrow(/已存在/);
  });

  it.each([
    CUSTOM_DNR_ID_MIN - 1,
    CUSTOM_DNR_ID_MAX + 1,
    10_001.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('rejects unsafe custom DNR ID %s', (dnrId) => {
    expect(() => parseCustomRule('new.cqu.edu.cn', dnrId)).toThrow(/DNR/);
  });

  it('builds only the exact source and generated target origins', () => {
    const rule = parseCustomRule('library.cqu.edu.cn', CUSTOM_DNR_ID_MIN);

    expect(customRulePermissions(rule)).toEqual({
      origins: [
        '*://library.cqu.edu.cn/*',
        'https://library-cqu-edu-cn-s.atrust.cqu.edu.cn/*',
      ],
    });
  });
});

describe('custom DNR allocation', () => {
  it('chooses the smallest available ID deterministically', () => {
    expect(selectNextCustomDnrId([
      CUSTOM_DNR_ID_MIN,
      CUSTOM_DNR_ID_MIN + 2,
      BUILT_IN_RULES[0]!.dnrId,
      80_000,
    ])).toBe(CUSTOM_DNR_ID_MIN + 1);
  });

  it('returns null when the custom range is exhausted', () => {
    const used = Array.from(
      { length: CUSTOM_DNR_ID_MAX - CUSTOM_DNR_ID_MIN + 1 },
      (_, index) => CUSTOM_DNR_ID_MIN + index,
    );

    expect(selectNextCustomDnrId(used)).toBeNull();
  });
});
