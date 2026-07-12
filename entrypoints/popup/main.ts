import './style.css';
import { getSettingsSnapshotViaBackground } from '../../src/storage/settings-client';
import { initializePopupController } from '../../src/ui/popup-controller';

let started = false;

function showStartupFailure(): void {
  const status = document.querySelector('#status');
  const feedback = document.querySelector('#feedback');
  if (status) status.textContent = '弹窗初始化失败';
  if (feedback) feedback.textContent = '请关闭弹窗后重试';
}

function startPopup(): void {
  if (started) return;
  started = true;
  void initializePopupController(document, {
    queryActiveTabs: () => browser.tabs.query({ active: true, currentWindow: true }),
    sendMessage: (message) => browser.runtime.sendMessage(message),
    openOptionsPage: () => browser.runtime.openOptionsPage(),
    closePopup: () => window.close(),
    getSettingsSnapshot: getSettingsSnapshotViaBackground,
  }).catch(showStartupFailure);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startPopup, { once: true });
} else {
  startPopup();
}
