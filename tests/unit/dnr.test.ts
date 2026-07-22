import type { Browser } from 'wxt/browser';
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import background from '../../entrypoints/background';
import { BUILT_IN_RULES } from '../../src/rules/builtins';
import {
  compareRulePrecedence,
  compileDynamicRules,
  getRulePriority,
  persistedDnrOwnsRewrite,
  reconcileDynamicRules,
} from '../../src/rules/dnr';
import { DEFAULT_SETTINGS, saveSettings } from '../../src/storage/settings';
import type { CustomRule, RuleDefinition } from '../../src/rules/types';
import { resetFakeBrowser } from './fake-browser-helpers';

const MAIN_FRAME = ['main_frame'] as const;

type RegexSupport = (
  options: Browser.declarativeNetRequest.RegexOptions,
) => Promise<Browser.declarativeNetRequest.IsRegexSupportedResult>;
type GetDynamicRules = () => Promise<Browser.declarativeNetRequest.Rule[]>;
type UpdateDynamicRules = (
  options: Browser.declarativeNetRequest.UpdateRuleOptions,
) => Promise<void>;
type UpdateStaticRules = (
  options: Browser.declarativeNetRequest.UpdateStaticRulesOptions,
) => Promise<void>;
type UpdateEnabledRulesets = (
  options: Browser.declarativeNetRequest.UpdateRulesetOptions,
) => Promise<void>;
type UpdateTab = (
  tabId: number | undefined,
  updateProperties: Browser.tabs.UpdateProperties,
) => Promise<Browser.tabs.Tab | undefined>;
type StorageGet = (
  keys?: string | string[] | Record<string, unknown> | null,
) => Promise<Record<string, unknown>>;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function mockRegexSupport(): MockInstance<RegexSupport> {
  return vi.spyOn(browser.declarativeNetRequest, 'isRegexSupported') as unknown as MockInstance<RegexSupport>;
}

function mockGetDynamicRules(): MockInstance<GetDynamicRules> {
  return vi.spyOn(browser.declarativeNetRequest, 'getDynamicRules') as unknown as MockInstance<GetDynamicRules>;
}

function mockUpdateDynamicRules(): MockInstance<UpdateDynamicRules> {
  return vi.spyOn(browser.declarativeNetRequest, 'updateDynamicRules') as unknown as MockInstance<UpdateDynamicRules>;
}

function mockUpdateStaticRules(): MockInstance<UpdateStaticRules> {
  const mock = vi.fn<UpdateStaticRules>();
  Object.defineProperty(browser.declarativeNetRequest, 'updateStaticRules', {
    configurable: true,
    value: mock,
  });
  return mock;
}

function mockUpdateEnabledRulesets(): MockInstance<UpdateEnabledRulesets> {
  const mock = vi.fn<UpdateEnabledRulesets>();
  Object.defineProperty(browser.declarativeNetRequest, 'updateEnabledRulesets', {
    configurable: true,
    value: mock,
  });
  return mock;
}

function mockUpdateTab(): MockInstance<UpdateTab> {
  return vi.spyOn(browser.tabs, 'update') as unknown as MockInstance<UpdateTab>;
}

function mockStorageGet(): MockInstance<StorageGet> {
  return vi.spyOn(browser.storage.local, 'get') as unknown as MockInstance<StorageGet>;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function canonicalRequestUrl(input: string): string {
  const url = new URL(input);
  url.hash = '';
  return url.toString();
}

function navigationDetails(
  url: string,
  overrides: Partial<Browser.webNavigation.WebNavigationBaseCallbackDetails> = {},
): Browser.webNavigation.WebNavigationBaseCallbackDetails {
  return {
    documentLifecycle: 'active',
    frameId: 0,
    frameType: 'outermost_frame',
    parentFrameId: -1,
    processId: -1,
    tabId: 7,
    timeStamp: 1,
    url,
    ...overrides,
  };
}

async function startBackgroundWithDnrMocks(): Promise<void> {
  mockRegexSupport().mockResolvedValue({ isSupported: true });
  mockGetDynamicRules().mockResolvedValue([]);
  const updateDynamicRules = mockUpdateDynamicRules().mockResolvedValue();
  background.main!();
  await vi.waitFor(() => expect(updateDynamicRules).toHaveBeenCalledTimes(1));
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

function createIpRule(port: number, host = '1.1.1.1'): CustomRule {
  return {
    id: `custom-ip-${port}`,
    dnrId: 3000 + port,
    name: 'Registered IP service',
    description: 'Test-only registered IP and port pair',
    category: 'custom',
    defaultEnabled: true,
    matcher: { kind: 'host-port', host, port },
    transformer: 'atrust-ip-port',
  };
}

function createYouthHostRule(): CustomRule {
  return {
    id: 'custom-youth-host',
    dnrId: 10_001,
    name: 'Youth through aTrust',
    description: 'Test-only higher-priority Youth host redirect',
    category: 'custom',
    defaultEnabled: true,
    matcher: { kind: 'host', host: 'youth.cqu.edu.cn' },
    transformer: 'atrust-domain',
  };
}

function createCustomYouthArticleRule(): CustomRule {
  return {
    id: 'custom-youth-article',
    dnrId: 10_000,
    name: 'Custom Youth public link',
    description: 'Test-only deferred Youth article redirect',
    category: 'custom',
    defaultEnabled: true,
    matcher: { kind: 'youth-article', host: 'youth.cqu.edu.cn' },
    transformer: 'youth-public',
  };
}

function compileTicketAllowForTest(): Browser.declarativeNetRequest.Rule {
  return compileDynamicRules([createYouthHostRule()], [])
    .find((rule) => rule.action.type === 'allow')!;
}

describe('DNR compilation', () => {
  it('uses one precedence function for custom, Youth, and other rules', () => {
    const core = BUILT_IN_RULES[0]!;
    const youth = BUILT_IN_RULES[1]!;
    const important: RuleDefinition = { ...core, id: 'important', category: 'important' };

    expect(getRulePriority(createIpRule(8000))).toBe(30_000);
    expect(getRulePriority(youth)).toBe(20_000);
    expect(getRulePriority(core)).toBe(10_000);
    expect(getRulePriority(important)).toBe(10_000);
  });

  it('compiles stable top-level redirect rules for the built-ins', () => {
    const compiled = compileDynamicRules(BUILT_IN_RULES, []);
    const [sso, youth] = compiled;

    expect(sso).toMatchObject({
      id: 1001,
      priority: expect.any(Number),
      condition: { resourceTypes: MAIN_FRAME },
      action: {
        type: 'redirect',
        redirect: { regexSubstitution: 'https://sso-cqu-edu-cn-s.atrust.cqu.edu.cn\\1' },
      },
    });
    expect(youth).toMatchObject({
      id: 2001,
      priority: expect.any(Number),
      condition: { resourceTypes: MAIN_FRAME },
      action: { type: 'redirect' },
    });
    expect(compiled).toHaveLength(3);
    expect(youth!.priority!).toBeGreaterThan(sso!.priority!);
    expect(compileDynamicRules(BUILT_IN_RULES, [])).toEqual(
      compileDynamicRules(BUILT_IN_RULES, []),
    );
  });

  it('encodes the same unique total precedence for overlapping equal-base custom rules', () => {
    const host = createYouthHostRule();
    const youth = createCustomYouthArticleRule();
    const compiled = compileDynamicRules([youth, host], []);
    const hostDnr = compiled.find((rule) => rule.id === host.dnrId)!;
    const youthDnr = compiled.find((rule) => rule.id === youth.dnrId)!;
    const redirects = compiled.filter((rule) => rule.action.type === 'redirect');

    expect(compareRulePrecedence(host, youth)).toBeLessThan(0);
    expect(hostDnr.priority!).toBeGreaterThan(youthDnr.priority!);
    expect(new Set(redirects.map((rule) => rule.priority)).size).toBe(redirects.length);
    expect(redirects.every((rule) => rule.priority! > 0 && rule.priority! < 100_000)).toBe(true);
  });

  it('rejects redirect sets that exceed the unique priority capacity', () => {
    expect(() =>
      compileDynamicRules(Array.from({ length: 100_000 }, () => BUILT_IN_RULES[0]!), []),
    ).toThrow(/priority capacity/i);
  });

  it('matches the exact SSO host, preserves its suffix, and rejects host lookalikes', () => {
    const [sso] = compileDynamicRules(BUILT_IN_RULES, []);
    const input =
      'http://sso.cqu.edu.cn:80/login?service=https%3A%2F%2Fone.example%2Fcb&service=https%3A%2F%2Ftwo.example%2Fcb#login';
    const requestUrl = canonicalRequestUrl(input);
    const output = applyRegexRedirect(sso!, requestUrl);

    expect(output).toBe(
      'https://sso-cqu-edu-cn-s.atrust.cqu.edu.cn/login?service=https%3A%2F%2Fone.example%2Fcb&service=https%3A%2F%2Ftwo.example%2Fcb',
    );
    expect(new URL(output!).searchParams.getAll('service')).toEqual(
      new URL(input).searchParams.getAll('service'),
    );
    expect(applyRegexRedirect(sso!, 'https://sso.cqu.edu.cn.evil.example/login')).toBeNull();
    expect(applyRegexRedirect(sso!, 'https://sso.cqu.edu.cn:444/login')).toBeNull();
  });

  it('compiles a top-priority allow for top-level CAS ticket callbacks only', () => {
    const custom = createYouthHostRule();
    const compiled = compileDynamicRules([custom], []);
    const redirect = compiled.find((rule) => rule.id === custom.dnrId)!;
    const ticketAllow = compileTicketAllowForTest();

    expect(ticketAllow.priority).toBeGreaterThan(redirect.priority!);
    expect(ticketAllow.condition).toMatchObject({
      isUrlFilterCaseSensitive: true,
      resourceTypes: MAIN_FRAME,
    });
  });

  it.each([
    'https://youth.cqu.edu.cn/callback?ticket=synthetic',
    'https://youth.cqu.edu.cn/callback?state=x&ticket=synthetic',
    'https://youth.cqu.edu.cn/callback?ticket',
    'https://youth.cqu.edu.cn/callback?ticket&state=x',
    'https://youth.cqu.edu.cn/callback?state=x&ticket#part',
    'https://youth.cqu.edu.cn/callback?t%69cket=synthetic',
    'https://youth.cqu.edu.cn/callback?%74%69%63%6b%65%74=synthetic',
    'https://youth.cqu.edu.cn/callback?%74%69%63%6B%65%74=synthetic',
  ])('allows an exact decoded lowercase top-level ticket key in %s', (input) => {
    expect(matchesRegex(compileTicketAllowForTest(), input)).toBe(true);
  });

  it.each([
    'https://youth.cqu.edu.cn/callback?Ticket=synthetic',
    'https://youth.cqu.edu.cn/callback?%54icket=synthetic',
    'https://youth.cqu.edu.cn/callback?ticketing=synthetic',
    'https://youth.cqu.edu.cn/callback?foo%26ticket=synthetic',
    'https://youth.cqu.edu.cn/callback?name=ticket=synthetic',
    'https://youth.cqu.edu.cn/start?service=https%3A%2F%2Fclient.example%2Fcallback%3Fticket%3Dsynthetic',
    'https://youth.cqu.edu.cn/start?service=x%26t%2569cket%3Dsynthetic',
  ])('does not allow non-top-level or non-exact ticket text in %s', (input) => {
    expect(matchesRegex(compileTicketAllowForTest(), input)).toBe(false);
  });

  it.each([
    [80, 'http://1.1.1.1:80/path?q=1'],
    [80, 'https://1.1.1.1:80/path?q=1'],
    [443, 'https://1.1.1.1:443/path?q=1'],
    [443, 'http://1.1.1.1:443/path?q=1'],
    [8000, 'http://1.1.1.1:8000/path?q=1'],
    [8000, 'https://1.1.1.1:8000/path?q=1'],
  ])('matches canonical request semantics for port %s via %s', (port, input) => {
    const [rule] = compileDynamicRules([createIpRule(port)], []);

    expect(applyRegexRedirect(rule!, canonicalRequestUrl(input))).toBe(
      `https://1-1-1-1-${port}-p.atrust.cqu.edu.cn/path?q=1`,
    );
  });

  it('distinguishes canonical default ports by scheme', () => {
    const [httpRule] = compileDynamicRules([createIpRule(80)], []);
    const [httpsRule] = compileDynamicRules([createIpRule(443)], []);

    expect(applyRegexRedirect(httpRule!, canonicalRequestUrl('http://1.1.1.1/path'))).not.toBeNull();
    expect(applyRegexRedirect(httpRule!, canonicalRequestUrl('https://1.1.1.1/path'))).toBeNull();
    expect(applyRegexRedirect(httpsRule!, canonicalRequestUrl('https://1.1.1.1/path'))).not.toBeNull();
    expect(applyRegexRedirect(httpsRule!, canonicalRequestUrl('http://1.1.1.1/path'))).toBeNull();
  });

  it('still rejects wrong hosts and retained non-default ports', () => {
    const [rule] = compileDynamicRules([createIpRule(8000)], []);

    expect(applyRegexRedirect(rule!, canonicalRequestUrl('http://1.1.1.1/path'))).toBeNull();
    expect(applyRegexRedirect(rule!, canonicalRequestUrl('http://1.1.1.10:8000/path'))).toBeNull();
    expect(applyRegexRedirect(rule!, canonicalRequestUrl('http://1.1.1.1:8001/path'))).toBeNull();
  });

  it.each([
    'example.com',
    '127.1',
    '0x7f000001',
    '0177.0.0.1',
    '2130706433',
    '[::1]',
    '256.1.1.1',
    '01.1.1.1',
    ' 1.1.1.1',
  ])('rejects non-canonical host-port matcher host %s', (host) => {
    expect(() => compileDynamicRules([createIpRule(8000, host)], [])).toThrow(
      'complete canonical IPv4',
    );
  });

  it.each([0, 65_536, 1.5, Number.NaN])('rejects invalid host-port matcher port %s', (port) => {
    expect(() => compileDynamicRules([createIpRule(port)], [])).toThrow('invalid port');
  });

  it('builds only a queryless Youth request target and preserves Chrome-visible fragments', () => {
    const youth = compileDynamicRules(BUILT_IN_RULES, [])[1]!;
    const source = canonicalRequestUrl(
      'https://youth.cqu.edu.cn/info/1009/24264.htm#print',
    );
    const target =
      'https://youth.cqu.edu.cn/content.jsp?urltype=news.NewsContentUrl&wbtreeid=1009&wbnewsid=24264';

    expect(applyRegexRedirect(youth, source)).toBe(target);
    expect(
      applyRegexRedirect(
        youth,
        'https://youth.cqu.edu.cn/info/1009/24264.htm#print',
      ),
    ).toBe(`${target}#print`);
    expect(
      applyRegexRedirect(
        youth,
        canonicalRequestUrl('https://youth.cqu.edu.cn/info/1009/24264.htm?'),
      ),
    ).toBe(target);
    expect(
      applyRegexRedirect(
        youth,
        canonicalRequestUrl('https://youth.cqu.edu.cn/info/1009/24264.htm?state=opaque'),
      ),
    ).toBeNull();
    expect(
      applyRegexRedirect(
        youth,
        canonicalRequestUrl('https://youth.cqu.edu.cn.evil.example/info/1009/24264.htm'),
      ),
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
    const allows = first.filter(
      (rule) => rule.action.type === 'allow' && rule.priority === 100_000,
    );

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

  it('keeps a persistent allow guard for disabled packaged rules below custom redirects', () => {
    const custom = createYouthHostRule();
    const compiled = compileDynamicRules(
      [custom],
      [],
      ['core-sso', 'addon-youth-public'],
    );
    const guards = compiled.filter(
      (rule) => rule.action.type === 'allow' && rule.priority === 50_000,
    );
    const customRedirect = compiled.find((rule) => rule.id === custom.dnrId)!;

    expect(guards.map((rule) => rule.id)).toEqual([900_001, 900_002]);
    expect(matchesRegex(guards[0]!, 'https://sso.cqu.edu.cn/login')).toBe(true);
    expect(matchesRegex(
      guards[1]!,
      'https://youth.cqu.edu.cn/info/1009/24264.htm',
    )).toBe(true);
    expect(customRedirect.priority).toBeGreaterThan(guards[1]!.priority!);
  });

  it('rejects collisions across derived, exclusion, and registered rule IDs', () => {
    const collidingRule = { ...createIpRule(8000), dnrId: 80_000 };

    expect(() => compileDynamicRules([collidingRule], ['sso.cqu.edu.cn'])).toThrow(
      'Duplicate DNR rule ID: 80000',
    );
  });
});

describe('persisted DNR compiler trust boundary', () => {
  const input = 'https://sso.cqu.edu.cn/login?service=%2Fclient#form';
  const target = 'https://sso-cqu-edu-cn-s.atrust.cqu.edu.cn/login?service=%2Fclient#form';

  function ownership(
    select: (compiled: Browser.declarativeNetRequest.Rule[]) =>
      Browser.declarativeNetRequest.Rule[],
  ): boolean {
    const compiled = compileDynamicRules(BUILT_IN_RULES, []);
    return persistedDnrOwnsRewrite(
      select(structuredClone(compiled)),
      compiled,
      input,
      BUILT_IN_RULES[0]!.dnrId,
      target,
    );
  }

  it('rejects an unknown XHR-only allow even when the relevant compiler rule is present', () => {
    expect(ownership((compiled) => [
      compiled.find((rule) => rule.id === BUILT_IN_RULES[0]!.dnrId)!,
      {
        id: 765_001,
        priority: 200_000,
        action: { type: 'allow' },
        condition: {
          regexFilter: '^https?://sso\\.cqu\\.edu\\.cn/.*$',
          resourceTypes: ['xmlhttprequest'],
        },
      },
    ])).toBe(false);
  });

  it('rejects an unknown higher-priority urlFilter rule', () => {
    expect(ownership((compiled) => [
      compiled.find((rule) => rule.id === BUILT_IN_RULES[0]!.dnrId)!,
      {
        id: 765_002,
        priority: 200_000,
        action: { type: 'allow' },
        condition: { urlFilter: '||sso.cqu.edu.cn/', resourceTypes: ['main_frame'] },
      },
    ])).toBe(false);
  });

  it('rejects a stale same-ID substitution with the wrong fragment', () => {
    expect(ownership((compiled) => compiled
      .filter((rule) => rule.id === BUILT_IN_RULES[0]!.dnrId)
      .map((rule) => ({
        ...rule,
        action: {
          type: 'redirect' as const,
          redirect: {
            regexSubstitution:
              'https://sso-cqu-edu-cn-s.atrust.cqu.edu.cn\\1#wrong',
          },
        },
      })))).toBe(false);
  });

  it('trusts a partial compiler-owned set containing the exact relevant rule and fragment behavior', () => {
    expect(ownership((compiled) =>
      compiled.filter((rule) => rule.id === BUILT_IN_RULES[0]!.dnrId),
    )).toBe(true);
  });

  it('rejects a partial compiler-owned set containing only an unrelated rule', () => {
    expect(ownership((compiled) =>
      compiled.filter((rule) => rule.id === BUILT_IN_RULES[1]!.dnrId),
    )).toBe(false);
  });
});

describe('DNR reconciliation', () => {
  beforeEach(resetFakeBrowser);

  it('keeps packaged built-in rules synchronized with disabled settings', async () => {
    mockRegexSupport().mockResolvedValue({ isSupported: true });
    mockGetDynamicRules().mockResolvedValue([]);
    mockUpdateDynamicRules().mockResolvedValue();
    const updateStaticRules = mockUpdateStaticRules().mockResolvedValue();

    await reconcileDynamicRules({
      ...DEFAULT_SETTINGS,
      disabledRuleIds: ['core-sso'],
    });

    expect(updateStaticRules).toHaveBeenCalledWith({
      rulesetId: 'built_in_defaults',
      disableRuleIds: [1001],
      enableRuleIds: [2001],
    });

    await reconcileDynamicRules({ ...DEFAULT_SETTINGS, enabled: false });
    expect(updateStaticRules).toHaveBeenLastCalledWith({
      rulesetId: 'built_in_defaults',
      disableRuleIds: [1001, 2001],
      enableRuleIds: [],
    });

    await reconcileDynamicRules(DEFAULT_SETTINGS);
    expect(updateStaticRules).toHaveBeenLastCalledWith({
      rulesetId: 'built_in_defaults',
      disableRuleIds: [],
      enableRuleIds: [1001, 2001],
    });
  });

  it('persists the all-CQU static ruleset only while the mode is active', async () => {
    mockRegexSupport().mockResolvedValue({ isSupported: true });
    mockGetDynamicRules().mockResolvedValue([]);
    mockUpdateDynamicRules().mockResolvedValue();
    const updateEnabledRulesets = mockUpdateEnabledRulesets().mockResolvedValue();

    await reconcileDynamicRules({
      ...DEFAULT_SETTINGS,
      enableAllCquDomains: true,
    });
    expect(updateEnabledRulesets).toHaveBeenLastCalledWith({
      enableRulesetIds: ['all_cqu_domains'],
      disableRulesetIds: [],
    });

    await reconcileDynamicRules(DEFAULT_SETTINGS);
    expect(updateEnabledRulesets).toHaveBeenLastCalledWith({
      enableRulesetIds: [],
      disableRulesetIds: ['all_cqu_domains'],
    });

    await reconcileDynamicRules({
      ...DEFAULT_SETTINGS,
      enabled: false,
      enableAllCquDomains: true,
    });
    expect(updateEnabledRulesets).toHaveBeenLastCalledWith({
      enableRulesetIds: [],
      disableRulesetIds: ['all_cqu_domains'],
    });
  });

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

  it('skips one unsupported redirect while installing unrelated rules', async () => {
    await saveSettings(DEFAULT_SETTINGS);
    mockRegexSupport().mockImplementation(async ({ regex }) =>
      regex.includes('sso\\.cqu\\.edu\\.cn')
        ? { isSupported: false, reason: 'syntaxError' }
        : { isSupported: true },
    );
    mockGetDynamicRules().mockResolvedValue([
      { id: 999, priority: 1, action: { type: 'allow' }, condition: {} },
    ]);
    const updateDynamicRules = mockUpdateDynamicRules().mockResolvedValue();

    const evidence = await reconcileDynamicRules();

    expect(evidence.validationErrors).toEqual([{
      ruleId: 'core-sso',
      message: expect.stringContaining('syntaxError'),
    }]);
    const installed = updateDynamicRules.mock.calls[0]![0].addRules ?? [];
    expect(installed.map((rule) => rule.id)).not.toContain(BUILT_IN_RULES[0]!.dnrId);
    expect(installed.map((rule) => rule.id)).toEqual(expect.arrayContaining([
      BUILT_IN_RULES[1]!.dnrId,
      999_999_999,
    ]));
  });

  it('skips one rule that fails compilation while preserving valid rules', async () => {
    const invalid = createIpRule(8000, '999.1.1.1');
    mockRegexSupport().mockResolvedValue({ isSupported: true });
    mockGetDynamicRules().mockResolvedValue([]);
    const updateDynamicRules = mockUpdateDynamicRules().mockResolvedValue();

    const evidence = await reconcileDynamicRules({
      ...DEFAULT_SETTINGS,
      customRules: [invalid],
    });

    expect(evidence.validationErrors).toEqual([{
      ruleId: invalid.id,
      message: expect.stringContaining('canonical IPv4'),
    }]);
    const installed = updateDynamicRules.mock.calls[0]![0].addRules ?? [];
    expect(installed.map((rule) => rule.id)).toEqual(expect.arrayContaining([
      BUILT_IN_RULES[0]!.dnrId,
      BUILT_IN_RULES[1]!.dnrId,
      999_999_999,
    ]));
    expect(installed.map((rule) => rule.id)).not.toContain(invalid.dnrId);
  });
});

describe('background reconciliation hooks', () => {
  beforeEach(resetFakeBrowser);

  it('runs at startup and install without redundant storage-change reconciliation', async () => {
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
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(updateDynamicRules).toHaveBeenCalledTimes(2);
    expect(isRegexSupported).toHaveBeenCalled();
  });

  it('exposes the latest per-rule validation status to trusted extension pages', async () => {
    mockRegexSupport().mockImplementation(async ({ regex }) =>
      regex.includes('sso\\.cqu\\.edu\\.cn')
        ? { isSupported: false, reason: 'syntaxError' }
        : { isSupported: true },
    );
    mockGetDynamicRules().mockResolvedValue([]);
    const updateDynamicRules = mockUpdateDynamicRules().mockResolvedValue();
    background.main!();
    await vi.waitFor(() => expect(updateDynamicRules).toHaveBeenCalled());

    await expect(fakeBrowser.runtime.onMessage.trigger(
      { type: 'get-dnr-status' },
      { id: browser.runtime.id, url: browser.runtime.getURL('/options.html') },
    )).resolves.toEqual([{
      ok: true,
      dnrStatus: {
        errors: [{ ruleId: 'core-sso', message: expect.stringContaining('syntaxError') }],
      },
    }]);
  });

  it('waits for delayed startup reconciliation before exposing rule validation status', async () => {
    mockRegexSupport().mockImplementation(async ({ regex }) =>
      regex.includes('sso\\.cqu\\.edu\\.cn')
        ? { isSupported: false, reason: 'syntaxError' }
        : { isSupported: true },
    );
    mockGetDynamicRules().mockResolvedValue([]);
    const startup = deferred<void>();
    const updateDynamicRules = mockUpdateDynamicRules().mockReturnValue(startup.promise);
    background.main!();
    await vi.waitFor(() => expect(updateDynamicRules).toHaveBeenCalledOnce());

    let settled = false;
    const response = fakeBrowser.runtime.onMessage.trigger(
      { type: 'get-dnr-status' },
      { id: browser.runtime.id, url: browser.runtime.getURL('/options.html') },
    ).then((value) => {
      settled = true;
      return value;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);

    startup.resolve();
    await expect(response).resolves.toEqual([{
      ok: true,
      dnrStatus: {
        errors: [{ ruleId: 'core-sso', message: expect.stringContaining('syntaxError') }],
      },
    }]);
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
    ).resolves.toEqual([]);
    expect(consoleError).toHaveBeenCalledTimes(2);
  });

  it('does not acknowledge a settings mutation until its DNR reconciliation succeeds', async () => {
    await saveSettings(DEFAULT_SETTINGS);
    mockRegexSupport().mockResolvedValue({ isSupported: true });
    mockGetDynamicRules().mockResolvedValue([]);
    const reconciliation = deferred<void>();
    const updateDynamicRules = mockUpdateDynamicRules()
      .mockResolvedValueOnce()
      .mockReturnValueOnce(reconciliation.promise);
    background.main!();
    await vi.waitFor(() => expect(updateDynamicRules).toHaveBeenCalledOnce());

    let settled = false;
    const response = fakeBrowser.runtime.onMessage.trigger({
      type: 'replace-settings',
      expectedRevision: 1,
      settings: {
        enabled: false,
        disabledRuleIds: [],
        customRules: [],
        excludedHosts: [],
      },
    }, { id: browser.runtime.id }).then((value) => {
      settled = true;
      return value;
    });
    await vi.waitFor(() => expect(updateDynamicRules).toHaveBeenCalledTimes(2));
    expect(settled).toBe(false);

    reconciliation.resolve();
    await reconciliation.promise;
    await expect(response).resolves.toEqual([{ ok: true, revision: 2 }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('rolls settings back and returns an actionable failure when DNR reconciliation fails', async () => {
    await saveSettings(DEFAULT_SETTINGS);
    mockRegexSupport().mockResolvedValue({ isSupported: true });
    mockGetDynamicRules().mockResolvedValue([]);
    const updateDynamicRules = mockUpdateDynamicRules()
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error('DNR unavailable'))
      .mockResolvedValueOnce();
    background.main!();
    await vi.waitFor(() => expect(updateDynamicRules).toHaveBeenCalledOnce());

    await expect(fakeBrowser.runtime.onMessage.trigger({
      type: 'replace-settings',
      expectedRevision: 1,
      settings: {
        enabled: false,
        disabledRuleIds: [],
        customRules: [],
        excludedHosts: [],
      },
    }, { id: browser.runtime.id })).resolves.toEqual([{
      ok: false,
      code: 'settings-apply-failed',
      error: expect.stringContaining('DNR'),
    }]);
    expect(await browser.storage.local.get()).toMatchObject({
      settings: DEFAULT_SETTINGS,
      settingsRevision: 1,
    });
  });

  it('holds snapshot and navigation reads behind a failed candidate until rollback commits', async () => {
    await saveSettings(DEFAULT_SETTINGS);
    mockRegexSupport().mockResolvedValue({ isSupported: true });
    mockGetDynamicRules().mockResolvedValue([]);
    const candidateApply = deferred<void>();
    const updateDynamicRules = mockUpdateDynamicRules()
      .mockResolvedValueOnce()
      .mockReturnValueOnce(candidateApply.promise)
      .mockResolvedValueOnce();
    background.main!();
    await vi.waitFor(() => expect(updateDynamicRules).toHaveBeenCalledOnce());
    const localGet = vi.spyOn(browser.storage.local, 'get');

    const mutation = fakeBrowser.runtime.onMessage.trigger({
      type: 'replace-settings',
      expectedRevision: 1,
      settings: {
        enabled: false,
        disabledRuleIds: [],
        customRules: [],
        excludedHosts: [],
      },
    }, { id: browser.runtime.id });
    await vi.waitFor(() => expect(updateDynamicRules).toHaveBeenCalledTimes(2));
    const readsBefore = localGet.mock.calls.length;
    let snapshotSettled = false;
    const snapshot = fakeBrowser.runtime.onMessage.trigger(
      { type: 'get-settings-snapshot' },
      { id: browser.runtime.id },
    ).then((value) => {
      snapshotSettled = true;
      return value;
    });
    await fakeBrowser.webNavigation.onBeforeNavigate.trigger(
      navigationDetails('https://sso.cqu.edu.cn/login'),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const settledBeforeRollback = snapshotSettled;
    const readsDuringCandidate = localGet.mock.calls.length;

    candidateApply.reject(new Error('candidate apply failed'));
    await expect(mutation).resolves.toEqual([{
      ok: false,
      code: 'settings-apply-failed',
      error: expect.any(String),
    }]);
    await expect(snapshot).resolves.toEqual([{
      ok: true,
      snapshot: { settings: DEFAULT_SETTINGS, revision: 1 },
    }]);
    expect(settledBeforeRollback).toBe(false);
    expect(readsDuringCandidate).toBe(readsBefore);
    await vi.waitFor(() =>
      expect(browser.storage.session.get('rewrite:7')).resolves.toMatchObject({
        'rewrite:7': { ruleId: 'core-sso' },
      }),
    );
  });

  it('lets the packaged static rule handle a built-in rewrite before dynamic DNR readiness', async () => {
    await saveSettings(DEFAULT_SETTINGS);
    mockRegexSupport().mockResolvedValue({ isSupported: true });
    mockGetDynamicRules().mockResolvedValue([]);
    const startup = deferred<void>();
    mockUpdateDynamicRules().mockReturnValueOnce(startup.promise);
    const updateTab = mockUpdateTab().mockResolvedValue(undefined);
    background.main!();

    await fakeBrowser.webNavigation.onBeforeNavigate.trigger(
      navigationDetails('https://sso.cqu.edu.cn/login'),
    );
    expect(updateTab).not.toHaveBeenCalled();
    startup.resolve();

    await startup.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(updateTab).not.toHaveBeenCalled();
  });

  it('does not manually compete with persisted DNR during a worker restart', async () => {
    await saveSettings(DEFAULT_SETTINGS);
    mockRegexSupport().mockResolvedValue({ isSupported: true });
    const persisted = compileDynamicRules(BUILT_IN_RULES, []);
    mockGetDynamicRules().mockResolvedValue(persisted);
    const startup = deferred<void>();
    mockUpdateDynamicRules().mockReturnValueOnce(startup.promise);
    const updateTab = mockUpdateTab().mockResolvedValue(undefined);
    background.main!();

    await fakeBrowser.webNavigation.onBeforeNavigate.trigger(
      navigationDetails('https://sso.cqu.edu.cn/login'),
    );
    startup.resolve();
    await startup.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(updateTab).not.toHaveBeenCalled();
  });

  it.each([
    ['partial unrelated rules', (rules: Browser.declarativeNetRequest.Rule[]) =>
      rules.filter((rule) => rule.id !== BUILT_IN_RULES[0]!.dnrId)],
    ['a stale same-ID redirect', (rules: Browser.declarativeNetRequest.Rule[]) =>
      rules.map((rule) => rule.id === BUILT_IN_RULES[0]!.dnrId
        ? {
            ...rule,
            action: {
              type: 'redirect' as const,
              redirect: { regexSubstitution: 'https://library-cqu-edu-cn-s.atrust.cqu.edu.cn\\1' },
            },
            condition: {
              ...rule.condition,
              regexFilter: '^https?://library\\.cqu\\.edu\\.cn((?:[/?].*)?)$',
            },
          }
        : rule)],
  ])('lets packaged static SSO handle an early navigation when dynamic DNR has %s', async (_label, select) => {
    await saveSettings(DEFAULT_SETTINGS);
    mockRegexSupport().mockResolvedValue({ isSupported: true });
    const persisted = select(compileDynamicRules(BUILT_IN_RULES, []));
    mockGetDynamicRules().mockResolvedValue(persisted);
    const startup = deferred<void>();
    mockUpdateDynamicRules().mockReturnValueOnce(startup.promise);
    const updateTab = mockUpdateTab().mockResolvedValue(undefined);
    background.main!();

    await fakeBrowser.webNavigation.onBeforeNavigate.trigger(
      navigationDetails('https://sso.cqu.edu.cn/login'),
    );
    startup.resolve();

    await startup.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(updateTab).not.toHaveBeenCalled();
  });
});

describe('queried Youth navigation routing', () => {
  beforeEach(() => {
    resetFakeBrowser();
    fakeBrowser.webNavigation.onBeforeNavigate.removeAllListeners();
  });

  it('does not record or navigate a top-level CAS ticket callback', async () => {
    await saveSettings({
      ...DEFAULT_SETTINGS,
      enableAllCquDomains: true,
      customRules: [createYouthHostRule()],
    });
    const updateTab = mockUpdateTab().mockResolvedValue(undefined);
    await startBackgroundWithDnrMocks();

    await fakeBrowser.webNavigation.onBeforeNavigate.trigger(
      navigationDetails(
        'https://youth.cqu.edu.cn/callback?state=x&ticket=synthetic',
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(updateTab).not.toHaveBeenCalled();
    await expect(browser.storage.session.get('rewrite:7')).resolves.toEqual({});
  });

  it('uses the hardened Rule Core for conflicts, protected duplicates, raw encoding, and fragments', async () => {
    await saveSettings(DEFAULT_SETTINGS);
    const updateTab = mockUpdateTab().mockResolvedValue(undefined);
    await startBackgroundWithDnrMocks();
    const input =
      'https://youth.cqu.edu.cn/info/1009/24264.htm?state=first&urltype=wrong&redirect_uri=https%3a%2f%2fclient.example%2fcb%3fq%3da%2520b&wb%6eewsid=111&foo=1&state=second&wbtreeid=222&service=https%3A%2F%2Fone.example%2Fcb&redirect_uri=https%3A%2F%2Ftwo.example%2Fcb&service=https%3A%2F%2Ftwo.example%2Fcb#details';

    await expect(fakeBrowser.webNavigation.onBeforeNavigate.trigger(navigationDetails(input)))
      .resolves.toEqual([undefined]);
    await vi.waitFor(() => expect(updateTab).toHaveBeenCalledTimes(1));

    const target =
      'https://youth.cqu.edu.cn/content.jsp?state=first&redirect_uri=https%3a%2f%2fclient.example%2fcb%3fq%3da%2520b&foo=1&state=second&service=https%3A%2F%2Fone.example%2Fcb&redirect_uri=https%3A%2F%2Ftwo.example%2Fcb&service=https%3A%2F%2Ftwo.example%2Fcb&urltype=news.NewsContentUrl&wbtreeid=1009&wbnewsid=24264#details';
    expect(updateTab).toHaveBeenCalledWith(7, { url: target });

    const before = new URL(input);
    const after = new URL(target);
    for (const key of ['state', 'redirect_uri', 'service', 'foo']) {
      expect(after.searchParams.getAll(key)).toEqual(before.searchParams.getAll(key));
    }
    expect(after.searchParams.getAll('urltype')).toEqual(['news.NewsContentUrl']);
    expect(after.searchParams.getAll('wbtreeid')).toEqual(['1009']);
    expect(after.searchParams.getAll('wbnewsid')).toEqual(['24264']);
    expect(after.hash).toBe('#details');
  });

  it('leaves a queried Youth URL to a higher-priority custom host DNR rule', async () => {
    await saveSettings({
      ...DEFAULT_SETTINGS,
      enableAllCquDomains: true,
      customRules: [createYouthHostRule()],
    });
    const updateTab = mockUpdateTab().mockResolvedValue(undefined);
    await startBackgroundWithDnrMocks();

    await fakeBrowser.webNavigation.onBeforeNavigate.trigger(
      navigationDetails('https://youth.cqu.edu.cn/info/1009/24264.htm?state=x'),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(updateTab).not.toHaveBeenCalled();
  });

  it('prefers a DNR-applicable rule over a deferred Youth rule at equal priority', async () => {
    await saveSettings({
      ...DEFAULT_SETTINGS,
      customRules: [createCustomYouthArticleRule(), createYouthHostRule()],
      disabledRuleIds: ['addon-youth-public'],
    });
    const updateTab = mockUpdateTab().mockResolvedValue(undefined);
    await startBackgroundWithDnrMocks();

    await fakeBrowser.webNavigation.onBeforeNavigate.trigger(
      navigationDetails('https://youth.cqu.edu.cn/info/1009/24264.htm?state=x'),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(updateTab).not.toHaveBeenCalled();
  });

  it('records the same custom-host winner that compiled DNR gives a queryless overlap', async () => {
    const youth = createCustomYouthArticleRule();
    const host = createYouthHostRule();
    await saveSettings({
      ...DEFAULT_SETTINGS,
      customRules: [youth, host],
      disabledRuleIds: ['addon-youth-public'],
    });
    const compiled = compileDynamicRules([youth, host], []);
    const compiledWinner = compiled
      .filter((rule) => rule.action.type === 'redirect')
      .sort((left, right) => right.priority! - left.priority!)[0]!;
    await startBackgroundWithDnrMocks();

    await fakeBrowser.webNavigation.onBeforeNavigate.trigger(
      navigationDetails('https://youth.cqu.edu.cn/info/1009/24264.htm'),
    );

    await vi.waitFor(() =>
      expect(browser.storage.session.get('rewrite:7')).resolves.toMatchObject({
        'rewrite:7': { ruleId: host.id },
      }),
    );
    expect(compiledWinner.id).toBe(host.dnrId);
  });

  it('restores queried Youth fallback when the custom host rule is disabled', async () => {
    const customRule = createYouthHostRule();
    await saveSettings({
      ...DEFAULT_SETTINGS,
      customRules: [customRule],
      disabledRuleIds: [customRule.id],
    });
    const updateTab = mockUpdateTab().mockResolvedValue(undefined);
    await startBackgroundWithDnrMocks();
    const input = 'https://youth.cqu.edu.cn/info/1009/24264.htm?state=x';

    await fakeBrowser.webNavigation.onBeforeNavigate.trigger(navigationDetails(input));
    await vi.waitFor(() => expect(updateTab).toHaveBeenCalledTimes(1));
    expect(updateTab).toHaveBeenCalledWith(7, {
      url: 'https://youth.cqu.edu.cn/content.jsp?state=x&urltype=news.NewsContentUrl&wbtreeid=1009&wbnewsid=24264',
    });
  });

  it('does not let a stale queried Youth completion overwrite a newer top-frame navigation', async () => {
    await saveSettings(DEFAULT_SETTINGS);
    const updateTab = mockUpdateTab().mockResolvedValue(undefined);
    await startBackgroundWithDnrMocks();
    const pendingSettings = deferred<Record<string, unknown>>();
    const storageGet = mockStorageGet().mockReturnValueOnce(pendingSettings.promise);

    await fakeBrowser.webNavigation.onBeforeNavigate.trigger(
      navigationDetails('https://youth.cqu.edu.cn/info/1009/24264.htm?state=old'),
    );
    await vi.waitFor(() => expect(storageGet).toHaveBeenCalledTimes(1));
    await fakeBrowser.webNavigation.onBeforeNavigate.trigger(
      navigationDetails('https://example.com/newer'),
    );

    pendingSettings.resolve({ settings: DEFAULT_SETTINGS });
    await pendingSettings.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(updateTab).not.toHaveBeenCalled();
  });

  it('updates when a deferred queried Youth navigation is still current', async () => {
    await saveSettings(DEFAULT_SETTINGS);
    const updateTab = mockUpdateTab().mockResolvedValue(undefined);
    await startBackgroundWithDnrMocks();
    const pendingSettings = deferred<Record<string, unknown>>();
    const storageGet = mockStorageGet().mockReturnValueOnce(pendingSettings.promise);
    const input = 'https://youth.cqu.edu.cn/info/1009/24264.htm?state=current';

    await fakeBrowser.webNavigation.onBeforeNavigate.trigger(navigationDetails(input));
    await vi.waitFor(() => expect(storageGet).toHaveBeenCalledTimes(1));
    pendingSettings.resolve({ settings: DEFAULT_SETTINGS });

    await vi.waitFor(() => expect(updateTab).toHaveBeenCalledTimes(1));
    expect(updateTab).toHaveBeenCalledWith(7, {
      url: 'https://youth.cqu.edu.cn/content.jsp?state=current&urltype=news.NewsContentUrl&wbtreeid=1009&wbnewsid=24264',
    });
  });

  it('invalidates a deferred queried Youth navigation when its tab closes', async () => {
    await saveSettings(DEFAULT_SETTINGS);
    const updateTab = mockUpdateTab().mockResolvedValue(undefined);
    await startBackgroundWithDnrMocks();
    const pendingSettings = deferred<Record<string, unknown>>();
    mockStorageGet().mockReturnValueOnce(pendingSettings.promise);

    await fakeBrowser.webNavigation.onBeforeNavigate.trigger(
      navigationDetails('https://youth.cqu.edu.cn/info/1009/24264.htm?state=closing'),
    );
    await fakeBrowser.tabs.onRemoved.trigger(7, { isWindowClosing: false, windowId: 1 });
    pendingSettings.resolve({ settings: DEFAULT_SETTINGS });
    await pendingSettings.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(updateTab).not.toHaveBeenCalled();
  });

  it('ignores queryless URLs, rewrite targets, subframes, unsupported schemes, and nonmatches', async () => {
    await saveSettings(DEFAULT_SETTINGS);
    const updateTab = mockUpdateTab().mockResolvedValue(undefined);
    await startBackgroundWithDnrMocks();

    const ignored = [
      navigationDetails('https://youth.cqu.edu.cn/info/1009/24264.htm'),
      navigationDetails(
        'https://youth.cqu.edu.cn/content.jsp?urltype=news.NewsContentUrl&wbtreeid=1009&wbnewsid=24264',
      ),
      navigationDetails('https://youth.cqu.edu.cn/info/1009/24264.htm?state=x', {
        frameId: 1,
        frameType: 'sub_frame',
        parentFrameId: 0,
      }),
      navigationDetails('ftp://youth.cqu.edu.cn/info/1009/24264.htm?state=x'),
      navigationDetails('https://youth.cqu.edu.cn/info/1009/not-an-article.htm?state=x'),
      navigationDetails('https://youth.cqu.edu.cn.evil.example/info/1009/24264.htm?state=x'),
    ];

    for (const details of ignored) {
      await fakeBrowser.webNavigation.onBeforeNavigate.trigger(details);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(updateTab).not.toHaveBeenCalled();
  });

  it.each([
    {
      settings: { ...DEFAULT_SETTINGS, excludedHosts: ['youth.cqu.edu.cn'] },
      label: 'excluded host',
    },
    {
      settings: { ...DEFAULT_SETTINGS, disabledRuleIds: ['addon-youth-public'] },
      label: 'disabled built-in',
    },
  ])('honors the $label setting', async ({ settings }) => {
    await saveSettings(settings);
    const updateTab = mockUpdateTab().mockResolvedValue(undefined);
    await startBackgroundWithDnrMocks();

    await fakeBrowser.webNavigation.onBeforeNavigate.trigger(
      navigationDetails('https://youth.cqu.edu.cn/info/1009/24264.htm?state=x'),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(updateTab).not.toHaveBeenCalled();
  });

  it('contains and logs a rejected tab navigation without rejecting the event', async () => {
    await saveSettings(DEFAULT_SETTINGS);
    const error = new Error('tab closed');
    mockUpdateTab().mockRejectedValue(error);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await startBackgroundWithDnrMocks();

    await expect(
      fakeBrowser.webNavigation.onBeforeNavigate.trigger(
        navigationDetails('https://youth.cqu.edu.cn/info/1009/24264.htm?state=x'),
      ),
    ).resolves.toEqual([undefined]);
    await vi.waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith(
        'Failed to rewrite top-frame navigation',
        error,
      ),
    );
  });
});

describe('unified top-frame navigation routing', () => {
  beforeEach(() => {
    resetFakeBrowser();
    fakeBrowser.webNavigation.onBeforeNavigate.removeAllListeners();
  });

  it('registers exactly one navigation listener synchronously at startup', () => {
    mockRegexSupport().mockResolvedValue({ isSupported: true });
    mockGetDynamicRules().mockResolvedValue([]);
    mockUpdateDynamicRules().mockResolvedValue();
    const addListener = vi.spyOn(browser.webNavigation.onBeforeNavigate, 'addListener');

    background.main!();

    expect(addListener).toHaveBeenCalledTimes(1);
    expect(browser.webNavigation.onBeforeNavigate.hasListeners()).toBe(true);
  });

  it('uses the all-CQU rewrite only as the fallback and performs one tab update', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, enableAllCquDomains: true });
    const updateTab = mockUpdateTab().mockResolvedValue(undefined);
    await startBackgroundWithDnrMocks();

    await expect(
      fakeBrowser.webNavigation.onBeforeNavigate.trigger(
        navigationDetails('https://library.cqu.edu.cn/a?q=1#part'),
      ),
    ).resolves.toEqual([undefined]);
    await vi.waitFor(() => expect(updateTab).toHaveBeenCalledTimes(1));

    expect(updateTab).toHaveBeenCalledWith(7, {
      url: 'https://library-cqu-edu-cn-s.atrust.cqu.edu.cn/a?q=1#part',
    });
  });

  it.each([
    ['SSO DNR', 'https://sso.cqu.edu.cn/login?service=https%3A%2F%2Fclient.example%2Fcb'],
    ['queryless Youth DNR', 'https://youth.cqu.edu.cn/info/1009/24264.htm'],
  ])('does not compete with the $label rule', async (_label, url) => {
    await saveSettings({ ...DEFAULT_SETTINGS, enableAllCquDomains: true });
    const updateTab = mockUpdateTab().mockResolvedValue(undefined);
    await startBackgroundWithDnrMocks();

    await fakeBrowser.webNavigation.onBeforeNavigate.trigger(navigationDetails(url));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(updateTab).not.toHaveBeenCalled();
  });

  it('lets the queried-Youth Rule Core win over all-CQU without a competing update', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, enableAllCquDomains: true });
    const updateTab = mockUpdateTab().mockResolvedValue(undefined);
    await startBackgroundWithDnrMocks();

    await fakeBrowser.webNavigation.onBeforeNavigate.trigger(
      navigationDetails('https://youth.cqu.edu.cn/info/1009/24264.htm?state=x'),
    );
    await vi.waitFor(() => expect(updateTab).toHaveBeenCalledTimes(1));

    expect(updateTab).toHaveBeenCalledWith(7, {
      url: 'https://youth.cqu.edu.cn/content.jsp?state=x&urltype=news.NewsContentUrl&wbtreeid=1009&wbnewsid=24264',
    });
  });

  it('invalidates delayed all-CQU work when a newer top-frame navigation arrives', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, enableAllCquDomains: true });
    const updateTab = mockUpdateTab().mockResolvedValue(undefined);
    await startBackgroundWithDnrMocks();
    const pendingSettings = deferred<Record<string, unknown>>();
    const storageGet = mockStorageGet().mockReturnValueOnce(pendingSettings.promise);

    await fakeBrowser.webNavigation.onBeforeNavigate.trigger(
      navigationDetails('https://library.cqu.edu.cn/old'),
    );
    await vi.waitFor(() => expect(storageGet).toHaveBeenCalledTimes(1));
    await fakeBrowser.webNavigation.onBeforeNavigate.trigger(
      navigationDetails('https://example.com/newer'),
    );

    pendingSettings.resolve({
      settings: { ...DEFAULT_SETTINGS, enableAllCquDomains: true },
    });
    await pendingSettings.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(updateTab).not.toHaveBeenCalled();
  });

  it.each([
    'https://sso.cqu.edu.cn:8443/login?service=https%3A%2F%2Fclient.example%2Fcb',
    'https://youth.cqu.edu.cn:8443/info/1009/24264.htm?state=x',
  ])('quietly ignores a registered hostname with a retained non-default port: %s', async (url) => {
    await saveSettings({ ...DEFAULT_SETTINGS, enableAllCquDomains: true });
    const updateTab = mockUpdateTab().mockResolvedValue(undefined);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await startBackgroundWithDnrMocks();

    await expect(
      fakeBrowser.webNavigation.onBeforeNavigate.trigger(navigationDetails(url)),
    ).resolves.toEqual([undefined]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(updateTab).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });
});
