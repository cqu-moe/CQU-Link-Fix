/// <reference types="chrome" />

import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  chromium,
  expect,
  test as base,
  type BrowserContext,
  type Page,
  type Worker,
} from '@playwright/test';

const FIXTURE_HOSTS = [
  'sso.cqu.edu.cn',
  'sso-cqu-edu-cn-s.atrust.cqu.edu.cn',
  'youth.cqu.edu.cn',
  'library.cqu.edu.cn',
  'library-cqu-edu-cn-s.atrust.cqu.edu.cn',
  'portal.cqu.edu.cn',
  'portal-cqu-edu-cn-s.atrust.cqu.edu.cn',
  'client.example',
] as const;

interface ExtensionError {
  source: string;
  message: string;
}

export interface ExtensionApp {
  context: BrowserContext;
  worker: Worker;
  extensionId: string;
  errors: ExtensionError[];
  close: () => Promise<void>;
  openExtensionPage: (path: 'popup.html' | 'options.html', active?: boolean) => Promise<Page>;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function fixtureBody(url: URL): string {
  const visible = `${url.hostname}${url.pathname}${url.search}`;
  return `<!doctype html><html><head><title>${escapeHtml(visible)}</title></head>` +
    `<body><main id="fixture-url">${escapeHtml(url.href)}</main></body></html>`;
}

function attachPageDiagnostics(page: Page, errors: ExtensionError[]): void {
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push({ source: `page console (${page.url()})`, message: message.text() });
    }
  });
  page.on('pageerror', (error) => {
    errors.push({ source: `page error (${page.url()})`, message: error.message });
  });
}

function attachWorkerDiagnostics(worker: Worker, errors: ExtensionError[]): void {
  worker.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push({ source: `service worker console (${worker.url()})`, message: message.text() });
    }
  });
}

async function installFixtureRoutes(
  context: BrowserContext,
  redirectFixtureOrigin: string,
): Promise<void> {
  for (const host of FIXTURE_HOSTS) {
    for (const protocol of ['http', 'https'] as const) {
      await context.route(`${protocol}://${host}/**`, async (route) => {
        const url = new URL(route.request().url());
        if (host === 'client.example' && url.pathname === '/cas-start') {
          await route.continue({
            url: `${redirectFixtureOrigin}/cas-start`,
          });
          return;
        }
        if (host === 'client.example' && url.pathname === '/link-source') {
          await route.fulfill({
            status: 200,
            contentType: 'text/html; charset=utf-8',
            body: '<!doctype html><html><body>' +
              '<a id="sso-link" href="https://sso.cqu.edu.cn/login?service=%2Fclicked">登录</a>' +
              '</body></html>',
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: fixtureBody(url),
        });
      });
    }
  }
}

async function startRedirectFixtureServer(): Promise<{
  origin: string;
  close: () => Promise<void>;
}> {
  const server = createServer((request, response) => {
    if (request.url !== '/cas-start') {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(302, {
      location: 'https://sso.cqu.edu.cn/login?service=' +
        'https%3A%2F%2Fclient.example%2Fcallback%3Fstate%3Da%2520b',
    }).end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

export async function launchExtension(): Promise<ExtensionApp> {
  const extensionPath = path.resolve('.output/chrome-mv3');
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'cqu-link-fix-'));
  const errors: ExtensionError[] = [];
  let context: BrowserContext | null = null;
  const redirectFixture = await startRedirectFixtureServer();

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: process.env.CQU_E2E_HEADED !== '1',
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    context.setDefaultTimeout(10_000);
    context.setDefaultNavigationTimeout(15_000);
    for (const page of context.pages()) attachPageDiagnostics(page, errors);
    context.on('page', (page) => attachPageDiagnostics(page, errors));
    context.on('serviceworker', (nextWorker) => attachWorkerDiagnostics(nextWorker, errors));
    await installFixtureRoutes(context, redirectFixture.origin);

    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', {
      timeout: 15_000,
    });
    attachWorkerDiagnostics(worker, errors);
    const extensionId = new URL(worker.url()).hostname;
    expect(extensionId).not.toBe('');
    await expect.poll(
      () => worker.evaluate(() => chrome.declarativeNetRequest.getDynamicRules().then(
        (rules) => rules.length,
      )),
      { message: 'dynamic DNR rules become ready' },
    ).toBeGreaterThan(0);

    let closed = false;
    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      let closeError: unknown;
      try {
        await context!.close();
      } catch (error) {
        closeError = error;
      } finally {
        await redirectFixture.close();
        await rm(userDataDir, { recursive: true, force: true });
      }
      if (closeError) throw closeError;
    };

    return {
      context,
      worker,
      extensionId,
      errors,
      close,
      openExtensionPage: async (pagePath, active = false) => {
        const url = `chrome-extension://${extensionId}/${pagePath}`;
        const opened = context!.waitForEvent('page');
        await worker.evaluate(
          ({ url: target, active: makeActive }) => chrome.tabs.create({
            url: target,
            active: makeActive,
          }),
          { url, active },
        );
        const page = await opened;
        await page.waitForURL(url);
        await page.waitForLoadState('domcontentloaded');
        return page;
      },
    };
  } catch (error) {
    try {
      if (context) await context.close();
    } finally {
      await redirectFixture.close();
      await rm(userDataDir, { recursive: true, force: true });
    }
    throw error;
  }
}

export const test = base.extend<{ extension: ExtensionApp }>({
  extension: async ({}, use) => {
    const extension = await launchExtension();
    try {
      await use(extension);
      expect(extension.errors, 'unexpected extension console or page errors').toEqual([]);
    } finally {
      await extension.close();
    }
  },
});

export { expect };

export async function activeTabId(app: ExtensionApp, page: Page): Promise<number> {
  await page.bringToFront();
  return app.worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !Number.isInteger(tab.id)) throw new Error('No active extension test tab');
    return tab.id as number;
  });
}

export async function rewriteRecord(app: ExtensionApp, tabId: number): Promise<unknown> {
  return app.worker.evaluate(async (id) => {
    const key = `rewrite:${id}`;
    return (await chrome.storage.session.get(key))[key] ?? null;
  }, tabId);
}

export async function sessionState(app: ExtensionApp, tabId: number): Promise<unknown> {
  return app.worker.evaluate(async (id) => {
    const stored = await chrome.storage.session.get([`rewrite:${id}`, `bypass:${id}`]);
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    return {
      stored,
      rules: rules.filter((rule) => rule.condition.tabIds?.includes(id)),
    };
  }, tabId);
}

export async function beginExtensionWorkerRestart(
  app: ExtensionApp,
  options: { clearDynamicRules: boolean; retainDynamicRuleIds?: readonly number[] },
): Promise<{ restarted: Promise<void> }> {
  const previous = app.worker;
  if (options.clearDynamicRules || options.retainDynamicRuleIds) {
    await previous.evaluate(async ({ clearDynamicRules, retainDynamicRuleIds }) => {
      const rules = await chrome.declarativeNetRequest.getDynamicRules();
      const retained = new Set(retainDynamicRuleIds ?? []);
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: rules
          .filter((rule) => clearDynamicRules || !retained.has(rule.id))
          .map((rule) => rule.id),
      });
    }, options);
  }
  const controlPage = app.context.pages()[0] ?? await app.context.newPage();
  const cdp = await app.context.newCDPSession(controlPage);
  type Version = {
    versionId: string;
    scriptURL: string;
    status: string;
    runningStatus: string;
  };
  const waitForVersion = (predicate: (version: Version) => boolean): Promise<Version> =>
    new Promise((resolve) => {
      const listener = (event: { versions: Version[] }): void => {
        const version = event.versions.find(predicate);
        if (!version) return;
        cdp.off('ServiceWorker.workerVersionUpdated', listener);
        resolve(version);
      };
      cdp.on('ServiceWorker.workerVersionUpdated', listener);
    });
  const activated = waitForVersion((candidate) =>
    candidate.scriptURL === previous.url() && candidate.status === 'activated',
  );
  await cdp.send('ServiceWorker.enable');
  const version = await activated;
  const stopped = waitForVersion((candidate) =>
    candidate.versionId === version.versionId && candidate.runningStatus === 'stopped',
  );
  await cdp.send('ServiceWorker.stopWorker', { versionId: version.versionId });
  await stopped;
  const running = waitForVersion((candidate) =>
    candidate.versionId === version.versionId && candidate.runningStatus === 'running',
  ).then(async () => {
    await cdp.detach();
  });
  return {
    restarted: running,
  };
}
