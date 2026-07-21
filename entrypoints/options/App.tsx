import { useEffect } from 'react';
import { BUILT_IN_RULES } from '../../src/rules/builtins';
import {
  getSettingsSnapshotViaBackground,
  replaceSettingsViaBackground,
} from '../../src/storage/settings-client';
import { setAllCquMode } from '../../src/storage/settings-permissions';
import { initializeOptionsController } from '../../src/ui/options-controller';
import { initializeOptionsNavigation } from '../../src/ui/options-navigation';
import { getDnrStatusViaBackground } from '../../src/ui/dnr-status-client';
import {
  acquireCustomPermissionLeaseViaBackground,
  releaseCustomPermissionLeaseViaBackground,
  renewCustomPermissionLeaseViaBackground,
} from '../../src/ui/custom-permission-lease-client';
import { BrandMark } from '../../src/ui/react/BrandMark';

const sections = [
  ['overview', '01', '全局状态'],
  ['built-in', '02', '内置规则'],
  ['custom', '03', '自定义规则'],
  ['excluded', '04', '暂停站点'],
] as const;

function SectionHeading({ number, title, id, children }: {
  number: string;
  title: string;
  id: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="section-heading">
      <span className="section-heading__number">{number}</span>
      {number === '01' ? <h1 id={id}>{title}</h1> : <h2 id={id}>{title}</h2>}
      {children ? <div className="section-heading__aside">{children}</div> : null}
    </div>
  );
}

function showStartupFailure(): void {
  const status = document.querySelector<HTMLElement>('#status');
  if (status) {
    status.dataset.tone = 'danger';
    status.textContent = '规则管理页面初始化失败，请刷新后重试。';
  }
}

export function OptionsApp() {
  useEffect(() => {
    const version = document.querySelector('#extension-version');
    if (version) version.textContent = 'v' + browser.runtime.getManifest().version;
    const disposeNavigation = initializeOptionsNavigation(document);
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
    return disposeNavigation;
  }, []);

  return (
    <>
      <header className="settings-appbar" data-console-app-bar>
        <a className="settings-appbar__inner" href="#overview" aria-label="CQU Link Fix 设置首页" data-console-brand>
          <BrandMark size={22} />
          <strong>CQU Link Fix</strong>
        </a>
      </header>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="设置分区" data-console-navigation>
          {sections.map(([id, number, label], index) => (
            <a
              key={id}
              href={`#${id}`}
              data-section-link={id}
              aria-current={index === 0 ? 'location' : undefined}
            >
              <span>{number}</span>{label}
            </a>
          ))}
        </nav>

        <main className="settings-content" data-console-workspace>
          <section id="overview" className="settings-section" data-console-section aria-labelledby="overview-heading">
            <SectionHeading number="01" title="全局状态" id="overview-heading">
              <span id="master-state" className="status-pill" data-tone="muted">正在读取</span>
            </SectionHeading>
            <div className="panel settings-global-panel">
              <div className="settings-switch-row">
                <div>
                  <label htmlFor="master-enabled">启用链接改写</label>
                  <p>停用后保留全部本地规则，但不执行新的改写。</p>
                </div>
                <input id="master-enabled" type="checkbox" role="switch" />
              </div>
              <div className="settings-permission-block" data-settings-dependent>
                <div className="settings-switch-row settings-switch-row--flush">
                  <div>
                    <label htmlFor="all-cqu-enabled">全部 CQU 域名模式</label>
                    <p>将未单独列出的 CQU 站点也尝试通过 aTrust 打开。</p>
                  </div>
                  <input id="all-cqu-enabled" type="checkbox" role="switch" />
                </div>
              </div>
              <p id="status" className="visually-hidden" role="status" aria-live="polite">正在读取设置…</p>
            </div>
          </section>

          <div className="settings-dependent" data-settings-dependent>
            <section id="built-in" className="settings-section" data-console-section aria-labelledby="built-in-heading">
              <SectionHeading number="02" title="内置规则" id="built-in-heading" />
              <div id="built-in-groups" className="panel rule-groups" />
            </section>

            <section id="custom" className="settings-section" data-console-section aria-labelledby="custom-heading">
              <SectionHeading number="03" title="自定义规则" id="custom-heading" />
              <div className="panel">
                <form id="custom-rule-form" className="custom-form" noValidate>
                  <input
                    id="custom-host"
                    name="host"
                    type="text"
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="library.cqu.edu.cn"
                    aria-label="自定义规则域名"
                    aria-describedby="custom-help custom-error"
                  />
                  <button id="custom-submit" className="button button--primary" type="submit">申请权限并添加</button>
                </form>
                <p id="custom-help" className="form-help">输入纯域名，不含协议与路径；添加时会请求该站点的访问权限。</p>
                <p id="custom-error" className="form-error" role="alert" />
                <div id="custom-list" className="rule-list" aria-label="本地自定义规则" />
              </div>
            </section>

            <section id="excluded" className="settings-section" data-console-section aria-labelledby="excluded-heading">
              <SectionHeading number="04" title="暂停站点" id="excluded-heading" />
              <div id="excluded-list" className="panel excluded-list" />
            </section>
          </div>
        </main>
      </div>

      <footer className="page-footer">
        <span>CQU Link Fix · 设置仅保存在本机</span>
        <span id="extension-version">v—</span>
      </footer>
    </>
  );
}
