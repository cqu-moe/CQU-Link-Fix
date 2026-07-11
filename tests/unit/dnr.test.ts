import type { Browser } from 'wxt/browser';
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import background from '../../entrypoints/background';
import { BUILT_IN_RULES } from '../../src/rules/builtins';
import { compileDynamicRules, reconcileDynamicRules } from '../../src/rules/dnr';
import { DEFAULT_SETTINGS, saveSettings } from '../../src/storage/settings';
import type { CustomRule } from '../../src/rules/types';

const MAIN_FRAME = ['main_frame'] as const;

type RegexSupport = (
  options: Browser.declarativeNetRequest.RegexOptions,
) => Promise<Browser.declarativeNetRequest.IsRegexSupportedResult>;
type GetDynamicRules = () => Promise<Browser.declarativeNetRequest.Rule[]>;
type UpdateDynamicRules = (
  options: Browser.declarativeNetRequest.UpdateRuleOptions,
) => Promise<void>;

function mockRegexSupport(): MockInstance<RegexSupport> {
  return vi.spyOn(browser.declarativeNetRequest, 'isRegexSupported') as unknown as MockInstance<RegexSupport>;
}

function mockGetDynamicRules(): MockInstance<GetDynamicRules> {
  return vi.spyOn(browser.declarativeNetRequest, 'getDynamicRules') as unknown as MockInstance<GetDynamicRules>;
}

function mockUpdateDynamicRules(): MockInstance<UpdateDynamicRules> {
  return vi.spyOn(browser.declarativeNetRequest, 'updateDynamicRules') as unknown as MockInstance<UpdateDynamicRules>;
}

function applyRegexRedirect(
  rule: Browser.declarativeNetRequest.Rule,
  input: string,
): string | null {
  const filter = rule.condition.regexFilter;
  const substitution = rule.action.redirect?.regexSubstitution;
  if (!filter || !substitution) return null;
  const match = new RegExp(filter, rule.condition.isUrlFilterCaseSensitive ? '' : 'i').exec(input);
  if (!match) return null;
  return substitution.replace(/\\([0-9])/g, (_capture: string, index: string) =>
    match[Number(index)] ?? '',
  );
}

function matchesRegex(rule: Browser.declarativeNetRequest.Rule, input: string): boolean {
  const filter = rule.condition.regexFilter;
  if (!filter) return false;
  return new RegExp(filter, rule.condition.isUrlFilterCaseSensitive ? '' : 'i').test(input);
}

function createIpRule(port: number): CustomRule {
  return {
    id: `custom-ip-${port}`,
    dnrId: 3000 + port,
    name: 'Registered IP service',
    description: 'Test-only registered IP and port pair',
    category: 'custom',
    defaultEnabled: true,
    matcher: { kind: 'host-port', host: '1.1.1.1', port },
    transformer: 'atrust-ip-port',
  };
}

describe('DNR compilation', () => {
  it('compiles stable top-level redirect rules for the built-ins', () => {
    const [sso, youth] = compileDynamicRules(BUILT_IN_RULES, []);

    expect(sso).toMatchObject({
      id: 1001,
      priority: 10_000,
      condition: { resourceTypes: MAIN_FRAME },
      action: {
        type: 'redirect',
        redirect: { regexSubstitution: 'https://sso-cqu-edu-cn-s.atrust.cqu.edu.cn\\1' },
      },
    });
    expect(youth).toMatchObject({
      id: 2001,
      priority: 20_000,
      condition: { resourceTypes: MAIN_FRAME },
      action: { type: 'redirect' },
    });
    expect(compileDynamicRules(BUILT_IN_RULES, [])).toEqual(
      compileDynamicRules(BUILT_IN_RULES, []),
    );
  });

  it('matches the exact SSO host, preserves its suffix, and rejects host lookalikes', () => {
    const [sso] = compileDynamicRules(BUILT_IN_RULES, []);
    const input =
      'http://sso.cqu.edu.cn:80/login?service=https%3A%2F%2Fone.example%2Fcb&service=https%3A%2F%2Ftwo.example%2Fcb#login';
    const output = applyRegexRedirect(sso!, input);

    expect(output).toBe(
      'https://sso-cqu-edu-cn-s.atrust.cqu.edu.cn/login?service=https%3A%2F%2Fone.example%2Fcb&service=https%3A%2F%2Ftwo.example%2Fcb#login',
    );
    expect(new URL(output!).searchParams.getAll('service')).toEqual(
      new URL(input).searchParams.getAll('service'),
    );
    expect(applyRegexRedirect(sso!, 'https://sso.cqu.edu.cn.evil.example/login')).toBeNull();
    expect(applyRegexRedirect(sso!, 'https://sso.cqu.edu.cn:444/login')).toBeNull();
  });

  it.each([80, 443, 8000])('requires the exact explicit host-port pair for port %s', (port) => {
    const [rule] = compileDynamicRules([createIpRule(port)], []);

    expect(applyRegexRedirect(rule!, `http://1.1.1.1:${port}/path?q=1#details`)).toBe(
      `https://1-1-1-1-${port}-p.atrust.cqu.edu.cn/path?q=1#details`,
    );
    expect(applyRegexRedirect(rule!, 'http://1.1.1.1/path')).toBeNull();
    expect(applyRegexRedirect(rule!, `http://1.1.1.10:${port}/path`)).toBeNull();
    expect(applyRegexRedirect(rule!, `http://1.1.1.1:${port + 1}/path`)).toBeNull();
  });

  it('preserves Youth query bytes, decoded protected values, multiplicity, order, and fragment', () => {
    const rules = compileDynamicRules(BUILT_IN_RULES, []);
    const youthWithQuery = rules.find((rule) =>
      rule.condition.regexFilter?.includes('([^#]+)'),
    );
    const input =
      'https://youth.cqu.edu.cn/info/1009/24264.htm?state=first&redirect_uri=https%3a%2f%2fclient.example%2fcb%3fq%3da%2520b&service=https%3A%2F%2Fone.example%2Fcb&state=second&redirect_uri=https%3A%2F%2Ftwo.example%2Fcb&foo=1&foo=2#details';
    const output = applyRegexRedirect(youthWithQuery!, input);
    const inputUrl = new URL(input);
    const outputUrl = new URL(output!);

    expect(output).toBe(
      'https://youth.cqu.edu.cn/content.jsp?state=first&redirect_uri=https%3a%2f%2fclient.example%2fcb%3fq%3da%2520b&service=https%3A%2F%2Fone.example%2Fcb&state=second&redirect_uri=https%3A%2F%2Ftwo.example%2Fcb&foo=1&foo=2&urltype=news.NewsContentUrl&wbtreeid=1009&wbnewsid=24264#details',
    );
    for (const key of ['state', 'redirect_uri', 'service', 'foo']) {
      expect(outputUrl.searchParams.getAll(key)).toEqual(inputUrl.searchParams.getAll(key));
    }
    expect([...outputUrl.searchParams].slice(0, 7)).toEqual([...inputUrl.searchParams]);
  });

  it('builds the exact Youth target when no source query exists', () => {
    const youth = compileDynamicRules(BUILT_IN_RULES, [])[1]!;

    expect(
      applyRegexRedirect(youth, 'https://youth.cqu.edu.cn/info/1009/24264.htm#print'),
    ).toBe(
      'https://youth.cqu.edu.cn/content.jsp?urltype=news.NewsContentUrl&wbtreeid=1009&wbnewsid=24264#print',
    );
    expect(
      applyRegexRedirect(youth, 'https://youth.cqu.edu.cn.evil.example/info/1009/24264.htm'),
    ).toBeNull();
  });

  it('sorts and deduplicates exact-host exclusions ahead of redirects', () => {
    const first = compileDynamicRules(BUILT_IN_RULES, [
      'Youth.CQU.EDU.CN',
      'sso.cqu.edu.cn',
      'sso.cqu.edu.cn',
    ]);
    const second = compileDynamicRules(BUILT_IN_RULES, [
      'sso.cqu.edu.cn',
      'youth.cqu.edu.cn',
    ]);
    const allows = first.filter((rule) => rule.action.type === 'allow');

    expect(first).toEqual(second);
    expect(allows).toHaveLength(2);
    expect(allows[0]).toMatchObject({
      id: 80_000,
      priority: 100_000,
      action: { type: 'allow' },
      condition: { resourceTypes: MAIN_FRAME },
    });
    expect(matchesRegex(allows[0]!, 'https://sso.cqu.edu.cn/login')).toBe(true);
    expect(matchesRegex(allows[0]!, 'https://sso.cqu.edu.cn.evil.example/login')).toBe(false);
  });

  it('rejects collisions across derived, exclusion, and registered rule IDs', () => {
    const collidingRule = { ...createIpRule(8000), dnrId: 80_000 };

    expect(() => compileDynamicRules([collidingRule], ['sso.cqu.edu.cn'])).toThrow(
      'Duplicate DNR rule ID: 80000',
    );
  });
});

describe('DNR reconciliation', () => {
  beforeEach(() => fakeBrowser.reset());

  it('validates every redirect regex before replacing all current dynamic rules', async () => {
    await saveSettings(DEFAULT_SETTINGS);
    const isRegexSupported = mockRegexSupport().mockResolvedValue({ isSupported: true });
    mockGetDynamicRules().mockResolvedValue([
      { id: 999, priority: 1, action: { type: 'allow' }, condition: {} },
    ]);
    const updateDynamicRules = mockUpdateDynamicRules().mockResolvedValue();

    await reconcileDynamicRules();

    const expected = compileDynamicRules(BUILT_IN_RULES, []);
    expect(isRegexSupported).toHaveBeenCalledTimes(expected.length);
    expect(isRegexSupported).toHaveBeenCalledWith(
      expect.objectContaining({ isCaseSensitive: false, requireCapturing: true }),
    );
    expect(updateDynamicRules).toHaveBeenCalledWith({ removeRuleIds: [999], addRules: expected });
  });

  it('rejects an unsupported regex without changing installed rules', async () => {
    await saveSettings(DEFAULT_SETTINGS);
    mockRegexSupport().mockResolvedValue({
      isSupported: false,
      reason: 'syntaxError',
    });
    const getDynamicRules = mockGetDynamicRules();
    const updateDynamicRules = mockUpdateDynamicRules();

    await expect(reconcileDynamicRules()).rejects.toThrow('Unsupported regex in DNR rule 1001');
    expect(getDynamicRules).not.toHaveBeenCalled();
    expect(updateDynamicRules).not.toHaveBeenCalled();
  });
});

describe('background reconciliation hooks', () => {
  beforeEach(() => fakeBrowser.reset());

  it('runs at startup, install, and local settings changes only', async () => {
    const isRegexSupported = mockRegexSupport().mockResolvedValue({ isSupported: true });
    mockGetDynamicRules().mockResolvedValue([]);
    const updateDynamicRules = mockUpdateDynamicRules().mockResolvedValue();

    background.main!();
    await vi.waitFor(() => expect(updateDynamicRules).toHaveBeenCalledTimes(1));

    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install', temporary: false });
    await vi.waitFor(() => expect(updateDynamicRules).toHaveBeenCalledTimes(2));

    await fakeBrowser.storage.onChanged.trigger({ unrelated: { newValue: true } }, 'local');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(updateDynamicRules).toHaveBeenCalledTimes(2);

    await fakeBrowser.storage.onChanged.trigger({ settings: { newValue: {} } }, 'sync');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(updateDynamicRules).toHaveBeenCalledTimes(2);

    await fakeBrowser.storage.onChanged.trigger({ settings: { newValue: {} } }, 'local');
    await vi.waitFor(() => expect(updateDynamicRules).toHaveBeenCalledTimes(3));
    expect(isRegexSupported).toHaveBeenCalled();
  });

  it('contains rejected startup and event reconciliations', async () => {
    const error = new Error('DNR unavailable');
    mockRegexSupport().mockRejectedValue(error);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    background.main!();
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledTimes(1));

    await expect(
      fakeBrowser.runtime.onInstalled.trigger({ reason: 'install', temporary: false }),
    ).resolves.toEqual([undefined]);
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledTimes(2));

    await expect(
      fakeBrowser.storage.onChanged.trigger({ settings: { newValue: {} } }, 'local'),
    ).resolves.toEqual([undefined]);
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledTimes(3));
  });
});
