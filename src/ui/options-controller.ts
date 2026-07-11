import type { CustomRule, RuleDefinition } from '../rules/types';
import {
  validateSettingsSnapshot,
  type EditableSettings,
  type ExtensionSettings,
  type ReplaceSettingsResult,
  type SettingsSnapshot,
} from '../storage/settings';
import {
  customRulePermissions,
  parseCustomRule,
  selectNextCustomDnrId,
  type ExactOriginPermission,
} from './custom-rule';
import { buildOptionsModel, toEditableSettings } from './options-model';

export type { ExactOriginPermission } from './custom-rule';

export interface OptionsControllerDependencies {
  builtInRules: readonly RuleDefinition[];
  getSnapshot: () => Promise<SettingsSnapshot | null>;
  replaceSettings: (
    settings: EditableSettings,
    expectedRevision: number,
  ) => Promise<ReplaceSettingsResult>;
  setAllCquMode: (enabled: boolean) => Promise<boolean>;
  containsPermission: (permission: ExactOriginPermission) => Promise<boolean>;
  requestPermission: (permission: ExactOriginPermission) => Promise<boolean>;
  removePermission: (permission: ExactOriginPermission) => Promise<boolean>;
}

interface OptionsElements {
  master: HTMLInputElement;
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

type CommitOutcome = 'success' | 'conflict' | 'failure';

const initializedScopes = new WeakSet<Element>();

function requireElement<T extends Element>(
  root: Document,
  selector: string,
  constructor: { new (...args: never[]): T },
): T {
  const element = root.querySelector(selector);
  if (!(element instanceof constructor)) throw new Error(`Missing options element: ${selector}`);
  return element;
}

function getElements(root: Document): OptionsElements {
  return {
    master: requireElement(root, '#master-enabled', HTMLInputElement),
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

function cloneSnapshot(value: unknown): SettingsSnapshot | null {
  try {
    return validateSettingsSnapshot(value);
  } catch {
    return null;
  }
}

function isReplaceResult(value: unknown): value is ReplaceSettingsResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { ok?: unknown; revision?: unknown; code?: unknown; error?: unknown };
  if (candidate.ok === true) {
    return Number.isSafeInteger(candidate.revision) && (candidate.revision as number) >= 0;
  }
  return candidate.ok === false &&
    (candidate.code === 'settings-conflict' || candidate.code === 'operation-failed') &&
    typeof candidate.error === 'string' && Boolean(candidate.error.trim());
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

export async function initializeOptionsController(
  root: Document,
  dependencies: OptionsControllerDependencies,
): Promise<void> {
  const scope = root.querySelector('main');
  if (!scope) throw new Error('Missing options page main element');
  if (initializedScopes.has(scope)) return;
  initializedScopes.add(scope);

  const elements = getElements(root);
  let saved: SettingsSnapshot | null = null;
  let pending = false;

  const setStatus = (message: string, tone: 'neutral' | 'success' | 'error' = 'neutral'): void => {
    elements.status.textContent = message;
    elements.status.dataset.tone = tone;
  };

  const renderControls = (): void => {
    const disabled = pending || saved === null;
    for (const control of scope.querySelectorAll('button, input')) {
      if (control instanceof HTMLButtonElement || control instanceof HTMLInputElement) {
        control.disabled = disabled;
        control.setAttribute('aria-busy', String(pending));
      }
    }
  };

  const commit = async (
    candidate: EditableSettings,
    successMessage: string,
  ): Promise<CommitOutcome> => {
    if (!saved) return 'failure';
    const before = structuredClone(saved);
    let response: unknown;
    try {
      response = await dependencies.replaceSettings(candidate, before.revision);
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : '后台通信失败';
      saved = before;
      setStatus(`操作未完成：${message}`, 'error');
      return 'failure';
    }
    if (!isReplaceResult(response)) {
      saved = before;
      setStatus('操作未完成：后台返回了无效结果', 'error');
      return 'failure';
    }
    if (response.ok) {
      saved = {
        settings: {
          ...structuredClone(candidate),
          enableAllCquDomains: before.settings.enableAllCquDomains,
        },
        revision: response.revision,
      };
      setStatus(successMessage, 'success');
      return 'success';
    }
    if (response.code === 'settings-conflict') {
      let fresh: SettingsSnapshot | null = null;
      try {
        fresh = cloneSnapshot(await dependencies.getSnapshot());
      } catch {
        fresh = null;
      }
      if (fresh) {
        saved = fresh;
        setStatus('设置已在其他页面更新；已保留较新的设置，请重新应用本次更改。', 'error');
      } else {
        saved = before;
        setStatus('设置已在其他页面更新，但无法重新读取；请刷新页面后再试。', 'error');
      }
      return 'conflict';
    }
    saved = before;
    setStatus(`操作未完成：${response.error}`, 'error');
    return 'failure';
  };

  const runEditable = (
    mutate: (current: EditableSettings) => EditableSettings,
    successMessage: string,
  ): void => {
    if (pending || !saved) return;
    pending = true;
    renderControls();
    const candidate = mutate(toEditableSettings(saved.settings));
    void commit(candidate, successMessage)
      .finally(() => {
        pending = false;
        render();
      });
  };

  const renderRuleToggle = (
    rule: RuleDefinition,
    checked: boolean,
    custom: boolean,
  ): HTMLInputElement => {
    const input = root.createElement('input');
    input.type = 'checkbox';
    input.id = checkboxId(custom ? 'custom-enabled' : 'built-in-enabled', rule.id);
    input.checked = checked;
    if (custom) input.dataset.customRuleId = rule.id;
    else input.dataset.ruleId = rule.id;
    input.setAttribute('aria-label', `${checked ? '停用' : '启用'}${rule.name}`);
    input.addEventListener('change', () => {
      if (custom) {
        runEditable((current) => ({
          ...current,
          customRules: current.customRules.map((item) =>
            item.id === rule.id ? { ...item, defaultEnabled: input.checked } : item,
          ),
        }), `已${input.checked ? '启用' : '停用'} ${rule.name}`);
        return;
      }
      runEditable((current) => {
        const disabled = new Set(current.disabledBuiltInRuleIds);
        if (input.checked) disabled.delete(rule.id);
        else disabled.add(rule.id);
        return { ...current, disabledBuiltInRuleIds: [...disabled].sort() };
      }, `已${input.checked ? '启用' : '停用'} ${rule.name}`);
    });
    return input;
  };

  const renderRuleCard = (
    rule: RuleDefinition,
    checked: boolean,
    custom: boolean,
  ): HTMLElement => {
    const article = root.createElement('article');
    article.className = 'rule-card';
    const header = root.createElement('div');
    header.className = 'rule-card__header';
    const label = root.createElement('label');
    const input = renderRuleToggle(rule, checked, custom);
    label.htmlFor = input.id;
    label.textContent = rule.name;
    header.append(label, input);
    const description = root.createElement('p');
    description.textContent = rule.description;
    const range = root.createElement('code');
    range.textContent = rule.matcher.kind === 'host-port'
      ? `${rule.matcher.host}:${rule.matcher.port}`
      : rule.matcher.host;
    article.append(header, description, range);
    if (custom) {
      const remove = root.createElement('button');
      remove.type = 'button';
      remove.className = 'danger-button';
      remove.dataset.deleteCustom = rule.id;
      remove.textContent = '删除规则';
      remove.setAttribute('aria-label', `删除自定义规则 ${rule.name}`);
      remove.addEventListener('click', () => runEditable((current) => ({
        ...current,
        customRules: current.customRules.filter((item) => item.id !== rule.id),
      }), `已删除 ${rule.name}`));
      article.append(remove);
    }
    return article;
  };

  const render = (): void => {
    if (!saved) {
      elements.master.checked = false;
      elements.allCqu.checked = false;
      elements.groups.replaceChildren();
      elements.customList.replaceChildren();
      elements.excludedList.replaceChildren();
      renderControls();
      return;
    }
    elements.master.checked = saved.settings.enabled;
    elements.allCqu.checked = saved.settings.enableAllCquDomains;

    const model = buildOptionsModel(saved.settings, dependencies.builtInRules);
    const groupNodes = model.groups.map((group) => {
      const fieldset = root.createElement('fieldset');
      fieldset.dataset.ruleGroup = group.category;
      const legend = root.createElement('legend');
      legend.textContent = group.label;
      const description = root.createElement('p');
      description.className = 'group-description';
      description.textContent = group.description;
      fieldset.append(legend, description);
      if (group.rules.length === 0) appendEmptyState(root, fieldset, '当前版本暂无此类内置规则。');
      else for (const rule of group.rules) fieldset.append(renderRuleCard(rule, rule.enabled, false));
      return fieldset;
    });
    elements.groups.replaceChildren(...groupNodes);

    const customNodes = saved.settings.customRules.map((rule) =>
      renderRuleCard(rule, rule.defaultEnabled, true),
    );
    elements.customList.replaceChildren(...customNodes);
    if (customNodes.length === 0) appendEmptyState(root, elements.customList, '尚未添加本地精确规则。');

    const excludedNodes = saved.settings.excludedHosts.map((host) => {
      const row = root.createElement('div');
      row.className = 'excluded-row';
      const value = root.createElement('code');
      value.textContent = host;
      const remove = root.createElement('button');
      remove.type = 'button';
      remove.dataset.removeExcluded = host;
      remove.textContent = '恢复改写';
      remove.setAttribute('aria-label', `从排除名单移除 ${host}`);
      remove.addEventListener('click', () => runEditable((current) => ({
        ...current,
        excludedHosts: current.excludedHosts.filter((item) => item !== host),
      }), `已从排除名单移除 ${host}`));
      row.append(value, remove);
      return row;
    });
    elements.excludedList.replaceChildren(...excludedNodes);
    if (excludedNodes.length === 0) appendEmptyState(root, elements.excludedList, '没有暂停的站点。');
    renderControls();
  };

  elements.master.addEventListener('change', () => {
    const enabled = elements.master.checked;
    runEditable((current) => ({ ...current, enabled }), enabled ? '扩展已启用' : '扩展已停用');
  });

  elements.allCqu.addEventListener('change', () => {
    if (pending || !saved) return;
    const requested = elements.allCqu.checked;
    pending = true;
    renderControls();
    // This call intentionally occurs synchronously inside the user click handler.
    let permissionOperation: Promise<boolean>;
    try {
      permissionOperation = dependencies.setAllCquMode(requested);
    } catch {
      permissionOperation = Promise.resolve(false);
    }
    void (async () => {
      let changed = false;
      try {
        changed = await permissionOperation;
      } catch {
        changed = false;
      }
      let fresh: SettingsSnapshot | null = null;
      try {
        fresh = cloneSnapshot(await dependencies.getSnapshot());
      } catch {
        fresh = null;
      }
      if (fresh) saved = fresh;
      if (!changed && requested) {
        setStatus('未授予全部 CQU 域名权限；全域模式保持关闭。', 'error');
      } else if (!fresh) {
        setStatus('权限操作后无法重新读取设置，请刷新页面确认状态。', 'error');
      } else {
        setStatus(requested ? '全部 CQU 域名模式已启用' : '全部 CQU 域名模式已关闭', 'success');
      }
    })().finally(() => {
      pending = false;
      render();
    });
  });

  elements.customForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (pending || !saved) return;
    elements.customError.textContent = '';
    const nextDnrId = selectNextCustomDnrId([
      ...dependencies.builtInRules.map((rule) => rule.dnrId),
      ...saved.settings.customRules.map((rule) => rule.dnrId),
    ]);
    if (nextDnrId === null) {
      elements.customError.textContent = '自定义规则 ID 已用尽，无法继续添加。';
      return;
    }

    let rule: CustomRule;
    let permission: ExactOriginPermission;
    try {
      rule = parseCustomRule(elements.customHost.value, nextDnrId, saved.settings.customRules);
      permission = customRulePermissions(rule);
    } catch (error) {
      elements.customError.textContent = error instanceof Error ? error.message : '自定义规则无效';
      return;
    }

    pending = true;
    renderControls();
    // Start permission acquisition directly in the submit gesture, before CAS work.
    const permissionOperation = (async () => {
      const missingOrigins: string[] = [];
      for (const origin of permission.origins) {
        const alreadyGranted = await dependencies.containsPermission({ origins: [origin] });
        if (!alreadyGranted) missingOrigins.push(origin);
      }
      if (missingOrigins.length === 0) return { granted: true, rollbackPermission: null };
      const rollbackPermission: ExactOriginPermission = { origins: missingOrigins };
      const granted = await dependencies.requestPermission(rollbackPermission);
      return { granted, rollbackPermission: granted ? rollbackPermission : null };
    })();

    void (async () => {
      let acquisition: {
        granted: boolean;
        rollbackPermission: ExactOriginPermission | null;
      };
      try {
        acquisition = await permissionOperation;
      } catch {
        elements.customError.textContent = '无法检查或申请该域名的访问权限。';
        return;
      }
      if (!acquisition.granted) {
        elements.customError.textContent = '未授予该域名的访问权限，规则未保存。';
        return;
      }

      const outcome = await commit({
        ...toEditableSettings(saved!.settings),
        customRules: [...saved!.settings.customRules, rule],
      }, `已添加 ${rule.name}`);
      if (outcome === 'success') {
        elements.customHost.value = '';
        return;
      }
      elements.customError.textContent = outcome === 'conflict'
        ? '设置已更新，请重新填写并添加该规则。'
        : '规则未保存。';
      if (acquisition.rollbackPermission) {
        try {
          await dependencies.removePermission(acquisition.rollbackPermission);
        } catch {
          // Best effort: the visible save failure remains the authoritative outcome.
        }
      }
    })().finally(() => {
      pending = false;
      render();
    });
  });

  elements.master.checked = false;
  elements.allCqu.checked = false;
  setStatus('正在读取设置…');
  renderControls();
  let initial: SettingsSnapshot | null = null;
  try {
    initial = cloneSnapshot(await dependencies.getSnapshot());
  } catch {
    initial = null;
  }
  if (!initial) {
    saved = null;
    setStatus('无法读取有效设置，请刷新页面重试。', 'error');
    render();
    return;
  }
  saved = initial;
  setStatus(`设置已加载（版本 ${saved.revision}）`, 'success');
  render();
}
