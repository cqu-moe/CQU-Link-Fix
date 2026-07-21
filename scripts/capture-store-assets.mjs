import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';

const root = process.cwd();
const extensionPath = path.join(root, '.output/chrome-mv3');
const assetsPath = path.join(root, 'docs/store/assets');
const icon = (await readFile(path.join(root, 'public/icon/512.png'))).toString('base64');
const profile = await mkdtemp(path.join(tmpdir(), 'cqu-store-assets-'));
const channel = process.env.CQU_STORE_BROWSER ?? 'chromium';

await mkdir(assetsPath, { recursive: true });

const waitForRules = async (worker) => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const count = await worker.evaluate(
      () => chrome.declarativeNetRequest.getDynamicRules().then((rules) => rules.length),
    );
    if (count > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for extension rules');
};

const settleVisuals = async (page) => {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);
};

const render = async (context, html, output, size) => {
  const page = await context.newPage();
  try {
    await page.setViewportSize(size);
    await page.setContent(html, { waitUntil: 'load' });
    await settleVisuals(page);
    await page.screenshot({ path: output, animations: 'disabled' });
  } finally {
    await page.close();
  }
};

let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    channel,
    headless: true,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  context.setDefaultTimeout(15_000);

  await context.route('https://sso-cqu-edu-cn-s.atrust.cqu.edu.cn/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><title>Link repair test</title><main>Local store asset fixture</main>',
    }),
  );

  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).hostname;
  await waitForRules(worker);

  const scenario = await context.newPage();
  await scenario.goto(
    'https://sso.cqu.edu.cn/login?service=https%3A%2F%2Fclient.example%2Fcallback',
  );
  await scenario.waitForURL((url) =>
    url.hostname === 'sso-cqu-edu-cn-s.atrust.cqu.edu.cn',
  );

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.locator('#master-state').filter({ hasNotText: '正在读取' }).waitFor();
  await settleVisuals(options);
  await options.screenshot({
    path: path.join(assetsPath, 'draft-screenshot-options-1280x800.png'),
    animations: 'disabled',
  });

  await scenario.bringToFront();
  const popupOpened = context.waitForEvent('page');
  await worker.evaluate((url) => chrome.tabs.create({ url, active: false }),
    `chrome-extension://${extensionId}/popup.html`);
  const popup = await popupOpened;
  await popup.waitForLoadState('domcontentloaded');
  await popup.locator('#runtime-status').filter({ hasNotText: '正在读取' }).waitFor();
  await popup.locator('#rule').filter({ hasText: '统一身份认证' }).waitFor();
  await settleVisuals(popup);
  const popupPng = await popup.locator('.popup-shell').screenshot({ animations: 'disabled' });

  const popupData = popupPng.toString('base64');
  await render(context, `<!doctype html>
    <meta charset="utf-8">
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; width: 1280px; height: 800px; overflow: hidden; background: #f4f1ea;
        color: #181818; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", sans-serif; }
      main { position: relative; display: grid; grid-template-columns: 1fr 430px; align-items: center;
        width: 100%; height: 100%; padding: 92px 110px; }
      main::before { content: ""; position: absolute; inset: 34px; border: 1px solid rgba(24,24,24,.10); }
      .copy { position: relative; z-index: 1; max-width: 560px; }
      .eyebrow { display: flex; align-items: center; gap: 12px; color: #76716a; font: 600 14px/1 monospace;
        letter-spacing: .12em; text-transform: uppercase; }
      .eyebrow::before { content: ""; width: 34px; height: 3px; background: #b52f36; }
      h1 { margin: 28px 0 20px; font-size: 64px; line-height: 1.08; letter-spacing: -.055em; }
      p { margin: 0; max-width: 520px; color: #56514c; font-size: 23px; line-height: 1.6; }
      .card { position: relative; z-index: 1; justify-self: end; padding: 22px; border-radius: 22px;
        background: rgba(255,255,255,.76); border: 1px solid rgba(24,24,24,.09);
        box-shadow: 0 28px 70px rgba(27,22,18,.16); transform: rotate(1.2deg); }
      .card img { display: block; width: 320px; height: auto; border-radius: 10px; }
      .route { position: absolute; right: 96px; bottom: 80px; color: #8d8780; font: 13px/1.5 monospace; }
    </style>
    <main>
      <section class="copy">
        <div class="eyebrow">LOCAL CONTROL</div>
        <h1>看得见的<br>链接修正</h1>
        <p>显示命中规则，随时暂停站点，或一次性回到原地址。</p>
      </section>
      <figure class="card"><img src="data:image/png;base64,${popupData}" alt="CQU Link Fix 弹窗"></figure>
      <div class="route">original URL → repaired URL</div>
    </main>`, path.join(assetsPath, 'draft-screenshot-popup-1280x800.png'), {
    width: 1280,
    height: 800,
  });

  await render(context, `<!doctype html>
    <meta charset="utf-8">
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; width: 440px; height: 280px; overflow: hidden; background: #f6f2ea;
        color: #171717; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      main { position: relative; display: flex; align-items: center; width: 100%; height: 100%; padding: 34px; }
      main::before { content: ""; position: absolute; inset: 14px; border: 1px solid rgba(23,23,23,.10); }
      .mark { position: relative; z-index: 1; width: 118px; height: 118px; flex: 0 0 auto; }
      .mark img { width: 100%; height: 100%; display: block; }
      .copy { position: relative; z-index: 1; margin-left: 28px; }
      h1 { margin: 0; max-width: 190px; font-size: 35px; line-height: 1.02; letter-spacing: -.055em; }
      .red { width: 40px; height: 4px; margin: 18px 0 14px; background: #b52f36; }
      .route { display: flex; align-items: center; gap: 9px; color: #6a665f; font: 600 11px/1 monospace;
        letter-spacing: .08em; }
      .route i { display: block; width: 34px; height: 1px; background: currentColor; position: relative; }
      .route i::after { content: ""; position: absolute; right: 0; top: -3px; width: 7px; height: 7px;
        border-top: 1px solid; border-right: 1px solid; transform: rotate(45deg); }
    </style>
    <main>
      <div class="mark"><img src="data:image/png;base64,${icon}" alt=""></div>
      <section class="copy"><h1>CQU<br>Link Fix</h1><div class="red"></div>
        <div class="route"><span>LINK</span><i></i><span>FIXED</span></div></section>
    </main>`, path.join(assetsPath, 'draft-small-promo-440x280.png'), {
    width: 440,
    height: 280,
  });

  await render(context, `<!doctype html>
    <style>
      body { margin: 0; width: 300px; height: 300px; display: grid; place-items: center; overflow: hidden;
        background: #f6f2ea; }
      div { width: 238px; height: 238px; filter: drop-shadow(0 14px 24px rgba(23,23,23,.13)); }
      img { display: block; width: 100%; height: 100%; }
    </style>
    <div><img src="data:image/png;base64,${icon}" alt="CQU Link Fix"></div>`,
  path.join(assetsPath, 'edge-logo-300x300.png'), { width: 300, height: 300 });

  console.log(`Generated store assets with ${channel} in ${assetsPath}`);
} finally {
  if (context) await context.close();
  await rm(profile, { recursive: true, force: true });
}
