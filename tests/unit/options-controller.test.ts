import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CUSTOM_PERMISSION_LEASE_TTL_MS } from '../../src/custom-permission-lease';
import { BUILT_IN_RULES } from '../../src/rules/builtins';
import { compileDynamicRules } from '../../src/rules/dnr';
import { getEnabledRules } from '../../src/rules/registry';
import type { CustomRule } from '../../src/rules/types';
import {
  DEFAULT_SETTINGS,
  type EditableSettings,
  type ExtensionSettings,
  type ReplaceSettingsResult,
  type SettingsSnapshot,
} from '../../src/storage/settings';
import {
  initializeOptionsController,
  type ExactOriginPermission,
  type OptionsControllerDependencies,
} from '../../src/ui/options-controller';

function fixture(): void {
  document.body.textContent = '';
  const main = document.createElement('main');
  const master = document.createElement('input');
  master.id = 'master-enabled';
  master.type = 'checkbox';
  const allCqu = document.createElement('input');
  allCqu.id = 'all-cqu-enabled';
  allCqu.type = 'checkbox';
  const groups = document.createElement('div');
  groups.id = 'built-in-groups';
  const customForm = document.createElement('form');
  customForm.id = 'custom-rule-form';
  const customInput = document.createElement('input');
  customInput.id = 'custom-host';
  const customSubmit = document.createElement('button');
  customSubmit.id = 'custom-submit';
  customSubmit.type = 'submit';
  customForm.append(customInput, customSubmit);
  for (const id of ['custom-list', 'excluded-list', 'status', 'custom-error']) {
    const element = document.createElement('div');
    element.id = id;
    main.append(element);
  }
  main.append(master, allCqu, groups, customForm);
  document.body.append(main);
}

function snapshot(
  settings: ExtensionSettings = DEFAULT_SETTINGS,
  revision = 3,
): SettingsSnapshot {
  return { settings: structuredClone(settings), revision };
}

function dependencies(
  overrides: Partial<OptionsControllerDependencies> = {},
): OptionsControllerDependencies {
  return {
    builtInRules: BUILT_IN_RULES,
    getSnapshot: vi.fn().mockResolvedValue(snapshot()),
    replaceSettings: vi.fn().mockImplementation(async (_settings, expectedRevision) => ({
      ok: true as const,
      revision: expectedRevision + 1,
    })),
    setAllCquMode: vi.fn().mockResolvedValue(true),
    containsPermission: vi.fn(async (permission) => permission.origins.length === 2),
    requestPermission: vi.fn().mockResolvedValue(true),
    acquirePermissionLease: vi.fn().mockResolvedValue({ nonce: crypto.randomUUID() }),
    renewPermissionLease: vi.fn().mockResolvedValue(true),
    releasePermissionLease: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function checkbox(id: string): HTMLInputElement {
  const element = document.querySelector(`#${id}`);
  if (!(element instanceof HTMLInputElement)) throw new Error(`Missing checkbox ${id}`);
  return element;
}

function button(id: string): HTMLButtonElement {
  const element = document.querySelector(`#${id}`);
  if (!(element instanceof HTMLButtonElement)) throw new Error(`Missing button ${id}`);
  return element;
}

function text(id: string): string {
  return document.querySelector(`#${id}`)?.textContent ?? '';
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('options controller', () => {
  beforeEach(fixture);
  afterEach(() => vi.useRealTimers());

  it('loads only the background snapshot and renders saved grouped state', async () => {
    const deps = dependencies();

    await initializeOptionsController(document, deps);

    expect(deps.getSnapshot).toHaveBeenCalledOnce();
    expect(checkbox('master-enabled').checked).toBe(true);
    expect(document.querySelectorAll('[data-rule-id]').length).toBe(BUILT_IN_RULES.length);
    expect(document.querySelectorAll('[data-rule-group]').length).toBe(4);
    expect(text('status')).toContain('设置已加载');
  });

  it('renders a default-off built-in as a locked accessible control that pending state cannot unlock', async () => {
    const defaultDisabled = {
      ...BUILT_IN_RULES[0]!,
      id: 'default-disabled',
      dnrId: 9_999,
      defaultEnabled: false,
    };
    const deps = dependencies({ builtInRules: [defaultDisabled] });
    await initializeOptionsController(document, deps);
    const locked = document.querySelector('[data-rule-id="default-disabled"]') as HTMLInputElement;

    expect(locked.disabled).toBe(true);
    expect(locked.getAttribute('aria-disabled')).toBe('true');
    expect(locked.title).toContain('默认关闭');
    const explanation = document.querySelector('[data-lock-reason-for="default-disabled"]');
    expect(explanation?.textContent).toContain('默认关闭');
    expect(locked.getAttribute('aria-describedby')).toBe(explanation?.id);
    locked.click();
    expect(deps.replaceSettings).not.toHaveBeenCalled();

    checkbox('master-enabled').click();
    await settle();
    const rerendered = document.querySelector('[data-rule-id="default-disabled"]') as HTMLInputElement;
    expect(rerendered.disabled).toBe(true);
  });

  it('saves the master switch with the current revision and no permission-backed field', async () => {
    const deps = dependencies();
    await initializeOptionsController(document, deps);

    checkbox('master-enabled').click();
    await settle();

    expect(deps.replaceSettings).toHaveBeenCalledOnce();
    const [editable, revision] = vi.mocked(deps.replaceSettings).mock.calls[0]!;
    expect(revision).toBe(3);
    expect(editable).toMatchObject({ enabled: false });
    expect(editable).not.toHaveProperty('enableAllCquDomains');
    expect(checkbox('master-enabled').checked).toBe(false);
  });

  it('guards duplicate writes and keeps saved state on an operation failure', async () => {
    let resolve!: (result: ReplaceSettingsResult) => void;
    const pending = new Promise<ReplaceSettingsResult>((next) => { resolve = next; });
    const deps = dependencies({ replaceSettings: vi.fn().mockReturnValue(pending) });
    await initializeOptionsController(document, deps);

    checkbox('master-enabled').click();
    checkbox('master-enabled').click();

    expect(deps.replaceSettings).toHaveBeenCalledOnce();
    expect(checkbox('master-enabled').disabled).toBe(true);
    resolve({ ok: false, code: 'operation-failed', error: '保存失败' });
    await settle();

    expect(checkbox('master-enabled').checked).toBe(true);
    expect(text('status')).toContain('保存失败');
  });

  it('shows an actionable reconciliation error for settings-apply-failed', async () => {
    const deps = dependencies({
      replaceSettings: vi.fn().mockResolvedValue({
        ok: false,
        code: 'settings-apply-failed',
        error: 'Settings application failed: DNR unavailable',
      }),
    });
    await initializeOptionsController(document, deps);

    checkbox('master-enabled').click();
    await settle();

    expect(checkbox('master-enabled').checked).toBe(true);
    expect(text('status')).toContain('规则运行状态同步失败');
    expect(text('status')).toContain('DNR unavailable');
  });

  it.each([3, 2, 5])(
    'rejects non-successor CAS revision %s without changing saved UI state',
    async (revision) => {
      const deps = dependencies({
        replaceSettings: vi.fn().mockResolvedValue({ ok: true, revision }),
      });
      await initializeOptionsController(document, deps);

      checkbox('master-enabled').click();
      await settle();

      expect(checkbox('master-enabled').checked).toBe(true);
      expect(text('status')).toContain('无效结果');
      checkbox('master-enabled').click();
      await settle();
      expect(deps.replaceSettings).toHaveBeenNthCalledWith(2, expect.anything(), 3);
    },
  );

  it('lets two clients race once, reloads the conflict loser, and never retries', async () => {
    let stored = snapshot();
    const replace = vi.fn(async (
      editable: EditableSettings,
      expectedRevision: number,
    ): Promise<ReplaceSettingsResult> => {
      if (expectedRevision !== stored.revision) {
        return { ok: false, code: 'settings-conflict', error: 'conflict' };
      }
      stored = {
        settings: { ...structuredClone(editable), enableAllCquDomains: stored.settings.enableAllCquDomains },
        revision: stored.revision + 1,
      };
      return { ok: true, revision: stored.revision };
    });
    const getSnapshot = vi.fn(async () => structuredClone(stored));
    const first = dependencies({ getSnapshot, replaceSettings: replace });
    await initializeOptionsController(document, first);
    const firstMaster = checkbox('master-enabled');

    fixture();
    const second = dependencies({ getSnapshot, replaceSettings: replace });
    await initializeOptionsController(document, second);
    const secondMaster = checkbox('master-enabled');

    firstMaster.checked = false;
    firstMaster.dispatchEvent(new Event('change'));
    await settle();
    secondMaster.click();
    await settle();

    expect(replace).toHaveBeenCalledTimes(2);
    expect(getSnapshot).toHaveBeenCalledTimes(3);
    expect(secondMaster.checked).toBe(false);
    expect(text('status')).toContain('较新的设置');
    expect(text('status')).toContain('重新应用');
  });

  it('calls the all-CQU permission flow directly, then reloads regardless of success', async () => {
    const calls: string[] = [];
    let current = snapshot();
    const deps = dependencies({
      setAllCquMode: vi.fn((enabled) => {
        calls.push('set-mode');
        current = snapshot({ ...DEFAULT_SETTINGS, enableAllCquDomains: enabled }, 4);
        return Promise.resolve(true);
      }),
      getSnapshot: vi.fn(async () => {
        calls.push('reload');
        return structuredClone(current);
      }),
    });
    await initializeOptionsController(document, deps);
    calls.length = 0;

    checkbox('all-cqu-enabled').click();

    expect(calls).toEqual(['set-mode']);
    await settle();
    expect(calls).toEqual(['set-mode', 'reload']);
    expect(checkbox('all-cqu-enabled').checked).toBe(true);
  });

  it('visibly returns all-CQU mode to disabled after denial and reload', async () => {
    const deps = dependencies({
      setAllCquMode: vi.fn().mockResolvedValue(false),
      getSnapshot: vi.fn().mockResolvedValue(snapshot()),
    });
    await initializeOptionsController(document, deps);

    checkbox('all-cqu-enabled').click();
    await settle();

    expect(checkbox('all-cqu-enabled').checked).toBe(false);
    expect(text('status')).toContain('未授予');
    expect(deps.getSnapshot).toHaveBeenCalledTimes(2);
  });

  it('shows failed all-CQU disable as an error and keeps the reloaded switch enabled', async () => {
    const enabled = snapshot({ ...DEFAULT_SETTINGS, enableAllCquDomains: true }, 4);
    const deps = dependencies({
      setAllCquMode: vi.fn().mockResolvedValue(false),
      getSnapshot: vi.fn().mockResolvedValue(enabled),
    });
    await initializeOptionsController(document, deps);

    checkbox('all-cqu-enabled').click();
    await settle();

    expect(checkbox('all-cqu-enabled').checked).toBe(true);
    expect(text('status')).toContain('无法关闭');
    expect(text('status')).not.toContain('已关闭');
  });

  it('contains a synchronous all-CQU failure, reloads, and restores controls', async () => {
    const deps = dependencies({
      setAllCquMode: vi.fn(() => { throw new Error('permission API unavailable'); }),
      getSnapshot: vi.fn().mockResolvedValue(snapshot()),
    });
    await initializeOptionsController(document, deps);

    expect(() => checkbox('all-cqu-enabled').click()).not.toThrow();
    await settle();

    expect(deps.getSnapshot).toHaveBeenCalledTimes(2);
    expect(checkbox('all-cqu-enabled').checked).toBe(false);
    expect(checkbox('all-cqu-enabled').disabled).toBe(false);
    expect(text('status')).toContain('未授予');
  });

  it('requests full exact custom origins synchronously before containment resolves and before CAS', async () => {
    const order: string[] = [];
    const containsResolvers: Array<(value: boolean) => void> = [];
    const deps = dependencies({
      containsPermission: vi.fn(() => {
        order.push('contains');
        return new Promise<boolean>((resolve) => containsResolvers.push(resolve));
      }),
      requestPermission: vi.fn(async () => { order.push('request'); return true; }),
      acquirePermissionLease: vi.fn(async () => {
        order.push('lease');
        return { nonce: crypto.randomUUID() };
      }),
      replaceSettings: vi.fn(async () => {
        order.push('replace');
        return { ok: true as const, revision: 4 };
      }),
    });
    await initializeOptionsController(document, deps);
    const input = document.querySelector('#custom-host') as HTMLInputElement;
    input.value = 'LIBRARY.CQU.EDU.CN';

    button('custom-submit').click();

    const exact: ExactOriginPermission = {
      origins: [
        '*://library.cqu.edu.cn/*',
        'https://library-cqu-edu-cn-s.atrust.cqu.edu.cn/*',
      ],
    };
    expect(order).toEqual(['contains', 'contains', 'lease', 'request']);
    expect(deps.requestPermission).toHaveBeenCalledWith(exact);
    for (const resolve of containsResolvers) resolve(false);
    await vi.waitFor(() => expect(containsResolvers).toHaveLength(3));
    containsResolvers[2]!(true);
    await settle();

    expect(order).toEqual(['contains', 'contains', 'lease', 'request', 'contains', 'replace']);
    expect(deps.containsPermission).toHaveBeenNthCalledWith(1, { origins: [exact.origins[0]!] });
    expect(deps.containsPermission).toHaveBeenNthCalledWith(2, { origins: [exact.origins[1]!] });
    expect(deps.requestPermission).toHaveBeenCalledWith(exact);
    const editable = vi.mocked(deps.replaceSettings).mock.calls[0]![0];
    expect(editable.customRules[0]).toMatchObject({
      dnrId: 10_001,
      matcher: { kind: 'host', host: 'library.cqu.edu.cn' },
    });
    expect(deps.releasePermissionLease).toHaveBeenCalledOnce();
  });

  it('does not save or request an IP permission for invalid and duplicate hosts', async () => {
    const existing: CustomRule = {
      id: crypto.randomUUID(), dnrId: 10_001, name: 'library.cqu.edu.cn',
      description: 'existing', category: 'custom', defaultEnabled: true,
      matcher: { kind: 'host', host: 'library.cqu.edu.cn' }, transformer: 'atrust-domain',
    };
    const deps = dependencies({
      getSnapshot: vi.fn().mockResolvedValue(snapshot({ ...DEFAULT_SETTINGS, customRules: [existing] })),
    });
    await initializeOptionsController(document, deps);
    const input = document.querySelector('#custom-host') as HTMLInputElement;

    input.value = '1.1.1.1:8000';
    button('custom-submit').click();
    await settle();
    input.value = 'library.cqu.edu.cn';
    button('custom-submit').click();
    await settle();

    expect(deps.containsPermission).not.toHaveBeenCalled();
    expect(deps.requestPermission).not.toHaveBeenCalled();
    expect(deps.replaceSettings).not.toHaveBeenCalled();
    expect(text('custom-error')).not.toBe('');
  });

  it('does not save when custom permission is denied', async () => {
    const deps = dependencies({ requestPermission: vi.fn().mockResolvedValue(false) });
    await initializeOptionsController(document, deps);
    (document.querySelector('#custom-host') as HTMLInputElement).value = 'library.cqu.edu.cn';

    button('custom-submit').click();
    await settle();

    expect(deps.replaceSettings).not.toHaveBeenCalled();
    expect(text('custom-error')).toContain('未授予');
  });

  it('guards a double submit while custom permission acquisition is pending', async () => {
    let resolveRequest!: (granted: boolean) => void;
    const request = new Promise<boolean>((resolve) => { resolveRequest = resolve; });
    const deps = dependencies({ requestPermission: vi.fn().mockReturnValue(request) });
    await initializeOptionsController(document, deps);
    (document.querySelector('#custom-host') as HTMLInputElement).value = 'library.cqu.edu.cn';

    button('custom-submit').click();
    button('custom-submit').click();
    await vi.waitFor(() => expect(deps.requestPermission).toHaveBeenCalledOnce());

    expect(button('custom-submit').disabled).toBe(true);
    resolveRequest(true);
    await settle();
    expect(deps.replaceSettings).toHaveBeenCalledOnce();
  });

  it('does not persist a rule when a concurrent cleanup removes the grant before commit', async () => {
    const containsPermission = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    const deps = dependencies({ containsPermission });
    await initializeOptionsController(document, deps);
    (document.querySelector('#custom-host') as HTMLInputElement).value = 'library.cqu.edu.cn';

    button('custom-submit').click();
    await settle();

    expect(deps.replaceSettings).not.toHaveBeenCalled();
    expect(deps.releasePermissionLease).toHaveBeenCalledWith(expect.any(String));
    expect(text('custom-error')).toContain('权限状态已变化');
  });

  it('rolls back only a newly acquired exact grant after CAS failure', async () => {
    const deps = dependencies({
      containsPermission: vi.fn(async (permission) => permission.origins.length === 2),
      requestPermission: vi.fn().mockResolvedValue(true),
      replaceSettings: vi.fn().mockResolvedValue({
        ok: false, code: 'operation-failed', error: '保存失败',
      }),
    });
    await initializeOptionsController(document, deps);
    (document.querySelector('#custom-host') as HTMLInputElement).value = 'library.cqu.edu.cn';

    button('custom-submit').click();
    await settle();

    expect(deps.releasePermissionLease).toHaveBeenCalledWith(
      expect.any(String),
      [
        '*://library.cqu.edu.cn/*',
        'https://library-cqu-edu-cn-s.atrust.cqu.edu.cn/*',
      ],
    );
    expect(deps.getSnapshot).toHaveBeenCalledOnce();
    expect(document.querySelectorAll('#custom-list [data-custom-rule-id]').length).toBe(0);
  });

  it('preserves an existing origin and rolls back only the origin newly acquired by this submit', async () => {
    const source = '*://library.cqu.edu.cn/*';
    const target = 'https://library-cqu-edu-cn-s.atrust.cqu.edu.cn/*';
    const deps = dependencies({
      containsPermission: vi.fn(async (permission) => permission.origins[0] === source),
      requestPermission: vi.fn().mockResolvedValue(true),
      replaceSettings: vi.fn().mockResolvedValue({
        ok: false, code: 'operation-failed', error: '保存失败',
      }),
    });
    await initializeOptionsController(document, deps);
    (document.querySelector('#custom-host') as HTMLInputElement).value = 'library.cqu.edu.cn';

    button('custom-submit').click();
    await settle();

    expect(deps.requestPermission).toHaveBeenCalledWith({ origins: [source, target] });
    expect(deps.releasePermissionLease).toHaveBeenCalledWith(expect.any(String), [target]);
    expect(deps.getSnapshot).toHaveBeenCalledOnce();
  });

  it('does not remove a pre-existing grant after a conflict', async () => {
    const deps = dependencies({
      containsPermission: vi.fn().mockResolvedValue(true),
      replaceSettings: vi.fn().mockResolvedValue({
        ok: false, code: 'settings-conflict', error: 'conflict',
      }),
    });
    await initializeOptionsController(document, deps);
    (document.querySelector('#custom-host') as HTMLInputElement).value = 'library.cqu.edu.cn';

    button('custom-submit').click();
    await settle();

    expect(deps.requestPermission).toHaveBeenCalledWith({
      origins: [
        '*://library.cqu.edu.cn/*',
        'https://library-cqu-edu-cn-s.atrust.cqu.edu.cn/*',
      ],
    });
    expect(deps.releasePermissionLease).toHaveBeenCalledWith(expect.any(String), []);
    expect(deps.getSnapshot).toHaveBeenCalledTimes(2);
  });

  it('retains a winning same-host grant when a second controller loses CAS', async () => {
    let stored = snapshot();
    const replace = vi.fn(async (
      editable: EditableSettings,
      expectedRevision: number,
    ): Promise<ReplaceSettingsResult> => {
      if (expectedRevision !== stored.revision) {
        return { ok: false, code: 'settings-conflict', error: 'conflict' };
      }
      stored = {
        settings: { ...structuredClone(editable), enableAllCquDomains: false },
        revision: expectedRevision + 1,
      };
      return { ok: true, revision: stored.revision };
    });
    const getSnapshot = vi.fn(async () => structuredClone(stored));
    const first = dependencies({
      getSnapshot,
      replaceSettings: replace,
      containsPermission: vi.fn(async (permission) => permission.origins.length === 2),
    });
    await initializeOptionsController(document, first);
    const firstForm = document.querySelector('#custom-rule-form') as HTMLFormElement;
    const firstInput = document.querySelector('#custom-host') as HTMLInputElement;
    firstInput.value = 'race.cqu.edu.cn';

    fixture();
    const secondRelease = vi.fn().mockResolvedValue(true);
    const second = dependencies({
      getSnapshot,
      replaceSettings: replace,
      containsPermission: vi.fn(async (permission) => permission.origins.length === 2),
      releasePermissionLease: secondRelease,
    });
    await initializeOptionsController(document, second);
    (document.querySelector('#custom-host') as HTMLInputElement).value = 'race.cqu.edu.cn';

    firstForm.dispatchEvent(new Event('submit', { cancelable: true }));
    button('custom-submit').click();
    await settle();

    expect(replace).toHaveBeenCalledTimes(2);
    expect(stored.settings.customRules).toHaveLength(1);
    expect(secondRelease).toHaveBeenCalledWith(expect.any(String), expect.any(Array));
  });

  it('retains an in-flight same-host grant when loser fails before winner persists', async () => {
    let stored = snapshot();
    let leaseCounter = 0;
    const leases = new Map<string, string[]>();
    const acquireLease = vi.fn(async (permission: ExactOriginPermission) => {
      const nonce = `00000000-0000-4000-8000-${String(++leaseCounter).padStart(12, '0')}`;
      leases.set(nonce, [...permission.origins]);
      return { nonce };
    });
    const releaseLease = vi.fn(async (nonce: string) => {
      leases.delete(nonce);
      return true;
    });
    let resolveWinner!: (result: ReplaceSettingsResult) => void;
    let winnerEditable: EditableSettings | undefined;
    const replace = vi.fn((editable: EditableSettings): Promise<ReplaceSettingsResult> => {
      if (!winnerEditable) {
        winnerEditable = structuredClone(editable);
        return new Promise((resolve) => { resolveWinner = resolve; });
      }
      return Promise.resolve({ ok: false, code: 'operation-failed', error: 'loser failed' });
    });
    const getSnapshot = vi.fn(async () => structuredClone(stored));
    const winner = dependencies({
      getSnapshot, replaceSettings: replace,
      acquirePermissionLease: acquireLease,
      releasePermissionLease: releaseLease,
    });
    await initializeOptionsController(document, winner);
    const winnerForm = document.querySelector('#custom-rule-form') as HTMLFormElement;
    (document.querySelector('#custom-host') as HTMLInputElement).value = 'race.cqu.edu.cn';

    fixture();
    const loser = dependencies({
      getSnapshot, replaceSettings: replace,
      acquirePermissionLease: acquireLease,
      releasePermissionLease: releaseLease,
    });
    await initializeOptionsController(document, loser);
    (document.querySelector('#custom-host') as HTMLInputElement).value = 'race.cqu.edu.cn';

    winnerForm.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(replace).toHaveBeenCalledOnce());
    button('custom-submit').click();
    await vi.waitFor(() => expect(releaseLease).toHaveBeenCalledOnce());

    stored = snapshot({
      ...DEFAULT_SETTINGS,
      customRules: winnerEditable!.customRules,
    }, 4);
    resolveWinner({ ok: true, revision: 4 });
    await settle();
    expect(releaseLease).toHaveBeenCalledTimes(2);
  });

  it('renews a long permission prompt lease and stops after the prompt settles', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const origins = [
      '*://race.cqu.edu.cn/*',
      'https://race-cqu-edu-cn-s.atrust.cqu.edu.cn/*',
    ];
    let leaseCounter = 0;
    const leases = new Map<string, { origins: string[]; expiresAt: number }>();
    const acquireLease = vi.fn(async (permission: ExactOriginPermission) => {
      const nonce = `00000000-0000-4000-8000-${String(++leaseCounter).padStart(12, '0')}`;
      leases.set(nonce, { origins: [...permission.origins], expiresAt: Date.now() + CUSTOM_PERMISSION_LEASE_TTL_MS });
      return { nonce };
    });
    const renewLease = vi.fn(async (nonce: string, permission: ExactOriginPermission) => {
      const lease = leases.get(nonce);
      if (!lease || lease.expiresAt <= Date.now() || lease.origins.join() !== permission.origins.join()) {
        return false;
      }
      lease.expiresAt = Date.now() + CUSTOM_PERMISSION_LEASE_TTL_MS;
      return true;
    });
    const releaseLease = vi.fn(async (nonce: string) => {
      leases.delete(nonce);
      return true;
    });
    let resolvePrompt!: (granted: boolean) => void;
    const prompt = new Promise<boolean>((resolve) => { resolvePrompt = resolve; });
    const winner = dependencies({
      requestPermission: vi.fn().mockReturnValue(prompt),
      acquirePermissionLease: acquireLease,
      renewPermissionLease: renewLease,
      releasePermissionLease: releaseLease,
    });
    await initializeOptionsController(document, winner);
    const winnerForm = document.querySelector('#custom-rule-form') as HTMLFormElement;
    (document.querySelector('#custom-host') as HTMLInputElement).value = 'race.cqu.edu.cn';
    winnerForm.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.advanceTimersByTimeAsync(CUSTOM_PERMISSION_LEASE_TTL_MS * 2 + 1);

    expect(renewLease).toHaveBeenCalled();
    expect([...leases.values()][0]!.expiresAt).toBeGreaterThan(Date.now());

    fixture();
    const loser = dependencies({
      replaceSettings: vi.fn().mockResolvedValue({
        ok: false, code: 'operation-failed', error: 'loser failed',
      }),
      acquirePermissionLease: acquireLease,
      renewPermissionLease: renewLease,
      releasePermissionLease: releaseLease,
    });
    await initializeOptionsController(document, loser);
    (document.querySelector('#custom-host') as HTMLInputElement).value = 'race.cqu.edu.cn';
    button('custom-submit').click();
    await vi.runOnlyPendingTimersAsync();

    const renewalsBeforeSettle = renewLease.mock.calls.length;
    resolvePrompt(false);
    await vi.runOnlyPendingTimersAsync();
    await vi.advanceTimersByTimeAsync(CUSTOM_PERMISSION_LEASE_TTL_MS);
    expect(renewLease).toHaveBeenCalledTimes(renewalsBeforeSettle);
  });

  it('retains a newly granted permission when heartbeat renewal fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let resolvePrompt!: (granted: boolean) => void;
    const prompt = new Promise<boolean>((resolve) => { resolvePrompt = resolve; });
    const deps = dependencies({
      requestPermission: vi.fn().mockReturnValue(prompt),
      renewPermissionLease: vi.fn().mockResolvedValue(false),
      replaceSettings: vi.fn().mockResolvedValue({
        ok: false, code: 'operation-failed', error: 'save failed',
      }),
    });
    await initializeOptionsController(document, deps);
    (document.querySelector('#custom-host') as HTMLInputElement).value = 'library.cqu.edu.cn';
    button('custom-submit').click();

    await vi.advanceTimersByTimeAsync(CUSTOM_PERMISSION_LEASE_TTL_MS / 3);
    resolvePrompt(true);
    await vi.runOnlyPendingTimersAsync();

    expect(deps.renewPermissionLease).toHaveBeenCalledOnce();
    expect(deps.releasePermissionLease).toHaveBeenCalledWith(expect.any(String));
  });

  it('rolls back an unrelated failed grant while another lease remains active', async () => {
    const deps = dependencies({
      replaceSettings: vi.fn().mockResolvedValue({
        ok: false, code: 'operation-failed', error: 'save failed',
      }),
      releasePermissionLease: vi.fn().mockResolvedValue(true),
    });
    await initializeOptionsController(document, deps);
    (document.querySelector('#custom-host') as HTMLInputElement).value = 'library.cqu.edu.cn';

    button('custom-submit').click();
    await settle();

    expect(deps.releasePermissionLease).toHaveBeenCalledWith(
      expect.any(String),
      [
        '*://library.cqu.edu.cn/*',
        'https://library-cqu-edu-cn-s.atrust.cqu.edu.cn/*',
      ],
    );
  });

  it('retains permission when lease acquisition or release validation fails', async () => {
    const acquireFailure = dependencies({
      acquirePermissionLease: vi.fn().mockResolvedValue(null),
    });
    await initializeOptionsController(document, acquireFailure);
    (document.querySelector('#custom-host') as HTMLInputElement).value = 'library.cqu.edu.cn';
    button('custom-submit').click();
    await settle();
    expect(acquireFailure.requestPermission).toHaveBeenCalledOnce();
    expect(acquireFailure.replaceSettings).not.toHaveBeenCalled();
    expect(acquireFailure.releasePermissionLease).not.toHaveBeenCalled();

    fixture();
    const releaseFailure = dependencies({
      replaceSettings: vi.fn().mockResolvedValue({
        ok: false, code: 'operation-failed', error: 'save failed',
      }),
      releasePermissionLease: vi.fn().mockResolvedValue(false),
    });
    await initializeOptionsController(document, releaseFailure);
    (document.querySelector('#custom-host') as HTMLInputElement).value = 'library.cqu.edu.cn';
    button('custom-submit').click();
    await settle();
    expect(releaseFailure.releasePermissionLease).toHaveBeenCalled();
  });

  it('delegates rollback even when no fresh UI snapshot can be loaded', async () => {
    const getSnapshot = vi.fn()
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(null);
    const deps = dependencies({
      getSnapshot,
      containsPermission: vi.fn(async (permission) => permission.origins.length === 2),
      replaceSettings: vi.fn().mockResolvedValue({
        ok: false, code: 'operation-failed', error: '保存失败',
      }),
    });
    await initializeOptionsController(document, deps);
    (document.querySelector('#custom-host') as HTMLInputElement).value = 'library.cqu.edu.cn';

    button('custom-submit').click();
    await settle();

    expect(getSnapshot).toHaveBeenCalledOnce();
    expect(deps.releasePermissionLease).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
    );
    expect(text('custom-error')).toContain('规则未保存');
  });

  it('rolls back a newly acquired exact grant after a CAS conflict', async () => {
    const deps = dependencies({
      containsPermission: vi.fn(async (permission) => permission.origins.length === 2),
      requestPermission: vi.fn().mockResolvedValue(true),
      replaceSettings: vi.fn().mockResolvedValue({
        ok: false, code: 'settings-conflict', error: 'conflict',
      }),
    });
    await initializeOptionsController(document, deps);
    (document.querySelector('#custom-host') as HTMLInputElement).value = 'library.cqu.edu.cn';

    button('custom-submit').click();
    await settle();

    expect(deps.releasePermissionLease).toHaveBeenCalledWith(
      expect.any(String),
      [
        '*://library.cqu.edu.cn/*',
        'https://library-cqu-edu-cn-s.atrust.cqu.edu.cn/*',
      ],
    );
    expect(deps.replaceSettings).toHaveBeenCalledOnce();
  });

  it('toggles custom rules through disabled IDs, updates runtime DNR state, and clears stale IDs on delete', async () => {
    const custom: CustomRule = {
      id: crypto.randomUUID(), dnrId: 10_001, name: 'library.cqu.edu.cn',
      description: 'custom', category: 'custom', defaultEnabled: true,
      matcher: { kind: 'host', host: 'library.cqu.edu.cn' }, transformer: 'atrust-domain',
    };
    const deps = dependencies({
      getSnapshot: vi.fn().mockResolvedValue(snapshot({
        ...DEFAULT_SETTINGS,
        customRules: [custom],
        excludedHosts: ['old.cqu.edu.cn'],
      })),
    });
    await initializeOptionsController(document, deps);

    checkbox(`custom-enabled-${custom.id}`).click();
    await settle();
    const disabled = vi.mocked(deps.replaceSettings).mock.calls[0]![0];
    expect(disabled.customRules[0]!.defaultEnabled).toBe(true);
    expect(disabled.disabledRuleIds).toContain(custom.id);
    expect(getEnabledRules({ ...disabled, enableAllCquDomains: false }).map((rule) => rule.id))
      .not.toContain(custom.id);
    expect(compileDynamicRules(
      getEnabledRules({ ...disabled, enableAllCquDomains: false }),
      disabled.excludedHosts,
    ).map((rule) => rule.id)).not.toContain(custom.dnrId);

    checkbox(`custom-enabled-${custom.id}`).click();
    await settle();
    const reenabled = vi.mocked(deps.replaceSettings).mock.calls[1]![0];
    expect(reenabled.disabledRuleIds).not.toContain(custom.id);
    expect(getEnabledRules({ ...reenabled, enableAllCquDomains: false }).map((rule) => rule.id))
      .toContain(custom.id);

    const deleteButton = document.querySelector(`[data-delete-custom="${custom.id}"]`) as HTMLButtonElement;
    deleteButton.click();
    await settle();
    expect(vi.mocked(deps.replaceSettings).mock.calls[2]![0].customRules).toEqual([]);
    expect(vi.mocked(deps.replaceSettings).mock.calls[2]![0].disabledRuleIds)
      .not.toContain(custom.id);

    const removeExcluded = document.querySelector('[data-remove-excluded="old.cqu.edu.cn"]') as HTMLButtonElement;
    removeExcluded.click();
    await settle();
    expect(vi.mocked(deps.replaceSettings).mock.calls[3]![0].excludedHosts).toEqual([]);
  });

  it('deleting an already-disabled custom rule removes its stale disabled ID', async () => {
    const custom: CustomRule = {
      id: crypto.randomUUID(), dnrId: 10_001, name: 'library.cqu.edu.cn',
      description: 'custom', category: 'custom', defaultEnabled: true,
      matcher: { kind: 'host', host: 'library.cqu.edu.cn' }, transformer: 'atrust-domain',
    };
    const deps = dependencies({
      getSnapshot: vi.fn().mockResolvedValue(snapshot({
        ...DEFAULT_SETTINGS,
        customRules: [custom],
        disabledRuleIds: [custom.id],
      })),
    });
    await initializeOptionsController(document, deps);

    const deleteButton = document.querySelector(`[data-delete-custom="${custom.id}"]`) as HTMLButtonElement;
    deleteButton.click();
    await settle();

    const editable = vi.mocked(deps.replaceSettings).mock.calls[0]![0];
    expect(editable.customRules).toEqual([]);
    expect(editable.disabledRuleIds).toEqual([]);
  });

  it('surfaces malformed initial state without enabling controls', async () => {
    const deps = dependencies({ getSnapshot: vi.fn().mockResolvedValue(null) });

    await initializeOptionsController(document, deps);

    expect(text('status')).toContain('无法读取');
    expect(checkbox('master-enabled').disabled).toBe(true);
    expect(checkbox('all-cqu-enabled').disabled).toBe(true);
  });
});
