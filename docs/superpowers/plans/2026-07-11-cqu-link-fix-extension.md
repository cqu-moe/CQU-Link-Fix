# CQU Link Fix Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chromium Manifest V3 extension that safely rewrites selected Chongqing University navigations through aTrust, preserves CAS client callbacks, fixes Youth League article links, and gives users local, reversible rule controls.

**Architecture:** A pure TypeScript rule core owns URL parsing and transformations. WXT packages a Manifest V3 background service worker, popup, and options page; `declarativeNetRequest` performs request-time exact redirects, while `webNavigation` handles the optional algorithmic all-CQU mode. Built-in rules and local settings compile into dynamic DNR rules, and session rules implement one-time bypasses.

**Tech Stack:** TypeScript, WXT (vanilla entrypoints), Chrome Manifest V3 APIs, pnpm, Vitest with WXT fake browser, Happy DOM, Playwright.

## Global Constraints

- Target Chromium Manifest V3 only; Firefox is outside the first release.
- Do not modify the `auth.cqu.moe` server-side CAS automation; it is a separate future project.
- Use vanilla DOM for popup and options; do not add React, Vue, or another UI framework.
- Handle top-level `http:` and `https:` navigations only; do not rewrite iframe, fetch, XHR, WebSocket, or request bodies.
- `sso.cqu.edu.cn` is enabled by default and rewrites to `sso-cqu-edu-cn-s.atrust.cqu.edu.cn` over HTTPS.
- Never alter the decoded value of CAS `service`, OAuth `redirect_uri`, or `state` parameters.
- Youth League links rewrite from `/info/{tree}/{id}.htm` to the public `content.jsp` form.
- Arbitrary IP rewriting is forbidden; only complete, explicitly registered IPv4 + port rules may use the `-p` transform.
- The all-`*.cqu.edu.cn` mode is disabled by default and requests optional host access only when enabled.
- Store settings and custom endpoints in `chrome.storage.local`; do not add remote rules, telemetry, history reads, credential reads, or `<all_urls>` as a required permission.
- UI is a functional prototype. Correctness, explainability, and reversibility take precedence over visual polish.
- Follow test-first red-green-refactor for each behavior task and use Conventional Commits.

---

## File Map

```text
package.json                         Project scripts and dependencies
pnpm-lock.yaml                      Reproducible dependency graph
.gitignore                          Generated WXT and test artifacts
tsconfig.json                       TypeScript configuration
wxt.config.ts                       Manifest metadata and permissions
vitest.config.ts                    WXT-aware unit test configuration
playwright.config.ts                Built-extension E2E configuration
entrypoints/background.ts           Background startup and event wiring
entrypoints/popup/index.html         Popup document
entrypoints/popup/main.ts            Popup controller
entrypoints/popup/style.css          Functional popup styles
entrypoints/options/index.html       Options document
entrypoints/options/main.ts          Options controller
entrypoints/options/style.css        Functional options styles
src/meta.ts                          Shared extension metadata
src/rules/types.ts                   Rule, setting, and decision contracts
src/rules/transform.ts               Pure URL transformers and invariants
src/rules/builtins.ts                Versioned built-in rule registry
src/rules/registry.ts                Merge built-ins with local settings
src/rules/dnr.ts                     Compile enabled rules to DNR rules
src/storage/settings.ts              Local settings schema and persistence
src/background/navigation.ts         All-CQU navigation fallback
src/background/session.ts            Explanation and one-time bypass state
src/messages.ts                      Typed popup/options background messages
src/ui/popup-model.ts                Pure popup view-model builder
src/ui/custom-rule.ts                Custom-rule parsing and validation
tests/unit/*.test.ts                 Pure and fake-browser unit tests
tests/e2e/extension.spec.ts          Loaded-extension redirect tests
docs/validation/live-smoke.md        Campus/off-campus validation record
README.md                            Installation, behavior, and privacy docs
```

---

### Task 1: Scaffold the WXT Manifest V3 Project

**Files:**
- Create: `package.json`
- Create: `pnpm-lock.yaml`
- Create: `tsconfig.json`
- Create: `wxt.config.ts`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Modify: `.gitignore`
- Create: `src/meta.ts`
- Create: `entrypoints/background.ts`
- Test: `tests/unit/meta.test.ts`

**Interfaces:**
- Produces: `EXTENSION_NAME`, `EXTENSION_VERSION`, and a buildable WXT project.
- Consumes: none.

- [ ] **Step 1: Create the package manifest and install the minimal toolchain**

Create `package.json`:

```json
{
  "name": "cqu-link-fix",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wxt",
    "build": "wxt build",
    "zip": "wxt zip",
    "typecheck": "wxt prepare && tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "pnpm build && playwright test",
    "verify": "pnpm typecheck && pnpm test && pnpm build"
  }
}
```

Run:

```bash
pnpm add -D wxt typescript vitest @vitest/coverage-v8 @playwright/test @types/chrome happy-dom
```

Expected: dependencies and `pnpm-lock.yaml` are created without peer-dependency errors.

Append these generated paths to `.gitignore`:

```gitignore
.output/
.wxt/
playwright-report/
test-results/
```

- [ ] **Step 2: Write the failing metadata smoke test**

Create `tests/unit/meta.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EXTENSION_NAME, EXTENSION_VERSION } from '../../src/meta';

describe('extension metadata', () => {
  it('exposes stable initial metadata', () => {
    expect(EXTENSION_NAME).toBe('CQU Link Fix');
    expect(EXTENSION_VERSION).toBe('0.1.0');
  });
});
```

- [ ] **Step 3: Run the test and verify red**

Run: `pnpm test -- tests/unit/meta.test.ts`

Expected: FAIL because `src/meta.ts` does not exist.

- [ ] **Step 4: Add the minimal configuration and background entrypoint**

Create `src/meta.ts`:

```ts
export const EXTENSION_NAME = 'CQU Link Fix';
export const EXTENSION_VERSION = '0.1.0';
```

Create `wxt.config.ts`:

```ts
import { defineConfig } from 'wxt';
import { EXTENSION_NAME, EXTENSION_VERSION } from './src/meta';

export default defineConfig({
  manifestVersion: 3,
  manifest: {
    name: EXTENSION_NAME,
    version: EXTENSION_VERSION,
    description: 'Rewrite and repair Chongqing University links.',
    permissions: ['storage'],
  },
});
```

Create `tsconfig.json`:

```json
{
  "extends": "./.wxt/tsconfig.json",
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  }
}
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  test: { environment: 'happy-dom', restoreMocks: true },
});
```

Create `playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  use: { trace: 'retain-on-failure' },
});
```

Create `entrypoints/background.ts`:

```ts
export default defineBackground(() => {
  console.info('CQU Link Fix background ready');
});
```

- [ ] **Step 5: Verify green and build output**

Run: `pnpm test -- tests/unit/meta.test.ts && pnpm typecheck && pnpm build`

Expected: one passing test; typecheck exits 0; `.output/chrome-mv3/manifest.json` and the background bundle exist.

- [ ] **Step 6: Commit the scaffold**

```bash
git add .gitignore package.json pnpm-lock.yaml tsconfig.json wxt.config.ts vitest.config.ts playwright.config.ts src/meta.ts entrypoints/background.ts tests/unit/meta.test.ts
git commit -m "chore: scaffold WXT extension"
```

---

### Task 2: Implement the Pure URL Transformation Core

**Files:**
- Create: `src/rules/types.ts`
- Create: `src/rules/transform.ts`
- Test: `tests/unit/transform.test.ts`

**Interfaces:**
- Produces: `toAtrustDomainUrl(input)`, `toAtrustIpPortUrl(input)`, `toYouthPublicUrl(input)`, `applyTransformer(transformer, input)`, `isAtrustUrl(input)`, `isCquDomain(input)`, and `assertCasServicePreserved(before, after)`.
- Consumes: none.

- [ ] **Step 1: Define the shared contracts**

Create `src/rules/types.ts`:

```ts
export type RuleCategory = 'core' | 'important' | 'ip' | 'addon' | 'custom';
export type Transformer = 'atrust-domain' | 'atrust-ip-port' | 'youth-public';

export type RuleMatcher =
  | { kind: 'host'; host: string }
  | { kind: 'host-port'; host: string; port: number }
  | { kind: 'youth-article'; host: 'youth.cqu.edu.cn' };

export interface RuleDefinition {
  id: string;
  dnrId: number;
  name: string;
  description: string;
  category: RuleCategory;
  defaultEnabled: boolean;
  matcher: RuleMatcher;
  transformer: Transformer;
}

export interface CustomRule extends RuleDefinition {
  category: 'custom';
}

export interface RewriteDecision {
  ruleId: string;
  originalUrl: string;
  targetUrl: string;
}
```

- [ ] **Step 2: Write failing transformer tests**

Create `tests/unit/transform.test.ts` with these exact cases:

```ts
import { describe, expect, it } from 'vitest';
import {
  assertCasServicePreserved,
  isAtrustUrl,
  isCquDomain,
  toAtrustDomainUrl,
  toAtrustIpPortUrl,
  toYouthPublicUrl,
} from '../../src/rules/transform';

describe('aTrust domain transform', () => {
  it('forces HTTPS and preserves the complete suffix', () => {
    const input = 'http://sso.cqu.edu.cn/login?service=https%3A%2F%2Fmy.cqu.edu.cn%2Fcb#login';
    expect(toAtrustDomainUrl(input)).toBe(
      'https://sso-cqu-edu-cn-s.atrust.cqu.edu.cn/login?service=https%3A%2F%2Fmy.cqu.edu.cn%2Fcb#login',
    );
  });

  it('refuses to rewrite an aTrust hostname twice', () => {
    expect(() => toAtrustDomainUrl('https://sso-cqu-edu-cn-s.atrust.cqu.edu.cn/login')).toThrow('already uses aTrust');
  });
});

describe('aTrust IP and port transform', () => {
  it('requires and encodes a complete IPv4 and port', () => {
    expect(toAtrustIpPortUrl('http://1.1.1.1:8000/path?q=1')).toBe(
      'https://1-1-1-1-8000-p.atrust.cqu.edu.cn/path?q=1',
    );
  });

  it.each(['http://1.1.1.1/path', 'http://[::1]:8000/path', 'ftp://1.1.1.1:8000/path'])(
    'rejects unsupported input %s',
    (input) => expect(() => toAtrustIpPortUrl(input)).toThrow(),
  );
});

describe('Youth League transform', () => {
  it('builds the public content.jsp address and preserves the fragment', () => {
    expect(toYouthPublicUrl('https://youth.cqu.edu.cn/info/1009/24264.htm#print')).toBe(
      'https://youth.cqu.edu.cn/content.jsp?urltype=news.NewsContentUrl&wbtreeid=1009&wbnewsid=24264#print',
    );
  });
});

describe('invariants', () => {
  it('recognizes aTrust and CQU hosts', () => {
    expect(isAtrustUrl('https://x-s.atrust.cqu.edu.cn/')).toBe(true);
    expect(isCquDomain('https://foo.cqu.edu.cn/')).toBe(true);
  });

  it('accepts an unchanged decoded CAS service', () => {
    const before = 'https://sso.cqu.edu.cn/login?service=https%3A%2F%2Fmy.cqu.edu.cn%2Fcb%3Fa%3D1';
    const after = toAtrustDomainUrl(before);
    expect(() => assertCasServicePreserved(before, after)).not.toThrow();
  });
});
```

- [ ] **Step 3: Run tests and verify red**

Run: `pnpm test -- tests/unit/transform.test.ts`

Expected: FAIL because `src/rules/transform.ts` is missing.

- [ ] **Step 4: Implement the transformers**

Create `src/rules/transform.ts`:

```ts
import type { Transformer } from './types';

const HTTP_PROTOCOLS = new Set(['http:', 'https:']);
const ATRUST_SUFFIX = '.atrust.cqu.edu.cn';
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;

function parseHttpUrl(input: string): URL {
  const url = new URL(input);
  if (!HTTP_PROTOCOLS.has(url.protocol) || url.username || url.password) {
    throw new Error('unsupported URL');
  }
  return url;
}

export function isAtrustUrl(input: string): boolean {
  return parseHttpUrl(input).hostname.toLowerCase().endsWith(ATRUST_SUFFIX);
}

export function isCquDomain(input: string): boolean {
  const host = parseHttpUrl(input).hostname.toLowerCase();
  return host === 'cqu.edu.cn' || host.endsWith('.cqu.edu.cn');
}

export function toAtrustDomainUrl(input: string): string {
  const url = parseHttpUrl(input);
  if (url.hostname.toLowerCase().endsWith(ATRUST_SUFFIX)) throw new Error('URL already uses aTrust');
  if (url.port) throw new Error('domain transform does not accept a non-default port');
  url.protocol = 'https:';
  url.hostname = `${url.hostname.toLowerCase().replaceAll('.', '-')}-s.atrust.cqu.edu.cn`;
  return url.toString();
}

export function toAtrustIpPortUrl(input: string): string {
  const url = parseHttpUrl(input);
  if (!IPV4.test(url.hostname) || !url.port) throw new Error('complete IPv4 and port required');
  const octets = url.hostname.split('.').map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) throw new Error('invalid IPv4');
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid port');
  url.protocol = 'https:';
  url.hostname = `${url.hostname.replaceAll('.', '-')}-${port}-p.atrust.cqu.edu.cn`;
  url.port = '';
  return url.toString();
}

export function toYouthPublicUrl(input: string): string {
  const url = parseHttpUrl(input);
  if (url.hostname.toLowerCase() !== 'youth.cqu.edu.cn') throw new Error('not a Youth League URL');
  const match = /^\/info\/(\d+)\/(\d+)\.htm$/.exec(url.pathname);
  if (!match) throw new Error('not a Youth League article');
  const [, wbtreeid, wbnewsid] = match;
  url.pathname = '/content.jsp';
  url.search = new URLSearchParams({
    urltype: 'news.NewsContentUrl',
    wbtreeid: wbtreeid!,
    wbnewsid: wbnewsid!,
  }).toString();
  return url.toString();
}

export function assertCasServicePreserved(before: string, after: string): void {
  const beforeService = parseHttpUrl(before).searchParams.get('service');
  const afterService = parseHttpUrl(after).searchParams.get('service');
  if (beforeService !== afterService) throw new Error('CAS service changed during rewrite');
}

export function applyTransformer(transformer: Transformer, input: string): string {
  if (transformer === 'atrust-domain') return toAtrustDomainUrl(input);
  if (transformer === 'atrust-ip-port') return toAtrustIpPortUrl(input);
  return toYouthPublicUrl(input);
}
```

- [ ] **Step 5: Verify green and add property-style edge cases**

Run: `pnpm test -- tests/unit/transform.test.ts`

Expected: all transformer tests pass.

Append these exact cases to `tests/unit/transform.test.ts`:

```ts
it.each([
  ['https://SSO.CQU.EDU.CN', 'https://sso-cqu-edu-cn-s.atrust.cqu.edu.cn/'],
  ['https://sso.cqu.edu.cn/?a=1&b=two', 'https://sso-cqu-edu-cn-s.atrust.cqu.edu.cn/?a=1&b=two'],
  [
    'https://sso.cqu.edu.cn/login?service=https%3A%2F%2Fx.cqu.edu.cn%2Fcb%3Fa%3D1%26b%3D2#x',
    'https://sso-cqu-edu-cn-s.atrust.cqu.edu.cn/login?service=https%3A%2F%2Fx.cqu.edu.cn%2Fcb%3Fa%3D1%26b%3D2#x',
  ],
])('rewrites %s without losing URL components', (input, expected) => {
  expect(toAtrustDomainUrl(input)).toBe(expected);
});
```

Rerun the same command and expect all cases to pass.

- [ ] **Step 6: Commit the rule core**

```bash
git add src/rules/types.ts src/rules/transform.ts tests/unit/transform.test.ts
git commit -m "feat(rules): add URL transformation core"
```

---

### Task 3: Add Built-In Rules and Local Settings

**Files:**
- Create: `src/rules/builtins.ts`
- Create: `src/rules/registry.ts`
- Create: `src/storage/settings.ts`
- Test: `tests/unit/registry.test.ts`
- Test: `tests/unit/settings.test.ts`

**Interfaces:**
- Consumes: `RuleDefinition`, `CustomRule` from Task 2.
- Produces: `BUILT_IN_RULES`, `DEFAULT_SETTINGS`, `loadSettings()`, `saveSettings(next)`, `getEnabledRules(settings)`, and `decideRegisteredRewrite(input, rules)`.

- [ ] **Step 1: Write failing registry and persistence tests**

Create `tests/unit/registry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BUILT_IN_RULES } from '../../src/rules/builtins';
import { getEnabledRules } from '../../src/rules/registry';
import { DEFAULT_SETTINGS } from '../../src/storage/settings';

describe('rule registry', () => {
  it('ships stable default built-ins', () => {
    expect(BUILT_IN_RULES.map((rule) => rule.id)).toEqual(['core-sso', 'addon-youth-public']);
    expect(getEnabledRules(DEFAULT_SETTINGS).map((rule) => rule.id)).toEqual(['core-sso', 'addon-youth-public']);
  });

  it('honors a disabled built-in', () => {
    const settings = { ...DEFAULT_SETTINGS, disabledBuiltInRuleIds: ['core-sso'] };
    expect(getEnabledRules(settings).map((rule) => rule.id)).toEqual(['addon-youth-public']);
  });
});
```

Create `tests/unit/settings.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../../src/storage/settings';

describe('settings storage', () => {
  beforeEach(() => fakeBrowser.reset());

  it('round-trips settings through local storage', async () => {
    const next = { ...DEFAULT_SETTINGS, enableAllCquDomains: true };
    await saveSettings(next);
    expect(await loadSettings()).toEqual(next);
  });
});
```

- [ ] **Step 2: Run tests and verify red**

Run: `pnpm test -- tests/unit/registry.test.ts tests/unit/settings.test.ts`

Expected: FAIL because registry and storage modules are missing.

- [ ] **Step 3: Implement built-ins and settings**

Create `src/rules/builtins.ts` with stable numeric DNR IDs:

```ts
import type { RuleDefinition } from './types';

export const BUILT_IN_RULES: readonly RuleDefinition[] = [
  {
    id: 'core-sso', dnrId: 1001, name: '统一身份认证',
    description: '通过 aTrust 打开统一身份认证入口',
    category: 'core', defaultEnabled: true,
    matcher: { kind: 'host', host: 'sso.cqu.edu.cn' },
    transformer: 'atrust-domain',
  },
  {
    id: 'addon-youth-public', dnrId: 2001, name: '团委公网链接',
    description: '将 /info 文章转换为 content.jsp 公网链接',
    category: 'addon', defaultEnabled: true,
    matcher: { kind: 'youth-article', host: 'youth.cqu.edu.cn' },
    transformer: 'youth-public',
  },
] as const;
```

Define `ExtensionSettings` in `src/storage/settings.ts`:

```ts
import type { CustomRule } from '../rules/types';

export interface ExtensionSettings {
  enabled: boolean;
  enableAllCquDomains: boolean;
  disabledBuiltInRuleIds: string[];
  customRules: CustomRule[];
  excludedHosts: string[];
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  enabled: true,
  enableAllCquDomains: false,
  disabledBuiltInRuleIds: [],
  customRules: [],
  excludedHosts: [],
};

const SETTINGS_KEY = 'settings';

export async function loadSettings(): Promise<ExtensionSettings> {
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] as Partial<ExtensionSettings> | undefined) };
}

export async function saveSettings(next: ExtensionSettings): Promise<void> {
  await browser.storage.local.set({ [SETTINGS_KEY]: next });
}
```

Create `src/rules/registry.ts`:

```ts
import type { ExtensionSettings } from '../storage/settings';
import { assertCasServicePreserved, applyTransformer } from './transform';
import { BUILT_IN_RULES } from './builtins';
import type { RewriteDecision, RuleDefinition } from './types';

export function getEnabledRules(settings: ExtensionSettings): RuleDefinition[] {
  if (!settings.enabled) return [];
  const disabled = new Set(settings.disabledBuiltInRuleIds);
  return [
    ...BUILT_IN_RULES.filter((rule) => rule.defaultEnabled && !disabled.has(rule.id)),
    ...settings.customRules.filter((rule) => !disabled.has(rule.id)),
  ];
}

export function decideRegisteredRewrite(
  input: string,
  rules: readonly RuleDefinition[],
): RewriteDecision | null {
  const url = new URL(input);
  const rule = rules.find((candidate) => {
    const matcher = candidate.matcher;
    if (matcher.kind === 'host') return url.hostname.toLowerCase() === matcher.host;
    if (matcher.kind === 'host-port') {
      return url.hostname === matcher.host && Number(url.port) === matcher.port;
    }
    return url.hostname === matcher.host && /^\/info\/\d+\/\d+\.htm$/.test(url.pathname);
  });
  if (!rule) return null;
  const targetUrl = applyTransformer(rule.transformer, input);
  if (url.hostname.toLowerCase() === 'sso.cqu.edu.cn') assertCasServicePreserved(input, targetUrl);
  return { ruleId: rule.id, originalUrl: input, targetUrl };
}
```

- [ ] **Step 4: Verify registry behavior and storage round-trip**

Run: `pnpm test -- tests/unit/registry.test.ts tests/unit/settings.test.ts`

Expected: all tests pass, including fake-browser reset isolation.

- [ ] **Step 5: Commit registry and settings**

```bash
git add src/rules/builtins.ts src/rules/registry.ts src/storage/settings.ts tests/unit/registry.test.ts tests/unit/settings.test.ts
git commit -m "feat(rules): add built-in registry and local settings"
```

---

### Task 4: Compile and Reconcile Dynamic DNR Rules

**Files:**
- Create: `src/rules/dnr.ts`
- Modify: `wxt.config.ts`
- Modify: `entrypoints/background.ts`
- Test: `tests/unit/dnr.test.ts`

**Interfaces:**
- Consumes: enabled `RuleDefinition[]` and `ExtensionSettings`.
- Produces: `compileDynamicRules(rules, excludedHosts)` and `reconcileDynamicRules()`.

- [ ] **Step 1: Write failing compiler tests**

Assert exact output for SSO and Youth League rules:

```ts
const [sso, youth] = compileDynamicRules(BUILT_IN_RULES, []);
expect(sso.condition.resourceTypes).toEqual(['main_frame']);
expect(sso.action).toEqual({
  type: 'redirect',
  redirect: { regexSubstitution: 'https://sso-cqu-edu-cn-s.atrust.cqu.edu.cn\\1' },
});
expect(youth.action.type).toBe('redirect');
```

Add an exclusion test for `sso.cqu.edu.cn` that expects a higher-priority `allow` rule and a `main_frame` condition.

- [ ] **Step 2: Run tests and verify red**

Run: `pnpm test -- tests/unit/dnr.test.ts`

Expected: FAIL because `compileDynamicRules` is missing.

- [ ] **Step 3: Implement deterministic DNR compilation**

Create `src/rules/dnr.ts` with the complete compiler and reconciler:

```ts
import { loadSettings } from '../storage/settings';
import { getEnabledRules } from './registry';
import type { RuleDefinition } from './types';

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const domainTarget = (host: string) => `${host.replaceAll('.', '-')}-s.atrust.cqu.edu.cn`;

export function compileDynamicRules(
  rules: readonly RuleDefinition[],
  excludedHosts: readonly string[],
): chrome.declarativeNetRequest.Rule[] {
  const redirects = rules.map((rule): chrome.declarativeNetRequest.Rule => {
    if (rule.matcher.kind === 'host') {
      return {
        id: rule.dnrId,
        priority: rule.category === 'custom' ? 30_000 : 10_000,
        action: {
          type: 'redirect',
          redirect: { regexSubstitution: `https://${domainTarget(rule.matcher.host)}\\1` },
        },
        condition: {
          regexFilter: `^https?://${escapeRegex(rule.matcher.host)}(/.*)?$`,
          resourceTypes: ['main_frame'],
        },
      };
    }

    if (rule.matcher.kind === 'host-port') {
      const encoded = `${rule.matcher.host.replaceAll('.', '-')}-${rule.matcher.port}-p.atrust.cqu.edu.cn`;
      return {
        id: rule.dnrId,
        priority: rule.category === 'custom' ? 30_000 : 10_000,
        action: { type: 'redirect', redirect: { regexSubstitution: `https://${encoded}\\1` } },
        condition: {
          regexFilter: `^https?://${escapeRegex(rule.matcher.host)}:${rule.matcher.port}(/.*)?$`,
          resourceTypes: ['main_frame'],
        },
      };
    }

    return {
      id: rule.dnrId,
      priority: 20_000,
      action: {
        type: 'redirect',
        redirect: {
          regexSubstitution: 'https://youth.cqu.edu.cn/content.jsp?urltype=news.NewsContentUrl&wbtreeid=\\1&wbnewsid=\\2',
        },
      },
      condition: {
        regexFilter: '^https?://youth\\.cqu\\.edu\\.cn/info/(\\d+)/(\\d+)\\.htm(?:\\?.*)?$',
        resourceTypes: ['main_frame'],
      },
    };
  });

  const allows = [...excludedHosts].sort().map((host, index): chrome.declarativeNetRequest.Rule => ({
    id: 80_000 + index,
    priority: 100_000,
    action: { type: 'allow' },
    condition: { urlFilter: `||${host}/`, resourceTypes: ['main_frame'] },
  }));

  return [...allows, ...redirects];
}

export async function reconcileDynamicRules(): Promise<void> {
  const settings = await loadSettings();
  const { validRules, validationErrors } = await compileAndValidateRulesIndividually(
    getEnabledRules(settings),
    settings.excludedHosts,
  );
  const current = await browser.declarativeNetRequest.getDynamicRules();
  await browser.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: current.map((rule) => rule.id),
    addRules: validRules,
  });
  recordDnrReconciliationStatus({ errors: validationErrors });
}
```

Individual redirect compile/regex failures are skipped and attributed to their stable rule ID so Options can mark the rule without blocking unrelated redirects. Duplicate IDs, invalid global exclusion/ticket safety rules, and atomic `updateDynamicRules` failures remain global errors.

- [ ] **Step 4: Add manifest permissions and background reconciliation**

Update `wxt.config.ts` manifest:

```ts
permissions: ['storage', 'activeTab', 'declarativeNetRequestWithHostAccess', 'webNavigation'],
host_permissions: [
  '*://sso.cqu.edu.cn/*',
  '*://youth.cqu.edu.cn/*',
  'https://sso-cqu-edu-cn-s.atrust.cqu.edu.cn/*',
],
optional_host_permissions: ['*://cqu.edu.cn/*', '*://*.cqu.edu.cn/*'],
```

Update `entrypoints/background.ts` to call `reconcileDynamicRules()` at startup, on `runtime.onInstalled`, and after `storage.onChanged` reports the `settings` key.

- [ ] **Step 5: Verify rule compilation and generated manifest**

Run: `pnpm test -- tests/unit/dnr.test.ts && pnpm typecheck && pnpm build`

Expected: compiler tests pass; generated manifest contains only the declared exact required hosts and the optional CQU wildcard.

- [ ] **Step 6: Commit DNR support**

```bash
git add src/rules/dnr.ts wxt.config.ts entrypoints/background.ts tests/unit/dnr.test.ts
git commit -m "feat(redirect): compile built-ins into DNR rules"
```

---

### Task 5: Add the Optional All-CQU Navigation Mode

**Files:**
- Create: `src/background/navigation.ts`
- Modify: `entrypoints/background.ts`
- Modify: `src/storage/settings.ts`
- Test: `tests/unit/navigation.test.ts`

**Interfaces:**
- Consumes: `toAtrustDomainUrl`, settings, exclusion hosts.
- Produces: `decideAllCquRewrite(details, settings)` and `setAllCquMode(enabled)`.

- [ ] **Step 1: Write failing decision tests**

Test that the decision function:

- rewrites `https://foo.cqu.edu.cn/a?q=1` when all-CQU is enabled;
- ignores `frameId !== 0`;
- ignores aTrust destinations;
- ignores `cqu.edu.cn` hosts listed in `excludedHosts`;
- returns `null` when the switch is disabled.

- [ ] **Step 2: Run tests and verify red**

Run: `pnpm test -- tests/unit/navigation.test.ts`

Expected: FAIL because the navigation module is missing.

- [ ] **Step 3: Implement the pure decision and event listener**

Create `src/background/navigation.ts`:

```ts
import { loadSettings, type ExtensionSettings } from '../storage/settings';
import { isAtrustUrl, isCquDomain, toAtrustDomainUrl } from '../rules/transform';

export interface NavigationInput { tabId: number; frameId: number; url: string }

export function decideAllCquRewrite(
  details: NavigationInput,
  settings: ExtensionSettings,
): string | null {
  if (!settings.enabled || !settings.enableAllCquDomains || details.frameId !== 0 || details.tabId < 0) return null;
  if (isAtrustUrl(details.url) || !isCquDomain(details.url)) return null;
  const host = new URL(details.url).hostname.toLowerCase();
  if (settings.excludedHosts.includes(host)) return null;
  return toAtrustDomainUrl(details.url);
}

export function registerNavigationFallback(): void {
  browser.webNavigation.onBeforeNavigate.addListener(async (details) => {
    const target = decideAllCquRewrite(details, await loadSettings());
    if (target && target !== details.url) await browser.tabs.update(details.tabId, { url: target });
  });
}
```

The event listener must be registered synchronously at module startup; asynchronous work occurs inside the listener.

- [ ] **Step 4: Implement optional permission gating**

Add to `src/storage/settings.ts`:

```ts
const CQU_WILDCARD = { origins: ['*://cqu.edu.cn/*', '*://*.cqu.edu.cn/*'] };

export async function setAllCquMode(enabled: boolean): Promise<boolean> {
  if (enabled && !(await browser.permissions.request(CQU_WILDCARD))) return false;
  const settings = await loadSettings();
  await saveSettings({ ...settings, enableAllCquDomains: enabled });
  if (!enabled) await browser.permissions.remove(CQU_WILDCARD);
  return true;
}
```

- [ ] **Step 5: Verify behavior, types, and build**

Run: `pnpm test -- tests/unit/navigation.test.ts tests/unit/settings.test.ts && pnpm typecheck && pnpm build`

Expected: tests pass; denying permission leaves the switch false; background listener is present in the build.

- [ ] **Step 6: Commit all-CQU mode**

```bash
git add src/background/navigation.ts src/storage/settings.ts entrypoints/background.ts tests/unit/navigation.test.ts tests/unit/settings.test.ts
git commit -m "feat(redirect): add optional all-CQU mode"
```

---

### Task 6: Add Explanation State and One-Time Bypass

**Files:**
- Create: `src/background/session.ts`
- Create: `src/messages.ts`
- Modify: `entrypoints/background.ts`
- Test: `tests/unit/session.test.ts`

**Interfaces:**
- Produces: `RewriteRecord`, `recordRewrite(record)`, `getTabState(tabId)`, `openOriginalOnce(tabId)`, and typed runtime messages.
- Consumes: settings and rule transformations.

- [ ] **Step 1: Write failing session tests**

Use the WXT fake browser to assert that:

- a rewrite record round-trips through `storage.session`;
- `openOriginalOnce(7)` installs one high-priority session `allow` rule scoped to `tabIds: [7]`;
- the tab navigates to the stored original URL;
- a committed navigation clears the bypass rule and record.

- [ ] **Step 2: Run tests and verify red**

Run: `pnpm test -- tests/unit/session.test.ts`

Expected: FAIL because session state functions are missing.

- [ ] **Step 3: Define message and state contracts**

Create `src/messages.ts`:

```ts
export type BackgroundMessage =
  | { type: 'get-tab-state'; tabId: number }
  | { type: 'open-original-once'; tabId: number }
  | { type: 'exclude-current-host'; tabId: number };
```

Create `src/background/session.ts`:

```ts
import { loadSettings, saveSettings } from '../storage/settings';

export interface RewriteRecord {
  tabId: number;
  ruleId: string;
  originalUrl: string;
  targetUrl: string;
  recordedAt: number;
  error?: string;
}

const recordKey = (tabId: number) => `rewrite:${tabId}`;
const bypassRuleId = (tabId: number) => 900_000 + tabId;
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function recordRewrite(record: RewriteRecord): Promise<void> {
  await browser.storage.session.set({ [recordKey(record.tabId)]: record });
}

export async function getTabState(tabId: number): Promise<RewriteRecord | null> {
  const stored = await browser.storage.session.get(recordKey(tabId));
  return (stored[recordKey(tabId)] as RewriteRecord | undefined) ?? null;
}

export async function openOriginalOnce(tabId: number): Promise<void> {
  const record = await getTabState(tabId);
  if (!record) throw new Error('No rewrite is recorded for this tab');
  const id = bypassRuleId(tabId);
  await browser.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [id],
    addRules: [{
      id,
      priority: 1_000_000,
      action: { type: 'allow' },
      condition: {
        regexFilter: `^${escapeRegex(record.originalUrl)}$`,
        resourceTypes: ['main_frame'],
        tabIds: [tabId],
      },
    }],
  });
  await browser.tabs.update(tabId, { url: record.originalUrl });
}

export async function excludeCurrentHost(tabId: number): Promise<void> {
  const record = await getTabState(tabId);
  const tab = await browser.tabs.get(tabId);
  const source = record?.originalUrl ?? tab.url;
  if (!source) throw new Error('The tab has no URL');
  const host = new URL(source).hostname.toLowerCase();
  const settings = await loadSettings();
  await saveSettings({
    ...settings,
    excludedHosts: [...new Set([...settings.excludedHosts, host])].sort(),
  });
}

export async function clearTabSession(tabId: number): Promise<void> {
  await browser.declarativeNetRequest.updateSessionRules({ removeRuleIds: [bypassRuleId(tabId)] });
  await browser.storage.session.remove(recordKey(tabId));
}
```

- [ ] **Step 4: Wire navigation observation and runtime messages**

In `entrypoints/background.ts`, register this dispatcher at module top level:

```ts
browser.runtime.onMessage.addListener(async (message: BackgroundMessage) => {
  if (message.type === 'get-tab-state') return getTabState(message.tabId);
  if (message.type === 'open-original-once') return openOriginalOnce(message.tabId);
  if (message.type === 'exclude-current-host') return excludeCurrentHost(message.tabId);
});

browser.tabs.onRemoved.addListener((tabId) => void clearTabSession(tabId));
browser.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  void browser.action.setBadgeText({ tabId: details.tabId, text: '' });
  void getTabState(details.tabId).then((record) => {
    if (record && details.url === record.originalUrl) return clearTabSession(details.tabId);
  });
});

browser.webNavigation.onErrorOccurred.addListener((details) => {
  if (details.frameId !== 0) return;
  void getTabState(details.tabId).then(async (record) => {
    if (!record || details.url !== record.targetUrl) return;
    await recordRewrite({ ...record, error: details.error });
    await browser.action.setBadgeBackgroundColor({ tabId: details.tabId, color: '#b42318' });
    await browser.action.setBadgeText({ tabId: details.tabId, text: '!' });
  });
});
```

Extend the existing `onBeforeNavigate` listener to call `decideRegisteredRewrite(details.url, getEnabledRules(settings))`, fall back to `decideAllCquRewrite`, and call `recordRewrite` before DNR or `tabs.update` changes the URL. Keep the record after the rewritten target commits so the popup can explain it; clear it only after an original-URL bypass or tab removal.

- [ ] **Step 5: Verify session lifecycle**

Run: `pnpm test -- tests/unit/session.test.ts && pnpm typecheck`

Expected: all lifecycle tests pass; no record survives the tested commit or tab removal.

- [ ] **Step 6: Commit explainability and bypass**

```bash
git add src/background/session.ts src/messages.ts entrypoints/background.ts tests/unit/session.test.ts
git commit -m "feat(redirect): add rewrite state and one-time bypass"
```

---

### Task 7: Build the Functional Popup

**Files:**
- Create: `entrypoints/popup/index.html`
- Create: `entrypoints/popup/main.ts`
- Create: `entrypoints/popup/style.css`
- Create: `src/ui/popup-model.ts`
- Test: `tests/unit/popup-model.test.ts`

**Interfaces:**
- Consumes: `RewriteRecord`, `BackgroundMessage`.
- Produces: `buildPopupModel(tabUrl, record)` and popup actions.

- [ ] **Step 1: Write failing view-model tests**

Create `tests/unit/popup-model.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildPopupModel } from '../../src/ui/popup-model';

describe('popup model', () => {
  it('explains a recorded rewrite', () => {
    const model = buildPopupModel('https://sso-cqu-edu-cn-s.atrust.cqu.edu.cn/login', {
      tabId: 7,
      ruleId: 'core-sso',
      originalUrl: 'https://sso.cqu.edu.cn/login',
      targetUrl: 'https://sso-cqu-edu-cn-s.atrust.cqu.edu.cn/login',
      recordedAt: 1,
    });
    expect(model).toMatchObject({
      status: '已通过 aTrust 打开',
      originalHost: 'sso.cqu.edu.cn',
      targetHost: 'sso-cqu-edu-cn-s.atrust.cqu.edu.cn',
      canBypass: true,
      ruleId: 'core-sso',
    });
  });

  it('shows an unchanged page without enabling bypass', () => {
    expect(buildPopupModel('https://example.com/', null)).toMatchObject({
      status: '当前页面未改写',
      canBypass: false,
    });
  });

  it('surfaces a detected navigation error', () => {
    const model = buildPopupModel('https://sso-cqu-edu-cn-s.atrust.cqu.edu.cn/login', {
      tabId: 7,
      ruleId: 'core-sso',
      originalUrl: 'https://sso.cqu.edu.cn/login',
      targetUrl: 'https://sso-cqu-edu-cn-s.atrust.cqu.edu.cn/login',
      recordedAt: 1,
      error: 'net::ERR_CONNECTION_REFUSED',
    });
    expect(model.status).toBe('aTrust 页面加载失败');
    expect(model.canBypass).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests and verify red**

Run: `pnpm test -- tests/unit/popup-model.test.ts`

Expected: FAIL because `popup-model.ts` is missing.

- [ ] **Step 3: Implement the pure view model**

Create `src/ui/popup-model.ts`:

```ts
import type { RewriteRecord } from '../background/session';

export interface PopupModel {
  status: string;
  originalHost: string;
  targetHost: string;
  canBypass: boolean;
  ruleId: string | null;
}

export function buildPopupModel(tabUrl: string, record: RewriteRecord | null): PopupModel {
  if (!record) {
    const host = new URL(tabUrl).hostname;
    return { status: '当前页面未改写', originalHost: host, targetHost: host, canBypass: false, ruleId: null };
  }
  return {
    status: record.error ? 'aTrust 页面加载失败' : '已通过 aTrust 打开',
    originalHost: new URL(record.originalUrl).hostname,
    targetHost: new URL(record.targetUrl).hostname,
    canBypass: true,
    ruleId: record.ruleId,
  };
}
```

- [ ] **Step 4: Build the popup document and controller**

The popup must include these stable element IDs:

```html
<main>
  <h1>CQU Link Fix</h1>
  <section id="status"></section>
  <button id="open-original" type="button">原地址打开一次</button>
  <button id="exclude-host" type="button">暂停当前站点</button>
  <button id="open-options" type="button">管理全部规则</button>
</main>
```

In `main.ts`, query the active tab, send `get-tab-state`, render only with `textContent`, and send the appropriate typed message for each action. Open the WXT-generated options page with `browser.runtime.openOptionsPage()`.

Use a simple single-column stylesheet with visible focus states, a minimum 320 px width, and no animations.

- [ ] **Step 5: Verify popup behavior and accessibility basics**

Run: `pnpm test -- tests/unit/popup-model.test.ts && pnpm typecheck && pnpm build`

Expected: view-model tests pass; build contains popup HTML; every button is reachable by keyboard and has visible text.

- [ ] **Step 6: Commit the popup**

```bash
git add entrypoints/popup src/ui/popup-model.ts tests/unit/popup-model.test.ts
git commit -m "feat(ui): add functional rewrite popup"
```

---

### Task 8: Build the Options Page and Custom Rule Validation

**Files:**
- Create: `entrypoints/options/index.html`
- Create: `entrypoints/options/main.ts`
- Create: `entrypoints/options/style.css`
- Create: `src/ui/custom-rule.ts`
- Test: `tests/unit/custom-rule.test.ts`

**Interfaces:**
- Consumes: built-ins, `getSettingsSnapshotViaBackground()`, revision-aware `replaceSettingsViaBackground(editable, expectedRevision)`, `setAllCquMode()`, and `reconcileDynamicRules` via background-owned storage updates.
- Produces: `parseCustomRule(input, nextDnrId)` and the rule-management UI.

- [ ] **Step 1: Write failing custom-rule validation tests**

Create `tests/unit/custom-rule.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseCustomRule } from '../../src/ui/custom-rule';

describe('custom rules', () => {
  it('accepts a bare CQU hostname', () => {
    const rule = parseCustomRule('SSO2.CQU.EDU.CN', 10_001);
    expect(rule).toMatchObject({
      dnrId: 10_001,
      matcher: { kind: 'host', host: 'sso2.cqu.edu.cn' },
      transformer: 'atrust-domain',
    });
    expect(rule.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each([
    '1.1.1.1:8000',
    'https://user@example.com',
    '[::1]:8000',
    'example.com',
    'sso-cqu-edu-cn-s.atrust.cqu.edu.cn',
  ])('rejects unsupported custom input %s', (input) => {
    expect(() => parseCustomRule(input, 10_001)).toThrow();
  });
});
```

- [ ] **Step 2: Run tests and verify red**

Run: `pnpm test -- tests/unit/custom-rule.test.ts`

Expected: FAIL because custom-rule parsing is missing.

- [ ] **Step 3: Implement the custom-rule parser**

Create `src/ui/custom-rule.ts`. First-release custom rules accept only bare CQU hostnames; IP:port rules remain developer-maintained built-ins until the exact-origin permission gate is proven.

```ts
import type { CustomRule } from '../rules/types';

export function parseCustomRule(input: string, dnrId: number): CustomRule {
  const host = input.trim().toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(host) || host.includes('..')) throw new Error('请输入不带协议的域名');
  if (host.endsWith('.atrust.cqu.edu.cn')) throw new Error('不能把 aTrust 地址作为源地址');
  if (host !== 'cqu.edu.cn' && !host.endsWith('.cqu.edu.cn')) throw new Error('首版仅支持 CQU 域名');
  return {
    id: crypto.randomUUID(),
    dnrId,
    name: host,
    description: `通过 aTrust 打开 ${host}`,
    category: 'custom',
    defaultEnabled: true,
    matcher: { kind: 'host', host },
    transformer: 'atrust-domain',
  };
}
```

- [ ] **Step 4: Build the options page**

Render:

- master switch;
- built-in rules grouped by core, important, IP, and add-on;
- all-CQU switch with its permission explanation;
- excluded hosts;
- custom-rule form and validation error text.

Load initial UI state only through `getSettingsSnapshotViaBackground()`. Keep both the returned settings and revision in the controller. For master-switch, built-in-rule, excluded-host, and custom-rule edits, construct editable settings without `enableAllCquDomains`, then call `replaceSettingsViaBackground(editable, revision)`. On success, retain the returned revision for the next edit; the existing background storage listener reconciles DNR rules.

If replacement returns `code: 'settings-conflict'`, do not retry the stale edit. Reload with `getSettingsSnapshotViaBackground()`, render the fresh state and revision, and show a visible conflict message explaining that newer settings were preserved and the user must reapply the edit. Other operation failures also remain visible and must not update the rendered saved state.

The options page and popup must never import or call `saveSettings()` directly. All production settings writes are background-owned. The all-CQU switch is not part of editable replacement state: it must continue to call `setAllCquMode()` from the permission-caller UI context so Chromium's permission prompt remains valid, then reload the background snapshot to obtain the resulting mode and revision. Use `textContent` and DOM creation rather than interpolated `innerHTML` for rule names, descriptions, and conflict errors.

Before saving a custom hostname, request only its exact source and generated target origins:

```ts
const source = `*://${rule.matcher.kind === 'host' ? rule.matcher.host : ''}/*`;
const targetHost = `${rule.matcher.kind === 'host' ? rule.matcher.host.replaceAll('.', '-') : ''}-s.atrust.cqu.edu.cn`;
const granted = await browser.permissions.request({ origins: [source, `https://${targetHost}/*`] });
if (!granted) throw new Error('未授予该域名的访问权限');
```

- [ ] **Step 5: Verify options behavior**

Run: `pnpm test -- tests/unit/custom-rule.test.ts tests/unit/settings.test.ts tests/unit/dnr.test.ts && pnpm typecheck && pnpm build`

Expected: tests pass; options HTML is generated; invalid custom input cannot be saved; two controllers editing the same revision produce one success and one visible conflict/reload; no options/popup production code calls `saveSettings()`; permission denial through `setAllCquMode()` leaves all-CQU disabled.

- [ ] **Step 6: Commit rule management UI**

```bash
git add entrypoints/options src/ui/custom-rule.ts tests/unit/custom-rule.test.ts
git commit -m "feat(ui): add local rule management"
```

---

### Task 9: Add Loaded-Extension E2E Coverage

**Files:**
- Modify: `playwright.config.ts`
- Create: `tests/e2e/extension.spec.ts`
- Create: `tests/e2e/helpers.ts`

**Interfaces:**
- Consumes: `.output/chrome-mv3` from `pnpm build`.
- Produces: browser-level evidence for SSO, CAS query preservation, Youth League mapping, and loop prevention.

- [ ] **Step 1: Create the loaded-extension fixture**

Create `tests/e2e/helpers.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';

export async function launchExtension() {
const extensionPath = path.resolve('.output/chrome-mv3');
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'cqu-link-fix-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
});
  await context.route(/https?:\/\/(?:sso|youth)[^/]*\.cqu\.edu\.cn\/.*/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>fixture</title>' });
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  return {
    context,
    worker,
    async close() {
      await context.close();
      await rm(userDataDir, { recursive: true, force: true });
    },
  };
}
```

- [ ] **Step 2: Add exact E2E assertions**

Create `tests/e2e/extension.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { launchExtension } from './helpers';

test('redirects SSO without changing decoded CAS service', async () => {
  const app = await launchExtension();
  try {
    await expect.poll(() => app.worker.evaluate(() => chrome.declarativeNetRequest.getDynamicRules().then((r) => r.length)))
      .toBeGreaterThan(0);
    const page = await app.context.newPage();
    const service = 'https://my.cqu.edu.cn/authserver/authentication/cas?a=1&b=2';
    await page.goto(`http://sso.cqu.edu.cn/login?service=${encodeURIComponent(service)}`);
    const rewritten = new URL(page.url());
    expect(rewritten.protocol).toBe('https:');
    expect(rewritten.hostname).toBe('sso-cqu-edu-cn-s.atrust.cqu.edu.cn');
    expect(rewritten.searchParams.get('service')).toBe(service);
    const once = page.url();
    await page.reload();
    expect(page.url()).toBe(once);
  } finally {
    await app.close();
  }
});

test('rewrites a Youth League article to content.jsp', async () => {
  const app = await launchExtension();
  try {
    const page = await app.context.newPage();
    await page.goto('https://youth.cqu.edu.cn/info/1009/24264.htm');
    const rewritten = new URL(page.url());
    expect(rewritten.pathname).toBe('/content.jsp');
    expect(rewritten.searchParams.get('urltype')).toBe('news.NewsContentUrl');
    expect(rewritten.searchParams.get('wbtreeid')).toBe('1009');
    expect(rewritten.searchParams.get('wbnewsid')).toBe('24264');
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 3: Run the browser integration gate**

Run: `pnpm test:e2e`

Expected: both E2E tests pass. If a test fails, invoke `superpowers:systematic-debugging`, patch the owning DNR, permission, or fixture module, and rerun this exact command without weakening assertions.

- [ ] **Step 4: Run the full automated gate**

Run: `pnpm verify && pnpm test:e2e`

Expected: typecheck, unit tests, production build, and all SSO, CAS, Youth League, and loop assertions pass.

- [ ] **Step 5: Commit E2E coverage**

```bash
git add playwright.config.ts tests/e2e
git commit -m "test: cover browser redirect flows"
```

---

### Task 10: Perform Live Validation and Document Release Behavior

**Files:**
- Create: `docs/validation/live-smoke.md`
- Create: `README.md`
- Modify when validated: `src/rules/builtins.ts`

**Interfaces:**
- Consumes: built extension and an authorized test account/session operated by the user.
- Produces: release evidence and user-facing installation/privacy documentation.

- [ ] **Step 1: Create the live validation record before testing**

Create `docs/validation/live-smoke.md` with a table containing exact columns:

```markdown
| Date | Network | aTrust client | Original URL | Rewritten URL | Login page | Original service preserved | Client session established | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
```

Add rows for campus/no-client, off-campus/no-client, off-campus/client-connected, Youth League, and each proposed IP:port rule. Mark unexecuted cells as `NOT RUN`, not as passing.

- [ ] **Step 2: Run campus and off-campus SSO validation**

Load `.output/chrome-mv3` as an unpacked extension. For each required network row:

1. ensure the stated aTrust client condition is true;
2. open a real CAS client such as `my.cqu.edu.cn`;
3. confirm the outer SSO host rewrites;
4. compare the decoded `service` before and after;
5. let the user complete authentication;
6. confirm the original client establishes a session;
7. record observable evidence without recording tickets, credentials, cookies, or account identifiers.

Expected: every release-required row records `PASS`; otherwise record the exact failure and keep release blocked.

- [ ] **Step 3: Validate Youth League and IP rules**

Confirm the known Youth League example resolves to the public article. Only add an IP:port rule to `src/rules/builtins.ts` after its authorized resource passes in the off-campus/no-client condition. If no authorized IP endpoint is supplied, ship with no default IP rules and state that explicitly.

- [ ] **Step 4: Write the README**

Create `README.md` with these sections and statements:

```markdown
# CQU Link Fix

面向 Chromium 的重庆大学链接修正扩展。

## 默认功能

- 统一身份认证入口默认通过 aTrust 打开，但 CAS `service` 回调保持原值。
- 团委 `/info/...htm` 文章默认转换为公网 `content.jsp` 地址。
- “全部 CQU 域名”默认关闭，开启时浏览器会请求额外域名权限。
- IP:port 只支持随扩展发布且经过真实验证的名单。

## 安装

开发版本运行 `pnpm build` 后，在 Chromium 扩展管理页加载 `.output/chrome-mv3`。
发布版本解压 WXT 生成的 zip 后按相同步骤加载。

## 控制与回退

弹窗会显示当前改写规则。用户可以让当前标签页原地址打开一次，也可以暂停当前站点。

## 隐私

扩展不提供遥测或远程规则服务，不读取浏览历史、请求体、凭据、Cookie 或验证码。设置仅保存在 `chrome.storage.local`。

## 已知限制

格式正确的 aTrust 地址仍可能因为学校未发布对应资源而无法访问。首版 UI 只保证功能清楚可用，视觉设计将在功能稳定后重做。
```

- [ ] **Step 5: Run release verification and build the zip**

Run:

```bash
pnpm verify
pnpm test:e2e
pnpm zip
git diff --check
```

Expected: all commands exit 0; the WXT zip exists; validation document contains no `NOT RUN` in release-required CAS rows; any unverified IP rule is absent from built-ins.

- [ ] **Step 6: Commit documentation and release readiness**

```bash
git add README.md docs/validation/live-smoke.md src/rules/builtins.ts
git commit -m "docs: add validation and release guidance"
```

---

## Final Verification Checklist

- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm test` reports zero failures.
- [ ] `pnpm build` produces `.output/chrome-mv3`.
- [ ] `pnpm test:e2e` passes SSO, CAS query, Youth League, and loop scenarios.
- [ ] `pnpm zip` produces the distributable archive.
- [ ] Generated manifest has exact required hosts and optional CQU wildcard; it does not require `<all_urls>`.
- [ ] Decoded CAS `service` is identical before and after every tested rewrite.
- [ ] Real CAS callback establishes a client session on campus and off campus under documented client conditions.
- [ ] No default IP:port rule lacks an authorized live validation record.
- [ ] No telemetry, remote rule endpoint, browser-history read, request-body read, or credential storage is present.
- [ ] `git status --short` is clean after the final commit.
