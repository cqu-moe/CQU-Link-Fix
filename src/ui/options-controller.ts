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
import {
  buildOptionsModel,
  toEditableSettings,
  type OptionsRuleModel,
} from './options-model';
import type {
  CustomPermissionLeaseHandle,
  CustomPermissionLeaseRelease,
} from '../custom-permission-lease';

export type { ExactOriginPermission } from './custom-rule';

interface OriginPermission {
  origins: string[];
}

export interface OptionsControllerDependencies {
  builtInRules: readonly RuleDefinition[];
  getSnapshot: () => Promise<SettingsSnapshot | null>;
  replaceSettings: (
    settings: EditableSettings,
    expectedRevision: number,
  ) => Promise<ReplaceSettingsResult>;
  setAllCquMode: (enabled: boolean) => Promise<boolean>;
  containsPermission: (permission: OriginPermission) => Promise<boolean>;
  requestPermission: (permission: ExactOriginPermission) => Promise<boolean>;
  removePermission: (permission: OriginPermission) => Promise<boolean>;
  acquirePermissionLease: (
    permission: ExactOriginPermission,
  ) => Promise<CustomPermissionLeaseHandle | null>;
  releasePermissionLease: (
    nonce: string,
  ) => Promise<CustomPermissionLeaseRelease | null>;
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
interface CommitResult {
  outcome: CommitOutcome;
  snapshotAfterFailure?: SettingsSnapshot | null;
}

type RenderableRule = OptionsRuleModel;

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

function isReplaceResult(
  value: unknown,
  expectedRevision: number,
): value is ReplaceSettingsResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { ok?: unknown; revision?: unknown; code?: unknown; error?: unknown };
  if (candidate.ok === true) {
    return Number.isSafeInteger(expectedRevision + 1) &&
      candidate.revision === expectedRevision + 1;
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
        const locked = control instanceof HTMLInputElement && control.dataset.locked === 'true';
        control.disabled = disabled || locked;
        control.setAttribute('aria-busy', String(pending));
      }
    }
  };

  const reloadSavedSnapshot = async (): Promise<SettingsSnapshot | null> => {
    let fresh: SettingsSnapshot | null = null;
    try {
      fresh = cloneSnapshot(await dependencies.getSnapshot());
    } catch {
      fresh = null;
    }
    if (fresh) saved = fresh;
    return fresh;
  };

  const commit = async (
    candidate: EditableSettings,
    successMessage: string,
  ): Promise<CommitResult> => {
    if (!saved) return { outcome: 'failure' };
    const before = structuredClone(saved);
    let response: unknown;
    try {
      response = await dependencies.replaceSettings(candidate, before.revision);
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : '后台通信失败';
      saved = before;
      setStatus(`操作未完成：${message}`, 'error');
      return { outcome: 'failure' };
    }
    if (!isReplaceResult(response, before.revision)) {
      saved = before;
      setStatus('操作未完成：后台返回了无效结果', 'error');
      return { outcome: 'failure' };
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
      return { outcome: 'success' };
    }
    if (response.code === 'settings-conflict') {
      const fresh = await reloadSavedSnapshot();
      if (fresh) {
        saved = fresh;
        setStatus('设置已在其他页面更新；已保留较新的设置，请重新应用本次更改。', 'error');
      } else {
        saved = before;
        setStatus('设置已在其他页面更新，但无法重新读取；请刷新页面后再试。', 'error');
      }
      return { outcome: 'conflict', snapshotAfterFailure: fresh };
    }
    saved = before;
    setStatus(`操作未完成：${response.error}`, 'error');
    return { outcome: 'failure' };
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
    rule: RenderableRule,
  ): HTMLInputElement => {
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
    input.addEventListener('change', () => {
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
    rule: RenderableRule,
  ): HTMLElement => {
    const isCustom = rule.category === 'custom';
    const article = root.createElement('article');
    article.className = 'rule-card';
    const header = root.createElement('div');
    header.className = 'rule-card__header';
    const label = root.createElement('label');
    const input = renderRuleToggle(rule);
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
      remove.addEventListener('click', () => runEditable((current) => ({
        ...current,
        customRules: current.customRules.filter((item) => item.id !== rule.id),
        disabledBuiltInRuleIds: current.disabledBuiltInRuleIds.filter((id) => id !== rule.id),
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
      else for (const rule of group.rules) fieldset.append(renderRuleCard(rule));
      return fieldset;
    });
    elements.groups.replaceChildren(...groupNodes);

    const disabled = new Set(saved.settings.disabledBuiltInRuleIds);
    const customNodes = saved.settings.customRules.map((rule): RenderableRule => ({
      ...rule,
      enabled: !disabled.has(rule.id),
      locked: false,
      lockReason: null,
    })).map(renderRuleCard);
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
    const containmentOperation = Promise.allSettled(permission.origins.map((origin) => {
      try {
        return dependencies.containsPermission({ origins: [origin] });
      } catch (error) {
        return Promise.reject(error);
      }
    }));
    let leaseOperation: Promise<CustomPermissionLeaseHandle | null>;
    try {
      leaseOperation = dependencies.acquirePermissionLease(permission);
    } catch {
      leaseOperation = Promise.resolve(null);
    }
    let requestOperation: Promise<boolean>;
    try {
      requestOperation = dependencies.requestPermission(permission);
    } catch (error) {
      requestOperation = Promise.reject(error);
    }
    const coordinationOperation = Promise.allSettled([leaseOperation, requestOperation]);

    void (async () => {
      const [leaseResult, requestResult] = await coordinationOperation;
      const lease = leaseResult?.status === 'fulfilled' ? leaseResult.value : null;
      const granted = requestResult?.status === 'fulfilled' && requestResult.value;
      if (!lease) {
        elements.customError.textContent = '无法建立权限协调租约；规则未保存，访问权限已保留。';
        return;
      }
      if (!granted) {
        await dependencies.releasePermissionLease(lease.nonce);
        elements.customError.textContent = '未授予该域名的访问权限，规则未保存。';
        return;
      }
      const containment = await containmentOperation;
      const canProveOwnership = containment.every((result) => result.status === 'fulfilled');
      const newlyAcquiredOrigins = canProveOwnership
        ? permission.origins.filter((_, index) =>
          containment[index]!.status === 'fulfilled' && !containment[index]!.value,
        )
        : null;

      const result = await commit({
        ...toEditableSettings(saved!.settings),
        customRules: [...saved!.settings.customRules, rule],
      }, `已添加 ${rule.name}`);
      if (result.outcome === 'success') {
        elements.customHost.value = '';
        await dependencies.releasePermissionLease(lease.nonce);
        return;
      }
      elements.customError.textContent = result.outcome === 'conflict'
        ? '设置已更新，请重新填写并添加该规则。'
        : '规则未保存。';
      const fresh = result.snapshotAfterFailure === undefined
        ? await reloadSavedSnapshot()
        : result.snapshotAfterFailure;
      const released = await dependencies.releasePermissionLease(lease.nonce);
      if (!fresh || !released || newlyAcquiredOrigins === null) {
        elements.customError.textContent = '规则未保存，且无法安全确认权限归属；已保留访问权限。';
        return;
      }
      const requiredOrigins = new Set(released.requiredOrigins);
      const removableOrigins = newlyAcquiredOrigins.filter(
        (origin) => !requiredOrigins.has(origin),
      );
      if (removableOrigins.length > 0) {
        try {
          await dependencies.removePermission({ origins: removableOrigins });
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
