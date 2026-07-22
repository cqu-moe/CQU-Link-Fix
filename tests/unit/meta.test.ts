import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Browser } from 'wxt/browser';
import { describe, expect, it } from 'vitest';
import packageJson from '../../package.json' with { type: 'json' };
import { EXTENSION_NAME, EXTENSION_VERSION } from '../../src/meta';
import { BUILT_IN_RULES } from '../../src/rules/builtins';
import { compileDynamicRules } from '../../src/rules/dnr';
import { compileMatcherRedirects } from '../../src/rules/matcher';

const root = process.cwd();

async function readMessages(relativePath: string): Promise<Record<string, { message: string }>> {
  return JSON.parse(
    await readFile(path.join(root, relativePath), 'utf8'),
  ) as Record<string, { message: string }>;
}

async function readJson<T>(relativePath: string): Promise<T> {
  return JSON.parse(await readFile(path.join(root, relativePath), 'utf8')) as T;
}

function applyStaticRedirect(
  rules: readonly Browser.declarativeNetRequest.Rule[],
  input: string,
): string | null {
  let winner: Browser.declarativeNetRequest.Rule | null = null;
  for (const rule of rules) {
    const filter = rule.condition.regexFilter;
    if (!filter) continue;
    const match = new RegExp(
      filter,
      rule.condition.isUrlFilterCaseSensitive ? '' : 'i',
    ).exec(input);
    if (!match) continue;
    if (!winner || (rule.priority ?? 1) > (winner.priority ?? 1)) winner = rule;
  }
  if (!winner || winner.action.type !== 'redirect') return null;
  const substitution = winner.action.redirect?.regexSubstitution;
  const filter = winner.condition.regexFilter;
  if (!substitution || !filter) return null;
  const match = new RegExp(
    filter,
    winner.condition.isUrlFilterCaseSensitive ? '' : 'i',
  ).exec(input);
  return substitution.replace(/\\([0-9])/g, (_capture, index: string) =>
    match?.[Number(index)] ?? '',
  );
}

describe('extension metadata', () => {
  it('exposes stable initial metadata', () => {
    expect(EXTENSION_NAME).toBe('CQU Link Fix');
    expect(EXTENSION_VERSION).toBe(packageJson.version);
  });

  it('localizes manifest name and description for Chinese and English', async () => {
    const [config, zh, en] = await Promise.all([
      readFile(path.join(root, 'wxt.config.ts'), 'utf8'),
      readMessages('public/_locales/zh_CN/messages.json'),
      readMessages('public/_locales/en/messages.json'),
    ]);

    expect(config).toContain("name: '__MSG_extName__'");
    expect(config).toContain("description: '__MSG_extDescription__'");
    expect(config).toContain("default_locale: 'zh_CN'");
    expect(Object.keys(zh).sort()).toEqual(['extDescription', 'extName']);
    expect(Object.keys(en).sort()).toEqual(['extDescription', 'extName']);
    expect(zh.extName?.message).toBe('CQU Link Fix');
    expect(en.extName?.message).toBe('CQU Link Fix');
    expect(zh.extDescription?.message.length).toBeLessThanOrEqual(132);
    expect(en.extDescription?.message.length).toBeLessThanOrEqual(132);
  });

  it('ships the default built-in redirects before the service worker starts', async () => {
    const [config, rules] = await Promise.all([
      readFile(path.join(root, 'wxt.config.ts'), 'utf8'),
      readJson<Array<Record<string, unknown>>>('public/rules/builtins.json'),
    ]);

    expect(config).toContain('declarative_net_request:');
    expect(config).toContain("id: 'built_in_defaults'");
    expect(config).toContain("path: 'rules/builtins.json'");
    expect(config).toContain('enabled: true');
    expect(rules).toEqual([
      ...BUILT_IN_RULES.flatMap((rule, index) =>
        compileMatcherRedirects(rule.matcher, rule.dnrId, (index + 1) * 10),
      ),
      ...compileDynamicRules([], []),
    ]);
  });

  it('ships an opt-in all-CQU ruleset for first navigation after browser restart', async () => {
    const [config, rules] = await Promise.all([
      readFile(path.join(root, 'wxt.config.ts'), 'utf8'),
      readJson<Browser.declarativeNetRequest.Rule[]>('public/rules/all-cqu-domains.json'),
    ]);

    expect(config).toContain("id: 'all_cqu_domains'");
    expect(config).toContain("path: 'rules/all-cqu-domains.json'");
    expect(config).toMatch(/id: 'all_cqu_domains',[\s\S]*?enabled: false/);
    expect(rules).toHaveLength(21);
    expect(applyStaticRedirect(rules, 'https://cqu.edu.cn/path?q=1')).toBe(
      'https://cqu-edu-cn-s.atrust.cqu.edu.cn/path?q=1',
    );
    expect(applyStaticRedirect(rules, 'https://portal.cqu.edu.cn/path?q=1')).toBe(
      'https://portal-cqu-edu-cn-s.atrust.cqu.edu.cn/path?q=1',
    );
    expect(applyStaticRedirect(
      rules,
      'https://a.b.c.d.e.f.g.h.cqu.edu.cn/path?q=1',
    )).toBe(
      'https://a-b-c-d-e-f-g-h-cqu-edu-cn-s.atrust.cqu.edu.cn/path?q=1',
    );
    expect(applyStaticRedirect(
      rules,
      'https://a.b.c.d.e.f.g.h.i.cqu.edu.cn/path?q=1',
    )).toBeNull();
    expect(applyStaticRedirect(
      rules,
      'https://portal-cqu-edu-cn-s.atrust.cqu.edu.cn/path?q=1',
    )).toBeNull();
    expect(applyStaticRedirect(
      rules,
      'https://youth.cqu.edu.cn/content.jsp?urltype=news.NewsContentUrl&wbtreeid=1009&wbnewsid=24264',
    )).toBeNull();
    expect(applyStaticRedirect(
      rules,
      'https://youth.cqu.edu.cn/info/1009/24264.htm?state=opaque',
    )).toBeNull();
  });
});
