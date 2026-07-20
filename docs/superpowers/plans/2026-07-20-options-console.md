# Dedicated Options Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Open CQU Link Fix settings in a dedicated Chromium tab and replace the oversized editorial options page with a compact, responsive management console.

**Architecture:** Keep the existing WXT options entrypoint, background-owned settings writes, controller, model, permission lease flow, and stable selectors. Change the options entrypoint metadata and semantic shell, add a focused section-navigation module, enrich renderer output with compact row states, and verify the resulting layout through loaded-extension Playwright geometry checks.

**Tech Stack:** WXT 0.20, Chromium Manifest V3, TypeScript 7, vanilla DOM, CSS, Vitest with happy-dom, Playwright loaded-extension fixtures, pnpm.

## Global Constraints

- Stay on Chromium Manifest V3 and use the existing WXT options entrypoint.
- Do not add React, Vue, a UI framework, runtime dependency, remote font, telemetry, remote rules, or new permissions.
- Preserve exact settings types, background-owned compare-and-swap writes, DNR status flow, and custom permission lease behavior.
- Permission requests must still start synchronously inside the original checkbox or form-submit user gesture.
- Preserve stable element IDs and dynamic data-rule-id, data-custom-rule-id, data-delete-custom, and data-remove-excluded selectors.
- Keep native checkbox inputs with visible labels and preserve aria-describedby, aria-disabled, aria-busy, and the #status live region.
- Use warm white, ink, and CQU red; remove the oversized serif hero and excessive vertical whitespace.
- At widths up to 768px, use a single-column workspace with horizontal section navigation and no horizontal page overflow.
- Do not stage or commit the unrelated .DS_Store file.

---

## File Structure

- Modify entrypoints/options/index.html: declare open-in-tab metadata and provide the semantic console shell.
- Modify entrypoints/options/main.ts: render the packaged version and initialize section navigation without changing controller dependencies.
- Modify entrypoints/options/style.css: own the complete desktop, responsive, focus, state, and reduced-motion presentation.
- Modify src/ui/options-renderer.ts: render global and per-rule state labels into compact rule rows.
- Create src/ui/options-navigation.ts: own section-link activation and IntersectionObserver lifecycle.
- Modify tests/unit/options-controller.test.ts: assert global status and compact rule-row semantics through the real controller/renderer path.
- Create tests/unit/options-navigation.test.ts: verify navigation selection, observation, clicks, and cleanup with an injected observer.
- Modify tests/e2e/extension.spec.ts: assert built Manifest metadata, packaged shell, version, and responsive geometry.
- Modify README.md: replace the stale note that the options visual redesign is future work.

---

### Task 1: Package the options entrypoint as a dedicated tab

**Files:**
- Modify: tests/e2e/extension.spec.ts
- Modify: entrypoints/options/index.html

**Interfaces:**
- Consumes: WXT HTML entrypoint metadata named manifest.open_in_tab.
- Produces: generated manifest.options_ui equal to { page: "options.html", open_in_tab: true }.

- [ ] **Step 1: Write the failing built-artifact test**

Add Node filesystem imports at the top of tests/e2e/extension.spec.ts:

~~~ts
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
~~~

Add this test to the existing rewrite records, UI, and original bypass describe block, immediately before the packaged options page smoke test:

~~~ts
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
~~~

- [ ] **Step 2: Run the test and verify RED**

Run:

~~~bash
pnpm build
pnpm exec playwright test --grep "packages options as a dedicated browser tab"
~~~

Expected: FAIL because the generated value of options_ui.open_in_tab is false.

- [ ] **Step 3: Add WXT options metadata**

In entrypoints/options/index.html, add this tag after the viewport meta tag:

~~~html
<meta name="manifest.open_in_tab" content="true" />
~~~

- [ ] **Step 4: Rebuild and verify GREEN**

Run:

~~~bash
pnpm build
pnpm exec playwright test --grep "packages options as a dedicated browser tab"
~~~

Expected: 1 test passes and .output/chrome-mv3/manifest.json contains open_in_tab: true.

- [ ] **Step 5: Commit**

~~~bash
git add entrypoints/options/index.html tests/e2e/extension.spec.ts
git diff --cached --check
git commit -m "feat(options): open settings in dedicated tab"
~~~

---

### Task 2: Replace the editorial shell with a semantic console shell

**Files:**
- Modify: tests/unit/options-controller.test.ts
- Modify: tests/e2e/extension.spec.ts
- Modify: entrypoints/options/index.html
- Modify: entrypoints/options/main.ts
- Modify: src/ui/options-renderer.ts

**Interfaces:**
- Consumes: initializeOptionsController(Document, OptionsControllerDependencies), browser.runtime.getManifest().version, and the existing stable options control IDs.
- Produces: #extension-version, #master-state, .app-bar, .status-bar, .section-nav, .console-layout, and four data-console-section sections.

- [ ] **Step 1: Extend the unit fixture and write a failing global-state assertion**

In fixture() in tests/unit/options-controller.test.ts, create and append the new status element before the loop that appends custom-list, excluded-list, status, and custom-error:

~~~ts
const masterState = document.createElement('span');
masterState.id = 'master-state';
main.append(masterState);
~~~

Extend the first options controller test after the master checkbox assertion:

~~~ts
expect(text('master-state')).toBe('运行中');
expect(document.querySelector('#master-state')?.getAttribute('data-tone')).toBe('success');
~~~

Add a new test after it:

~~~ts
it('renders the paused master state in the app bar summary', async () => {
  await initializeOptionsController(document, dependencies({
    getSnapshot: vi.fn().mockResolvedValue(snapshot({
      ...DEFAULT_SETTINGS,
      enabled: false,
    })),
  }));

  expect(text('master-state')).toBe('已停用');
  expect(document.querySelector('#master-state')?.getAttribute('data-tone')).toBe('muted');
});
~~~

- [ ] **Step 2: Write a failing packaged-shell E2E test**

Add this test after the dedicated-tab test:

~~~ts
test('renders the packaged compact console shell', async ({ extension }) => {
  const options = await extension.openExtensionPage('options.html', true);

  await expect(options.locator('.app-bar')).toBeVisible();
  await expect(options.locator('#extension-version')).toHaveText('v0.1.1');
  await expect(options.locator('#master-state')).toHaveText('运行中');
  await expect(options.locator('.status-bar #status')).toContainText('设置已加载');
  await expect(options.locator('.section-nav a')).toHaveCount(4);
  await expect(options.locator('[data-console-section]')).toHaveCount(4);
  await expect(options.locator('.masthead')).toHaveCount(0);
});
~~~

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

~~~bash
pnpm vitest run tests/unit/options-controller.test.ts
pnpm build
pnpm exec playwright test --grep "renders the packaged compact console shell"
~~~

Expected: the unit test fails because #master-state remains empty; the E2E test fails because the console shell does not exist.

- [ ] **Step 4: Replace the options document body**

Keep the existing doctype, language, charset, viewport, title, color-scheme, open-in-tab meta, and module script. Replace the body content in entrypoints/options/index.html with:

~~~html
<header class="app-bar">
  <a class="brand" href="#overview" aria-label="CQU Link Fix 设置首页">
    <span class="brand__mark" aria-hidden="true">C</span>
    <span class="brand__copy">
      <strong>CQU Link Fix</strong>
      <span>本地导航控制台</span>
    </span>
  </a>
  <div class="app-bar__meta">
    <span id="extension-version" class="version-chip">v—</span>
    <span class="privacy-chip">LOCAL ONLY</span>
    <span id="master-state" class="master-state" data-tone="muted">正在读取</span>
  </div>
</header>

<div class="status-bar">
  <span class="status-bar__label">系统状态</span>
  <span class="status-bar__signal" aria-hidden="true">●</span>
  <p id="status" role="status" aria-live="polite">正在读取设置…</p>
</div>

<main class="console-layout">
  <nav class="section-nav" aria-label="设置分区">
    <p class="section-nav__eyebrow">CONTROL PANEL</p>
    <a href="#overview" data-section-link="overview" aria-current="location">
      <span>01</span>概览
    </a>
    <a href="#built-in" data-section-link="built-in">
      <span>02</span>内置规则
    </a>
    <a href="#custom" data-section-link="custom">
      <span>03</span>自定义规则
    </a>
    <a href="#excluded" data-section-link="excluded">
      <span>04</span>暂停站点
    </a>
    <p class="section-nav__foot">无遥测 · 无远程规则</p>
  </nav>

  <div class="workspace">
    <section id="overview" class="console-section" data-console-section>
      <div class="section-heading">
        <div>
          <p class="section-index">01 / OVERVIEW</p>
          <h1>运行概览</h1>
        </div>
        <p>控制链接改写与可选的全校域名访问范围。</p>
      </div>
      <div class="control-grid">
        <fieldset class="control-panel control-panel--primary">
          <legend>全局状态</legend>
          <div class="switch-row">
            <div>
              <label for="master-enabled">启用链接改写</label>
              <p>停用后保留全部本地规则，但不执行新的改写。</p>
            </div>
            <input id="master-enabled" type="checkbox" role="switch" />
          </div>
        </fieldset>
        <fieldset class="control-panel">
          <legend>可选权限</legend>
          <div class="switch-row">
            <div>
              <label for="all-cqu-enabled">全部 CQU 域名模式</label>
              <p>开启时申请 cqu.edu.cn 与 *.cqu.edu.cn 的访问权限；学校未发布的资源仍可能不可用。</p>
            </div>
            <input id="all-cqu-enabled" type="checkbox" role="switch" />
          </div>
        </fieldset>
      </div>
    </section>

    <section id="built-in" class="console-section" data-console-section>
      <div class="section-heading">
        <div>
          <p class="section-index">02 / BUILT-IN</p>
          <h2>内置规则</h2>
        </div>
        <p>规则随扩展发布；关闭规则只保存本地覆盖状态。</p>
      </div>
      <div id="built-in-groups" class="rule-groups"></div>
    </section>

    <section id="custom" class="console-section" data-console-section>
      <div class="section-heading">
        <div>
          <p class="section-index">03 / LOCAL</p>
          <h2>自定义规则</h2>
        </div>
        <p>只接受不带协议、路径、端口或通配符的精确 CQU DNS 域名。</p>
      </div>
      <form id="custom-rule-form" class="custom-form" novalidate>
        <label for="custom-host">CQU 域名</label>
        <div class="custom-form__row">
          <input
            id="custom-host"
            name="host"
            type="text"
            inputmode="url"
            autocomplete="off"
            spellcheck="false"
            placeholder="library.cqu.edu.cn"
            aria-describedby="custom-help custom-error"
          />
          <button id="custom-submit" type="submit">申请权限并添加</button>
        </div>
        <p id="custom-help" class="form-help">IP、IPv6、userinfo、aTrust 地址和已有规则会被拒绝。</p>
        <p id="custom-error" class="form-error" role="alert"></p>
      </form>
      <div id="custom-list" class="rule-list" aria-label="本地自定义规则"></div>
    </section>

    <section id="excluded" class="console-section" data-console-section>
      <div class="section-heading">
        <div>
          <p class="section-index">04 / EXCLUSIONS</p>
          <h2>暂停站点</h2>
        </div>
        <p>这些主机会跳过全部改写；新的暂停操作从扩展弹窗发起。</p>
      </div>
      <div id="excluded-list" class="excluded-list"></div>
    </section>
  </div>
</main>

<footer class="page-footer">
  <span>CQU LINK FIX / LOCAL NAVIGATION UTILITY</span>
  <span>设置保存在本机</span>
</footer>
~~~

- [ ] **Step 5: Populate the packaged version**

In entrypoints/options/main.ts, add:

~~~ts
function showExtensionVersion(): void {
  const version = document.querySelector('#extension-version');
  if (version) version.textContent = 'v' + browser.runtime.getManifest().version;
}
~~~

Call showExtensionVersion() as the first statement inside startOptions() after the started guard:

~~~ts
if (started) return;
started = true;
showExtensionVersion();
~~~

- [ ] **Step 6: Render the master summary state**

Add masterState to OptionsElements and getOptionsElements() in src/ui/options-renderer.ts:

~~~ts
masterState: HTMLElement;
~~~

~~~ts
masterState: requireElement(root, '#master-state', HTMLElement),
~~~

In the no-snapshot branch of renderOptionsContent(), add:

~~~ts
elements.masterState.textContent = '状态未知';
elements.masterState.dataset.tone = 'muted';
~~~

After assigning the master checkbox in the saved-snapshot branch, add:

~~~ts
elements.masterState.textContent = snapshot.settings.enabled ? '运行中' : '已停用';
elements.masterState.dataset.tone = snapshot.settings.enabled ? 'success' : 'muted';
~~~

- [ ] **Step 7: Run the focused tests and verify GREEN**

Run:

~~~bash
pnpm vitest run tests/unit/options-controller.test.ts
pnpm build
pnpm exec playwright test --grep "renders the packaged compact console shell"
~~~

Expected: all options controller unit tests pass and the single shell E2E passes.

- [ ] **Step 8: Commit**

~~~bash
git add entrypoints/options/index.html entrypoints/options/main.ts src/ui/options-renderer.ts tests/unit/options-controller.test.ts tests/e2e/extension.spec.ts
git diff --cached --check
git commit -m "feat(options): add compact console shell"
~~~

---

### Task 3: Render built-in and custom rules as compact stateful rows

**Files:**
- Modify: tests/unit/options-controller.test.ts
- Modify: src/ui/options-renderer.ts

**Interfaces:**
- Consumes: OptionsRuleModel fields enabled, locked, lockReason, validationError, category, name, description, and matcher.
- Produces: .rule-row with data-state, .rule-row__lead, .rule-row__description, .rule-row__range, and .rule-state.

- [ ] **Step 1: Write failing row-state tests**

Extend the first controller test after the existing rule-count assertions:

~~~ts
const enabledRow = document.querySelector('[data-rule-id="core-sso"]')?.closest('.rule-row');
expect(enabledRow?.getAttribute('data-state')).toBe('enabled');
expect(enabledRow?.querySelector('.rule-state')?.textContent).toBe('已启用');
~~~

Extend the skipped-DNR-rule test:

~~~ts
const failedRow = error?.closest('.rule-row');
expect(failedRow?.getAttribute('data-state')).toBe('error');
expect(failedRow?.querySelector('.rule-state')?.textContent).toBe('未加载');
~~~

Extend the default-off locked-rule test after finding locked:

~~~ts
const lockedRow = locked.closest('.rule-row');
expect(lockedRow?.getAttribute('data-state')).toBe('locked');
expect(lockedRow?.querySelector('.rule-state')?.textContent).toBe('版本锁定');
~~~

Add a new test:

~~~ts
it('renders a disabled built-in as a compact paused row', async () => {
  await initializeOptionsController(document, dependencies({
    getSnapshot: vi.fn().mockResolvedValue(snapshot({
      ...DEFAULT_SETTINGS,
      disabledRuleIds: ['core-sso'],
    })),
  }));

  const row = document.querySelector('[data-rule-id="core-sso"]')?.closest('.rule-row');
  expect(row?.getAttribute('data-state')).toBe('disabled');
  expect(row?.querySelector('.rule-state')?.textContent).toBe('已停用');
});
~~~

- [ ] **Step 2: Run the tests and verify RED**

Run:

~~~bash
pnpm vitest run tests/unit/options-controller.test.ts
~~~

Expected: the new assertions fail because renderer output still uses .rule-card and has no state label.

- [ ] **Step 3: Add a deterministic row-state helper**

Add this helper before renderRuleCard() in src/ui/options-renderer.ts:

~~~ts
type RuleRowState = 'enabled' | 'disabled' | 'locked' | 'error';

function ruleRowState(rule: OptionsRuleModel): {
  state: RuleRowState;
  label: string;
} {
  if (rule.validationError) return { state: 'error', label: '未加载' };
  if (rule.locked) return { state: 'locked', label: '版本锁定' };
  if (rule.enabled) return { state: 'enabled', label: '已启用' };
  return { state: 'disabled', label: '已停用' };
}
~~~

- [ ] **Step 4: Replace renderRuleCard() with compact row markup**

Replace the function body while keeping its signature:

~~~ts
function renderRuleCard(
  root: Document,
  rule: OptionsRuleModel,
  handlers: OptionsRenderHandlers,
): HTMLElement {
  const isCustom = rule.category === 'custom';
  const presentation = ruleRowState(rule);
  const article = root.createElement('article');
  article.className = 'rule-row';
  article.dataset.state = presentation.state;

  const lead = root.createElement('div');
  lead.className = 'rule-row__lead';
  const input = renderRuleToggle(root, rule, handlers);
  const label = root.createElement('label');
  label.htmlFor = input.id;
  label.textContent = rule.name;
  lead.append(input, label);

  const description = root.createElement('p');
  description.className = 'rule-row__description';
  description.textContent = rule.description;

  const range = root.createElement('code');
  range.className = 'rule-row__range';
  range.textContent = matcherRangeLabel(rule.matcher);

  const state = root.createElement('span');
  state.className = 'rule-state';
  state.textContent = presentation.label;
  article.append(lead, description, range, state);

  if (rule.validationError) {
    const validationError = root.createElement('p');
    validationError.className = 'rule-validation-error';
    validationError.dataset.ruleValidationErrorFor = rule.id;
    validationError.textContent = '规则未加载：' + rule.validationError;
    article.append(validationError);
  }
  if (rule.locked && rule.lockReason) {
    const lockReason = root.createElement('p');
    lockReason.id = checkboxId('rule-lock-reason', rule.id);
    lockReason.className = 'rule-lock-reason';
    lockReason.dataset.lockReasonFor = rule.id;
    lockReason.textContent = rule.lockReason;
    input.setAttribute('aria-describedby', lockReason.id);
    article.append(lockReason);
  }
  if (isCustom) {
    const remove = root.createElement('button');
    remove.type = 'button';
    remove.className = 'danger-button';
    remove.dataset.deleteCustom = rule.id;
    remove.textContent = '删除';
    remove.setAttribute('aria-label', '删除自定义规则 ' + rule.name);
    remove.addEventListener('click', () => handlers.deleteCustomRule(rule));
    article.append(remove);
  }
  return article;
}
~~~

Update the custom-rule list CSS hook assignment in renderOptionsContent() only if a remaining production selector still uses .rule-card; do not change any data attributes or handlers.

- [ ] **Step 5: Run the tests and verify GREEN**

Run:

~~~bash
pnpm vitest run tests/unit/options-controller.test.ts tests/unit/options-model.test.ts
pnpm typecheck
~~~

Expected: both test files pass and TypeScript exits 0.

- [ ] **Step 6: Commit**

~~~bash
git add src/ui/options-renderer.ts tests/unit/options-controller.test.ts
git diff --cached --check
git commit -m "feat(options): render compact rule rows"
~~~

---

### Task 4: Track the active console section

**Files:**
- Create: tests/unit/options-navigation.test.ts
- Create: src/ui/options-navigation.ts
- Modify: entrypoints/options/main.ts
- Modify: tests/unit/options-dependencies.test.ts

**Interfaces:**
- Produces: initializeOptionsNavigation(root: Document, createObserver?: SectionObserverFactory): () => void.
- Consumes: links with data-section-link and section IDs matching each link value.

- [ ] **Step 1: Write the failing navigation tests**

Create tests/unit/options-navigation.test.ts:

~~~ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  initializeOptionsNavigation,
  type SectionObserverFactory,
} from '../../src/ui/options-navigation';

function fixture(): void {
  document.body.innerHTML = [
    '<nav>',
    '<a href="#overview" data-section-link="overview">概览</a>',
    '<a href="#built-in" data-section-link="built-in">内置规则</a>',
    '</nav>',
    '<section id="overview"></section>',
    '<section id="built-in"></section>',
  ].join('');
}

describe('options section navigation', () => {
  beforeEach(fixture);

  it('observes each section and selects the most visible entry', () => {
    let callback: IntersectionObserverCallback | null = null;
    const observe = vi.fn();
    const disconnect = vi.fn();
    const createObserver: SectionObserverFactory = (next) => {
      callback = next;
      return { observe, disconnect };
    };
    const dispose = initializeOptionsNavigation(document, createObserver);
    const overview = document.querySelector('#overview') as Element;
    const builtIn = document.querySelector('#built-in') as Element;

    expect(observe).toHaveBeenCalledWith(overview);
    expect(observe).toHaveBeenCalledWith(builtIn);
    expect(document.querySelector('[data-section-link="overview"]')?.getAttribute('aria-current'))
      .toBe('location');

    callback?.([
      { target: overview, isIntersecting: true, intersectionRatio: 0.2 },
      { target: builtIn, isIntersecting: true, intersectionRatio: 0.8 },
    ] as IntersectionObserverEntry[], {} as IntersectionObserver);

    expect(document.querySelector('[data-section-link="overview"]')?.hasAttribute('aria-current'))
      .toBe(false);
    expect(document.querySelector('[data-section-link="built-in"]')?.getAttribute('aria-current'))
      .toBe('location');

    dispose();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('updates selection immediately on a section-link click', () => {
    const createObserver: SectionObserverFactory = () => ({
      observe: vi.fn(),
      disconnect: vi.fn(),
    });
    initializeOptionsNavigation(document, createObserver);

    (document.querySelector('[data-section-link="built-in"]') as HTMLAnchorElement).click();

    expect(document.querySelector('[data-section-link="built-in"]')?.getAttribute('aria-current'))
      .toBe('location');
  });
});
~~~

- [ ] **Step 2: Run the test and verify RED**

Run:

~~~bash
pnpm vitest run tests/unit/options-navigation.test.ts
~~~

Expected: FAIL because src/ui/options-navigation.ts does not exist.

- [ ] **Step 3: Implement the focused navigation module**

Create src/ui/options-navigation.ts:

~~~ts
interface SectionObserver {
  observe: (target: Element) => void;
  disconnect: () => void;
}

export type SectionObserverFactory = (
  callback: IntersectionObserverCallback,
) => SectionObserver;

function defaultObserverFactory(callback: IntersectionObserverCallback): SectionObserver {
  return new IntersectionObserver(callback, {
    rootMargin: '-96px 0px -55% 0px',
    threshold: [0.15, 0.35, 0.6, 0.85],
  });
}

export function initializeOptionsNavigation(
  root: Document,
  createObserver: SectionObserverFactory = defaultObserverFactory,
): () => void {
  const links = Array.from(
    root.querySelectorAll<HTMLAnchorElement>('[data-section-link]'),
  );
  const targets = links.flatMap((link) => {
    const id = link.dataset.sectionLink;
    const target = id ? root.getElementById(id) : null;
    return target ? [target] : [];
  });
  if (links.length === 0 || targets.length === 0) return () => {};

  const select = (id: string): void => {
    for (const link of links) {
      if (link.dataset.sectionLink === id) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
  };
  select(targets[0]!.id);

  const onClick = (event: Event): void => {
    const link = event.currentTarget;
    if (link instanceof HTMLAnchorElement && link.dataset.sectionLink) {
      select(link.dataset.sectionLink);
    }
  };
  for (const link of links) link.addEventListener('click', onClick);

  const observer = createObserver((entries) => {
    const winner = entries
      .filter((entry) => entry.isIntersecting)
      .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
    if (winner?.target instanceof HTMLElement) {
      select(winner.target.id);
    }
  });
  for (const target of targets) observer.observe(target);

  return () => {
    observer.disconnect();
    for (const link of links) link.removeEventListener('click', onClick);
  };
}
~~~

- [ ] **Step 4: Wire navigation once in the options entrypoint**

Import the module in entrypoints/options/main.ts:

~~~ts
import { initializeOptionsNavigation } from '../../src/ui/options-navigation';
~~~

After showExtensionVersion() inside startOptions(), initialize it and arrange cleanup:

~~~ts
const disposeNavigation = initializeOptionsNavigation(document);
window.addEventListener('pagehide', disposeNavigation, { once: true });
~~~

Do not insert an await before initializeOptionsController() or before any existing permission event handler.

- [ ] **Step 5: Add a dependency-boundary assertion**

In tests/unit/options-dependencies.test.ts add:

~~~ts
it('keeps section observation outside the settings controller', async () => {
  const controller = await readFile(
    resolve(process.cwd(), 'src/ui/options-controller.ts'),
    'utf8',
  );
  const entrypoint = await readFile(
    resolve(process.cwd(), 'entrypoints/options/main.ts'),
    'utf8',
  );

  expect(controller).not.toMatch(/IntersectionObserver/);
  expect(entrypoint).toMatch(/initializeOptionsNavigation/);
});
~~~

- [ ] **Step 6: Run the tests and verify GREEN**

Run:

~~~bash
pnpm vitest run tests/unit/options-navigation.test.ts tests/unit/options-dependencies.test.ts
pnpm typecheck
~~~

Expected: all tests pass and TypeScript exits 0.

- [ ] **Step 7: Commit**

~~~bash
git add src/ui/options-navigation.ts entrypoints/options/main.ts tests/unit/options-navigation.test.ts tests/unit/options-dependencies.test.ts
git diff --cached --check
git commit -m "feat(options): track active settings section"
~~~

---

### Task 5: Implement the responsive high-density console presentation

**Files:**
- Modify: tests/e2e/extension.spec.ts
- Modify: entrypoints/options/style.css

**Interfaces:**
- Consumes: the Task 2 shell classes and Task 3 rule-row classes.
- Produces: sticky desktop app bar and navigation, two-column desktop console, compact rule rows, top horizontal navigation below 768px, 44px touch targets, and zero page-level horizontal overflow.

- [ ] **Step 1: Write the failing responsive geometry test**

Add this test after the packaged-shell E2E test:

~~~ts
test('lays out the console without narrow-screen overflow', async ({ extension }) => {
  const options = await extension.openExtensionPage('options.html', true);
  await expect(options.locator('#status')).toContainText('设置已加载');

  await options.setViewportSize({ width: 1440, height: 900 });
  const appBarPosition = await options.locator('.app-bar').evaluate(
    (element) => getComputedStyle(element).position,
  );
  const navigationPosition = await options.locator('.section-nav').evaluate(
    (element) => getComputedStyle(element).position,
  );
  const desktopNav = await options.locator('.section-nav').boundingBox();
  const desktopWorkspace = await options.locator('.workspace').boundingBox();
  expect(appBarPosition).toBe('sticky');
  expect(navigationPosition).toBe('sticky');
  expect(desktopNav).not.toBeNull();
  expect(desktopWorkspace).not.toBeNull();
  expect(desktopWorkspace!.x).toBeGreaterThan(desktopNav!.x + desktopNav!.width);

  await options.setViewportSize({ width: 1024, height: 900 });
  expect(await options.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )).toBe(false);

  await options.setViewportSize({ width: 700, height: 900 });
  const narrowGeometry = await options.evaluate(() => {
    const nav = document.querySelector('.section-nav')!.getBoundingClientRect();
    const workspace = document.querySelector('.workspace')!.getBoundingClientRect();
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
});
~~~

- [ ] **Step 2: Run the test and verify RED**

Run:

~~~bash
pnpm build
pnpm exec playwright test --grep "lays out the console without narrow-screen overflow"
~~~

Expected: FAIL because the old stylesheet does not style the new shell and still imposes a 720px body minimum width.

- [ ] **Step 3: Replace the stylesheet with the console design**

Replace entrypoints/options/style.css completely with:

~~~css
:root {
  color: #1b1916;
  background: #eeeae1;
  font-family: "Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-synthesis: none;
  --ink: #1b1916;
  --muted: #6e685f;
  --paper: #fbf9f4;
  --surface: #f4f0e7;
  --line: #d3ccc0;
  --line-strong: #aaa194;
  --red: #a51c30;
  --red-dark: #751221;
  --red-wash: #f4e3e5;
  --green: #246344;
  --green-wash: #e1eee6;
  --amber: #7b5414;
  --amber-wash: #f6ead0;
  --shadow: 0 16px 42px rgba(36, 29, 22, 0.08);
  --app-bar-height: 72px;
}

* {
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
  scroll-padding-top: calc(var(--app-bar-height) + 42px);
}

body {
  min-width: 0;
  margin: 0;
  background:
    linear-gradient(rgba(165, 28, 48, 0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(165, 28, 48, 0.035) 1px, transparent 1px),
    #eeeae1;
  background-size: 32px 32px;
  color: var(--ink);
}

button,
input {
  font: inherit;
}

button,
input[type="checkbox"] {
  cursor: pointer;
}

button:disabled,
input:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

button:focus-visible,
input:focus-visible,
a:focus-visible {
  outline: 3px solid #176a86;
  outline-offset: 3px;
}

.app-bar {
  position: sticky;
  z-index: 20;
  top: 0;
  display: flex;
  min-height: var(--app-bar-height);
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 12px clamp(20px, 4vw, 56px);
  border-bottom: 1px solid #332e29;
  background: rgba(27, 25, 22, 0.97);
  color: var(--paper);
  box-shadow: 0 8px 26px rgba(20, 16, 13, 0.14);
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  color: inherit;
  text-decoration: none;
}

.brand__mark {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.7);
  border-bottom: 6px solid #cf334a;
  font-family: Georgia, "Songti SC", serif;
  font-size: 22px;
  font-weight: 700;
}

.brand__copy {
  display: grid;
  gap: 2px;
}

.brand__copy strong {
  font-size: 17px;
  letter-spacing: 0.01em;
}

.brand__copy span {
  color: #bcb5ab;
  font-size: 11px;
  letter-spacing: 0.08em;
}

.app-bar__meta {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 11px;
}

.version-chip,
.privacy-chip,
.master-state {
  min-height: 28px;
  padding: 6px 9px;
  border: 1px solid #5b554e;
  border-radius: 999px;
  white-space: nowrap;
}

.privacy-chip {
  color: #c9c2b8;
}

.master-state[data-tone="success"] {
  border-color: #4b8768;
  background: #173d2a;
  color: #bce3ca;
}

.master-state[data-tone="muted"] {
  color: #d0c8bd;
}

.status-bar {
  display: grid;
  grid-template-columns: 210px 12px minmax(0, 1fr);
  gap: 8px;
  min-height: 42px;
  padding: 9px clamp(20px, 4vw, 56px);
  border-bottom: 1px solid var(--line-strong);
  background: var(--paper);
  font-size: 13px;
}

.status-bar__signal {
  color: #8f877c;
}

.status-bar:has(#status[data-tone="success"]) .status-bar__signal {
  color: var(--green);
}

.status-bar:has(#status[data-tone="error"]) .status-bar__signal {
  color: var(--red);
}

.status-bar__label {
  color: var(--muted);
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

#status {
  margin: 0;
}

#status[data-tone="success"] {
  color: var(--green);
}

#status[data-tone="error"] {
  color: var(--red-dark);
  font-weight: 700;
}

.console-layout {
  display: grid;
  grid-template-columns: 210px minmax(0, 1fr);
  gap: clamp(28px, 4vw, 64px);
  width: min(100%, 1480px);
  margin: 0 auto;
  padding: 38px clamp(20px, 4vw, 56px) 84px;
}

.section-nav {
  position: sticky;
  top: calc(var(--app-bar-height) + 64px);
  align-self: start;
  display: grid;
  gap: 4px;
}

.section-nav__eyebrow,
.section-nav__foot,
.section-index,
.page-footer {
  font-family: "SFMono-Regular", Consolas, monospace;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.section-nav__eyebrow {
  margin: 0 0 12px;
  color: var(--red);
  font-size: 11px;
  font-weight: 800;
}

.section-nav a {
  display: grid;
  grid-template-columns: 30px 1fr;
  align-items: center;
  min-height: 44px;
  padding: 9px 12px;
  border-left: 3px solid transparent;
  color: #49443e;
  text-decoration: none;
  transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease;
}

.section-nav a span {
  color: #948c81;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 10px;
}

.section-nav a:hover {
  background: rgba(255, 255, 255, 0.6);
  color: var(--ink);
}

.section-nav a[aria-current="location"] {
  border-left-color: var(--red);
  background: var(--paper);
  color: var(--red-dark);
  font-weight: 700;
  box-shadow: 0 5px 16px rgba(36, 29, 22, 0.05);
}

.section-nav__foot {
  margin: 24px 12px 0;
  color: #8a8378;
  font-size: 9px;
  line-height: 1.6;
}

.workspace {
  min-width: 0;
}

.console-section {
  scroll-margin-top: calc(var(--app-bar-height) + 58px);
  margin: 0 0 70px;
}

.section-heading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 32px;
  margin-bottom: 20px;
  padding-bottom: 15px;
  border-bottom: 1px solid var(--line-strong);
}

.section-heading > div {
  min-width: 210px;
}

.section-index {
  margin: 0 0 7px;
  color: var(--red);
  font-size: 10px;
  font-weight: 800;
}

h1,
h2 {
  margin: 0;
  font-size: clamp(25px, 3vw, 38px);
  line-height: 1.08;
  letter-spacing: -0.035em;
}

.section-heading > p {
  max-width: 560px;
  margin: 0;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.65;
  text-align: right;
}

.control-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

fieldset {
  min-width: 0;
  margin: 0;
  border: 0;
}

.control-panel,
.rule-groups > fieldset,
.custom-form,
.rule-list .rule-row,
.excluded-row {
  border: 1px solid var(--line);
  background: var(--paper);
  box-shadow: var(--shadow);
}

.control-panel {
  padding: 22px;
}

.control-panel--primary {
  border-top: 4px solid var(--red);
}

legend {
  padding: 0 8px;
  font-weight: 750;
}

.switch-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 22px;
  align-items: start;
}

.switch-row label,
.custom-form > label {
  font-weight: 750;
}

.switch-row p,
.group-description,
.rule-row__description,
.rule-lock-reason,
.form-help,
.form-error,
.empty-state {
  color: var(--muted);
  line-height: 1.55;
}

.switch-row p {
  margin: 7px 0 0;
  font-size: 13px;
}

input[type="checkbox"] {
  width: 22px;
  height: 22px;
  margin: 0;
  accent-color: var(--red);
}

.rule-groups {
  display: grid;
  gap: 14px;
}

.rule-groups > fieldset {
  padding: 0;
  overflow: hidden;
}

.rule-groups > fieldset > legend {
  float: left;
  width: 210px;
  padding: 18px 20px 8px;
  font-size: 15px;
}

.group-description {
  min-height: 58px;
  margin: 0;
  padding: 18px 20px 12px 230px;
  border-bottom: 1px solid var(--line);
  font-size: 12px;
}

.rule-row {
  position: relative;
  display: grid;
  grid-template-columns: minmax(180px, 1.1fr) minmax(200px, 1.5fr) minmax(160px, 1fr) 82px auto;
  gap: 18px;
  align-items: center;
  min-height: 68px;
  padding: 13px 18px;
  border-bottom: 1px solid var(--line);
}

.rule-row:last-child {
  border-bottom: 0;
}

.rule-row__lead {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 11px;
}

.rule-row__lead label {
  overflow: hidden;
  font-size: 13px;
  font-weight: 750;
  text-overflow: ellipsis;
}

.rule-row__description {
  margin: 0;
  font-size: 12px;
}

.rule-row__range {
  overflow-wrap: anywhere;
  color: #5e2830;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 11px;
}

.rule-state {
  justify-self: end;
  padding: 5px 8px;
  border-radius: 999px;
  background: var(--surface);
  color: var(--muted);
  font-size: 10px;
  font-weight: 800;
  white-space: nowrap;
}

.rule-row[data-state="enabled"] .rule-state {
  background: var(--green-wash);
  color: var(--green);
}

.rule-row[data-state="error"] .rule-state {
  background: var(--red-wash);
  color: var(--red-dark);
}

.rule-row[data-state="locked"] .rule-state {
  background: var(--amber-wash);
  color: var(--amber);
}

.rule-validation-error,
.rule-lock-reason {
  grid-column: 2 / -1;
  margin: -6px 0 3px;
  font-size: 11px;
}

.rule-validation-error {
  color: var(--red-dark);
  font-weight: 700;
}

.custom-form {
  padding: 22px;
  border-left: 5px solid var(--red);
}

.custom-form__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  margin-top: 9px;
}

input[type="text"] {
  width: 100%;
  min-height: 44px;
  padding: 9px 12px;
  border: 1px solid var(--line-strong);
  border-radius: 2px;
  background: #fffefa;
}

button {
  min-height: 44px;
  padding: 9px 15px;
  border: 1px solid var(--ink);
  border-radius: 2px;
  background: var(--ink);
  color: var(--paper);
  font-weight: 750;
}

button:hover:not(:disabled) {
  border-color: var(--red-dark);
  background: var(--red-dark);
}

.danger-button {
  justify-self: end;
  min-height: 36px;
  padding: 6px 10px;
  border-color: var(--red);
  background: transparent;
  color: var(--red-dark);
  font-size: 11px;
}

.rule-list,
.excluded-list {
  display: grid;
  gap: 10px;
  margin-top: 14px;
}

.rule-list .rule-row {
  border-bottom: 1px solid var(--line);
}

.excluded-row {
  display: flex;
  min-height: 60px;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 10px 16px;
}

.excluded-row code {
  overflow-wrap: anywhere;
  color: var(--red-dark);
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 12px;
}

.form-help,
.form-error {
  margin: 8px 0 0;
  font-size: 12px;
}

.form-error {
  color: var(--red-dark);
  font-weight: 700;
}

.empty-state {
  margin: 0;
  padding: 22px;
  background: rgba(251, 249, 244, 0.72);
  text-align: center;
}

.page-footer {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  padding: 24px clamp(20px, 4vw, 56px) 36px;
  border-top: 1px solid var(--line-strong);
  color: var(--muted);
  font-size: 9px;
}

@media (max-width: 1040px) {
  .rule-row {
    grid-template-columns: minmax(170px, 1fr) minmax(180px, 1.2fr) 72px auto;
  }

  .rule-state {
    grid-column: 3;
    grid-row: 1;
  }

  .danger-button {
    grid-column: 4;
    grid-row: 1;
  }

  .rule-row__range {
    grid-column: 2 / 3;
  }

  .rule-row__description {
    grid-column: 2 / 3;
  }
}

@media (max-width: 768px) {
  :root {
    --app-bar-height: 64px;
  }

  .app-bar {
    gap: 12px;
    padding-block: 9px;
  }

  .brand__copy span,
  .privacy-chip {
    display: none;
  }

  .status-bar {
    grid-template-columns: 12px minmax(0, 1fr);
    gap: 3px;
  }

  .status-bar__label {
    grid-column: 1 / -1;
  }

  .console-layout {
    grid-template-columns: 1fr;
    gap: 22px;
    padding-top: 20px;
  }

  .section-nav {
    top: var(--app-bar-height);
    z-index: 15;
    display: flex;
    width: 100%;
    gap: 2px;
    overflow-x: auto;
    padding: 6px;
    border: 1px solid var(--line);
    background: rgba(251, 249, 244, 0.96);
    box-shadow: 0 8px 20px rgba(36, 29, 22, 0.08);
  }

  .section-nav__eyebrow,
  .section-nav__foot {
    display: none;
  }

  .section-nav a {
    flex: 1 0 auto;
    grid-template-columns: auto;
    min-width: 108px;
    border: 0;
    border-bottom: 3px solid transparent;
    text-align: center;
  }

  .section-nav a span {
    display: none;
  }

  .section-nav a[aria-current="location"] {
    border-bottom-color: var(--red);
  }

  .section-heading {
    display: grid;
    gap: 10px;
  }

  .section-heading > p {
    text-align: left;
  }

  .control-grid {
    grid-template-columns: 1fr;
  }

  .rule-groups > fieldset > legend {
    float: none;
    display: block;
    width: auto;
    padding-bottom: 4px;
  }

  .group-description {
    min-height: 0;
    padding: 4px 20px 15px;
  }

  .rule-row {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px 14px;
    padding: 14px;
  }

  .rule-row__lead,
  .rule-row__description,
  .rule-row__range,
  .rule-validation-error,
  .rule-lock-reason {
    grid-column: 1 / -1;
  }

  .rule-state,
  .danger-button {
    grid-column: 2;
    grid-row: 1;
  }

  .rule-row:has(.danger-button) .rule-state {
    justify-self: start;
    grid-column: 1;
    grid-row: auto;
  }

  .rule-row:has(.danger-button) .danger-button {
    grid-row: auto;
  }

  .custom-form__row {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 520px) {
  .brand__copy strong {
    font-size: 14px;
  }

  .version-chip {
    display: none;
  }

  .app-bar__meta {
    min-width: 0;
  }

  .section-nav a {
    min-width: 94px;
  }

  .page-footer {
    display: grid;
  }
}

@media (prefers-reduced-motion: reduce) {
  html {
    scroll-behavior: auto;
  }

  *,
  *::before,
  *::after {
    transition-duration: 0.01ms !important;
  }
}
~~~

- [ ] **Step 4: Run the focused E2E and verify GREEN**

Run:

~~~bash
pnpm build
pnpm exec playwright test --grep "renders the packaged compact console shell|lays out the console without narrow-screen overflow|loads the packaged options artifact"
~~~

Expected: all selected options E2E tests pass with no console or page errors.

- [ ] **Step 5: Run unit and type checks**

Run:

~~~bash
pnpm typecheck
pnpm vitest run tests/unit/options-controller.test.ts tests/unit/options-navigation.test.ts tests/unit/options-dependencies.test.ts
~~~

Expected: TypeScript exits 0 and all selected unit tests pass.

- [ ] **Step 6: Commit**

~~~bash
git add entrypoints/options/style.css tests/e2e/extension.spec.ts
git diff --cached --check
git commit -m "feat(options): style responsive rule console"
~~~

---

### Task 6: Update documentation and run the complete release-quality verification

**Files:**
- Modify: README.md

**Interfaces:**
- Consumes: the finished independent-tab console.
- Produces: current user-facing documentation and fresh full-suite evidence.

- [ ] **Step 1: Update the stale UI limitation**

In README.md, replace:

~~~md
首版 UI 只保证功能清楚可用，视觉设计将在功能稳定后重做。
~~~

with:

~~~md
设置控制台会在独立标签页中打开，并使用紧凑规则列表管理全局状态、可选权限、自定义规则和暂停站点；扩展弹窗仍只负责当前标签页的快捷操作。
~~~

- [ ] **Step 2: Run the full verification gate**

Run:

~~~bash
pnpm verify
pnpm test:e2e
pnpm zip
unzip -t .output/cqu-link-fix-0.1.1-chrome.zip
git diff --check
~~~

Expected:

- pnpm verify exits 0 after typecheck, the complete Vitest suite, and WXT build.
- pnpm test:e2e reports all automatic loaded-extension tests passing.
- pnpm zip exits 0 and writes .output/cqu-link-fix-0.1.1-chrome.zip.
- unzip reports no errors in the compressed data.
- git diff --check prints no output.

- [ ] **Step 3: Inspect the built Manifest and responsive page one final time**

Run:

~~~bash
node -e "const m=require('./.output/chrome-mv3/manifest.json'); if(m.options_ui?.open_in_tab!==true) process.exit(1); console.log(m.options_ui)"
pnpm exec playwright test --grep "packages options as a dedicated browser tab|renders the packaged compact console shell|lays out the console without narrow-screen overflow"
~~~

Expected: the Node command prints the options_ui object with open_in_tab true and all three focused E2E tests pass.

- [ ] **Step 4: Review the final diff against the design**

Run:

~~~bash
git status --short
git diff --stat HEAD
git diff HEAD -- entrypoints/options src/ui/options-renderer.ts src/ui/options-navigation.ts tests README.md
~~~

Confirm:

- no URL rewrite, storage, DNR, permission, or background protocol file changed;
- permission requests remain in the existing controller/custom-rule synchronous gesture path;
- .DS_Store is still untracked and unstaged;
- no remote assets or new dependency were added;
- every design completion condition maps to a passing test or the responsive geometry check.

- [ ] **Step 5: Commit the documentation**

~~~bash
git add README.md
git diff --cached --check
git commit -m "docs(options): describe dedicated settings console"
~~~

- [ ] **Step 6: Record final handoff evidence**

Run:

~~~bash
git status --short
git log -6 --oneline --decorate
~~~

Expected: only the pre-existing untracked .DS_Store remains; the six implementation and documentation commits are visible, with the approved design and plan commits earlier in history.
