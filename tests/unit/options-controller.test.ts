import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILT_IN_RULES } from '../../src/rules/builtins';
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
    replaceSettings: vi.fn().mockResolvedValue({ ok: true, revision: 4 }),
    setAllCquMode: vi.fn().mockResolvedValue(true),
    containsPermission: vi.fn().mockResolvedValue(false),
    requestPermission: vi.fn().mockResolvedValue(true),
    removePermission: vi.fn().mockResolvedValue(true),
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

  it('loads only the background snapshot and renders saved grouped state', async () => {
    const deps = dependencies();

    await initializeOptionsController(document, deps);

    expect(deps.getSnapshot).toHaveBeenCalledOnce();
    expect(checkbox('master-enabled').checked).toBe(true);
    expect(document.querySelectorAll('[data-rule-id]').length).toBe(BUILT_IN_RULES.length);
    expect(document.querySelectorAll('[data-rule-group]').length).toBe(4);
    expect(text('status')).toContain('设置已加载');
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

  it('requests exact custom origins before CAS and saves once', async () => {
    const order: string[] = [];
    const deps = dependencies({
      containsPermission: vi.fn(async () => { order.push('contains'); return false; }),
      requestPermission: vi.fn(async () => { order.push('request'); return true; }),
      replaceSettings: vi.fn(async () => {
        order.push('replace');
        return { ok: true as const, revision: 4 };
      }),
    });
    await initializeOptionsController(document, deps);
    const input = document.querySelector('#custom-host') as HTMLInputElement;
    input.value = 'LIBRARY.CQU.EDU.CN';

    button('custom-submit').click();
    await settle();

    const exact: ExactOriginPermission = {
      origins: [
        '*://library.cqu.edu.cn/*',
        'https://library-cqu-edu-cn-s.atrust.cqu.edu.cn/*',
      ],
    };
    expect(order).toEqual(['contains', 'contains', 'request', 'replace']);
    expect(deps.containsPermission).toHaveBeenNthCalledWith(1, { origins: [exact.origins[0]!] });
    expect(deps.containsPermission).toHaveBeenNthCalledWith(2, { origins: [exact.origins[1]!] });
    expect(deps.requestPermission).toHaveBeenCalledWith(exact);
    const editable = vi.mocked(deps.replaceSettings).mock.calls[0]![0];
    expect(editable.customRules[0]).toMatchObject({
      dnrId: 10_001,
      matcher: { kind: 'host', host: 'library.cqu.edu.cn' },
    });
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

  it('rolls back only a newly acquired exact grant after CAS failure', async () => {
    const deps = dependencies({
      containsPermission: vi.fn().mockResolvedValue(false),
      requestPermission: vi.fn().mockResolvedValue(true),
      replaceSettings: vi.fn().mockResolvedValue({
        ok: false, code: 'operation-failed', error: '保存失败',
      }),
    });
    await initializeOptionsController(document, deps);
    (document.querySelector('#custom-host') as HTMLInputElement).value = 'library.cqu.edu.cn';

    button('custom-submit').click();
    await settle();

    expect(deps.removePermission).toHaveBeenCalledWith({
      origins: [
        '*://library.cqu.edu.cn/*',
        'https://library-cqu-edu-cn-s.atrust.cqu.edu.cn/*',
      ],
    });
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

    expect(deps.requestPermission).toHaveBeenCalledWith({ origins: [target] });
    expect(deps.removePermission).toHaveBeenCalledWith({ origins: [target] });
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

    expect(deps.requestPermission).not.toHaveBeenCalled();
    expect(deps.removePermission).not.toHaveBeenCalled();
    expect(deps.getSnapshot).toHaveBeenCalledTimes(2);
  });

  it('rolls back a newly acquired exact grant after a CAS conflict', async () => {
    const deps = dependencies({
      containsPermission: vi.fn().mockResolvedValue(false),
      requestPermission: vi.fn().mockResolvedValue(true),
      replaceSettings: vi.fn().mockResolvedValue({
        ok: false, code: 'settings-conflict', error: 'conflict',
      }),
    });
    await initializeOptionsController(document, deps);
    (document.querySelector('#custom-host') as HTMLInputElement).value = 'library.cqu.edu.cn';

    button('custom-submit').click();
    await settle();

    expect(deps.removePermission).toHaveBeenCalledWith({
      origins: [
        '*://library.cqu.edu.cn/*',
        'https://library-cqu-edu-cn-s.atrust.cqu.edu.cn/*',
      ],
    });
    expect(deps.replaceSettings).toHaveBeenCalledOnce();
  });

  it('toggles and deletes custom rules and removes exclusions through editable CAS', async () => {
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
    expect(vi.mocked(deps.replaceSettings).mock.calls[0]![0].customRules[0]!.defaultEnabled).toBe(false);

    const deleteButton = document.querySelector(`[data-delete-custom="${custom.id}"]`) as HTMLButtonElement;
    deleteButton.click();
    await settle();
    expect(vi.mocked(deps.replaceSettings).mock.calls[1]![0].customRules).toEqual([]);

    const removeExcluded = document.querySelector('[data-remove-excluded="old.cqu.edu.cn"]') as HTMLButtonElement;
    removeExcluded.click();
    await settle();
    expect(vi.mocked(deps.replaceSettings).mock.calls[2]![0].excludedHosts).toEqual([]);
  });

  it('surfaces malformed initial state without enabling controls', async () => {
    const deps = dependencies({ getSnapshot: vi.fn().mockResolvedValue(null) });

    await initializeOptionsController(document, deps);

    expect(text('status')).toContain('无法读取');
    expect(checkbox('master-enabled').disabled).toBe(true);
    expect(checkbox('all-cqu-enabled').disabled).toBe(true);
  });
});
