import { describe, expect, it } from 'vitest';
import { BUILT_IN_RULES } from '../../src/rules/builtins';
import { decideRegisteredRewrite, getEnabledRules } from '../../src/rules/registry';
import { DEFAULT_SETTINGS } from '../../src/storage/settings';
import type { CustomRule } from '../../src/rules/types';

describe('rule registry', () => {
  it('ships stable default built-ins', () => {
    expect(BUILT_IN_RULES.map((rule) => rule.id)).toEqual(['core-sso', 'addon-youth-public']);
    expect(getEnabledRules(DEFAULT_SETTINGS).map((rule) => rule.id)).toEqual([
      'core-sso',
      'addon-youth-public',
    ]);
  });

  it('honors a disabled built-in', () => {
    const settings = { ...DEFAULT_SETTINGS, disabledBuiltInRuleIds: ['core-sso'] };
    expect(getEnabledRules(settings).map((rule) => rule.id)).toEqual(['addon-youth-public']);
  });

  it('returns no rules when the extension is disabled', () => {
    expect(getEnabledRules({ ...DEFAULT_SETTINGS, enabled: false })).toEqual([]);
  });

  it('includes enabled custom rules and honors their disabled IDs', () => {
    const customRule = createIpRule(8000);
    expect(
      getEnabledRules({ ...DEFAULT_SETTINGS, customRules: [customRule] }).map((rule) => rule.id),
    ).toEqual(['core-sso', 'addon-youth-public', 'custom-ip']);
    expect(
      getEnabledRules({
        ...DEFAULT_SETTINGS,
        customRules: [customRule],
        disabledBuiltInRuleIds: ['custom-ip'],
      }).map((rule) => rule.id),
    ).toEqual(['core-sso', 'addon-youth-public']);
  });
});

describe('registered rewrites', () => {
  it('matches exact registered hosts without matching lookalike suffixes', () => {
    expect(decideRegisteredRewrite('https://sso.cqu.edu.cn/login', BUILT_IN_RULES)).toEqual({
      ruleId: 'core-sso',
      originalUrl: 'https://sso.cqu.edu.cn/login',
      targetUrl: 'https://sso-cqu-edu-cn-s.atrust.cqu.edu.cn/login',
    });
    expect(
      decideRegisteredRewrite('https://sso.cqu.edu.cn.evil.example/login', BUILT_IN_RULES),
    ).toBeNull();
  });

  it('preserves all decoded CAS service values through a registered rewrite', () => {
    const input =
      'https://sso.cqu.edu.cn/login?service=https%3A%2F%2Ffirst.cqu.edu.cn%2Fcb&service=https%3A%2F%2Fsecond.cqu.edu.cn%2Fcb%3Fstate%3Da%2520b#login';
    const decision = decideRegisteredRewrite(input, BUILT_IN_RULES);

    expect(decision?.targetUrl).toBe(
      'https://sso-cqu-edu-cn-s.atrust.cqu.edu.cn/login?service=https%3A%2F%2Ffirst.cqu.edu.cn%2Fcb&service=https%3A%2F%2Fsecond.cqu.edu.cn%2Fcb%3Fstate%3Da%2520b#login',
    );
    expect(new URL(decision!.targetUrl).searchParams.getAll('service')).toEqual(
      new URL(input).searchParams.getAll('service'),
    );
  });

  it('matches only a registered Youth article path and preserves protected query values', () => {
    const input =
      'https://youth.cqu.edu.cn/info/1009/24264.htm?state=a%2Bb&redirect_uri=https%3A%2F%2Fclient.example%2Fcb%3Fx%3D1#details';
    const decision = decideRegisteredRewrite(input, BUILT_IN_RULES);

    expect(decision?.targetUrl).toBe(
      'https://youth.cqu.edu.cn/content.jsp?state=a%2Bb&redirect_uri=https%3A%2F%2Fclient.example%2Fcb%3Fx%3D1&urltype=news.NewsContentUrl&wbtreeid=1009&wbnewsid=24264#details',
    );
    expect(
      decideRegisteredRewrite('https://youth.cqu.edu.cn/info/1009/not-an-article.htm', BUILT_IN_RULES),
    ).toBeNull();
  });

  it('rewrites only an explicitly registered IPv4 and port pair', () => {
    const rule = createIpRule(8000);
    expect(decideRegisteredRewrite('http://1.1.1.1:8000/path?q=1', [rule])).toEqual({
      ruleId: 'custom-ip',
      originalUrl: 'http://1.1.1.1:8000/path?q=1',
      targetUrl: 'https://1-1-1-1-8000-p.atrust.cqu.edu.cn/path?q=1',
    });
    expect(decideRegisteredRewrite('http://1.1.1.1:9000/path', [rule])).toBeNull();
    expect(decideRegisteredRewrite('http://2.2.2.2:8000/path', [rule])).toBeNull();
  });

  it('matches an explicitly registered default port without losing it to URL normalization', () => {
    const rule = createIpRule(80);
    expect(decideRegisteredRewrite('http://1.1.1.1:80/path', [rule])?.targetUrl).toBe(
      'https://1-1-1-1-80-p.atrust.cqu.edu.cn/path',
    );
  });
});

function createIpRule(port: number): CustomRule {
  return {
    id: 'custom-ip',
    dnrId: 3001,
    name: 'Registered IP service',
    description: 'Test-only registered IP and port pair',
    category: 'custom',
    defaultEnabled: true,
    matcher: { kind: 'host-port', host: '1.1.1.1', port },
    transformer: 'atrust-ip-port',
  };
}
