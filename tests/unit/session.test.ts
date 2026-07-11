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
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../../src/storage/settings';

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
    mockGetSessionRules().mockResolvedValue([]);
    const updateRules = mockUpdateSessionRules().mockResolvedValue();
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
  });

  it('rejects an unsafe stored original and a session-rule ID collision without navigating', async () => {
    await browser.storage.session.set({
      'rewrite:7': rewriteRecord({ originalUrl: 'javascript:alert(1)' }),
    });
    const updateTab = mockUpdateTab().mockResolvedValue(undefined);
    await expect(openOriginalOnce(7)).rejects.toThrow(/HTTP\(S\)|rewrite/i);
    expect(updateTab).not.toHaveBeenCalled();

    await recordRewrite(rewriteRecord());
    mockGetSessionRules().mockResolvedValue([
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
    await browser.storage.session.set({
      'bypass:7': { tabId: 7, originalRequestUrl: 'https://sso.cqu.edu.cn/login' },
    });
    const updateRules = mockUpdateSessionRules().mockResolvedValue();

    await clearTabSession(7);

    expect(updateRules).toHaveBeenCalledWith({ removeRuleIds: [1_000_000_007] });
    expect(await browser.storage.session.get(null)).toEqual({});
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
    mockGetSessionRules().mockResolvedValue([]);
    mockUpdateSessionRules().mockResolvedValue();
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
      vi.spyOn(browser.storage.session, 'set').mockImplementation(async () => {
        order.push('record');
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
    mockGetSessionRules().mockResolvedValue([]);
    const updateRules = mockUpdateSessionRules().mockResolvedValue();
    mockUpdateTab().mockResolvedValue(undefined);
    await startBackground();
    await openOriginalOnce(7);

    await fakeBrowser.webNavigation.onCommitted.trigger(
      committedDetails('https://sso.cqu.edu.cn/login?x=1'),
    );

    await vi.waitFor(() => expect(getTabState(7)).resolves.toBeNull());
    expect(updateRules).toHaveBeenLastCalledWith({ removeRuleIds: [1_000_000_007] });
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
    await browser.storage.session.set({
      'bypass:7': { tabId: 7, originalRequestUrl: 'https://sso.cqu.edu.cn/login' },
    });
    const updateRules = mockUpdateSessionRules().mockResolvedValue();
    const addListener = vi.spyOn(browser.tabs.onRemoved, 'addListener');
    await startBackground();

    expect(addListener).toHaveBeenCalledTimes(1);
    await fakeBrowser.tabs.onRemoved.trigger(7, { isWindowClosing: false, windowId: 1 });

    await vi.waitFor(() => expect(getTabState(7)).resolves.toBeNull());
    expect(updateRules).toHaveBeenCalledWith({ removeRuleIds: [1_000_000_007] });
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

  it('contains lifecycle badge failures instead of producing unhandled listener rejections', async () => {
    await recordRewrite(rewriteRecord());
    vi.spyOn(browser.action, 'setBadgeText').mockRejectedValue(new Error('badge unavailable'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await startBackground();

    await expect(
      fakeBrowser.webNavigation.onCommitted.trigger(committedDetails('https://example.com/')),
    ).resolves.toEqual([undefined]);
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalled());
  });

  it('validates runtime message shapes and contains valid-message failures', async () => {
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
      { type: 'unknown', tabId: 7 },
    ];

    for (const message of invalid) {
      await expect(fakeBrowser.runtime.onMessage.trigger(message, {})).resolves.toEqual([undefined]);
    }
    expect(sessionSet).not.toHaveBeenCalled();
    expect(tabGet).not.toHaveBeenCalled();
    expect(tabUpdate).not.toHaveBeenCalled();

    await expect(
      fakeBrowser.runtime.onMessage.trigger({ type: 'open-original-once', tabId: 7 }, {}),
    ).resolves.toEqual([undefined]);
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalled());
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
