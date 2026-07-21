import { useEffect } from 'react';
import { getSettingsSnapshotViaBackground } from '../../src/storage/settings-client';
import { initializePopupController } from '../../src/ui/popup-controller';
import { BrandMark } from '../../src/ui/react/BrandMark';

function showStartupFailure(): void {
  const runtimePill = document.querySelector<HTMLElement>('#runtime-pill');
  const runtime = document.querySelector('#runtime-status');
  const status = document.querySelector('#status');
  const feedback = document.querySelector('#feedback');
  if (runtimePill) runtimePill.dataset.tone = 'danger';
  if (runtime) runtime.textContent = '扩展后台不可用';
  if (status) status.textContent = '弹窗初始化失败';
  if (feedback) feedback.textContent = '请关闭弹窗后重试';
}

export function PopupApp() {
  useEffect(() => {
    void initializePopupController(document, {
      queryActiveTabs: () => browser.tabs.query({ active: true, currentWindow: true }),
      sendMessage: (message) => browser.runtime.sendMessage(message),
      openOptionsPage: () => browser.runtime.openOptionsPage(),
      closePopup: () => window.close(),
      getSettingsSnapshot: getSettingsSnapshotViaBackground,
    }).catch(showStartupFailure);
  }, []);

  return (
    <main className="popup-shell">
      <header className="popup-status">
        <div className="popup-brand">
          <BrandMark size={20} />
          <strong>CQU Link Fix</strong>
        </div>
        <div
          id="runtime-pill"
          className="status-pill"
          data-tone="muted"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="status-pill__dot" aria-hidden="true" />
          <span id="runtime-status">正在读取扩展状态…</span>
          <span className="status-pill__separator" aria-hidden="true">·</span>
          <span id="status">正在读取当前页面…</span>
        </div>
      </header>

      <section className="popup-rule" aria-label="当前命中规则">
        <span>命中规则</span>
        <strong id="rule">读取中</strong>
        <span id="route" className="visually-hidden">—</span>
      </section>

      <section className="popup-actions" aria-label="当前页面操作">
        <button id="open-original" className="button button--primary button--wide" type="button" disabled>
          原地址打开一次
        </button>
        <button id="exclude-host" className="button button--secondary button--wide" type="button" disabled>
          暂停当前站点
        </button>
        <p id="feedback" className="popup-feedback" aria-live="polite" />
      </section>

      <footer className="popup-footer">
        <button id="open-options" className="text-link" type="button">
          管理全部规则 <span aria-hidden="true">→</span>
        </button>
      </footer>
    </main>
  );
}
