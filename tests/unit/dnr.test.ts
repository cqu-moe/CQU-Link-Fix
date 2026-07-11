import type { Browser } from 'wxt/browser';
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import background from '../../entrypoints/background';
import { BUILT_IN_RULES } from '../../src/rules/builtins';
import {
  compileDynamicRules,
  getRulePriority,
  reconcileDynamicRules,
} from '../../src/rules/dnr';
import { DEFAULT_SETTINGS, saveSettings } from '../../src/storage/settings';
import type { CustomRule, RuleDefinition } from '../../src/rules/types';

const MAIN_FRAME = ['main_frame'] as const;

type RegexSupport = (
  options: Browser.declarativeNetRequest.RegexOptions,
) => Promise<Browser.declarativeNetRequest.IsRegexSupportedResult>;
type GetDynamicRules = () => Promise<Browser.declarativeNetRequest.Rule[]>;
type UpdateDynamicRules = (
  options: Browser.declarativeNetRequest.UpdateRuleOptions,
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

function mockUpdateTab(): MockInstance<UpdateTab> {
  return vi.spyOn(browser.tabs, 'update') as unknown as MockInstance<UpdateTab>;
}

function mockStorageGet(): MockInstance<StorageGet> {
  return vi.spyOn(browser.storage.local, 'get') as unknown as MockInstance<StorageGet>;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
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
    expect(compiled).toHaveLength(2);
    expect(compileDynamicRules(BUILT_IN_RULES, [])).toEqual(
      compileDynamicRules(BUILT_IN_RULES, []),
    );
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

  it('builds only a queryless Youth request target without assuming DNR sees fragments', () => {
    const youth = compileDynamicRules(BUILT_IN_RULES, [])[1]!;
    const source = canonicalRequestUrl(
      'https://youth.cqu.edu.cn/info/1009/24264.htm#print',
    );

    expect(applyRegexRedirect(youth, source)).toBe(
      'https://youth.cqu.edu.cn/content.jsp?urltype=news.NewsContentUrl&wbtreeid=1009&wbnewsid=24264',
    );
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

describe('queried Youth navigation routing', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    fakeBrowser.webNavigation.onBeforeNavigate.removeAllListeners();
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
    await saveSettings({ ...DEFAULT_SETTINGS, customRules: [createYouthHostRule()] });
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
      disabledBuiltInRuleIds: ['addon-youth-public'],
    });
    const updateTab = mockUpdateTab().mockResolvedValue(undefined);
    await startBackgroundWithDnrMocks();

    await fakeBrowser.webNavigation.onBeforeNavigate.trigger(
      navigationDetails('https://youth.cqu.edu.cn/info/1009/24264.htm?state=x'),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(updateTab).not.toHaveBeenCalled();
  });

  it('restores queried Youth fallback when the custom host rule is disabled', async () => {
    const customRule = createYouthHostRule();
    await saveSettings({
      ...DEFAULT_SETTINGS,
      customRules: [customRule],
      disabledBuiltInRuleIds: [customRule.id],
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
    expect(storageGet).toHaveBeenCalledTimes(1);
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
    expect(storageGet).toHaveBeenCalledTimes(1);
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
      settings: { ...DEFAULT_SETTINGS, disabledBuiltInRuleIds: ['addon-youth-public'] },
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
        'Failed to rewrite queried Youth navigation',
        error,
      ),
    );
  });
});
