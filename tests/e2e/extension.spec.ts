/// <reference types="chrome" />

import {
  activeTabId,
  expect,
  rewriteRecord,
  beginExtensionWorkerRestart,
  sessionState,
  test,
} from './helpers';

const SSO_TARGET = 'sso-cqu-edu-cn-s.atrust.cqu.edu.cn';

async function countSsoTargetNavigations(
  extension: import('./helpers').ExtensionApp,
  clearDynamicRules: boolean,
): Promise<number> {
  const restart = await beginExtensionWorkerRestart(extension, { clearDynamicRules });
  const page = await extension.context.newPage();
  let targetNavigations = 0;
  page.on('request', (request) => {
    if (
      request.isNavigationRequest() &&
      new URL(request.url()).hostname === SSO_TARGET
    ) targetNavigations += 1;
  });
  await gotoWithBackgroundRedirect(page, 'https://sso.cqu.edu.cn/login?service=%2Fclient');
  await restart.restarted;
  await expect.poll(() => new URL(page.url()).hostname).toBe(SSO_TARGET);
  await page.waitForTimeout(100);
  return targetNavigations;
}

async function gotoWithBackgroundRedirect(
  page: import('@playwright/test').Page,
  url: string,
): Promise<void> {
  try {
    await page.goto(url);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('net::ERR_ABORTED')) throw error;
  }
}

async function reloadWithBackgroundRedirect(
  page: import('@playwright/test').Page,
): Promise<void> {
  try {
    await page.reload();
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('net::ERR_ABORTED')) throw error;
  }
}

test.describe('loaded extension redirects', () => {
  for (const protocol of ['http', 'https'] as const) {
    test(`rewrites ${protocol.toUpperCase()} SSO without changing ordered decoded CAS services`, async ({ extension }) => {
      const page = await extension.context.newPage();
      const services = [
        'https://my.cqu.edu.cn/authserver/authentication/cas?a=1&ticket=synthetic-nested',
        '/local/callback?next=/a+b&state=%2Fraw',
      ] as const;
      const original = `${protocol}://sso.cqu.edu.cn/login/deep` +
        `?service=${encodeURIComponent(services[0])}&state=first` +
        `&service=${encodeURIComponent(services[1])}&state=second#login-form`;

      await page.goto(original);

      const rewritten = new URL(page.url());
      expect(rewritten.protocol).toBe('https:');
      expect(rewritten.hostname).toBe(SSO_TARGET);
      expect(rewritten.pathname).toBe('/login/deep');
      expect(rewritten.searchParams.getAll('service')).toEqual(services);
      expect(rewritten.searchParams.getAll('state')).toEqual(['first', 'second']);
      expect(rewritten.hash).toBe('#login-form');
      const once = page.url();
      await page.reload();
      expect(page.url()).toBe(once);
    });
  }

  test('leaves a top-level CAS ticket callback on the original host without recording it', async ({ extension }) => {
    const page = await extension.context.newPage();
    const original = 'https://sso.cqu.edu.cn/login?state=x&ticket=synthetic';

    await page.goto(original);

    expect(page.url()).toBe(original);
    const tabId = await activeTabId(extension, page);
    await expect.poll(() => rewriteRecord(extension, tabId)).toBeNull();
  });

  test('leaves an encoded valueless top-level CAS ticket callback on the original host', async ({ extension }) => {
    const page = await extension.context.newPage();

    await page.goto('https://sso.cqu.edu.cn/login?t%69cket');

    const callback = new URL(page.url());
    expect(callback.hostname).toBe('sso.cqu.edu.cn');
    expect(callback.searchParams.has('ticket')).toBe(true);
    const tabId = await activeTabId(extension, page);
    await expect.poll(() => rewriteRecord(extension, tabId)).toBeNull();
  });

  test('uses queryless Youth DNR mapping and Chromium fragment inheritance', async ({ extension }) => {
    const page = await extension.context.newPage();

    await page.goto('https://youth.cqu.edu.cn/info/1009/24264.htm#article-part');

    const rewritten = new URL(page.url());
    expect(rewritten.origin).toBe('https://youth.cqu.edu.cn');
    expect(rewritten.pathname).toBe('/content.jsp');
    expect([...rewritten.searchParams.entries()]).toEqual([
      ['urltype', 'news.NewsContentUrl'],
      ['wbtreeid', '1009'],
      ['wbnewsid', '24264'],
    ]);
    expect(rewritten.hash).toBe('#article-part');
  });

  test('uses queried Youth fallback without losing duplicate, raw, or unrelated values', async ({ extension }) => {
    const page = await extension.context.newPage();
    const originalQuery = [
      'state=first',
      'state=second',
      'redirect_uri=https%3A%2F%2Fclient.example%2Fcb%3Fx%3D1%26y%3D2',
      'service=https%3A%2F%2Fa.example%2F%3Fa%3D1%26b%3D2',
      'service=%2Frelative%3Fx%3D1%26y%3D2',
      'raw=%252Fvalue%2Bplus',
      'unrelated=a+b',
      'urltype=attacker',
      'wbtreeid=999',
      'wbnewsid=888',
    ].join('&');

    await gotoWithBackgroundRedirect(
      page,
      `https://youth.cqu.edu.cn/info/1009/24264.htm?${originalQuery}#article-part`,
    );

    await expect.poll(() => new URL(page.url()).pathname).toBe('/content.jsp');

    const rewritten = new URL(page.url());
    expect(rewritten.pathname).toBe('/content.jsp');
    expect(rewritten.searchParams.getAll('state')).toEqual(['first', 'second']);
    expect(rewritten.searchParams.get('redirect_uri')).toBe(
      'https://client.example/cb?x=1&y=2',
    );
    expect(rewritten.searchParams.getAll('service')).toEqual([
      'https://a.example/?a=1&b=2',
      '/relative?x=1&y=2',
    ]);
    expect(rewritten.searchParams.get('raw')).toBe('%2Fvalue+plus');
    expect(rewritten.searchParams.get('unrelated')).toBe('a b');
    expect(rewritten.searchParams.getAll('urltype')).toEqual(['news.NewsContentUrl']);
    expect(rewritten.searchParams.getAll('wbtreeid')).toEqual(['1009']);
    expect(rewritten.searchParams.getAll('wbnewsid')).toEqual(['24264']);
    expect(rewritten.hash).toBe('#article-part');
  });
});

test.describe('service-worker startup fallback boundary', () => {
  test('completes one target navigation from a fresh empty-DNR worker start', async ({ extension }) => {
    expect(await countSsoTargetNavigations(extension, true)).toBe(1);
  });

  test('does not double-navigate when persisted DNR survives a worker restart', async ({ extension }) => {
    expect(await countSsoTargetNavigations(extension, false)).toBe(1);
  });
});

test.describe('rewrite records, UI, and original bypass', () => {
  test('records the SSO winner, renders popup state, and consumes one DNR bypass', async ({ extension }) => {
    const page = await extension.context.newPage();
    const original = 'https://sso.cqu.edu.cn/login?service=%2Fportal%3Fa%3D1%26b%3D2#form';
    await page.goto(original);
    const rewritten = page.url();
    const tabId = await activeTabId(extension, page);

    await expect.poll(() => rewriteRecord(extension, tabId)).toMatchObject({
      tabId,
      ruleId: 'core-sso',
      originalUrl: original,
      targetUrl: rewritten,
    });

    const popup = await extension.openExtensionPage('popup.html');
    await expect(popup.locator('#status')).toHaveText('已通过 aTrust 打开');
    await expect(popup.locator('#route')).toContainText('sso.cqu.edu.cn');
    await expect(popup.locator('#rule')).toHaveText('规则：core-sso');
    await expect(popup.locator('#open-original')).toBeEnabled();
    await expect(popup.locator('#exclude-host')).toBeEnabled();
    await expect(popup.locator('#open-options')).toBeEnabled();

    await popup.locator('#open-original').click();
    await expect.poll(() => page.url()).toBe(original);
    await expect.poll(() => sessionState(extension, tabId)).toEqual({ stored: {}, rules: [] });
    expect(page.url()).toBe(original);

    await page.reload();
    await expect.poll(() => page.url()).toBe(rewritten);
  });

  test('records queried Youth and consumes one background-navigation bypass', async ({ extension }) => {
    const page = await extension.context.newPage();
    const original = 'https://youth.cqu.edu.cn/info/1009/24264.htm?state=a&state=b#part';
    await gotoWithBackgroundRedirect(page, original);
    await expect.poll(() => new URL(page.url()).pathname).toBe('/content.jsp');
    const rewritten = page.url();
    const tabId = await activeTabId(extension, page);

    await expect.poll(() => rewriteRecord(extension, tabId)).toMatchObject({
      tabId,
      ruleId: 'addon-youth-public',
      originalUrl: original,
      targetUrl: rewritten,
    });
    const popup = await extension.openExtensionPage('popup.html');
    await expect(popup.locator('#rule')).toHaveText('规则：addon-youth-public');
    await popup.locator('#open-original').click();
    await expect.poll(() => page.url()).toBe(original);
    await expect.poll(() => sessionState(extension, tabId)).toEqual({ stored: {}, rules: [] });
    expect(page.url()).toBe(original);

    await reloadWithBackgroundRedirect(page);
    await expect.poll(() => page.url()).toBe(rewritten);
  });

  test('loads the packaged options artifact without page or console errors', async ({ extension }) => {
    const options = await extension.openExtensionPage('options.html', true);
    await expect(options).toHaveTitle('CQU Link Fix · 规则管理');
    await expect(options.locator('#status')).toContainText('设置已加载');
    await expect(options.locator('#master-enabled')).toBeChecked();
    await expect(options.locator('[data-rule-id="core-sso"]')).toBeChecked();
    await expect(options.locator('[data-rule-id="addon-youth-public"]')).toBeChecked();
  });
});

test.describe('manual optional-permission gate', () => {
  test.skip(
    process.env.CQU_E2E_PERMISSION_GATE !== '1',
    'Chromium optional-permission prompts are browser chrome; run headed with CQU_E2E_PERMISSION_GATE=1 and approve both prompts.',
  );

  test('grants exact custom and all-CQU permissions only from real options gestures', async ({ extension }) => {
    test.setTimeout(120_000);
    const options = await extension.openExtensionPage('options.html', true);
    await options.bringToFront();
    await expect(options.locator('#status')).toContainText('设置已加载');

    await options.locator('#custom-host').fill('library.cqu.edu.cn');
    await options.locator('#custom-submit').click();
    await expect(options.locator('#custom-list')).toContainText('library.cqu.edu.cn', {
      timeout: 60_000,
    });
    const exactOrigins = [
      '*://library.cqu.edu.cn/*',
      'https://library-cqu-edu-cn-s.atrust.cqu.edu.cn/*',
    ];
    await expect.poll(() => extension.worker.evaluate(
      () => chrome.permissions.getAll().then((permissions) => permissions.origins ?? []),
    )).toEqual(expect.arrayContaining(exactOrigins));
    expect(await extension.worker.evaluate(
      () => chrome.permissions.getAll().then((permissions) => permissions.origins ?? []),
    )).not.toContain('*://*.cqu.edu.cn/*');

    await options.locator('#all-cqu-enabled').click();
    await expect(options.locator('#all-cqu-enabled')).toBeChecked({ timeout: 60_000 });
    await expect.poll(() => extension.worker.evaluate(() => chrome.permissions.contains({
      origins: ['*://cqu.edu.cn/*', '*://*.cqu.edu.cn/*'],
    }))).toBe(true);
    await expect.poll(() => extension.worker.evaluate(async () => {
      const settings = (await chrome.storage.local.get('settings')).settings as
        { enableAllCquDomains?: unknown } | undefined;
      return settings?.enableAllCquDomains;
    })).toBe(true);

    const page = await extension.context.newPage();
    const original = 'https://portal.cqu.edu.cn/path?x=1#part';
    await gotoWithBackgroundRedirect(page, original);
    const rewritten = 'https://portal-cqu-edu-cn-s.atrust.cqu.edu.cn/path?x=1#part';
    await expect.poll(() => page.url()).toBe(rewritten);
    const tabId = await activeTabId(extension, page);
    await expect.poll(() => rewriteRecord(extension, tabId)).toMatchObject({
      tabId,
      ruleId: 'all-cqu-domains',
      originalUrl: original,
      targetUrl: rewritten,
    });
    const popup = await extension.openExtensionPage('popup.html');
    await expect(popup.locator('#rule')).toHaveText('规则：all-cqu-domains');
    await popup.locator('#open-original').click();
    await expect.poll(() => page.url()).toBe(original);
    await expect.poll(() => sessionState(extension, tabId)).toEqual({ stored: {}, rules: [] });
  });
});
