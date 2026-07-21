import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackgroundMessage } from '../../src/messages';
import type { RewriteRecord } from '../../src/rewrite-record';
import {
  initializePopupController,
  type PopupControllerDependencies,
} from '../../src/ui/popup-controller';

function rewriteRecord(overrides: Partial<RewriteRecord> = {}): RewriteRecord {
  return {
    tabId: 7,
    ruleId: 'core-sso',
    originalUrl: 'https://sso.cqu.edu.cn/login',
    targetUrl: 'https://sso-cqu-edu-cn-s.atrust.cqu.edu.cn/login',
    recordedAt: 1,
    generation: '7:1:test',
    navigationSequence: 1,
    ...overrides,
  };
}

function renderFixture(): void {
  document.body.innerHTML = `
    <main>
      <div id="runtime-pill">
        <p id="runtime-status"></p>
        <section id="status"></section>
      </div>
      <p id="route"></p>
      <p id="rule"></p>
      <p id="feedback"></p>
      <button id="open-original" type="button">原地址打开一次</button>
      <button id="exclude-host" type="button">暂停当前站点</button>
      <button id="open-options" type="button">管理全部规则</button>
    </main>
  `;
}

function button(id: string): HTMLButtonElement {
  const element = document.querySelector(`#${id}`);
  if (!(element instanceof HTMLButtonElement)) throw new Error(`Missing ${id}`);
  return element;
}

function text(id: string): string {
  return document.querySelector(`#${id}`)?.textContent ?? '';
}

function dependencies(
  overrides: Partial<PopupControllerDependencies> = {},
): PopupControllerDependencies {
  return {
    queryActiveTabs: vi.fn().mockResolvedValue([{
      id: 7,
      url: 'https://sso-cqu-edu-cn-s.atrust.cqu.edu.cn/login',
    }]),
    sendMessage: vi.fn().mockResolvedValue({ ok: true, state: rewriteRecord() }),
    openOptionsPage: vi.fn().mockResolvedValue(undefined),
    closePopup: vi.fn(),
    getSettingsSnapshot: vi.fn().mockResolvedValue({
      settings: { enabled: true },
      revision: 0,
    }),
    ...overrides,
  };
}

async function flushActions(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('popup controller', () => {
  beforeEach(renderFixture);

  it('queries the current tab and renders a trusted get-state success', async () => {
    const deps = dependencies();

    await initializePopupController(document, deps);

    expect(deps.queryActiveTabs).toHaveBeenCalledOnce();
    expect(deps.getSettingsSnapshot).toHaveBeenCalledOnce();
    expect(text('runtime-status')).toBe('扩展运行中');
    expect(document.querySelector('#runtime-pill')?.getAttribute('data-tone')).toBe('success');
    expect(deps.sendMessage).toHaveBeenCalledWith({ type: 'get-tab-state', tabId: 7 });
    expect(text('status')).toBe('已通过 aTrust 打开');
    expect(text('route')).toContain('sso.cqu.edu.cn');
    expect(text('rule')).toBe('统一身份认证');
    expect(button('open-original').disabled).toBe(false);
    expect(button('exclude-host').disabled).toBe(false);
  });

  it('distinguishes a disabled extension from an enabled unmatched page', async () => {
    await initializePopupController(document, dependencies({
      queryActiveTabs: vi.fn().mockResolvedValue([{ id: 7, url: 'https://example.com/' }]),
      getSettingsSnapshot: vi.fn().mockResolvedValue({
        settings: { enabled: false },
        revision: 3,
      }),
      sendMessage: vi.fn().mockResolvedValue({ ok: true, state: null }),
    }));

    expect(text('runtime-status')).toBe('扩展已停用');
    expect(document.querySelector('#runtime-pill')?.getAttribute('data-tone')).toBe('muted');
    expect(text('status')).toBe('当前页面未改写');
  });

  it('reports an unavailable background snapshot explicitly', async () => {
    await initializePopupController(document, dependencies({
      getSettingsSnapshot: vi.fn().mockResolvedValue(null),
    }));

    expect(text('runtime-status')).toBe('扩展后台不可用');
    expect(document.querySelector('#runtime-pill')?.getAttribute('data-tone')).toBe('danger');
  });

  it.each([
    { response: undefined, expected: '未收到后台响应' },
    { response: { ok: true }, expected: '后台返回了无效状态' },
    { response: { ok: true, state: rewriteRecord({ tabId: 8 }) }, expected: '后台返回了无效状态' },
    { response: { ok: false, code: 'operation-failed', error: '读取失败' }, expected: '读取失败' },
  ])('does not treat an invalid or failed get-state response as success: %#', async ({ response, expected }) => {
    await initializePopupController(document, dependencies({
      sendMessage: vi.fn().mockResolvedValue(response),
    }));

    expect(text('status')).toBe('无法读取改写状态');
    expect(text('feedback')).toBe(expected);
    expect(button('open-original').disabled).toBe(true);
    expect(button('exclude-host').disabled).toBe(true);
  });

  it('handles a missing active tab without messaging the background', async () => {
    const deps = dependencies({ queryActiveTabs: vi.fn().mockResolvedValue([{}]) });

    await initializePopupController(document, deps);

    expect(deps.sendMessage).not.toHaveBeenCalled();
    expect(text('status')).toBe('无法读取当前标签页');
    expect(button('open-original').disabled).toBe(true);
    expect(button('exclude-host').disabled).toBe(true);
    expect(button('open-options').disabled).toBe(false);
  });

  it('recovers visibly when querying the active tab rejects', async () => {
    const deps = dependencies({
      queryActiveTabs: vi.fn().mockRejectedValue(new Error('tabs unavailable')),
    });

    await initializePopupController(document, deps);

    expect(deps.sendMessage).not.toHaveBeenCalled();
    expect(text('status')).toBe('无法读取当前标签页');
    expect(text('feedback')).toBe('请关闭弹窗后重试');
    expect(button('open-original').disabled).toBe(true);
    expect(button('exclude-host').disabled).toBe(true);
    expect(button('open-options').disabled).toBe(false);
  });

  it('does not query stale state or enable page actions on a restricted URL', async () => {
    const deps = dependencies({
      queryActiveTabs: vi.fn().mockResolvedValue([{ id: 7, url: 'chrome://extensions/' }]),
    });

    await initializePopupController(document, deps);

    expect(deps.sendMessage).not.toHaveBeenCalled();
    expect(text('status')).toBe('此页面不支持链接改写');
    expect(button('open-original').disabled).toBe(true);
    expect(button('exclude-host').disabled).toBe(true);
  });

  it('sends one exact bypass message while pending and closes only after success', async () => {
    let resolveBypass: ((response: unknown) => void) | undefined;
    const bypassResponse = new Promise<unknown>((resolve) => { resolveBypass = resolve; });
    const sendMessage = vi.fn((message: BackgroundMessage) => {
      if (message.type === 'get-tab-state') return Promise.resolve({ ok: true, state: rewriteRecord() });
      return bypassResponse;
    });
    const deps = dependencies({ sendMessage });
    await initializePopupController(document, deps);

    button('open-original').click();
    button('open-original').click();

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenLastCalledWith({ type: 'open-original-once', tabId: 7 });
    expect(button('open-original').disabled).toBe(true);
    expect(button('exclude-host').disabled).toBe(true);
    expect(deps.closePopup).not.toHaveBeenCalled();

    resolveBypass?.({ ok: true });
    await flushActions();
    expect(deps.closePopup).toHaveBeenCalledOnce();
  });

  it('keeps the popup open and exposes mutation errors', async () => {
    const sendMessage = vi.fn((message: BackgroundMessage) => Promise.resolve(
      message.type === 'get-tab-state'
        ? { ok: true, state: rewriteRecord() }
        : { ok: false, code: 'settings-conflict', error: '设置版本冲突' },
    ));
    const deps = dependencies({ sendMessage });
    await initializePopupController(document, deps);

    button('open-original').click();
    await flushActions();

    expect(text('feedback')).toBe('设置版本冲突');
    expect(deps.closePopup).not.toHaveBeenCalled();
    expect(button('open-original').disabled).toBe(false);
  });

  it.each([
    { action: 'open-original', failure: '打开通信失败' },
    { action: 'exclude-host', failure: '暂停通信失败' },
  ])('recovers controls when $action messaging rejects', async ({ action, failure }) => {
    const sendMessage = vi.fn((message: BackgroundMessage) => {
      if (message.type === 'get-tab-state') {
        return Promise.resolve({ ok: true, state: rewriteRecord() });
      }
      return Promise.reject(new Error(failure));
    });
    const deps = dependencies({ sendMessage });
    await initializePopupController(document, deps);

    button(action).click();
    await flushActions();

    expect(text('feedback')).toBe(failure);
    expect(deps.closePopup).not.toHaveBeenCalled();
    expect(button('open-original').disabled).toBe(false);
    expect(button('exclude-host').disabled).toBe(false);
  });

  it('rejects a get-state-shaped response to a mutation', async () => {
    const sendMessage = vi.fn((message: BackgroundMessage) => Promise.resolve(
      message.type === 'get-tab-state'
        ? { ok: true, state: rewriteRecord() }
        : { ok: true, state: rewriteRecord() },
    ));
    const deps = dependencies({ sendMessage });
    await initializePopupController(document, deps);

    button('open-original').click();
    await flushActions();

    expect(text('feedback')).toBe('原地址未能打开');
    expect(deps.closePopup).not.toHaveBeenCalled();
    expect(button('open-original').disabled).toBe(false);
  });

  it('opens options once while pending and shows confirmation after success', async () => {
    let resolveOptions: (() => void) | undefined;
    const opening = new Promise<void>((resolve) => { resolveOptions = resolve; });
    const deps = dependencies({
      openOptionsPage: vi.fn().mockReturnValue(opening),
    });
    await initializePopupController(document, deps);

    button('open-options').click();
    button('open-options').click();

    expect(deps.openOptionsPage).toHaveBeenCalledOnce();
    expect(button('open-options').disabled).toBe(true);
    resolveOptions?.();
    await flushActions();

    expect(text('feedback')).toBe('已打开规则管理页面');
    expect(button('open-options').disabled).toBe(false);
  });

  it('confirms a successful exclusion and catches options errors', async () => {
    const sendMessage = vi.fn((message: BackgroundMessage) => Promise.resolve(
      message.type === 'get-tab-state' ? { ok: true, state: rewriteRecord() } : { ok: true },
    ));
    const deps = dependencies({
      sendMessage,
      openOptionsPage: vi.fn().mockRejectedValue(new Error('options unavailable')),
    });
    await initializePopupController(document, deps);

    button('exclude-host').click();
    await flushActions();
    expect(sendMessage).toHaveBeenLastCalledWith({ type: 'exclude-current-host', tabId: 7 });
    expect(text('feedback')).toContain('已暂停 sso.cqu.edu.cn');

    button('open-options').click();
    await flushActions();
    expect(text('feedback')).toBe('无法打开规则管理页面');
  });
});
