import type { RuleDefinition } from '../rules/types';
import type { RuleValidationError } from '../rules/dnr-status';
import type { SettingsSnapshot } from '../storage/settings-types';
import { matcherRangeLabel } from '../rules/matcher';
import { buildOptionsModel, type OptionsRuleModel } from './options-model';

export interface OptionsElements {
  master: HTMLInputElement;
  masterState: HTMLElement;
  allCqu: HTMLInputElement;
  groups: HTMLElement;
  customForm: HTMLFormElement;
  customHost: HTMLInputElement;
  customSubmit: HTMLButtonElement;
  customList: HTMLElement;
  excludedList: HTMLElement;
  status: HTMLElement;
  customError: HTMLElement;
}

export interface OptionsRenderHandlers {
  toggleRule: (rule: OptionsRuleModel, enabled: boolean) => void;
  deleteCustomRule: (rule: OptionsRuleModel) => void;
  removeExcludedHost: (host: string) => void;
}

function requireElement<T extends Element>(
  root: Document,
  selector: string,
  constructor: { new (...args: never[]): T },
): T {
  const element = root.querySelector(selector);
  if (!(element instanceof constructor)) throw new Error(`Missing options element: ${selector}`);
  return element;
}

export function getOptionsElements(root: Document): OptionsElements {
  return {
    master: requireElement(root, '#master-enabled', HTMLInputElement),
    masterState: requireElement(root, '#master-state', HTMLElement),
    allCqu: requireElement(root, '#all-cqu-enabled', HTMLInputElement),
    groups: requireElement(root, '#built-in-groups', HTMLElement),
    customForm: requireElement(root, '#custom-rule-form', HTMLFormElement),
    customHost: requireElement(root, '#custom-host', HTMLInputElement),
    customSubmit: requireElement(root, '#custom-submit', HTMLButtonElement),
    customList: requireElement(root, '#custom-list', HTMLElement),
    excludedList: requireElement(root, '#excluded-list', HTMLElement),
    status: requireElement(root, '#status', HTMLElement),
    customError: requireElement(root, '#custom-error', HTMLElement),
  };
}

export function renderOptionsControls(
  scope: Element,
  pending: boolean,
  hasSnapshot: boolean,
): void {
  const disabled = pending || !hasSnapshot;
  for (const control of scope.querySelectorAll('button, input')) {
    if (control instanceof HTMLButtonElement || control instanceof HTMLInputElement) {
      const locked = control instanceof HTMLInputElement && control.dataset.locked === 'true';
      control.disabled = disabled || locked;
      control.setAttribute('aria-busy', String(pending));
    }
  }
}

function checkboxId(prefix: string, value: string): string {
  return `${prefix}-${value.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function appendEmptyState(root: Document, container: HTMLElement, text: string): void {
  const empty = root.createElement('p');
  empty.className = 'empty-state';
  empty.textContent = text;
  container.append(empty);
}

function renderRuleToggle(
  root: Document,
  rule: OptionsRuleModel,
  handlers: OptionsRenderHandlers,
): HTMLInputElement {
  const isCustom = rule.category === 'custom';
  const input = root.createElement('input');
  input.type = 'checkbox';
  input.id = checkboxId(isCustom ? 'custom-enabled' : 'built-in-enabled', rule.id);
  input.checked = rule.enabled;
  if (isCustom) input.dataset.customRuleId = rule.id;
  else input.dataset.ruleId = rule.id;
  if (rule.locked) {
    const reason = rule.lockReason ?? '此规则当前不可更改。';
    input.dataset.locked = 'true';
    input.disabled = true;
    input.title = reason;
    input.setAttribute('aria-disabled', 'true');
    input.setAttribute('aria-label', `${rule.name}：${reason}`);
    return input;
  }
  input.setAttribute('aria-label', `${rule.enabled ? '停用' : '启用'}${rule.name}`);
  input.addEventListener('change', () => handlers.toggleRule(rule, input.checked));
  return input;
}

function renderRuleCard(
  root: Document,
  rule: OptionsRuleModel,
  handlers: OptionsRenderHandlers,
): HTMLElement {
  const isCustom = rule.category === 'custom';
  const article = root.createElement('article');
  article.className = 'rule-card';
  const header = root.createElement('div');
  header.className = 'rule-card__header';
  const label = root.createElement('label');
  const input = renderRuleToggle(root, rule, handlers);
  label.htmlFor = input.id;
  label.textContent = rule.name;
  header.append(label, input);
  const description = root.createElement('p');
  description.textContent = rule.description;
  const range = root.createElement('code');
  range.textContent = matcherRangeLabel(rule.matcher);
  article.append(header, description, range);
  if (rule.validationError) {
    const validationError = root.createElement('p');
    validationError.className = 'rule-validation-error';
    validationError.dataset.ruleValidationErrorFor = rule.id;
    validationError.textContent = `规则未加载：${rule.validationError}`;
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
    remove.textContent = '删除规则';
    remove.setAttribute('aria-label', `删除自定义规则 ${rule.name}`);
    remove.addEventListener('click', () => handlers.deleteCustomRule(rule));
    article.append(remove);
  }
  return article;
}

export function renderOptionsContent(
  root: Document,
  elements: OptionsElements,
  scope: Element,
  snapshot: SettingsSnapshot | null,
  builtInRules: readonly RuleDefinition[],
  validationErrors: readonly RuleValidationError[],
  pending: boolean,
  handlers: OptionsRenderHandlers,
): void {
  if (!snapshot) {
    elements.master.checked = false;
    elements.masterState.textContent = '状态未知';
    elements.masterState.dataset.tone = 'muted';
    elements.allCqu.checked = false;
    elements.groups.replaceChildren();
    elements.customList.replaceChildren();
    elements.excludedList.replaceChildren();
    renderOptionsControls(scope, pending, false);
    return;
  }
  elements.master.checked = snapshot.settings.enabled;
  elements.masterState.textContent = snapshot.settings.enabled ? '运行中' : '已停用';
  elements.masterState.dataset.tone = snapshot.settings.enabled ? 'success' : 'muted';
  elements.allCqu.checked = snapshot.settings.enableAllCquDomains;

  const model = buildOptionsModel(snapshot.settings, builtInRules, validationErrors);
  const groupNodes = model.groups.map((group) => {
    const fieldset = root.createElement('fieldset');
    fieldset.dataset.ruleGroup = group.category;
    const legend = root.createElement('legend');
    legend.textContent = group.label;
    const description = root.createElement('p');
    description.className = 'group-description';
    description.textContent = group.description;
    fieldset.append(legend, description);
    if (group.rules.length === 0) {
      appendEmptyState(root, fieldset, '当前版本暂无此类内置规则。');
    } else {
      for (const rule of group.rules) fieldset.append(renderRuleCard(root, rule, handlers));
    }
    return fieldset;
  });
  elements.groups.replaceChildren(...groupNodes);

  const validationByRuleId = new Map(
    validationErrors.map((error) => [error.ruleId, error.message]),
  );
  const disabled = new Set(snapshot.settings.disabledRuleIds);
  const customNodes = snapshot.settings.customRules.map((rule): OptionsRuleModel => ({
    ...rule,
    enabled: !disabled.has(rule.id),
    locked: false,
    lockReason: null,
    validationError: validationByRuleId.get(rule.id) ?? null,
  })).map((rule) => renderRuleCard(root, rule, handlers));
  elements.customList.replaceChildren(...customNodes);
  if (customNodes.length === 0) {
    appendEmptyState(root, elements.customList, '尚未添加本地精确规则。');
  }

  const excludedNodes = snapshot.settings.excludedHosts.map((host) => {
    const row = root.createElement('div');
    row.className = 'excluded-row';
    const value = root.createElement('code');
    value.textContent = host;
    const remove = root.createElement('button');
    remove.type = 'button';
    remove.dataset.removeExcluded = host;
    remove.textContent = '恢复改写';
    remove.setAttribute('aria-label', `从排除名单移除 ${host}`);
    remove.addEventListener('click', () => handlers.removeExcludedHost(host));
    row.append(value, remove);
    return row;
  });
  elements.excludedList.replaceChildren(...excludedNodes);
  if (excludedNodes.length === 0) {
    appendEmptyState(root, elements.excludedList, '没有暂停的站点。');
  }
  renderOptionsControls(scope, pending, true);
}
