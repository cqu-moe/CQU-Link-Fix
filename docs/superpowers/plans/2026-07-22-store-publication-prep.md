# CQU Link Fix Store Publication Preparation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare a versioned, privacy-complete, bilingual Chrome/Edge store submission bundle with draft visual assets and a freshly verified Manifest V3 ZIP.

**Architecture:** Keep the repository as the single source of truth: root-level privacy policy, WXT manifest locales, store-facing Markdown under `docs/store`, and reproducible Playwright-based asset capture. Product behavior and permission scope remain unchanged; publication metadata is verified by unit contracts and the final WXT build/ZIP.

**Tech Stack:** WXT 0.20, TypeScript 7, Vitest 4, Playwright 1.61, Chromium Manifest V3, Markdown, PNG assets

## Global Constraints

- Do not publish the GitHub repository or submit either browser store.
- Do not change URL rewrite behavior or expand required/optional permissions.
- Use `PRIVACY.md` in the repository as the canonical bilingual privacy policy.
- Use WXT `public/_locales/<locale>/messages.json` with `default_locale: 'zh_CN'`.
- Store screenshots must contain no account, student ID, CAS ticket, Cookie, browser profile, or other identity data.
- Treat the Youth League rule as user-verified while preserving the boundary that the previous HTTP 412 observation came from a different network session.
- Generated visual assets are drafts for review, not final brand approval.

---

### Task 1: Lock Manifest Localization Contracts

**Files:**
- Modify: `tests/unit/meta.test.ts`
- Modify: `wxt.config.ts`
- Create: `public/_locales/zh_CN/messages.json`
- Create: `public/_locales/en/messages.json`

**Interfaces:**
- Consumes: `EXTENSION_NAME` and `EXTENSION_VERSION` from `src/meta.ts`.
- Produces: Manifest messages `extName` and `extDescription`, plus `default_locale: 'zh_CN'` for WXT builds.

- [ ] **Step 1: Write the failing localization contract**

Add a test that loads both locale JSON files and checks the WXT config source:

```ts
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

async function readJson(relativePath: string) {
  return JSON.parse(await readFile(path.join(root, relativePath), 'utf8')) as Record<
    string,
    { message: string }
  >;
}

it('localizes manifest name and description for Chinese and English', async () => {
  const [config, zh, en] = await Promise.all([
    readFile(path.join(root, 'wxt.config.ts'), 'utf8'),
    readJson('public/_locales/zh_CN/messages.json'),
    readJson('public/_locales/en/messages.json'),
  ]);
  expect(config).toContain("name: '__MSG_extName__'");
  expect(config).toContain("description: '__MSG_extDescription__'");
  expect(config).toContain("default_locale: 'zh_CN'");
  expect(Object.keys(zh).sort()).toEqual(['extDescription', 'extName']);
  expect(Object.keys(en).sort()).toEqual(['extDescription', 'extName']);
  expect(zh.extName.message).toBe('CQU Link Fix');
  expect(en.extName.message).toBe('CQU Link Fix');
  expect(zh.extDescription.message.length).toBeLessThanOrEqual(132);
  expect(en.extDescription.message.length).toBeLessThanOrEqual(132);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec vitest run tests/unit/meta.test.ts`

Expected: FAIL because `public/_locales/zh_CN/messages.json` and `public/_locales/en/messages.json` do not exist.

- [ ] **Step 3: Add WXT manifest i18n metadata and locale files**

Set the WXT manifest fields:

```ts
manifest: {
  name: '__MSG_extName__',
  description: '__MSG_extDescription__',
  default_locale: 'zh_CN',
  version: EXTENSION_VERSION,
}
```

Use these exact locale values:

```json
{
  "extName": { "message": "CQU Link Fix" },
  "extDescription": { "message": "在本机修正重庆大学相关网站的顶层导航链接，并提供暂停与原地址回退。" }
}
```

```json
{
  "extName": { "message": "CQU Link Fix" },
  "extDescription": { "message": "Repair top-level navigation links for Chongqing University sites with local controls and rollback." }
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm exec vitest run tests/unit/meta.test.ts`

Expected: PASS with all metadata tests green.

- [ ] **Step 5: Commit the localized manifest contract**

```bash
git add tests/unit/meta.test.ts wxt.config.ts public/_locales
git commit -m "feat: localize extension store metadata"
```

### Task 2: Publish the Canonical Privacy Policy

**Files:**
- Create: `PRIVACY.md`
- Create: `tests/unit/store-publication.test.ts`
- Modify: `README.md`
- Modify: `docs/validation/live-smoke.md`
- Modify: `docs/research/2026-07-22-chrome-edge-store-publishing.md`

**Interfaces:**
- Consumes: Current `storage.local`, `storage.session`, permission, CAS ticket, and no-telemetry behavior documented in the codebase.
- Produces: Public URL target `https://github.com/cqu-moe/CQU-Link-Fix/blob/main/PRIVACY.md` and accurate repository privacy language.

- [ ] **Step 1: Write the failing publication-document contract**

Create a focused file-content test:

```ts
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const read = (relativePath: string) => readFile(path.join(root, relativePath), 'utf8');

describe('store publication documents', () => {
  it('publishes a bilingual privacy policy with local-only data handling', async () => {
    const policy = await read('PRIVACY.md');
    expect(policy).toContain('# CQU Link Fix 隐私政策');
    expect(policy).toContain('# CQU Link Fix Privacy Policy');
    expect(policy).toContain('storage.local');
    expect(policy).toContain('storage.session');
    expect(policy).toContain('CAS ticket');
    expect(policy).toContain('不会向开发者服务器');
    expect(policy).toContain('does not transmit');
    expect(policy).toContain('Chrome Web Store User Data Policy');
    expect(policy).toContain('https://github.com/cqu-moe/CQU-Link-Fix/issues');
  });
});
```

- [ ] **Step 2: Run the document test and verify RED**

Run: `pnpm exec vitest run tests/unit/store-publication.test.ts`

Expected: FAIL because `PRIVACY.md` does not exist.

- [ ] **Step 3: Write `PRIVACY.md` and correct repository disclosures**

Write complete Chinese and English sections covering scope, locally handled data, purposes, storage/retention, no transmission/sharing/sale, authentication safeguards, permissions, user controls, children, policy changes, Limited Use, and GitHub Issues contact.

Replace the README privacy claim with this factual distinction:

```markdown
扩展不会查询浏览器的历史记录数据库，也不会把浏览活动发送给开发者或第三方。为完成链接修正，它会在本机处理当前顶层导航的 URL/域名，并在本机保存规则、排除项和临时改写状态。完整说明见[隐私政策](PRIVACY.md)。
```

In the live-smoke record, preserve the historical 412 row and add a dated note that the user independently confirmed the Youth League rule works in real use on 2026-07-22, without claiming the earlier session or full network matrix was rerun. Update the research report so the old 412 observation is no longer described as a current hard blocker.

- [ ] **Step 4: Run the document test and verify GREEN**

Run: `pnpm exec vitest run tests/unit/store-publication.test.ts`

Expected: PASS for the privacy-policy contract.

- [ ] **Step 5: Commit privacy and evidence-boundary updates**

```bash
git add PRIVACY.md README.md docs/validation/live-smoke.md docs/research/2026-07-22-chrome-edge-store-publishing.md tests/unit/store-publication.test.ts
git commit -m "docs: prepare privacy policy for browser stores"
```

### Task 3: Create Store Copy and Reviewer Instructions

**Files:**
- Create: `docs/store/listing-copy.md`
- Create: `docs/store/privacy-and-permissions.md`
- Create: `docs/store/reviewer-instructions.md`
- Create: `docs/store/submission-checklist.md`
- Modify: `tests/unit/store-publication.test.ts`

**Interfaces:**
- Consumes: Canonical URLs and privacy policy from Task 2, actual permissions from `wxt.config.ts`.
- Produces: Paste-ready Chinese/English listing content, disclosure mapping, no-credential test instructions, and an operator checklist.

- [ ] **Step 1: Extend the test with required store-document contracts**

Check all four files exist and contain no placeholder tokens, and assert exact required phrases:

```ts
const files = [
  'docs/store/listing-copy.md',
  'docs/store/privacy-and-permissions.md',
  'docs/store/reviewer-instructions.md',
  'docs/store/submission-checklist.md',
];
const contents = await Promise.all(files.map(read));
for (const content of contents) {
  expect(content).not.toMatch(/\b(?:TBD|TODO|PLACEHOLDER)\b/);
}
expect(contents[0]).toContain('在本机修正重庆大学相关网站的顶层导航链接');
expect(contents[0]).toContain('Independent community project');
expect(contents[1]).toContain('declarativeNetRequestWithHostAccess');
expect(contents[1]).toContain('Web browsing activity');
expect(contents[1]).toContain('Remote code');
expect(contents[2]).toContain('无需扩展账号');
expect(contents[2]).toContain('Do not provide personal CQU credentials');
expect(contents[3]).toContain('https://github.com/cqu-moe/CQU-Link-Fix/blob/main/PRIVACY.md');
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec vitest run tests/unit/store-publication.test.ts`

Expected: FAIL because `docs/store` submission documents do not exist.

- [ ] **Step 3: Write paste-ready store submission documents**

Use these canonical URLs everywhere:

```text
Homepage: https://github.com/cqu-moe/CQU-Link-Fix
Support: https://github.com/cqu-moe/CQU-Link-Fix/issues
Privacy: https://github.com/cqu-moe/CQU-Link-Fix/blob/main/PRIVACY.md
```

The documents must include exact Chinese/English long descriptions, a narrow single-purpose statement, all permission justifications, remote-code “No”, local Web browsing activity disclosure, test URLs with synthetic query values, asset filenames, Chrome tabs to complete, Edge pages to complete, and a final “repository must be public before submission” gate.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm exec vitest run tests/unit/store-publication.test.ts`

Expected: PASS for all store-document contracts.

- [ ] **Step 5: Commit the store copy bundle**

```bash
git add docs/store tests/unit/store-publication.test.ts
git commit -m "docs: add browser store submission copy"
```

### Task 4: Generate Draft Store Assets from the Real Extension

**Files:**
- Create: `scripts/capture-store-assets.mjs`
- Create: `docs/store/assets/draft-screenshot-options-1280x800.png`
- Create: `docs/store/assets/draft-screenshot-popup-1280x800.png`
- Create: `docs/store/assets/draft-small-promo-440x280.png`
- Create: `docs/store/assets/edge-logo-300x300.png`
- Modify: `package.json`
- Modify: `tests/unit/store-publication.test.ts`

**Interfaces:**
- Consumes: `.output/chrome-mv3`, `public/icon/512.png`, Playwright Chromium.
- Produces: Four deterministic PNG files with exact store dimensions.

- [ ] **Step 1: Add a failing asset contract**

Read PNG dimensions without adding dependencies by checking the PNG IHDR header:

```ts
async function pngDimensions(relativePath: string): Promise<[number, number]> {
  const bytes = await readFile(path.join(root, relativePath));
  expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

it('provides store assets at exact dimensions', async () => {
  await expect(pngDimensions('docs/store/assets/draft-screenshot-options-1280x800.png'))
    .resolves.toEqual([1280, 800]);
  await expect(pngDimensions('docs/store/assets/draft-screenshot-popup-1280x800.png'))
    .resolves.toEqual([1280, 800]);
  await expect(pngDimensions('docs/store/assets/draft-small-promo-440x280.png'))
    .resolves.toEqual([440, 280]);
  await expect(pngDimensions('docs/store/assets/edge-logo-300x300.png'))
    .resolves.toEqual([300, 300]);
});
```

- [ ] **Step 2: Run the asset test and verify RED**

Run: `pnpm exec vitest run tests/unit/store-publication.test.ts`

Expected: FAIL because the PNG files do not exist.

- [ ] **Step 3: Generate one visual direction with ImageGen**

Use the exact `public/icon/512.png` as the referenced image and request a restrained 440×280 browser-extension promo concept: warm white and ink-black palette, a small CQU-red accent, no university logo, no third-party logo, no fake browser chrome, and no text other than `CQU Link Fix`. Inspect the result as inspiration only; do not use an altered AI rendering of the project mark in the committed store asset.

- [ ] **Step 4: Add a reproducible Playwright capture script**

Add `store:assets` to `package.json`:

```json
"store:assets": "pnpm build && node scripts/capture-store-assets.mjs"
```

The script must launch a temporary Chromium profile with `.output/chrome-mv3`, capture the actual `options.html` and `popup.html`, compose the popup screenshot and 440×280 promo on neutral local HTML canvases, render the 300×300 logo from the exact project icon, close the browser in `finally`, and remove the temporary profile. All visible sample URLs must use synthetic, non-identifying values.

- [ ] **Step 5: Generate the assets and verify GREEN**

Run: `pnpm store:assets`

Expected: exit 0 and four PNG files under `docs/store/assets`.

Run: `pnpm exec vitest run tests/unit/store-publication.test.ts`

Expected: PASS, including all exact PNG dimensions.

- [ ] **Step 6: Inspect every generated image**

Open the four PNG files and verify: text is legible; the project mark is accurate; no CQU official logo is used; no credentials, tickets, cookies, account names, or real personal URLs are visible.

- [ ] **Step 7: Commit the reproducible visual drafts**

```bash
git add package.json scripts/capture-store-assets.mjs docs/store/assets tests/unit/store-publication.test.ts
git commit -m "feat: generate draft browser store assets"
```

### Task 5: Verify, Package, and Record the Handoff

**Files:**
- Modify: `docs/store/submission-checklist.md`
- Output: `.output/cqu-link-fix-0.3.0-chrome.zip`

**Interfaces:**
- Consumes: All prior tasks and current repository HEAD.
- Produces: Fresh verified ZIP, SHA-256, clean diff checks, and next-day operator steps.

- [ ] **Step 1: Run the complete unit/type/build verification**

Run: `pnpm verify`

Expected: TypeScript succeeds, all Vitest files pass, and WXT produces a Manifest V3 build containing `_locales/en/messages.json` and `_locales/zh_CN/messages.json`.

- [ ] **Step 2: Run loaded-extension E2E**

Run: `pnpm test:e2e`

Expected: All non-manual Playwright extension tests pass with no page or service-worker errors.

- [ ] **Step 3: Build and validate the release ZIP**

Run: `pnpm zip`

Expected: `.output/cqu-link-fix-0.3.0-chrome.zip` is created.

Run: `unzip -t .output/cqu-link-fix-0.3.0-chrome.zip`

Expected: `No errors detected in compressed data`.

- [ ] **Step 4: Record immutable release evidence**

Run: `shasum -a 256 .output/cqu-link-fix-0.3.0-chrome.zip`

Append the exact commit, ZIP filename, SHA-256, successful commands, and remaining manual gates to `docs/store/submission-checklist.md`. Remaining gates must be limited to making the repository public, selecting/adjusting final artwork, filling live account-specific fields, and clicking submit.

- [ ] **Step 5: Review the complete change set**

Run: `git diff --check`

Run: `git status --short`

Expected: no whitespace errors; only intended store-preparation changes are present.

- [ ] **Step 6: Commit the verified handoff**

```bash
git add docs/store/submission-checklist.md
git commit -m "chore: finalize browser store release handoff"
```

- [ ] **Step 7: Push the private repository branch**

Run: `git push origin main`

Expected: private `origin/main` contains every store-preparation commit; repository visibility remains unchanged.
