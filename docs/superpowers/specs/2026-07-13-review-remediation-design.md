# Full Review Remediation Design

## Goal

Resolve every code-actionable finding from the full `main..d7f7957` Standards and Spec review without changing the extension's product scope, permission posture, or existing public behavior.

Formal campus/off-campus CAS validation and the live Youth HTTP 412 row remain release gates because they require external network state; they are not represented as automated passes.

## Chosen Approach

Use incremental seam extraction rather than either a behavior-only patch or a rule-engine rewrite. Existing public imports remain compatible while responsibilities move behind smaller modules. Each behavior change is test-first; structural extraction runs against the existing regression suite before and after each move.

## Behavioral Changes

### Popup runtime state

The popup reads the existing global `ExtensionSettings.enabled` value through the background-owned settings snapshot. It renders three distinct states:

- enabled: the extension is running, followed by the current-tab rewrite result;
- disabled: the extension is paused, distinct from an enabled but unmatched page;
- unavailable: the background settings snapshot could not be read.

This does not add a second master switch or let the popup write settings.

### Per-rule DNR failure isolation

Compilation and Chromium regex support checks produce per-rule validation results. If one redirect rule fails compilation or regex support:

- that redirect rule is omitted from the installed ruleset;
- other valid redirect rules, exclusion allows, and the CAS ticket allow remain active;
- the rule ID and human-readable reason are retained in the latest background reconciliation status;
- the options page marks the affected rule with its error.

Failure of a global safety rule, duplicate DNR IDs, or an atomic browser update remains a global reconciliation failure. This resolves the prior plan/spec conflict in favor of the approved design requirement: an invalid individual rule must not block unrelated rules.

### Integration evidence

Loaded-extension Playwright coverage is extended for link clicks, server-side CAS redirects, forward/back navigation, and persistence of a disabled built-in across a service-worker restart representing an extension upgrade boundary. Browser-chrome permission denial remains a headed manual gate because Playwright cannot reliably click or reject Chromium's native optional-permission prompt; deterministic controller tests continue to cover the denial state transition.

## Structural Changes

### Matcher behavior

Matcher-specific behavior moves behind one exhaustive module. Consumers call named operations for runtime matching, DNR compilation metadata, source hosts, and UI range labels instead of reimplementing `matcher.kind` cascades. Adding a matcher kind therefore produces one central exhaustiveness failure rather than shotgun changes across unrelated layers.

### Settings boundaries

The current `src/storage/settings.ts` remains a compatibility barrel. Responsibilities move into:

- settings types/defaults;
- persisted-value validation and normalization;
- storage/revision transactions;
- UI-to-background message and optional-permission clients.

Background-only mutations continue to serialize through the same global operation queue, and UI code still cannot write settings storage directly.

### Options boundaries

`initializeOptionsController` remains the public entry point but delegates:

- DOM rule and exclusion rendering;
- custom-rule permission acquisition, rollback, renewal, and release;
- controller state/revision coordination.

This keeps browser gesture-sensitive permission requests in the UI call stack while reducing the initializer's unrelated responsibilities.

### Serial queues

A shared serial queue factory owns the promise-tail error recovery pattern. The background coordination queue and per-tab navigation-state queue instantiate it independently, preserving their current isolation.

## Error Handling

- Per-rule compiler and regex errors are escaped as text and never interpolated as HTML.
- A failed settings snapshot gives the popup an explicit unavailable state rather than pretending the current page merely did not match.
- An atomic `updateDynamicRules` failure preserves the previous rules and remains visible as a global settings apply error.
- Permission denial keeps the requested feature disabled and does not weaken required permissions.

## Verification

- New unit tests must be observed failing before each behavior implementation.
- Existing unit tests must remain green after each structural extraction.
- The complete `pnpm verify` and `pnpm test:e2e` commands must pass on the final HEAD, except the explicitly manual optional-permission prompt test may remain skipped by default.
- `pnpm zip`, archive integrity, `git diff --check`, and a clean worktree are required before declaring the code branch complete.
- Formal release remains blocked until every required real-network row is freshly executed against the final HEAD.

## Self-review

- No placeholder requirements remain.
- The design keeps the current MV3 permission model and product scope.
- Per-rule isolation explicitly supersedes the conflicting throw-first implementation text in the old plan.
- Automated and manual verification boundaries are stated separately.
