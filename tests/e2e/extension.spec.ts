/// <reference types="chrome" />

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

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
  restartOptions: Parameters<typeof beginExtensionWorkerRestart>[1],
): Promise<number> {
  const restart = await beginExtensionWorkerRestart(extension, restartOptions);
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

  test('rewrites an SSO navigation initiated by an in-page link click', async ({ extension }) => {
    const page = await extension.context.newPage();
    await page.goto('https://client.example/link-source');

    await page.locator('#sso-link').click();

    await expect.poll(() => new URL(page.url()).hostname).toBe(SSO_TARGET);
    expect(new URL(page.url()).searchParams.get('service')).toBe('/clicked');
  });

  test('rewrites the original SSO location from a server-side CAS 302', async ({ extension }) => {
    const page = await extension.context.newPage();
    const cdp = await extension.context.newCDPSession(page);
    cdp.on('Fetch.requestPaused', (event: {
      requestId: string;
      request: { url: string };
      resourceType: string;
    }) => {
      void cdp.send('Fetch.fulfillRequest', {
        requestId: event.requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'content-type', value: 'text/html; charset=utf-8' }],
        body: Buffer.from('<!doctype html><title>synthetic CAS target</title>').toString('base64'),
      });
    });
    await cdp.send('Fetch.enable', {
      patterns: [{
        urlPattern: `https://${SSO_TARGET}/login*`,
        resourceType: 'Document',
        requestStage: 'Request',
      }],
    });

    try {
      await page.goto('http://client.example/cas-start');
    } finally {
      await cdp.send('Fetch.disable');
      await cdp.detach();
    }

    const rewritten = new URL(page.url());
    expect(rewritten.hostname).toBe(SSO_TARGET);
    expect(rewritten.searchParams.get('service')).toBe(
      'https://client.example/callback?state=a%20b',
    );
  });

  test('does not loop across browser back and forward history', async ({ extension }) => {
    const page = await extension.context.newPage();
    let targetNavigations = 0;
    page.on('request', (request) => {
      if (
        request.isNavigationRequest() &&
        new URL(request.url()).hostname === SSO_TARGET
      ) targetNavigations += 1;
    });

    await page.goto('https://client.example/link-source');
    await page.locator('#sso-link').click();
    await expect.poll(() => new URL(page.url()).hostname).toBe(SSO_TARGET);
    await page.goto('https://client.example/after');

    await page.goBack();
    await expect.poll(() => new URL(page.url()).hostname).toBe(SSO_TARGET);
    await page.goBack();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/link-source');
    await page.goForward();
    await expect.poll(() => new URL(page.url()).hostname).toBe(SSO_TARGET);
    await page.goForward();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/after');
    expect(targetNavigations).toBeLessThanOrEqual(3);
  });

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
    expect(await countSsoTargetNavigations(extension, { clearDynamicRules: true })).toBe(1);
  });

  test('does not double-navigate when persisted DNR survives a worker restart', async ({ extension }) => {
    expect(await countSsoTargetNavigations(extension, { clearDynamicRules: false })).toBe(1);
  });

  test('manually completes one navigation when persisted DNR is partial and unrelated', async ({ extension }) => {
    expect(await countSsoTargetNavigations(extension, {
      clearDynamicRules: false,
      retainDynamicRuleIds: [2001],
    })).toBe(1);
  });

  test('preserves a disabled built-in across a worker upgrade boundary', async ({ extension }) => {
    const options = await extension.openExtensionPage('options.html', true);
    await expect(options.locator('#status')).toContainText('设置已加载');
    await options.locator('[data-rule-id="core-sso"]').click();
    await expect(options.locator('[data-rule-id="core-sso"]')).not.toBeChecked();
    await expect.poll(() => options.evaluate(async () => {
      const stored = await chrome.storage.local.get('settings');
      return (stored.settings as { disabledRuleIds?: string[] } | undefined)
        ?.disabledRuleIds ?? [];
    })).toContain('core-sso');

    const restart = await beginExtensionWorkerRestart(extension, { clearDynamicRules: false });
    const page = await extension.context.newPage();
    const original = 'https://sso.cqu.edu.cn/login?service=%2Fupgrade';
    await page.goto(original);
    await restart.restarted;

    expect(page.url()).toBe(original);
    await expect.poll(() => options.evaluate(async () => {
      const stored = await chrome.storage.local.get('settings');
      return (stored.settings as { disabledRuleIds?: string[] } | undefined)
        ?.disabledRuleIds ?? [];
    })).toContain('core-sso');
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
    await expect(popup.locator('#runtime-status')).toHaveText('扩展运行中');
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

  test('packages options as a dedicated browser tab', async () => {
    const manifestPath = resolve(process.cwd(), '.output/chrome-mv3/manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      options_ui?: { page?: string; open_in_tab?: boolean };
    };

    expect(manifest.options_ui).toEqual({
      page: 'options.html',
      open_in_tab: true,
    });
  });

  test('renders the packaged compact console shell', async ({ extension }) => {
    const options = await extension.openExtensionPage('options.html', true);

    await expect(options.locator('[data-console-app-bar]')).toBeVisible();
    await expect(options.locator('#extension-version')).toHaveText('v0.2.0');
    await expect(options.locator('#master-state')).toHaveText('运行中');
    await expect(options.locator('#status')).toContainText('设置已加载');
    await expect(options.locator('[data-section-link]')).toHaveCount(4);
    const sections = options.locator('[data-console-section]');
    await expect(sections).toHaveCount(4);
    for (const [index, name] of ['运行概览', '内置规则', '自定义规则', '暂停站点'].entries()) {
      await expect(sections.nth(index)).toHaveAccessibleName(name);
    }
  });

  test('lays out the console without narrow-screen overflow', async ({ extension }) => {
    const options = await extension.openExtensionPage('options.html', true);
    await expect(options.locator('#status')).toContainText('设置已加载');

    await options.evaluate(async () => {
      await chrome.storage.local.set({
        settings: {
          enabled: true,
          enableAllCquDomains: false,
          disabledRuleIds: [],
          customRules: [{
            id: 'geometry-custom',
            dnrId: 10_001,
            name: 'library.cqu.edu.cn',
            description: '通过 aTrust 打开 library.cqu.edu.cn',
            category: 'custom',
            defaultEnabled: true,
            matcher: { kind: 'host', host: 'library.cqu.edu.cn' },
            transformer: 'atrust-domain',
          }],
          excludedHosts: [],
        },
        settingsRevision: 1,
      });
    });
    await options.reload();
    await expect(options.locator('#status')).toContainText('设置已加载');
    await expect(options.locator('[data-rule-row-for="geometry-custom"]'))
      .toContainText('library.cqu.edu.cn');

    await options.setViewportSize({ width: 1440, height: 900 });
    const appBarPosition = await options.locator('[data-console-app-bar]').evaluate(
      (element) => getComputedStyle(element).position,
    );
    const navigationPosition = await options.locator('[data-console-navigation]').evaluate(
      (element) => getComputedStyle(element).position,
    );
    const desktopNav = await options.locator('[data-console-navigation]').boundingBox();
    const desktopWorkspace = await options.locator('[data-console-workspace]').boundingBox();
    expect(appBarPosition).toBe('sticky');
    expect(navigationPosition).toBe('sticky');
    expect(desktopNav).not.toBeNull();
    expect(desktopWorkspace).not.toBeNull();
    expect(desktopWorkspace!.x).toBeGreaterThan(desktopNav!.x + desktopNav!.width);

    const focusContrast = await options.locator('[data-console-brand]').evaluate((element) => {
      const parse = (value: string): [number, number, number, number] => {
        const parts = value.match(/[\d.]+/g)?.map(Number) ?? [];
        return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
      };
      const composite = (
        foreground: [number, number, number, number],
        background: [number, number, number, number],
      ): [number, number, number, number] => {
        const alpha = foreground[3];
        return [
          foreground[0] * alpha + background[0] * (1 - alpha),
          foreground[1] * alpha + background[1] * (1 - alpha),
          foreground[2] * alpha + background[2] * (1 - alpha),
          1,
        ];
      };
      const luminance = (color: [number, number, number, number]): number =>
        [color[0], color[1], color[2]]
          .map((channel) => {
            const normalized = channel / 255;
            return normalized <= 0.04045
              ? normalized / 12.92
              : ((normalized + 0.055) / 1.055) ** 2.4;
          })
          .reduce((total, channel, index) =>
            total + channel * [0.2126, 0.7152, 0.0722][index]!, 0);
      (element as HTMLElement).focus();
      const outline = parse(getComputedStyle(element).outlineColor);
      const appBar = parse(getComputedStyle(element.closest('[data-console-app-bar]')!).backgroundColor);
      const page = parse(getComputedStyle(document.body).backgroundColor);
      const background = composite(appBar, page);
      const lighter = Math.max(luminance(outline), luminance(background));
      const darker = Math.min(luminance(outline), luminance(background));
      return (lighter + 0.05) / (darker + 0.05);
    });
    expect(focusContrast).toBeGreaterThanOrEqual(3);

    await options.evaluate(() => {
      const row = document.querySelector('[data-rule-row-for="geometry-custom"]');
      const remove = row?.querySelector('[data-delete-custom="geometry-custom"]');
      if (!row || !remove) throw new Error('Missing custom rule geometry hooks');
      const error = document.createElement('p');
      error.dataset.ruleValidationErrorFor = 'geometry-custom';
      error.textContent = '规则未加载：geometry fixture';
      row.insertBefore(error, remove);
    });
    const customToggleBox = await options.locator('[data-custom-rule-id="geometry-custom"]')
      .boundingBox();
    const desktopDeleteBox = await options.locator('[data-delete-custom="geometry-custom"]')
      .boundingBox();
    expect(customToggleBox).not.toBeNull();
    expect(desktopDeleteBox).not.toBeNull();
    expect(Math.abs(
      customToggleBox!.y + customToggleBox!.height / 2 -
      (desktopDeleteBox!.y + desktopDeleteBox!.height / 2),
    )).toBeLessThanOrEqual(1);

    await options.setViewportSize({ width: 1024, height: 900 });
    expect(await options.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )).toBe(false);

    for (const width of [1121, 1100, 1075, 1041, 800, 769]) {
      await options.setViewportSize({ width, height: 900 });
      const geometry = await options.evaluate(() => {
        const rows = [...document.querySelectorAll<HTMLElement>(
          '[data-rule-row-for]',
        )].filter((row) => row.getClientRects().length > 0);
        const customRow = document.querySelector<HTMLElement>(
          '[data-rule-row-for="geometry-custom"]',
        );
        return {
          hasOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          customGridTrackCount: customRow
            ? getComputedStyle(customRow).gridTemplateColumns.split(/\s+/).length
            : 0,
          rows: rows.map((row) => ({
            clientWidth: row.clientWidth,
            scrollWidth: row.scrollWidth,
          })),
        };
      });
      const deleteButton = options.locator('[data-delete-custom="geometry-custom"]');
      await expect(deleteButton).toBeVisible();
      const deleteButtonBox = await deleteButton.boundingBox();
      expect(deleteButtonBox).not.toBeNull();
      expect.soft(
        deleteButtonBox!.height,
        `${width}px custom delete touch target`,
      ).toBeGreaterThanOrEqual(44);
      expect.soft(
        deleteButtonBox!.width,
        `${width}px custom delete touch target`,
      ).toBeGreaterThanOrEqual(44);

      expect.soft(geometry.hasOverflow, `${width}px document overflow`).toBe(false);
      expect(geometry.rows.length).toBeGreaterThan(1);
      for (const [index, row] of geometry.rows.entries()) {
        expect.soft(
          row.scrollWidth,
          `${width}px rule row ${index + 1} clips content`,
        ).toBeLessThanOrEqual(row.clientWidth);
      }
      if (width === 1121) expect(geometry.customGridTrackCount).toBe(5);
    }

    await options.setViewportSize({ width: 700, height: 900 });
    for (const controlId of ['master-enabled', 'all-cqu-enabled']) {
      const target = options.locator(`label[for="${controlId}"]`);
      const targetBox = await target.boundingBox();
      expect(targetBox, `${controlId} associated label target`).not.toBeNull();
      expect.soft(
        targetBox!.height,
        `${controlId} associated label touch target height`,
      ).toBeGreaterThanOrEqual(44);
      expect.soft(
        targetBox!.width,
        `${controlId} associated label touch target width`,
      ).toBeGreaterThanOrEqual(44);
    }
    const narrowGeometry = await options.evaluate(() => {
      const nav = document.querySelector('[data-console-navigation]')!.getBoundingClientRect();
      const workspace = document.querySelector('[data-console-workspace]')!.getBoundingClientRect();
      return {
        hasOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        navWidth: nav.width,
        workspaceTop: workspace.top,
        navBottom: nav.bottom,
      };
    });
    expect(narrowGeometry.hasOverflow).toBe(false);
    expect(narrowGeometry.navWidth).toBeGreaterThan(640);
    expect(narrowGeometry.workspaceTop).toBeGreaterThanOrEqual(narrowGeometry.navBottom - 1);

    await options.setViewportSize({ width: 1440, height: 900 });
    const excludedLink = options.locator('[data-section-link="excluded"]');
    await excludedLink.click();
    await expect.poll(() => options.evaluate(() => {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      return window.scrollY >= maxScroll - 1;
    })).toBe(true);
    await options.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    await expect(excludedLink).toHaveAttribute('aria-current', 'location');
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

test.describe('manual optional-permission approval gate', () => {
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

test.describe('manual optional-permission denial gate', () => {
  test.skip(
    process.env.CQU_E2E_PERMISSION_DENIAL_GATE !== '1',
    'Run headed and reject the all-CQU optional-permission prompt.',
  );

  test('keeps all-CQU disabled and core rewrites active after prompt rejection', async ({ extension }) => {
    test.setTimeout(120_000);
    const options = await extension.openExtensionPage('options.html', true);
    await options.bringToFront();
    await expect(options.locator('#status')).toContainText('设置已加载');

    await options.locator('#all-cqu-enabled').click();
    await expect(options.locator('#all-cqu-enabled')).not.toBeChecked({ timeout: 60_000 });
    await expect(options.locator('#status')).toContainText('未授予全部 CQU 域名权限');
    await expect.poll(() => extension.worker.evaluate(() => chrome.permissions.contains({
      origins: ['*://cqu.edu.cn/*', '*://*.cqu.edu.cn/*'],
    }))).toBe(false);
    await expect.poll(() => extension.worker.evaluate(async () => {
      const settings = (await chrome.storage.local.get('settings')).settings as
        { enableAllCquDomains?: unknown } | undefined;
      return settings?.enableAllCquDomains;
    })).toBe(false);

    const page = await extension.context.newPage();
    await page.goto('https://sso.cqu.edu.cn/login?service=%2Fpermission-denied');
    expect(new URL(page.url()).hostname).toBe(SSO_TARGET);
  });
});
