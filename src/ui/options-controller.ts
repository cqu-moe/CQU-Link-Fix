import type { RuleDefinition } from '../rules/types';
import { validateSettingsSnapshot } from '../storage/settings-codec';
import type {
  EditableSettings,
  ReplaceSettingsResult,
  SettingsSnapshot,
} from '../storage/settings-types';
import type { DnrReconciliationStatus, RuleValidationError } from '../rules/dnr-status';
import { selectNextCustomDnrId } from './custom-rule';
import { toEditableSettings, type OptionsRuleModel } from './options-model';
import {
  beginCustomRuleAddition,
  type CustomRulePermissionDependencies,
} from './options-custom-rules';
import {
  getOptionsElements,
  renderOptionsContent,
  renderOptionsControls,
  type OptionsRenderHandlers,
} from './options-renderer';

export type { ExactOriginPermission } from './custom-rule';

export interface OptionsControllerDependencies extends CustomRulePermissionDependencies {
  builtInRules: readonly RuleDefinition[];
  getSnapshot: () => Promise<SettingsSnapshot | null>;
  replaceSettings: (
    settings: EditableSettings,
    expectedRevision: number,
  ) => Promise<ReplaceSettingsResult>;
  setAllCquMode: (enabled: boolean) => Promise<boolean>;
  getDnrStatus: () => Promise<DnrReconciliationStatus | null>;
}

type CommitOutcome = 'success' | 'conflict' | 'failure';

interface CommitResult {
  outcome: CommitOutcome;
  snapshotAfterFailure?: SettingsSnapshot | null;
}

const initializedScopes = new WeakSet<Element>();

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
    (candidate.code === 'settings-conflict' ||
      candidate.code === 'settings-apply-failed' ||
      candidate.code === 'operation-failed') &&
    typeof candidate.error === 'string' && Boolean(candidate.error.trim());
}

export async function initializeOptionsController(
  root: Document,
  dependencies: OptionsControllerDependencies,
): Promise<void> {
  const scope = root.querySelector('main');
  if (!scope) throw new Error('Missing options page main element');
  if (initializedScopes.has(scope)) return;
  initializedScopes.add(scope);

  const elements = getOptionsElements(root);
  let saved: SettingsSnapshot | null = null;
  let validationErrors: RuleValidationError[] = [];
  let pending = false;

  const setStatus = (
    message: string,
    tone: 'neutral' | 'success' | 'error' = 'neutral',
  ): void => {
    elements.status.textContent = message;
    elements.status.dataset.tone = tone;
  };

  const renderControls = (): void => {
    renderOptionsControls(scope, pending, saved !== null);
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

  const reloadDnrStatus = async (): Promise<void> => {
    let status: DnrReconciliationStatus | null = null;
    try {
      status = await dependencies.getDnrStatus();
    } catch {
      status = null;
    }
    validationErrors = status ? structuredClone(status.errors) : [];
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
      await reloadDnrStatus();
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
    if (response.code === 'settings-apply-failed') {
      saved = before;
      setStatus(`规则运行状态同步失败：${response.error}。请重试；若问题持续，请刷新页面。`, 'error');
      return { outcome: 'failure' };
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
    setStatus('正在保存…');
    renderControls();
    const candidate = mutate(toEditableSettings(saved.settings));
    void commit(candidate, successMessage)
      .finally(() => {
        pending = false;
        render();
      });
  };

  const handlers: OptionsRenderHandlers = {
    toggleRule: (rule: OptionsRuleModel, enabled: boolean) => {
      runEditable((current) => {
        const disabled = new Set(current.disabledRuleIds);
        if (enabled) disabled.delete(rule.id);
        else disabled.add(rule.id);
        return { ...current, disabledRuleIds: [...disabled].sort() };
      }, `已${enabled ? '启用' : '停用'} ${rule.name}`);
    },
    deleteCustomRule: (rule: OptionsRuleModel) => {
      runEditable((current) => ({
        ...current,
        customRules: current.customRules.filter((item) => item.id !== rule.id),
        disabledRuleIds: current.disabledRuleIds.filter((id) => id !== rule.id),
      }), `已删除 ${rule.name}`);
    },
    removeExcludedHost: (host: string) => {
      runEditable((current) => ({
        ...current,
        excludedHosts: current.excludedHosts.filter((item) => item !== host),
      }), `已从排除名单移除 ${host}`);
    },
  };

  const render = (): void => {
    renderOptionsContent(
      root,
      elements,
      scope,
      saved,
      dependencies.builtInRules,
      validationErrors,
      pending,
      handlers,
    );
  };

  elements.master.addEventListener('change', () => {
    const enabled = elements.master.checked;
    runEditable((current) => ({ ...current, enabled }), enabled ? '扩展已启用' : '扩展已停用');
  });

  elements.allCqu.addEventListener('change', () => {
    if (pending || !saved) return;
    const requested = elements.allCqu.checked;
    pending = true;
    setStatus('正在申请权限…');
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
      if (!fresh) {
        setStatus('权限操作后无法重新读取设置，请刷新页面确认状态。', 'error');
      } else if (fresh.settings.enableAllCquDomains !== requested) {
        setStatus(requested
          ? '未授予全部 CQU 域名权限；全域模式保持关闭。'
          : '无法关闭全部 CQU 域名模式；通配域名权限仍然存在。', 'error');
      } else if (!changed) {
        setStatus(`后台无法确认权限操作；已按重新读取的设置显示为${requested ? '已启用' : '已关闭'}。`, 'error');
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

    const addition = beginCustomRuleAddition(
      elements.customHost.value,
      nextDnrId,
      saved.settings.customRules,
      dependencies,
      async (rule) => {
        if (!saved) return 'failure';
        setStatus('正在保存…');
        const result = await commit({
          ...toEditableSettings(saved.settings),
          customRules: [...saved.settings.customRules, rule],
        }, `已添加 ${rule.name}`);
        return result.outcome;
      },
    );
    if (!addition.started) {
      elements.customError.textContent = addition.error;
      return;
    }

    pending = true;
    setStatus('正在申请权限…');
    renderControls();
    void addition.completion
      .then((result) => {
        if (result.clearInput) elements.customHost.value = '';
        elements.customError.textContent = result.error ?? '';
      })
      .finally(() => {
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
  await reloadDnrStatus();
  setStatus(`设置已加载（版本 ${saved.revision}）`, 'success');
  render();
}
