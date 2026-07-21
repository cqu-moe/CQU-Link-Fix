# Built-in Rule List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将设置页内置规则改为无次级标题的连续规则列表。

**Architecture:** `buildOptionsModel` 直接返回按定义顺序生成的 `rules`；renderer 将每条规则直接挂到 `#built-in-groups`。内部类别继续保留给规则系统使用，但设置页不再根据类别创建 fieldset。

**Tech Stack:** TypeScript, React 19 shell, WXT 0.20, Vitest 4, Playwright, CSS custom properties

## Global Constraints

- 当前只显示“统一身份认证”和“团委官网链接”，不添加未实现规则。
- 不渲染次级组标题、组说明或 IP 空态。
- 后续域名、IP 和链接规则统一按内置定义顺序追加。
- 规则行为、开关动效、稳定 ID 和版本号 `0.3.0` 不变。

---

### Task 1: 扁平化内置规则模型与渲染

**Files:**
- Modify: `tests/unit/options-model.test.ts`
- Modify: `tests/unit/options-controller.test.ts`
- Modify: `tests/unit/design-system.test.ts`
- Modify: `src/ui/options-model.ts`
- Modify: `src/ui/options-renderer.ts`
- Modify: `entrypoints/options/style.css`

**Interfaces:**
- Consumes: `buildOptionsModel(settings, builtInRules, validationErrors)` and `renderRuleCard(...)`.
- Produces: `OptionsModel { rules: OptionsRuleModel[] }` and direct child `.rule-row` elements under `#built-in-groups`.

- [ ] **Step 1: Write failing flat-list tests**

Assert `model.rules.map(rule => rule.id)` equals `['core-sso', 'addon-youth-public']`. Assert `#built-in-groups` has zero `[data-rule-group]`, zero `legend`, zero `.group-description`, zero `.empty-state`, and two direct `.rule-row` children.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm vitest run tests/unit/options-model.test.ts tests/unit/options-controller.test.ts tests/unit/design-system.test.ts
```

Expected: FAIL because the current model returns `groups` and renderer creates three fieldsets.

- [ ] **Step 3: Implement the minimal flat list**

Change `OptionsModel` to expose `rules`, map every `builtInRules` entry to `OptionsRuleModel`, and replace the renderer's group mapping with:

```ts
const ruleNodes = model.rules.map((rule) => renderRuleCard(root, rule, handlers));
elements.groups.replaceChildren(...ruleNodes);
if (ruleNodes.length === 0) {
  appendEmptyState(root, elements.groups, '当前版本暂无内置规则。');
}
```

Remove fieldset/group CSS and use `.rule-groups > .rule-row + .rule-row { border-top: 1px solid var(--border-soft); }`, with the base `.rule-row` having no unconditional top border.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the same focused Vitest command and expect all selected test files to pass.

- [ ] **Step 5: Run complete verification**

Run:

```bash
pnpm verify
pnpm test:e2e
```

Expected: typecheck, all unit tests, production build, and all non-manual Playwright tests pass.
