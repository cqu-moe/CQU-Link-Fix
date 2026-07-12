# Full Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve every code-actionable Standards and Spec finding from the full implementation review while preserving the extension's MV3 permission model and current product scope.

**Architecture:** Add explicit runtime/validation status at the UI boundary, isolate invalid DNR redirect rules, and then move repeated matcher, queue, settings, and options behavior behind focused modules with compatibility exports. Extend loaded-extension tests for the missing navigation triggers and persistence boundaries; keep real-network release gates separate.

**Tech Stack:** TypeScript 7, WXT 0.20, Chrome Manifest V3, Vitest 4, Playwright 1.61, pnpm.

## Global Constraints

- Keep `storage`, `activeTab`, `declarativeNetRequestWithHostAccess`, and `webNavigation`; do not add `<all_urls>`, history, cookies, telemetry, or remote storage.
- Keep all-CQU mode default-off and optional-host-permission gated.
- Preserve top-level CAS `ticket` and every decoded `service` value exactly.
- Keep the built-in IP rule list empty until an endpoint is explicitly authorized and verified.
- Browser-native optional-permission denial remains a headed manual release gate; deterministic code behavior must remain unit-tested.
- Do not mark formal release ready until all real-network rows pass on final HEAD.

---

### Task 1: Expose Popup Runtime State

**Files:**
- Modify: `src/ui/popup-model.ts`
- Modify: `src/ui/popup-controller.ts`
- Modify: `entrypoints/popup/index.html`
- Test: `tests/unit/popup-model.test.ts`
- Test: `tests/unit/popup-controller.test.ts`
- Test: `tests/e2e/extension.spec.ts`

**Interfaces:**
- Consumes: `getSettingsSnapshotViaBackground(): Promise<SettingsSnapshot | null>`.
- Produces: `buildPopupModel(tabUrl, record, runtimeState)` where `runtimeState` is `'enabled' | 'disabled' | 'unavailable'`, plus a visible `#runtime-status` element.

- [ ] **Step 1: Write failing model tests**

```ts
expect(buildPopupModel('https://example.com/', null, 'disabled')).toMatchObject({
  runtimeState: 'disabled',
  runtimeLabel: '扩展已停用',
});
expect(buildPopupModel('https://example.com/', null, 'unavailable')).toMatchObject({
  runtimeState: 'unavailable',
  runtimeLabel: '扩展后台不可用',
});
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `pnpm vitest run tests/unit/popup-model.test.ts tests/unit/popup-controller.test.ts`

Expected: failure because `PopupModel` and the controller do not expose runtime state.

- [ ] **Step 3: Implement the minimal runtime-state model and controller read**

```ts
export type PopupRuntimeState = 'enabled' | 'disabled' | 'unavailable';

const runtimeLabel = {
  enabled: '扩展运行中',
  disabled: '扩展已停用',
  unavailable: '扩展后台不可用',
} satisfies Record<PopupRuntimeState, string>;
```

The controller must read a background snapshot, pass its `settings.enabled` value into the model, and render it with `textContent`. Snapshot failure must not be treated as enabled-but-unmatched.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `pnpm vitest run tests/unit/popup-model.test.ts tests/unit/popup-controller.test.ts`

Expected: all focused tests pass.

- [ ] **Step 5: Commit the behavior**

```bash
git add src/ui/popup-model.ts src/ui/popup-controller.ts entrypoints/popup/index.html tests/unit/popup-model.test.ts tests/unit/popup-controller.test.ts
git commit -m "fix(popup): distinguish extension runtime state"
```

### Task 2: Isolate Per-rule DNR Failures and Report Them

**Files:**
- Create: `src/rules/dnr-status.ts`
- Modify: `src/rules/dnr.ts`
- Modify: `src/messages.ts`
- Modify: `entrypoints/background.ts`
- Modify: `src/ui/options-model.ts`
- Modify: `src/ui/options-controller.ts`
- Modify: `docs/superpowers/plans/2026-07-11-cqu-link-fix-extension.md`
- Test: `tests/unit/dnr.test.ts`
- Test: `tests/unit/session.test.ts`
- Test: `tests/unit/options-model.test.ts`
- Test: `tests/unit/options-controller.test.ts`

**Interfaces:**
- Produces: `RuleValidationError { ruleId: string; message: string }` and `DnrReconciliationStatus { errors: RuleValidationError[] }`.
- Produces: a strict `get-dnr-status` background message response.
- Preserves: atomic replacement of the valid compiled ruleset and global failure for duplicate IDs/global safety rules/browser update failure.

- [ ] **Step 1: Write failing compiler/reconciliation tests**

```ts
it('skips one unsupported redirect and installs unrelated valid rules', async () => {
  // Make only the SSO redirect regex unsupported.
  const evidence = await reconcileDynamicRules();
  expect(evidence.validationErrors).toEqual([
    { ruleId: 'core-sso', message: expect.stringContaining('unsupported') },
  ]);
  expect(updated.addRules).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 2001 }),
    expect.objectContaining({ id: 999_999_999 }),
  ]));
});
```

Add a second test proving a compile exception for one rule is isolated, and retain tests proving duplicate IDs and atomic `updateDynamicRules` failure remain global failures.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `pnpm vitest run tests/unit/dnr.test.ts tests/unit/session.test.ts tests/unit/options-model.test.ts tests/unit/options-controller.test.ts`

Expected: the first unsupported regex rejects the whole reconciliation and no per-rule status exists.

- [ ] **Step 3: Implement rule-attributed compilation and validation**

```ts
export interface RuleValidationError {
  ruleId: string;
  message: string;
}

export interface DnrReconciliationEvidence {
  previousDynamicRules: Browser.declarativeNetRequest.Rule[];
  compiledDynamicRules: Browser.declarativeNetRequest.Rule[];
  validationErrors: RuleValidationError[];
}
```

Compile each redirect rule independently, validate its generated regexes, and omit only the failing rule. Compile exclusion allows and the CAS ticket allow as global safety rules. Store the latest cloned status in the background module and expose it through a strict message parser.

- [ ] **Step 4: Render rule errors in Options**

Each built-in/custom rule row receives a dedicated error element. The options controller reads `get-dnr-status`, maps errors by stable rule ID, and writes messages with `textContent`. A global background failure remains in the existing page status.

- [ ] **Step 5: Resolve the old plan/spec contradiction**

Replace the old throw-first expected behavior with: invalid individual redirect rules are skipped and reported without blocking unrelated rules; global safety-rule and atomic replacement failures still reject.

- [ ] **Step 6: Run focused tests and confirm GREEN**

Run: `pnpm vitest run tests/unit/dnr.test.ts tests/unit/session.test.ts tests/unit/options-model.test.ts tests/unit/options-controller.test.ts`

Expected: all focused tests pass.

- [ ] **Step 7: Commit the behavior**

```bash
git add src/rules/dnr.ts src/rules/dnr-status.ts src/messages.ts entrypoints/background.ts src/ui/options-model.ts src/ui/options-controller.ts docs/superpowers/plans/2026-07-11-cqu-link-fix-extension.md tests/unit
git commit -m "fix(rules): isolate DNR validation failures"
```

### Task 3: Centralize Matcher Behavior and Serial Queues

**Files:**
- Create: `src/rules/matcher.ts`
- Create: `src/serial-queue.ts`
- Modify: `src/rules/dnr.ts`
- Modify: `src/rules/registry.ts`
- Modify: `src/background/custom-permission-leases.ts`
- Modify: `src/ui/options-controller.ts`
- Modify: `src/background/coordination.ts`
- Modify: `src/background/navigation-state.ts`
- Test: `tests/unit/matcher.test.ts`
- Test: `tests/unit/navigation.test.ts`
- Test: `tests/unit/custom-permission-lease.test.ts`

**Interfaces:**
- Produces matcher operations with exhaustive `RuleMatcher` handling: `matchesRuleMatcher`, `matcherSourceHosts`, `matcherRangeLabel`, and DNR matcher compilation metadata.
- Produces `createSerialQueue(): <T>(operation: () => Promise<T>) => Promise<T>`.

- [ ] **Step 1: Add failing matcher and queue contract tests**

```ts
expect(matcherRangeLabel({ kind: 'host-port', host: '1.1.1.1', port: 8000 }))
  .toBe('1.1.1.1:8000');
expect(matcherSourceHosts({ kind: 'youth-article', host: 'youth.cqu.edu.cn' }))
  .toEqual(['youth.cqu.edu.cn']);
```

The queue test must show that a rejected first operation does not poison a later operation while preserving order.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `pnpm vitest run tests/unit/matcher.test.ts tests/unit/navigation.test.ts tests/unit/custom-permission-lease.test.ts`

Expected: imports fail because the central modules do not exist.

- [ ] **Step 3: Implement central exhaustive operations and migrate consumers**

Use `assertNever(value: never)` for new matcher kinds. Keep category precedence outside matcher behavior. Remove local matcher-kind switches that only reimplement matching, source-host, or display semantics.

- [ ] **Step 4: Implement and adopt the shared serial queue factory**

```ts
export function createSerialQueue() {
  let tail = Promise.resolve();
  return function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation, operation);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}
```

Instantiate separate queues for global background coordination and navigation state.

- [ ] **Step 5: Run focused and complete unit tests**

Run: `pnpm test`

Expected: all unit tests pass with no matcher behavior changes.

- [ ] **Step 6: Commit the refactor**

```bash
git add src/rules src/background src/ui/options-controller.ts src/serial-queue.ts tests/unit
git commit -m "refactor(core): centralize matcher and queue behavior"
```

### Task 4: Split Settings Responsibilities

**Files:**
- Create: `src/storage/settings-types.ts`
- Create: `src/storage/settings-codec.ts`
- Create: `src/storage/settings-repository.ts`
- Create: `src/storage/settings-client.ts`
- Create: `src/storage/settings-permissions.ts`
- Modify: `src/storage/settings.ts`
- Test: `tests/unit/settings.test.ts`
- Test: `tests/unit/options-dependencies.test.ts`
- Test: `tests/unit/popup-dependencies.test.ts`

**Interfaces:**
- `settings-types.ts`: settings/snapshot/result types and defaults.
- `settings-codec.ts`: strict persisted and message response parsing with no browser side effects.
- `settings-repository.ts`: local storage reads/writes and revision transactions.
- `settings-client.ts`: runtime-message clients only.
- `settings-permissions.ts`: optional CQU permission request/remove/contains orchestration only.
- `settings.ts`: compatibility re-exports and background mutation entry points.

- [ ] **Step 1: Record the green regression baseline**

Run: `pnpm vitest run tests/unit/settings.test.ts tests/unit/options-dependencies.test.ts tests/unit/popup-dependencies.test.ts`

Expected: all tests pass before structural moves.

- [ ] **Step 2: Extract types/defaults and pure codecs**

Move declarations without changing their exported names. Re-export them from `settings.ts`, then rerun the focused tests.

- [ ] **Step 3: Extract repository, client, and permission services**

Move implementations one responsibility at a time. UI-facing modules import the client/permission modules directly; background code imports repository/mutation APIs. Keep `settings.ts` as a compatibility barrel for existing tests and extensions.

- [ ] **Step 4: Verify structural equivalence**

Run: `pnpm typecheck && pnpm vitest run tests/unit/settings.test.ts tests/unit/options-dependencies.test.ts tests/unit/popup-dependencies.test.ts`

Expected: typecheck and all focused tests pass.

- [ ] **Step 5: Commit the refactor**

```bash
git add src/storage src/ui tests/unit
git commit -m "refactor(settings): separate storage and browser clients"
```

### Task 5: Split Options Rendering and Custom Permission Workflow

**Files:**
- Create: `src/ui/options-renderer.ts`
- Create: `src/ui/options-custom-rules.ts`
- Modify: `src/ui/options-controller.ts`
- Test: `tests/unit/options-controller.test.ts`
- Test: `tests/unit/options-dependencies.test.ts`

**Interfaces:**
- `options-renderer.ts` owns DOM construction/update with `textContent` and event callback parameters.
- `options-custom-rules.ts` owns exact-origin acquisition, rollback, renewal, release, and save orchestration while preserving the synchronous user-gesture call chain.
- `initializeOptionsController` owns only snapshot/revision state, event wiring, and cross-workflow status.

- [ ] **Step 1: Record the green regression baseline**

Run: `pnpm vitest run tests/unit/options-controller.test.ts tests/unit/options-dependencies.test.ts`

Expected: all tests pass before extraction.

- [ ] **Step 2: Extract pure DOM rendering**

Move rule rows, exclusion rows, status labels, and DNR validation messages into the renderer. Pass handlers as callbacks; do not import storage or permission APIs into the renderer.

- [ ] **Step 3: Extract custom permission workflow**

Move lease acquire/renew/release/rollback logic behind an injected dependency object. Permission request calls must still originate synchronously from the options click/submit handler.

- [ ] **Step 4: Verify the controller boundary**

Run: `pnpm typecheck && pnpm vitest run tests/unit/options-controller.test.ts tests/unit/options-dependencies.test.ts`

Expected: all tests pass and `options-controller.ts` no longer contains DOM row construction or lease lifecycle internals.

- [ ] **Step 5: Commit the refactor**

```bash
git add src/ui tests/unit
git commit -m "refactor(options): separate rendering and permissions"
```

### Task 6: Add Missing Loaded-extension Evidence

**Files:**
- Modify: `tests/e2e/helpers.ts`
- Modify: `tests/e2e/extension.spec.ts`
- Modify: `docs/validation/live-smoke.md`

**Interfaces:**
- Fixture routes provide a clickable source page and a synthetic HTTP 302 into the original SSO URL.
- Existing extension launch/restart helpers remain the only way tests interact with the MV3 worker.

- [ ] **Step 1: Add loaded-extension tests for link-click and CAS 302**

```ts
await page.goto('https://client.example/link-source');
await page.locator('#sso-link').click();
await expect.poll(() => new URL(page.url()).hostname).toBe(SSO_TARGET);

await page.goto('https://client.example/cas-start');
await expect.poll(() => new URL(page.url()).hostname).toBe(SSO_TARGET);
```

The redirect route must return HTTP 302 with a `Location` on `sso.cqu.edu.cn`, not perform a test-side `page.goto` to SSO.

- [ ] **Step 2: Add forward/back no-loop coverage**

Navigate through an original URL, its rewritten target, and an unrelated fixture page. Exercise `goBack()` and `goForward()`, asserting a bounded navigation count and stable final URL.

- [ ] **Step 3: Add disabled built-in persistence across worker restart**

Disable `core-sso` through the background-owned settings mutation path, restart the extension worker, and assert both the stored disabled ID and absence of SSO rewriting remain. This is the testable upgrade-preservation boundary for stable built-in IDs.

- [ ] **Step 4: Run E2E and confirm GREEN**

Run: `pnpm test:e2e`

Expected: all automated E2E tests pass; only the explicitly headed native optional-permission prompt gate is skipped by default.

- [ ] **Step 5: Update live evidence truthfully and commit**

Document the new automated coverage and retain `NOT RUN`/HTTP 412 for external rows that were not freshly executed.

```bash
git add tests/e2e docs/validation/live-smoke.md
git commit -m "test(e2e): cover navigation and upgrade boundaries"
```

### Task 7: Full Verification and Completion Audit

**Files:**
- Modify only if verification reveals a defect in an owning module.

**Interfaces:**
- Consumes every prior task's committed behavior.
- Produces fresh unit/type/build/E2E/archive evidence and a clean reviewable branch.

- [ ] **Step 1: Run the complete verification suite**

Run: `pnpm verify`

Expected: typecheck, all unit tests, and production build pass.

- [ ] **Step 2: Run loaded-extension tests**

Run: `pnpm test:e2e`

Expected: all automated cases pass with only the manual permission prompt gate skipped.

- [ ] **Step 3: Build and inspect the release archive**

Run: `pnpm zip && unzip -t .output/*-chrome.zip`

Expected: archive build and integrity check pass.

- [ ] **Step 4: Audit diff and repository state**

Run: `git diff --check && git status --short && git log --oneline main..HEAD`

Expected: no whitespace errors or unintended uncommitted files.

- [ ] **Step 5: Re-run full independent review**

Review both Standards and Spec axes against `main..HEAD`. Any Critical or Important code-actionable issue returns to the owning task. Formal network-only release blockers remain reported separately.

## Plan Self-review

- Every code-actionable review finding maps to Tasks 1–6.
- Formal network-only gates are preserved and never converted to synthetic passes.
- All behavior changes use explicit RED/GREEN cycles; pure extractions use a green regression baseline before and after.
- Public type and function names referenced across tasks are consistent.
- No placeholder implementation steps remain.
