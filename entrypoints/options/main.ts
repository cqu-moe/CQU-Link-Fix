import './style.css';
import { BUILT_IN_RULES } from '../../src/rules/builtins';
import {
  getSettingsSnapshotViaBackground,
  replaceSettingsViaBackground,
} from '../../src/storage/settings-client';
import { setAllCquMode } from '../../src/storage/settings-permissions';
import { initializeOptionsController } from '../../src/ui/options-controller';
import { getDnrStatusViaBackground } from '../../src/ui/dnr-status-client';
import {
  acquireCustomPermissionLeaseViaBackground,
  releaseCustomPermissionLeaseViaBackground,
  renewCustomPermissionLeaseViaBackground,
} from '../../src/ui/custom-permission-lease-client';

let started = false;

function showExtensionVersion(): void {
  const version = document.querySelector('#extension-version');
  if (version) version.textContent = 'v' + browser.runtime.getManifest().version;
}

function showStartupFailure(): void {
  const status = document.querySelector('#status');
  if (status) status.textContent = '规则管理页面初始化失败，请刷新后重试。';
}

function startOptions(): void {
  if (started) return;
  started = true;
  showExtensionVersion();
  void initializeOptionsController(document, {
    builtInRules: BUILT_IN_RULES,
    getSnapshot: getSettingsSnapshotViaBackground,
    replaceSettings: replaceSettingsViaBackground,
    setAllCquMode,
    containsPermission: (permission) => browser.permissions.contains(permission),
    requestPermission: (permission) => browser.permissions.request(permission),
    acquirePermissionLease: acquireCustomPermissionLeaseViaBackground,
    renewPermissionLease: renewCustomPermissionLeaseViaBackground,
    releasePermissionLease: releaseCustomPermissionLeaseViaBackground,
    getDnrStatus: getDnrStatusViaBackground,
  }).catch(showStartupFailure);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startOptions, { once: true });
} else {
  startOptions();
}
