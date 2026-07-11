import type { Browser } from 'wxt/browser';
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import background from '../../entrypoints/background';
import {
  clearTabSession,
  excludeCurrentHost,
  getTabState,
  isOriginalBypass,
  openOriginalOnce,
  recordRewrite,
  type RewriteRecord,
} from '../../src/background/session';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  loadSettingsSnapshot,
  saveSettings,
  updateSettings,
} from '../../src/storage/settings';

type RegexSupport = (
  options: Browser.declarativeNetRequest.RegexOptions,
) => Promise<Browser.declarativeNetRequest.IsRegexSupportedResult>;
type GetRules = () => Promise<Browser.declarativeNetRequest.Rule[]>;
type UpdateRules = (
  options: Browser.declarativeNetRequest.UpdateRuleOptions,
) => Promise<void>;
type UpdateTab = (
  tabId: number | undefined,
  updateProperties: Browser.tabs.UpdateProperties,
) => Promise<Browser.tabs.Tab | undefined>;
type GetTab = (tabId: number) => Promise<Browser.tabs.Tab>;
type StorageGet = (
  keys?: string | string[] | Record<string, unknown> | null,
) => Promise<Record<string, unknown>>;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function mockRegexSupport(): MockInstance<RegexSupport> {
  return vi.spyOn(browser.declarativeNetRequest, 'isRegexSupported') as unknown as MockInstance<RegexSupport>;
}

function mockGetDynamicRules(): MockInstance<GetRules> {
  return vi.spyOn(browser.declarativeNetRequest, 'getDynamicRules') as unknown as MockInstance<GetRules>;
}

function mockGetSessionRules(): MockInstance<GetRules> {
  return vi.spyOn(browser.declarativeNetRequest, 'getSessionRules') as unknown as MockInstance<GetRules>;
}

function mockUpdateDynamicRules(): MockInstance<UpdateRules> {
  return vi.spyOn(browser.declarativeNetRequest, 'updateDynamicRules') as unknown as MockInstance<UpdateRules>;
}

function mockUpdateSessionRules(): MockInstance<UpdateRules> {
  return vi.spyOn(browser.declarativeNetRequest, 'updateSessionRules') as unknown as MockInstance<UpdateRules>;
}

function mockSessionRuleStore(initial: Browser.declarativeNetRequest.Rule[] = []) {
  let rules = structuredClone(initial);
  const getRules = mockGetSessionRules().mockImplementation(async () => structuredClone(rules));
  const updateRules = mockUpdateSessionRules().mockImplementation(async (options) => {
    const removed = new Set(options.removeRuleIds ?? []);
    rules = rules.filter((rule) => !removed.has(rule.id));
    rules.push(...structuredClone(options.addRules ?? []));
  });
  return {
    getRules,
    updateRules,
    current: () => structuredClone(rules),
    replace: (next: Browser.declarativeNetRequest.Rule[]) => {
      rules = structuredClone(next);
    },
  };
}

function mockUpdateTab(): MockInstance<UpdateTab> {
  return vi.spyOn(browser.tabs, 'update') as unknown as MockInstance<UpdateTab>;
}

function mockGetTab(): MockInstance<GetTab> {
  return vi.spyOn(browser.tabs, 'get') as unknown as MockInstance<GetTab>;
}

function mockLocalStorageGet(): MockInstance<StorageGet> {
  return vi.spyOn(browser.storage.local, 'get') as unknown as MockInstance<StorageGet>;
}

function rewriteRecord(overrides: Partial<RewriteRecord> = {}): RewriteRecord {
  return {
    tabId: 7,
    ruleId: 'core-sso',
    originalUrl: 'https://sso.cqu.edu.cn/login?service=https%3A%2F%2Fclient.example%2Fcb#form',
    targetUrl:
      'https://sso-cqu-edu-cn-s.atrust.cqu.edu.cn/login?service=https%3A%2F%2Fclient.example%2Fcb#form',
    recordedAt: 123,
    generation: 'test-generation',
    navigationSequence: 0,
    ...overrides,
  };
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

function committedDetails(
  url: string,
  overrides: Partial<Browser.webNavigation.WebNavigationTransitionCallbackDetails> = {},
): Browser.webNavigation.WebNavigationTransitionCallbackDetails {
  return {
    ...navigationDetails(url),
    transitionQualifiers: [],
    transitionType: 'typed',
    ...overrides,
  } as Browser.webNavigation.WebNavigationTransitionCallbackDetails;
}

function errorDetails(
  url: string,
  overrides: Partial<Browser.webNavigation.WebNavigationFramedErrorCallbackDetails> = {},
): Browser.webNavigation.WebNavigationFramedErrorCallbackDetails {
  return {
    ...navigationDetails(url),
    error: 'net::ERR_NAME_NOT_RESOLVED',
    ...overrides,
  } as Browser.webNavigation.WebNavigationFramedErrorCallbackDetails;
}

function tab(url?: string): Browser.tabs.Tab {
  return {
    id: 7,
    index: 0,
    pinned: false,
    highlighted: false,
    active: true,
    incognito: false,
    windowId: 1,
    frozen: false,
    selected: true,
    discarded: false,
    autoDiscardable: true,
    groupId: -1,
    ...(url === undefined ? {} : { url }),
  };
}

async function startBackground(): Promise<void> {
  mockRegexSupport().mockResolvedValue({ isSupported: true });
  mockGetDynamicRules().mockResolvedValue([]);
  const updateDynamicRules = mockUpdateDynamicRules().mockResolvedValue();
  background.main!();
  await vi.waitFor(() => expect(updateDynamicRules).toHaveBeenCalledTimes(1));
}

function resetBackgroundEvents(): void {
  fakeBrowser.webNavigation.onBeforeNavigate.removeAllListeners();
  fakeBrowser.webNavigation.onCommitted.removeAllListeners();
  fakeBrowser.webNavigation.onErrorOccurred.removeAllListeners();
}

describe('rewrite session state', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    resetBackgroundEvents();
  });

  it('round-trips a rewrite record without exposing nested mutable state', async () => {
    const record = rewriteRecord();
    await recordRewrite(record);
    record.ruleId = 'mutated-input';

    const first = await getTabState(7);
    expect(first).toEqual(rewriteRecord());
    first!.ruleId = 'mutated-output';
    expect(await getTabState(7)).toEqual(rewriteRecord());
  });

  it('installs one exact fragment-free top-frame allow rule before opening the full original URL', async () => {
    const record = rewriteRecord({
      originalUrl: 'HTTPS://SSO.CQU.EDU.CN:443/a/../login?x=1&x=2#form',
    });
    await recordRewrite(record);
    const sessionRules = mockSessionRuleStore();
    const updateRules = sessionRules.updateRules;
    const updateTab = mockUpdateTab().mockResolvedValue(undefined);

    await openOriginalOnce(7);

    expect(updateRules).toHaveBeenCalledTimes(1);
    const update = updateRules.mock.calls[0]![0];
    expect(update.removeRuleIds).toHaveLength(1);
    expect(update.addRules).toHaveLength(1);
    const rule = update.addRules![0]!;
    expect(rule.priority).toBeGreaterThan(100_000);
    expect(rule.action).toEqual({ type: 'allow' });
    expect(rule.condition.resourceTypes).toEqual(['main_frame']);
    expect(rule.condition.tabIds).toEqual([7]);
    expect(rule.condition.regexFilter).not.toContain('form');
    const matcher = new RegExp(rule.condition.regexFilter!);
    expect(matcher.test('https://sso.cqu.edu.cn/login?x=1&x=2')).toBe(true);
    expect(matcher.test('https://sso.cqu.edu.cn/login?x=2&x=1')).toBe(false);
    expect(matcher.test('https://sso.cqu.edu.cn/other?x=1&x=2')).toBe(false);
    expect(matcher.test('https://sso.cqu.edu.cn/login?x=1&x=2#form')).toBe(false);
    expect(updateTab).toHaveBeenCalledWith(7, { url: record.originalUrl });
    await expect(isOriginalBypass(7, record.originalUrl)).resolves.toBe(true);
    const stored = (await browser.storage.session.get('bypass:7'))['bypass:7'];
    expect(stored).toMatchObject({
      tabId: 7,
      recordGeneration: record.generation,
      nonce: expect.any(String),
      rule: {
        id: rule.id,
        priority: rule.priority,
        regexFilter: rule.condition.regexFilter,
        tabId: 7,
        actionType: 'allow',
        resourceType: 'main_frame',
        isUrlFilterCaseSensitive: true,
      },
    });
  });

  it('rejects an unsafe stored original and a session-rule ID collision without navigating', async () => {
    await browser.storage.session.set({
      'rewrite:7': rewriteRecord({ originalUrl: 'javascript:alert(1)' }),
    });
    const updateTab = mockUpdateTab().mockResolvedValue(undefined);
    await expect(openOriginalOnce(7)).rejects.toThrow(/HTTP\(S\)|rewrite/i);
    expect(updateTab).not.toHaveBeenCalled();

    await recordRewrite(rewriteRecord());
    mockSessionRuleStore([
      {
        id: 1_000_000_007,
        priority: 1,
        action: { type: 'block' },
        condition: { resourceTypes: ['main_frame'] },
      },
    ]);
    await expect(openOriginalOnce(7)).rejects.toThrow(/collision/i);
    expect(updateTab).not.toHaveBeenCalled();
  });

  it('clears both the record and explicit bypass even when no navigation listener is active', async () => {
    await recordRewrite(rewriteRecord());
    const sessionRules = mockSessionRuleStore();
    mockUpdateTab().mockResolvedValue(undefined);
    await openOriginalOnce(7);
    const ownedRuleId = sessionRules.current()[0]!.id;

    await clearTabSession(7);

    expect(sessionRules.updateRules).toHaveBeenLastCalledWith({ removeRuleIds: [ownedRuleId] });
    expect(await browser.storage.session.get(null)).toEqual({});
  });

  it('does not honor stale bypass storage after its correlated DNR rule disappears', async () => {
    await recordRewrite(rewriteRecord());
    const sessionRules = mockSessionRuleStore();
    mockUpdateTab().mockResolvedValue(undefined);
    await openOriginalOnce(7);
    sessionRules.replace([]);

    await expect(isOriginalBypass(7, rewriteRecord().originalUrl)).resolves.toBe(false);
  });

  it('retains owned bypass state and record when DNR removal fails, then clears on retry', async () => {
    const record = rewriteRecord();
    await recordRewrite(record);
    const sessionRules = mockSessionRuleStore();
    mockUpdateTab().mockResolvedValue(undefined);
    await openOriginalOnce(7);
    sessionRules.updateRules.mockRejectedValueOnce(new Error('DNR busy'));

    await expect(clearTabSession(7)).rejects.toThrow('DNR busy');
    expect(await getTabState(7)).toEqual(record);
    await expect(isOriginalBypass(7, record.originalUrl)).resolves.toBe(true);

    await clearTabSession(7);
    expect(await getTabState(7)).toBeNull();
    expect(sessionRules.current()).toEqual([]);
  });

  it('retains ownership when DNR reports success without removing the rule, then retries', async () => {
    const record = rewriteRecord();
    await recordRewrite(record);
    const sessionRules = mockSessionRuleStore();
    mockUpdateTab().mockResolvedValue(undefined);
    await openOriginalOnce(7);
    sessionRules.updateRules.mockImplementationOnce(async () => undefined);

    await expect(clearTabSession(7)).rejects.toThrow(/still installed/i);
    expect(await getTabState(7)).toEqual(record);
    await expect(isOriginalBypass(7, record.originalUrl)).resolves.toBe(true);

    await clearTabSession(7);
    expect(await getTabState(7)).toBeNull();
    expect(sessionRules.current()).toEqual([]);
  });

  it('never removes a colliding non-owned session rule during cleanup', async () => {
    await recordRewrite(rewriteRecord());
    const sessionRules = mockSessionRuleStore();
    mockUpdateTab().mockResolvedValue(undefined);
    await openOriginalOnce(7);
    const owned = sessionRules.current()[0]!;
    const collision: Browser.declarativeNetRequest.Rule = {
      ...owned,
      condition: {
        ...owned.condition,
        excludedTabIds: [8],
      },
    };
    sessionRules.replace([collision]);
    sessionRules.updateRules.mockClear();

    await clearTabSession(7);

    expect(sessionRules.updateRules).not.toHaveBeenCalled();
    expect(sessionRules.current()).toEqual([collision]);
    expect(await getTabState(7)).toBeNull();
  });

  it('does not delete a newer record when expected bypass ownership is already gone', async () => {
    const first = rewriteRecord({ generation: 'first' });
    await recordRewrite(first);
    const sessionRules = mockSessionRuleStore();
    mockUpdateTab().mockResolvedValue(undefined);
    await openOriginalOnce(7);
    const ownership = (await browser.storage.session.get('bypass:7'))['bypass:7'] as {
      nonce: string;
    };
    await browser.storage.session.remove('bypass:7');
    const second = rewriteRecord({ generation: 'second', recordedAt: 456 });
    await recordRewrite(second);

    await clearTabSession(7, ownership.nonce);

    expect(await getTabState(7)).toEqual(second);
    expect(sessionRules.current()).toHaveLength(1);
  });

  it.each(['derived ID', 'derived regex'] as const)(
    'rejects stored bypass ownership with a mismatched %s even when an installed rule matches it',
    async (kind) => {
      const record = rewriteRecord();
      await recordRewrite(record);
      const sessionRules = mockSessionRuleStore();
      mockUpdateTab().mockResolvedValue(undefined);
      await openOriginalOnce(7);
      const stored = (await browser.storage.session.get('bypass:7'))['bypass:7'] as {
        rule: { id: number; regexFilter: string };
      };
      const [installed] = sessionRules.current();
      if (kind === 'derived ID') {
        stored.rule.id += 1;
        installed!.id += 1;
      } else {
        stored.rule.regexFilter = '^https://different.cqu.edu.cn/$';
        installed!.condition.regexFilter = stored.rule.regexFilter;
      }
      await browser.storage.session.set({ 'bypass:7': stored });
      sessionRules.replace([installed!]);

      await expect(isOriginalBypass(7, record.originalUrl)).resolves.toBe(false);
    },
  );

  it('rejects rewrite records whose tab cannot map into the bypass DNR range', async () => {
    await expect(
      recordRewrite(rewriteRecord({ tabId: 1_147_483_648 })),
    ).rejects.toThrow(/tab|record/i);
  });
});

describe('background rewrite recording and bypass', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    resetBackgroundEvents();
  });

  it('records the winning registered DNR rewrite without issuing a competing tab update', async () => {
    await saveSettings(DEFAULT_SETTINGS);
    const updateTab = mockUpdateTab().mockResolvedValue(undefined);
    await startBackground();
    const original = rewriteRecord().originalUrl;

    await fakeBrowser.webNavigation.onBeforeNavigate.trigger(navigationDetails(original));

    await vi.waitFor(() => expect(getTabState(7)).resolves.toMatchObject({
      ruleId: 'core-sso',
      originalUrl: original,
      targetUrl: rewriteRecord().targetUrl,
    }));
    expect(updateTab).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'queried Youth',
      settings: DEFAULT_SETTINGS,
      record: rewriteRecord({
        ruleId: 'addon-youth-public',
        originalUrl: 'https://youth.cqu.edu.cn/info/1009/24264.htm?state=x#part',
        targetUrl:
          'https://youth.cqu.edu.cn/content.jsp?state=x&urltype=news.NewsContentUrl&wbtreeid=1009&wbnewsid=24264#part',
      }),
    },
    {
      label: 'all-CQU',
      settings: { ...DEFAULT_SETTINGS, enableAllCquDomains: true },
      record: rewriteRecord({
        ruleId: 'all-cqu-domains',
        originalUrl: 'https://library.cqu.edu.cn/a?q=1#part',
        targetUrl: 'https://library-cqu-edu-cn-s.atrust.cqu.edu.cn/a?q=1#part',
      }),
    },
  ])('uses explicit per-tab bypass state for a background-driven $label rewrite', async ({ settings, record }) => {
    await saveSettings(settings);
    await recordRewrite(record);
    mockSessionRuleStore();
    const updateTab = mockUpdateTab().mockResolvedValue(undefined);
    await startBackground();
    await openOriginalOnce(7);
    updateTab.mockClear();

    await fakeBrowser.webNavigation.onBeforeNavigate.trigger(
      navigationDetails(record.originalUrl),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(updateTab).not.toHaveBeenCalled();
    expect(await getTabState(7)).toEqual(record);
    await expect(isOriginalBypass(7, record.originalUrl)).resolves.toBe(true);
  });

  it('records queried-Youth and all-CQU rewrites before their single tab update', async () => {
    const cases = [
      {
        settings: DEFAULT_SETTINGS,
        original: 'https://youth.cqu.edu.cn/info/1009/24264.htm?state=x#part',
        ruleId: 'addon-youth-public',
      },
      {
        settings: { ...DEFAULT_SETTINGS, enableAllCquDomains: true },
        original: 'https://library.cqu.edu.cn/a?q=1#part',
        ruleId: 'all-cqu-domains',
      },
    ];

    for (const testCase of cases) {
      fakeBrowser.reset();
      resetBackgroundEvents();
      await saveSettings(testCase.settings);
      const order: string[] = [];
      vi.spyOn(browser.storage.session, 'set').mockImplementation(async (items) => {
        if ('rewrite:7' in items) order.push('record');
      });
      mockUpdateTab().mockImplementation(async () => {
        order.push('navigate');
        return undefined;
      });
      await startBackground();

      await fakeBrowser.webNavigation.onBeforeNavigate.trigger(
        navigationDetails(testCase.original),
      );
      await vi.waitFor(() => expect(order).toEqual(['record', 'navigate']));
    }
  });

  it('does not persist a stale rewrite after a newer unrelated top-frame navigation', async () => {
    await saveSettings(DEFAULT_SETTINGS);
    await recordRewrite(rewriteRecord({ ruleId: 'previous-record' }));
    const updateTab = mockUpdateTab().mockResolvedValue(undefined);
    await startBackground();
    const pendingSettings = deferred<Record<string, unknown>>();
    mockLocalStorageGet().mockReturnValueOnce(pendingSettings.promise);

    await fakeBrowser.webNavigation.onBeforeNavigate.trigger(
      navigationDetails('https://youth.cqu.edu.cn/info/1009/24264.htm?state=old'),
    );
    await fakeBrowser.webNavigation.onBeforeNavigate.trigger(
      navigationDetails('https://example.com/newer'),
    );
    pendingSettings.resolve({ settings: DEFAULT_SETTINGS });
    await pendingSettings.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(updateTab).not.toHaveBeenCalled();
    expect(await getTabState(7)).toMatchObject({ ruleId: 'previous-record' });
  });

  it('ignores a top-frame navigation whose tab cannot map into the bypass DNR range', async () => {
    await saveSettings(DEFAULT_SETTINGS);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const sessionGet = vi.spyOn(browser.storage.session, 'get');
    await startBackground();
    sessionGet.mockClear();

    await fakeBrowser.webNavigation.onBeforeNavigate.trigger(
      navigationDetails('https://sso.cqu.edu.cn/login', { tabId: 1_147_483_648 }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sessionGet).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('continues a background rewrite when clearing its stale badge fails', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, enableAllCquDomains: true });
    const updateTab = mockUpdateTab().mockResolvedValue(undefined);
    vi.spyOn(browser.action, 'setBadgeText').mockRejectedValue(new Error('badge unavailable'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await startBackground();

    await fakeBrowser.webNavigation.onBeforeNavigate.trigger(
      navigationDetails('https://library.cqu.edu.cn/path', { timeStamp: 30 }),
    );

    await vi.waitFor(() => expect(updateTab).toHaveBeenCalledWith(7, {
      url: 'https://library-cqu-edu-cn-s.atrust.cqu.edu.cn/path',
    }));
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to clear stale rewrite badge',
      expect.any(Error),
    );
  });
});

describe('background session lifecycle, errors, and messages', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    resetBackgroundEvents();
  });

  it('clears only when the original top-frame bypass commits, tolerating fragment omission and URL canonicalization', async () => {
    const record = rewriteRecord({
      originalUrl: 'HTTPS://SSO.CQU.EDU.CN:443/a/../login?x=1#form',
    });
    await recordRewrite(record);
    const sessionRules = mockSessionRuleStore();
    mockUpdateTab().mockResolvedValue(undefined);
    await startBackground();
    await openOriginalOnce(7);

    await fakeBrowser.webNavigation.onCommitted.trigger(
      committedDetails('https://sso.cqu.edu.cn/login?x=1'),
    );

    await vi.waitFor(() => expect(getTabState(7)).resolves.toBeNull());
    expect(sessionRules.current()).toEqual([]);
    await expect(isOriginalBypass(7, record.originalUrl)).resolves.toBe(false);
  });

  it('keeps the record after target or unrelated commits and ignores subframe commits', async () => {
    const record = rewriteRecord();
    await recordRewrite(record);
    await startBackground();

    await fakeBrowser.webNavigation.onCommitted.trigger(
      committedDetails(record.targetUrl.replace('#form', '')),
    );
    await fakeBrowser.webNavigation.onCommitted.trigger(
      committedDetails('https://example.com/unrelated'),
    );
    await fakeBrowser.webNavigation.onCommitted.trigger(
      committedDetails(record.originalUrl.replace('#form', ''), { frameId: 2 }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(await getTabState(7)).toEqual(record);
  });

  it('clears record and bypass on tab removal through the single consolidated listener', async () => {
    await recordRewrite(rewriteRecord());
    const sessionRules = mockSessionRuleStore();
    mockUpdateTab().mockResolvedValue(undefined);
    await openOriginalOnce(7);
    const addListener = vi.spyOn(browser.tabs.onRemoved, 'addListener');
    await startBackground();

    expect(addListener).toHaveBeenCalledTimes(1);
    await fakeBrowser.tabs.onRemoved.trigger(7, { isWindowClosing: false, windowId: 1 });

    await vi.waitFor(() => expect(getTabState(7)).resolves.toBeNull());
    expect(sessionRules.current()).toEqual([]);
  });

  it('leaves a colliding non-owned rule intact when the tab is removed', async () => {
    await recordRewrite(rewriteRecord());
    const sessionRules = mockSessionRuleStore();
    mockUpdateTab().mockResolvedValue(undefined);
    await openOriginalOnce(7);
    const collision: Browser.declarativeNetRequest.Rule = {
      id: sessionRules.current()[0]!.id,
      priority: 9,
      action: { type: 'block' },
      condition: { resourceTypes: ['main_frame'], tabIds: [7] },
    };
    sessionRules.replace([collision]);
    await startBackground();

    await fakeBrowser.tabs.onRemoved.trigger(7, { isWindowClosing: false, windowId: 1 });

    await vi.waitFor(() => expect(getTabState(7)).resolves.toBeNull());
    expect(sessionRules.current()).toEqual([collision]);
  });

  it('records a matching target error and warning badge while ignoring unrelated errors', async () => {
    const record = rewriteRecord();
    await recordRewrite(record);
    const badgeColor = vi.spyOn(browser.action, 'setBadgeBackgroundColor');
    const badgeText = vi.spyOn(browser.action, 'setBadgeText');
    await startBackground();

    await fakeBrowser.webNavigation.onErrorOccurred.trigger(
      errorDetails('https://example.com/unrelated'),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await getTabState(7)).toEqual(record);
    expect(badgeColor).not.toHaveBeenCalled();

    await fakeBrowser.webNavigation.onErrorOccurred.trigger(
      errorDetails(record.targetUrl.replace('#form', '')),
    );
    await vi.waitFor(() => expect(getTabState(7)).resolves.toMatchObject({
      error: 'net::ERR_NAME_NOT_RESOLVED',
    }));
    expect(badgeColor).toHaveBeenCalledWith({ tabId: 7, color: '#b42318' });
    expect(badgeText).toHaveBeenCalledWith({ tabId: 7, text: '!' });
  });

  it('serializes an old target error before a newer rewrite so the newer record and clear badge win', async () => {
    const old = rewriteRecord();
    await recordRewrite(old);
    await saveSettings({ ...DEFAULT_SETTINGS, enableAllCquDomains: true });
    const originalGet = browser.storage.session.get.bind(browser.storage.session) as StorageGet;
    const pendingOldRead = deferred<Record<string, unknown>>();
    const sessionGet = vi.spyOn(browser.storage.session, 'get') as unknown as MockInstance<StorageGet>;
    mockUpdateTab().mockResolvedValue(undefined);
    await startBackground();
    sessionGet.mockReturnValueOnce(pendingOldRead.promise).mockImplementation(originalGet);

    await fakeBrowser.webNavigation.onErrorOccurred.trigger(
      errorDetails(old.targetUrl, { timeStamp: 10 }),
    );
    await fakeBrowser.webNavigation.onBeforeNavigate.trigger(
      navigationDetails('https://library.cqu.edu.cn/new', { timeStamp: 20 }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    pendingOldRead.resolve({ 'rewrite:7': old });

    await vi.waitFor(() => expect(getTabState(7)).resolves.toMatchObject({
      ruleId: 'all-cqu-domains',
      originalUrl: 'https://library.cqu.edu.cn/new',
    }));
    expect((await getTabState(7))?.error).toBeUndefined();
    await vi.waitFor(() => expect(browser.action.getBadgeText({ tabId: 7 })).resolves.toBe(''));
  });

  it('serializes a newer rewrite before an overlapping old error and clears the stale badge', async () => {
    const old = rewriteRecord();
    await recordRewrite(old);
    await saveSettings({ ...DEFAULT_SETTINGS, enableAllCquDomains: true });
    const originalSet = browser.storage.session.set.bind(browser.storage.session) as (
      items: Record<string, unknown>,
    ) => Promise<void>;
    const pendingRewrite = deferred<void>();
    const sessionSet = vi.spyOn(browser.storage.session, 'set');
    mockUpdateTab().mockResolvedValue(undefined);
    await startBackground();
    sessionSet.mockImplementationOnce(async (items) => {
      await pendingRewrite.promise;
      await originalSet(items);
    }).mockImplementation(originalSet);

    await fakeBrowser.webNavigation.onBeforeNavigate.trigger(
      navigationDetails('https://library.cqu.edu.cn/newer', { timeStamp: 20 }),
    );
    await vi.waitFor(() => expect(sessionSet).toHaveBeenCalled());
    await fakeBrowser.webNavigation.onErrorOccurred.trigger(
      errorDetails(old.targetUrl, { timeStamp: 10 }),
    );
    pendingRewrite.resolve();

    await vi.waitFor(() => expect(getTabState(7)).resolves.toMatchObject({
      ruleId: 'all-cqu-domains',
      originalUrl: 'https://library.cqu.edu.cn/newer',
    }));
    expect((await getTabState(7))?.error).toBeUndefined();
    await vi.waitFor(() => expect(browser.action.getBadgeText({ tabId: 7 })).resolves.toBe(''));
  });

  it('does not re-add an old target error badge after a newer unrelated commit', async () => {
    const record = rewriteRecord();
    await recordRewrite(record);
    await startBackground();

    await fakeBrowser.webNavigation.onCommitted.trigger(
      committedDetails('https://example.com/newer', { timeStamp: 20 }),
    );
    await fakeBrowser.webNavigation.onErrorOccurred.trigger(
      errorDetails(record.targetUrl, { timeStamp: 10 }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(await getTabState(7)).toEqual(record);
    expect(await browser.action.getBadgeText({ tabId: 7 })).toBe('');
  });

  it('consumes an active original bypass on top-frame navigation error', async () => {
    const record = rewriteRecord();
    await recordRewrite(record);
    const sessionRules = mockSessionRuleStore();
    mockUpdateTab().mockResolvedValue(undefined);
    await startBackground();
    await openOriginalOnce(7);

    await fakeBrowser.webNavigation.onErrorOccurred.trigger(
      errorDetails(record.originalUrl.replace('#form', ''), { timeStamp: 20 }),
    );

    await vi.waitFor(() => expect(getTabState(7)).resolves.toBeNull());
    expect(sessionRules.current()).toEqual([]);
  });

  it('binds delayed original cleanup to its nonce so it cannot delete a newer bypass', async () => {
    const first = rewriteRecord({ generation: 'first' });
    await recordRewrite(first);
    const sessionRules = mockSessionRuleStore();
    mockUpdateTab().mockResolvedValue(undefined);
    await startBackground();
    await openOriginalOnce(7);
    const firstRules = sessionRules.current();
    const delayedRules = deferred<Browser.declarativeNetRequest.Rule[]>();
    sessionRules.getRules.mockReturnValueOnce(delayedRules.promise);

    await fakeBrowser.webNavigation.onCommitted.trigger(
      committedDetails(first.originalUrl, { timeStamp: 10 }),
    );
    await vi.waitFor(() => expect(sessionRules.getRules).toHaveBeenCalledTimes(2));
    const second = rewriteRecord({ generation: 'second', recordedAt: 456 });
    await recordRewrite(second);
    await openOriginalOnce(7);
    delayedRules.resolve(firstRules);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await getTabState(7)).toEqual(second);
    await expect(isOriginalBypass(7, second.originalUrl)).resolves.toBe(true);
    expect(sessionRules.current()).toHaveLength(1);
  });

  it('removes delayed committed bypass A but preserves newer record generation B', async () => {
    const first = rewriteRecord({ generation: 'commit-a' });
    await recordRewrite(first);
    const sessionRules = mockSessionRuleStore();
    mockUpdateTab().mockResolvedValue(undefined);
    await startBackground();
    await openOriginalOnce(7);
    const firstRules = sessionRules.current();
    const delayedCleanupRules = deferred<Browser.declarativeNetRequest.Rule[]>();
    sessionRules.getRules
      .mockImplementationOnce(async () => structuredClone(firstRules))
      .mockReturnValueOnce(delayedCleanupRules.promise);

    await fakeBrowser.webNavigation.onCommitted.trigger(
      committedDetails(first.originalUrl, { timeStamp: 30 }),
    );
    await vi.waitFor(() => expect(sessionRules.getRules).toHaveBeenCalledTimes(3));
    const second = rewriteRecord({ generation: 'commit-b', recordedAt: 789 });
    await recordRewrite(second);
    delayedCleanupRules.resolve(firstRules);

    await vi.waitFor(() => expect(sessionRules.current()).toEqual([]));
    expect((await browser.storage.session.get('bypass:7'))['bypass:7']).toBeUndefined();
    expect(await getTabState(7)).toEqual(second);
  });

  it('removes delayed original-error bypass A but preserves newer record generation B', async () => {
    const first = rewriteRecord({ generation: 'error-a' });
    await recordRewrite(first);
    const sessionRules = mockSessionRuleStore();
    mockUpdateTab().mockResolvedValue(undefined);
    await startBackground();
    await openOriginalOnce(7);
    const firstRules = sessionRules.current();
    const delayedCleanupRules = deferred<Browser.declarativeNetRequest.Rule[]>();
    sessionRules.getRules
      .mockImplementationOnce(async () => structuredClone(firstRules))
      .mockReturnValueOnce(delayedCleanupRules.promise);

    await fakeBrowser.webNavigation.onErrorOccurred.trigger(
      errorDetails(first.originalUrl, { timeStamp: 30 }),
    );
    await vi.waitFor(() => expect(sessionRules.getRules).toHaveBeenCalledTimes(3));
    const second = rewriteRecord({ generation: 'error-b', recordedAt: 790 });
    await recordRewrite(second);
    delayedCleanupRules.resolve(firstRules);

    await vi.waitFor(() => expect(sessionRules.current()).toEqual([]));
    expect((await browser.storage.session.get('bypass:7'))['bypass:7']).toBeUndefined();
    expect(await getTabState(7)).toEqual(second);
  });

  it('uses local event sequence so equal browser timestamps cannot restore an old badge', async () => {
    const record = rewriteRecord({ navigationSequence: 0 });
    await recordRewrite(record);
    await startBackground();

    await fakeBrowser.webNavigation.onCommitted.trigger(
      committedDetails('https://example.com/newer', { timeStamp: 50 }),
    );
    await fakeBrowser.webNavigation.onErrorOccurred.trigger(
      errorDetails(record.targetUrl, { timeStamp: 50 }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((await getTabState(7))?.error).toBeUndefined();
    expect(await browser.action.getBadgeText({ tabId: 7 })).toBe('');
  });

  it('suppresses an old error from a persisted committed waterline after restart', async () => {
    const record = rewriteRecord({ navigationSequence: 40 });
    await recordRewrite(record);
    await browser.storage.session.set({
      'navigation:sequence': 41,
      'navigation:committed:7': 41,
    });
    await startBackground();

    await fakeBrowser.webNavigation.onErrorOccurred.trigger(errorDetails(record.targetUrl));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((await getTabState(7))?.error).toBeUndefined();
    expect(await browser.action.getBadgeText({ tabId: 7 })).toBe('');
  });

  it('allocates rewrite ordering from the persisted global counter after restart', async () => {
    await browser.storage.session.set({ 'navigation:sequence': 90 });
    await saveSettings({ ...DEFAULT_SETTINGS, enableAllCquDomains: true });
    mockUpdateTab().mockResolvedValue(undefined);
    await startBackground();

    await fakeBrowser.webNavigation.onBeforeNavigate.trigger(
      navigationDetails('https://library.cqu.edu.cn/restarted'),
    );

    await vi.waitFor(() => expect(getTabState(7)).resolves.toMatchObject({ navigationSequence: 91 }));
  });

  it('removes only the per-tab committed waterline when a tab closes', async () => {
    await browser.storage.session.set({
      'navigation:sequence': 12,
      'navigation:committed:7': 12,
    });
    await startBackground();
    await fakeBrowser.tabs.onRemoved.trigger(7, { isWindowClosing: false, windowId: 1 });

    await vi.waitFor(async () => {
      const state = await browser.storage.session.get([
        'navigation:sequence', 'navigation:committed:7',
      ]);
      expect(state).toEqual({ 'navigation:sequence': 12 });
    });
  });

  it('contains synchronous lifecycle badge throws instead of rejecting the listener', async () => {
    await recordRewrite(rewriteRecord());
    vi.spyOn(browser.action, 'setBadgeText').mockImplementation(() => {
      throw new Error('badge unavailable');
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await startBackground();

    await expect(
      fakeBrowser.webNavigation.onCommitted.trigger(committedDetails('https://example.com/')),
    ).resolves.toEqual([undefined]);
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalled());
  });

  it('returns typed responses for trusted messages and ignores malformed or untrusted senders', async () => {
    const sessionSet = vi.spyOn(browser.storage.session, 'set');
    const tabGet = mockGetTab();
    const tabUpdate = mockUpdateTab();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await startBackground();
    const invalid = [
      null,
      'open-original-once',
      {},
      { type: 'open-original-once' },
      { type: 'open-original-once', tabId: -1 },
      { type: 'exclude-current-host', tabId: 1.5 },
      { type: 'get-tab-state', tabId: '7' },
      { type: 'get-tab-state', tabId: Number.MAX_SAFE_INTEGER },
      { type: 'unknown', tabId: 7 },
    ];
    const trustedPopup = { id: browser.runtime.id };

    for (const message of invalid) {
      await expect(fakeBrowser.runtime.onMessage.trigger(message, trustedPopup)).resolves.toEqual([undefined]);
    }
    await expect(
      fakeBrowser.runtime.onMessage.trigger({ type: 'get-tab-state', tabId: 7 }, { id: 'other' }),
    ).resolves.toEqual([undefined]);
    await expect(
      fakeBrowser.runtime.onMessage.trigger(
        { type: 'get-tab-state', tabId: 7 },
        { id: browser.runtime.id, tab: { ...tab(), id: 8 } } as never,
      ),
    ).resolves.toEqual([undefined]);
    expect(sessionSet).not.toHaveBeenCalled();
    expect(tabGet).not.toHaveBeenCalled();
    expect(tabUpdate).not.toHaveBeenCalled();

    await recordRewrite(rewriteRecord());
    await expect(
      fakeBrowser.runtime.onMessage.trigger(
        { type: 'get-tab-state', tabId: 7 },
        trustedPopup,
      ),
    ).resolves.toEqual([{ ok: true, state: rewriteRecord() }]);
    await expect(
      fakeBrowser.runtime.onMessage.trigger(
        { type: 'get-tab-state', tabId: 7 },
        { id: browser.runtime.id, tab: tab() } as never,
      ),
    ).resolves.toEqual([{ ok: true, state: rewriteRecord() }]);
    await browser.storage.session.remove('rewrite:7');
    await expect(
      fakeBrowser.runtime.onMessage.trigger(
        { type: 'open-original-once', tabId: 7 },
        trustedPopup,
      ),
    ).resolves.toEqual([{
      ok: false, code: 'operation-failed', error: expect.any(String),
    }]);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it.each([
    { ...DEFAULT_SETTINGS, enabled: 'yes' },
    { ...DEFAULT_SETTINGS, excludedHosts: ['bad host'] },
    {
      ...DEFAULT_SETTINGS,
      customRules: [{
        id: 'bad-rule',
        dnrId: -1,
        name: 'Bad',
        description: 'Bad rule',
        category: 'custom',
        defaultEnabled: true,
        matcher: { kind: 'host-port', host: '1.1.1.1', port: 70_000 },
        transformer: 'atrust-ip-port',
      }],
    },
  ])('ignores malformed replacement settings before dispatch without writing: %#', async (settings) => {
    await saveSettings(DEFAULT_SETTINGS);
    await startBackground();
    const storageSet = vi.spyOn(browser.storage.local, 'set');

    await expect(
      fakeBrowser.runtime.onMessage.trigger(
        { type: 'replace-settings', settings, expectedRevision: 1 },
        { id: browser.runtime.id },
      ),
    ).resolves.toEqual([undefined]);

    expect(storageSet).not.toHaveBeenCalled();
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it.each([
    {
      label: 'custom DNR ID below range',
      customRules: [{
        id: 'below-range', dnrId: 10_000, name: 'Below', description: 'Below range',
        category: 'custom', defaultEnabled: true,
        matcher: { kind: 'host', host: 'below.cqu.edu.cn' }, transformer: 'atrust-domain',
      }],
      excludedHosts: [],
    },
    {
      label: 'custom DNR ID colliding with exclusion range',
      customRules: [{
        id: 'exclusion-collision', dnrId: 80_000, name: 'Collision', description: 'Collision',
        category: 'custom', defaultEnabled: true,
        matcher: { kind: 'host', host: 'collision.cqu.edu.cn' }, transformer: 'atrust-domain',
      }],
      excludedHosts: ['excluded.cqu.edu.cn'],
    },
    {
      label: 'built-in source host duplicate',
      customRules: [{
        id: 'built-in-host', dnrId: 10_001, name: 'Duplicate', description: 'Duplicate',
        category: 'custom', defaultEnabled: true,
        matcher: { kind: 'host', host: 'SSO.CQU.EDU.CN' }, transformer: 'atrust-domain',
      }],
      excludedHosts: [],
    },
    {
      label: 'canonical custom source host duplicate',
      customRules: [
        {
          id: 'first-host', dnrId: 10_001, name: 'First', description: 'First',
          category: 'custom', defaultEnabled: true,
          matcher: { kind: 'host', host: 'same.cqu.edu.cn' }, transformer: 'atrust-domain',
        },
        {
          id: 'second-host', dnrId: 10_002, name: 'Second', description: 'Second',
          category: 'custom', defaultEnabled: true,
          matcher: { kind: 'host', host: ' SAME.CQU.EDU.CN ' }, transformer: 'atrust-domain',
        },
      ],
      excludedHosts: [],
    },
  ])('rejects semantic replacement collision before background dispatch: $label', async ({
    customRules,
    excludedHosts,
  }) => {
    await saveSettings(DEFAULT_SETTINGS);
    await startBackground();
    const storageSet = vi.spyOn(browser.storage.local, 'set');

    await expect(fakeBrowser.runtime.onMessage.trigger({
      type: 'replace-settings',
      settings: {
        enabled: true,
        disabledBuiltInRuleIds: [],
        customRules,
        excludedHosts,
      },
      expectedRevision: 1,
    }, { id: browser.runtime.id })).resolves.toEqual([undefined]);

    expect(storageSet).not.toHaveBeenCalled();
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it.each([
    {
      type: 'acquire-custom-permission-lease',
      origins: ['*://*.cqu.edu.cn/*', 'https://x-s.atrust.cqu.edu.cn/*'],
    },
    {
      type: 'acquire-custom-permission-lease',
      origins: ['*://1.1.1.1/*', 'https://1-1-1-1-s.atrust.cqu.edu.cn/*'],
    },
    {
      type: 'acquire-custom-permission-lease',
      origins: ['*://library.cqu.edu.cn/*', 'https://wrong-s.atrust.cqu.edu.cn/*'],
    },
    {
      type: 'renew-custom-permission-lease',
      nonce: '00000000-0000-4000-8000-000000000001',
      origins: ['*://library.cqu.edu.cn/*', 'https://wrong-s.atrust.cqu.edu.cn/*'],
    },
    {
      type: 'renew-custom-permission-lease',
      nonce: 'forged',
      origins: [
        '*://library.cqu.edu.cn/*',
        'https://library-cqu-edu-cn-s.atrust.cqu.edu.cn/*',
      ],
    },
    { type: 'release-custom-permission-lease', nonce: 'forged' },
  ])('rejects malformed custom permission lease message before dispatch: %#', async (message) => {
    await startBackground();

    await expect(fakeBrowser.runtime.onMessage.trigger(
      message,
      { id: browser.runtime.id },
    )).resolves.toEqual([undefined]);
  });

  it('accepts trusted lease messages and rejects acquire and renew from a tab sender', async () => {
    await startBackground();
    const acquire = {
      type: 'acquire-custom-permission-lease',
      origins: [
        '*://library.cqu.edu.cn/*',
        'https://library-cqu-edu-cn-s.atrust.cqu.edu.cn/*',
      ],
    };

    await expect(fakeBrowser.runtime.onMessage.trigger(
      acquire,
      { id: browser.runtime.id, tab: tab() } as never,
    )).resolves.toEqual([undefined]);
    const acquired = (await fakeBrowser.runtime.onMessage.trigger(
      acquire,
      { id: browser.runtime.id },
    ))[0] as unknown as { ok: true; leaseNonce: string };
    expect(acquired).toEqual({ ok: true, leaseNonce: expect.stringMatching(/^[0-9a-f-]{36}$/) });

    const renew = {
      type: 'renew-custom-permission-lease',
      nonce: acquired.leaseNonce,
      origins: acquire.origins,
    };
    await expect(fakeBrowser.runtime.onMessage.trigger(
      renew,
      { id: browser.runtime.id, tab: tab() } as never,
    )).resolves.toEqual([undefined]);
    await expect(fakeBrowser.runtime.onMessage.trigger(
      renew,
      { id: browser.runtime.id },
    )).resolves.toEqual([{
      ok: true,
      leaseExpiresAt: expect.any(Number),
    }]);

    await expect(fakeBrowser.runtime.onMessage.trigger({
      type: 'release-custom-permission-lease',
      nonce: acquired.leaseNonce,
    }, { id: browser.runtime.id })).resolves.toEqual([{
      ok: true,
      requiredOrigins: [],
    }]);
  });

  it('serializes an independent UI replacement with background exclusion and mode persistence', async () => {
    await saveSettings(DEFAULT_SETTINGS);
    const expectedRevision = (await loadSettingsSnapshot()).revision;
    await startBackground();
    mockGetTab().mockResolvedValue(tab('https://second.cqu.edu.cn/path'));
    const originalSet = browser.storage.local.set.bind(browser.storage.local) as (
      items: Record<string, unknown>,
    ) => Promise<void>;
    const releaseReplacement = deferred<void>();
    const storageSet = vi.spyOn(browser.storage.local, 'set');
    storageSet.mockImplementationOnce(async (items) => {
      await releaseReplacement.promise;
      await originalSet(items);
    }).mockImplementation(originalSet);
    const customRule = {
      id: 'ui-custom',
      dnrId: 10_001,
      name: 'UI custom',
      description: 'Written from the options client',
      category: 'custom' as const,
      defaultEnabled: true,
      matcher: { kind: 'host' as const, host: 'other.cqu.edu.cn' },
      transformer: 'atrust-domain' as const,
    };
    const replacement = {
      enabled: DEFAULT_SETTINGS.enabled,
      disabledBuiltInRuleIds: DEFAULT_SETTINGS.disabledBuiltInRuleIds,
      customRules: [customRule],
      excludedHosts: ['first.cqu.edu.cn'],
    };
    const sender = { id: browser.runtime.id };

    const replacing = fakeBrowser.runtime.onMessage.trigger(
      { type: 'replace-settings', settings: replacement, expectedRevision },
      sender,
    );
    await vi.waitFor(() => expect(storageSet).toHaveBeenCalledTimes(1));
    const excluding = fakeBrowser.runtime.onMessage.trigger(
      { type: 'exclude-current-host', tabId: 7 },
      sender,
    );
    await vi.waitFor(() => expect(browser.tabs.get).toHaveBeenCalledWith(7));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const settingMode = fakeBrowser.runtime.onMessage.trigger(
      { type: 'persist-all-cqu-mode', enabled: true },
      sender,
    );
    releaseReplacement.resolve();

    await expect(replacing).resolves.toEqual([{ ok: true, revision: expectedRevision + 1 }]);
    await expect(excluding).resolves.toEqual([{ ok: true }]);
    await expect(settingMode).resolves.toEqual([{ ok: true, revision: expectedRevision + 3 }]);
    expect(await loadSettings()).toEqual({
      ...replacement,
      enableAllCquDomains: true,
      excludedHosts: ['first.cqu.edu.cn', 'second.cqu.edu.cn'],
    });
  });

  it('uses settings CAS so two clients cannot silently overwrite each other', async () => {
    await saveSettings(DEFAULT_SETTINGS);
    await startBackground();
    const sender = { id: browser.runtime.id };
    const snapshot = (await fakeBrowser.runtime.onMessage.trigger(
      { type: 'get-settings-snapshot' }, sender,
    ))[0] as unknown as { ok: true; snapshot: { revision: number } };
    const editable = {
      enabled: false,
      disabledBuiltInRuleIds: [],
      customRules: [],
      excludedHosts: ['first.cqu.edu.cn'],
    };
    await expect(fakeBrowser.runtime.onMessage.trigger(
      { type: 'replace-settings', settings: editable, expectedRevision: snapshot.snapshot.revision }, sender,
    )).resolves.toEqual([{ ok: true, revision: snapshot.snapshot.revision + 1 }]);
    await expect(fakeBrowser.runtime.onMessage.trigger(
      { type: 'replace-settings', settings: { ...editable, enabled: true }, expectedRevision: snapshot.snapshot.revision }, sender,
    )).resolves.toEqual([{
      ok: false, code: 'settings-conflict', error: expect.any(String),
    }]);
    expect(await loadSettings()).toMatchObject({ enabled: false, excludedHosts: ['first.cqu.edu.cn'] });
  });

  it('rejects a stale UI replacement after a later background mode write', async () => {
    await saveSettings(DEFAULT_SETTINGS);
    const expectedRevision = (await loadSettingsSnapshot()).revision;
    await startBackground();
    const sender = { id: browser.runtime.id };

    await expect(fakeBrowser.runtime.onMessage.trigger(
      { type: 'persist-all-cqu-mode', enabled: true }, sender,
    )).resolves.toEqual([{ ok: true, revision: expectedRevision + 1 }]);
    await expect(fakeBrowser.runtime.onMessage.trigger({
      type: 'replace-settings',
      expectedRevision,
      settings: {
        enabled: false, disabledBuiltInRuleIds: [], customRules: [], excludedHosts: [],
      },
    }, sender)).resolves.toEqual([{
      ok: false, code: 'settings-conflict', error: expect.any(String),
    }]);

    expect(await loadSettingsSnapshot()).toEqual({
      revision: expectedRevision + 1,
      settings: { ...DEFAULT_SETTINGS, enableAllCquDomains: true },
    });
  });

  it('ignores settings writes from an untrusted sender', async () => {
    await saveSettings(DEFAULT_SETTINGS);
    await startBackground();
    const storageSet = vi.spyOn(browser.storage.local, 'set');

    await expect(
      fakeBrowser.runtime.onMessage.trigger(
        { type: 'replace-settings', settings: {
          enabled: false, disabledBuiltInRuleIds: [], customRules: [], excludedHosts: [],
        }, expectedRevision: 1 },
        { id: 'untrusted-extension' },
      ),
    ).resolves.toEqual([undefined]);

    expect(storageSet).not.toHaveBeenCalled();
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe('exclude current host', () => {
  beforeEach(() => fakeBrowser.reset());

  it('normalizes and deduplicates exclusions from a valid stored HTTP(S) original', async () => {
    await saveSettings({
      ...DEFAULT_SETTINGS,
      excludedHosts: ['  SSO.CQU.EDU.CN ', 'sso.cqu.edu.cn', 'Other.CQU.EDU.CN'],
    });
    await recordRewrite(rewriteRecord());

    await excludeCurrentHost(7);

    expect((await loadSettings()).excludedHosts).toEqual([
      'other.cqu.edu.cn',
      'sso.cqu.edu.cn',
    ]);
  });

  it('reloads the latest settings immediately before saving after a delayed tab lookup', async () => {
    const pendingTab = deferred<Browser.tabs.Tab>();
    mockGetTab().mockReturnValue(pendingTab.promise);
    const excluding = excludeCurrentHost(7);
    await vi.waitFor(() => expect(browser.tabs.get).toHaveBeenCalledWith(7));
    await saveSettings({
      ...DEFAULT_SETTINGS,
      disabledBuiltInRuleIds: ['core-sso'],
      excludedHosts: ['existing.cqu.edu.cn'],
    });
    pendingTab.resolve(tab('https://Library.CQU.EDU.CN/path'));

    await excluding;

    expect(await loadSettings()).toMatchObject({
      disabledBuiltInRuleIds: ['core-sso'],
      excludedHosts: ['existing.cqu.edu.cn', 'library.cqu.edu.cn'],
    });
  });

  it('serializes exclusion with a concurrent mode/custom update without losing either host', async () => {
    const pendingTab = deferred<Browser.tabs.Tab>();
    mockGetTab().mockReturnValue(pendingTab.promise);
    const excluding = excludeCurrentHost(7);
    await vi.waitFor(() => expect(browser.tabs.get).toHaveBeenCalledWith(7));
    const customRule = {
      id: 'concurrent-rule',
      dnrId: 9001,
      name: 'Concurrent',
      description: 'Concurrent update',
      category: 'custom' as const,
      defaultEnabled: true,
      matcher: { kind: 'host' as const, host: 'other.cqu.edu.cn' },
      transformer: 'atrust-domain' as const,
    };
    const updating = updateSettings((current) => ({
      ...current,
      enableAllCquDomains: true,
      customRules: [customRule],
      excludedHosts: [...current.excludedHosts, 'first.cqu.edu.cn'],
    }));
    pendingTab.resolve(tab('https://second.cqu.edu.cn/path'));

    await Promise.all([excluding, updating]);

    expect(await loadSettings()).toMatchObject({
      enableAllCquDomains: true,
      customRules: [customRule],
      excludedHosts: ['first.cqu.edu.cn', 'second.cqu.edu.cn'],
    });
  });

  it.each([
    ['unsupported scheme', 'chrome://extensions/'],
    ['credentialed URL', 'https://user:secret@library.cqu.edu.cn/path'],
    ['missing URL', undefined],
  ])('rejects a $label tab source without mutating settings', async (_label, url) => {
    await saveSettings(DEFAULT_SETTINGS);
    mockGetTab().mockResolvedValue(tab(url));

    await expect(excludeCurrentHost(7)).rejects.toThrow();
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
