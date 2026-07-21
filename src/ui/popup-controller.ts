import type { BackgroundMessage, BackgroundResponse } from '../messages';
import {
  MAX_REWRITE_TAB_ID,
  isRewriteRecord,
  type RewriteRecord,
} from '../rewrite-record';
import {
  buildPopupModel,
  type PopupModel,
  type PopupRuntimeState,
} from './popup-model';

interface PopupTab {
  id?: number | undefined;
  url?: string | undefined;
}

export interface PopupControllerDependencies {
  queryActiveTabs: () => Promise<readonly PopupTab[]>;
  sendMessage: (message: BackgroundMessage) => Promise<unknown>;
  openOptionsPage: () => Promise<void>;
  closePopup: () => void;
  getSettingsSnapshot: () => Promise<{
    settings: { enabled: boolean };
    revision: number;
  } | null>;
}

interface PopupElements {
  runtimePill: HTMLElement;
  runtimeStatus: HTMLElement;
  status: HTMLElement;
  route: HTMLElement;
  rule: HTMLElement;
  feedback: HTMLElement;
  openOriginal: HTMLButtonElement;
  excludeHost: HTMLButtonElement;
  openOptions: HTMLButtonElement;
}

function requireElement<T extends Element>(
  root: Document,
  selector: string,
  constructor: { new (...args: never[]): T },
): T {
  const element = root.querySelector(selector);
  if (!(element instanceof constructor)) throw new Error(`Missing popup element: ${selector}`);
  return element;
}

function getElements(root: Document): PopupElements {
  return {
    runtimePill: requireElement(root, '#runtime-pill', HTMLElement),
    runtimeStatus: requireElement(root, '#runtime-status', HTMLElement),
    status: requireElement(root, '#status', HTMLElement),
    route: requireElement(root, '#route', HTMLElement),
    rule: requireElement(root, '#rule', HTMLElement),
    feedback: requireElement(root, '#feedback', HTMLElement),
    openOriginal: requireElement(root, '#open-original', HTMLButtonElement),
    excludeHost: requireElement(root, '#exclude-host', HTMLButtonElement),
    openOptions: requireElement(root, '#open-options', HTMLButtonElement),
  };
}

function isGetStateSuccess(
  value: unknown,
  expectedTabId: number,
): value is Extract<BackgroundResponse, { ok: true; state: RewriteRecord | null }> {
  if (!value || typeof value !== 'object') return false;
  const response = value as { ok?: unknown; state?: unknown };
  return response.ok === true && 'state' in response &&
    (response.state === null || isRewriteRecord(response.state, expectedTabId));
}

function isMutationSuccess(value: unknown): value is { ok: true } {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as { ok?: unknown }).ok === true &&
    Object.keys(value).length === 1,
  );
}

function responseError(value: unknown, fallback: string): string {
  if (
    value &&
    typeof value === 'object' &&
    (value as { ok?: unknown }).ok === false &&
    typeof (value as { error?: unknown }).error === 'string' &&
    (value as { error: string }).error.trim()
  ) {
    return (value as { error: string }).error.trim();
  }
  return value === undefined ? '未收到后台响应' : fallback;
}

function isSafeTabId(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_REWRITE_TAB_ID;
}

function initialModel(runtimeState: PopupRuntimeState = 'unavailable'): PopupModel {
  return buildPopupModel(undefined, null, runtimeState);
}

export async function initializePopupController(
  root: Document,
  dependencies: PopupControllerDependencies,
): Promise<void> {
  const elements = getElements(root);
  let tabId: number | null = null;
  let tabUrl: string | null = null;
  let model = initialModel();
  let runtimeState: PopupRuntimeState = 'unavailable';
  let pending = false;
  let excluded = false;

  const renderControls = (): void => {
    elements.openOriginal.disabled = pending || tabId === null || !model.canBypass;
    elements.excludeHost.disabled = pending || tabId === null || !model.canExclude || excluded;
    elements.openOptions.disabled = pending;
    elements.openOriginal.setAttribute('aria-busy', String(pending));
    elements.excludeHost.setAttribute('aria-busy', String(pending));
    elements.openOptions.setAttribute('aria-busy', String(pending));
  };

  const renderModel = (): void => {
    elements.runtimeStatus.textContent = model.runtimeLabel;
    elements.runtimePill.dataset.tone = model.runtimeState === 'enabled'
      ? 'success'
      : model.runtimeState === 'disabled' ? 'muted' : 'danger';
    elements.status.textContent = model.status;
    elements.route.textContent = model.originalHost === model.targetHost
      ? model.originalHost
      : `${model.originalHost} → ${model.targetHost}`;
    elements.rule.textContent = model.ruleLabel ?? '未命中规则';
    elements.feedback.textContent = model.error ? `错误：${model.error}` : '';
    renderControls();
  };

  const runAction = async (
    progress: string,
    operation: () => Promise<void>,
  ): Promise<void> => {
    if (pending) return;
    pending = true;
    elements.feedback.textContent = progress;
    renderControls();
    try {
      await operation();
    } catch (error) {
      elements.feedback.textContent = error instanceof Error && error.message
        ? error.message
        : '操作未完成，请重试';
    } finally {
      pending = false;
      renderControls();
    }
  };

  elements.openOriginal.addEventListener('click', () => {
    if (tabId === null || !model.canBypass) return;
    void runAction('正在打开原地址…', async () => {
      const response = await dependencies.sendMessage({
        type: 'open-original-once',
        tabId: tabId as number,
      });
      if (!isMutationSuccess(response)) {
        throw new Error(responseError(response, '原地址未能打开'));
      }
      dependencies.closePopup();
    });
  });

  elements.excludeHost.addEventListener('click', () => {
    if (tabId === null || !model.canExclude || excluded) return;
    void runAction('正在暂停当前站点…', async () => {
      const response = await dependencies.sendMessage({
        type: 'exclude-current-host',
        tabId: tabId as number,
      });
      if (!isMutationSuccess(response)) {
        throw new Error(responseError(response, '当前站点未能暂停'));
      }
      excluded = true;
      elements.feedback.textContent = `已暂停 ${model.originalHost}`;
    });
  });

  elements.openOptions.addEventListener('click', () => {
    void runAction('正在打开规则管理…', async () => {
      try {
        await dependencies.openOptionsPage();
        elements.feedback.textContent = '已打开规则管理页面';
      } catch {
        throw new Error('无法打开规则管理页面');
      }
    });
  });

  elements.status.textContent = '正在读取当前页面…';
  elements.runtimeStatus.textContent = '正在读取扩展状态…';
  elements.runtimePill.dataset.tone = 'muted';
  elements.route.textContent = '—';
  elements.rule.textContent = '规则：读取中';
  elements.feedback.textContent = '';
  renderControls();

  try {
    const snapshot = await dependencies.getSettingsSnapshot();
    runtimeState = snapshot === null
      ? 'unavailable'
      : snapshot.settings.enabled ? 'enabled' : 'disabled';
  } catch {
    runtimeState = 'unavailable';
  }
  model = initialModel(runtimeState);
  elements.runtimeStatus.textContent = model.runtimeLabel;
  elements.runtimePill.dataset.tone = runtimeState === 'enabled'
    ? 'success'
    : runtimeState === 'disabled' ? 'muted' : 'danger';

  let tabs: readonly PopupTab[];
  try {
    tabs = await dependencies.queryActiveTabs();
  } catch {
    elements.status.textContent = '无法读取当前标签页';
    elements.rule.textContent = '规则：不可用';
    elements.feedback.textContent = '请关闭弹窗后重试';
    renderControls();
    return;
  }

  const tab = tabs[0];
  if (!tab || !isSafeTabId(tab.id) || typeof tab.url !== 'string' || !tab.url) {
    elements.status.textContent = '无法读取当前标签页';
    elements.rule.textContent = '规则：不可用';
    elements.feedback.textContent = '当前标签页没有可读取的地址';
    renderControls();
    return;
  }

  tabId = tab.id;
  tabUrl = tab.url;
  model = buildPopupModel(tabUrl, null, runtimeState);
  if (!model.canExclude) {
    renderModel();
    return;
  }

  let response: unknown;
  try {
    response = await dependencies.sendMessage({ type: 'get-tab-state', tabId });
  } catch {
    model = { ...model, canExclude: false };
    elements.status.textContent = '无法读取改写状态';
    elements.rule.textContent = '规则：不可用';
    elements.feedback.textContent = '后台通信失败，请重试';
    renderControls();
    return;
  }
  if (!isGetStateSuccess(response, tabId)) {
    model = { ...model, canExclude: false };
    elements.status.textContent = '无法读取改写状态';
    elements.rule.textContent = '规则：不可用';
    elements.feedback.textContent = responseError(response, '后台返回了无效状态');
    renderControls();
    return;
  }

  model = buildPopupModel(tabUrl, response.state, runtimeState);
  renderModel();
}
