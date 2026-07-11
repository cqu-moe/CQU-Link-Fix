import type { Browser } from 'wxt/browser';
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  DEFAULT_SETTINGS,
  getSettingsSnapshotViaBackground,
  loadSettingsSnapshot,
  loadSettings,
  replaceSettingsViaBackground,
  saveSettings,
  setAllCquMode,
  updateSettings,
  validateEditableSettings,
} from '../../src/storage/settings';
import type { CustomRule } from '../../src/rules/types';

const CQU_OPTIONAL_ORIGINS = {
  origins: ['*://cqu.edu.cn/*', '*://*.cqu.edu.cn/*'],
};

type PermissionOperation = (
  permissions: Browser.permissions.Permissions,
) => Promise<boolean>;
type StorageSet = (items: Record<string, unknown>) => Promise<void>;
type SendMessage = (message: unknown) => Promise<unknown>;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function mockPermissionContains(): MockInstance<PermissionOperation> {
  return vi.spyOn(browser.permissions, 'contains') as unknown as MockInstance<PermissionOperation>;
}

function mockPermissionRequest(): MockInstance<PermissionOperation> {
  return vi.spyOn(browser.permissions, 'request') as unknown as MockInstance<PermissionOperation>;
}

function mockPermissionRemove(): MockInstance<PermissionOperation> {
  return vi.spyOn(browser.permissions, 'remove') as unknown as MockInstance<PermissionOperation>;
}

function mockStorageSet(): MockInstance<StorageSet> {
  return vi.spyOn(browser.storage.local, 'set') as unknown as MockInstance<StorageSet>;
}

function mockSendMessage(): MockInstance<SendMessage> {
  return vi.spyOn(browser.runtime, 'sendMessage') as unknown as MockInstance<SendMessage>;
}

function createCustomRule(): CustomRule {
  return {
    id: 'concurrent-custom',
    dnrId: 10_001,
    name: 'Concurrent custom rule',
    description: 'Test-only concurrent settings mutation',
    category: 'custom',
    defaultEnabled: true,
    matcher: { kind: 'host', host: 'library.cqu.edu.cn' },
    transformer: 'atrust-domain',
  };
}

describe('settings storage', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    mockSendMessage().mockImplementation(async (message) => {
      const candidate = message as { type?: string; enabled?: boolean };
      if (candidate.type === 'persist-all-cqu-mode' && typeof candidate.enabled === 'boolean') {
        await updateSettings((current) => ({
          ...current,
          enableAllCquDomains: candidate.enabled!,
        }));
        return { ok: true, revision: 1 };
      }
      return { ok: false, error: 'Unexpected test message' };
    });
  });

  it('round-trips settings through local storage', async () => {
    const next = { ...DEFAULT_SETTINGS, enableAllCquDomains: true };
    await saveSettings(next);
    expect(await loadSettings()).toEqual(next);
  });

  it('returns defaults when local storage is empty', async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('merges stored partial settings with new defaults', async () => {
    await browser.storage.local.set({ settings: { enableAllCquDomains: true } });

    expect(await loadSettings()).toEqual({
      ...DEFAULT_SETTINGS,
      enableAllCquDomains: true,
    });
  });

  it('does not expose mutable arrays from the default settings singleton', async () => {
    const loaded = await loadSettings();
    loaded.disabledBuiltInRuleIds.push('core-sso');
    loaded.excludedHosts.push('example.cqu.edu.cn');

    expect(DEFAULT_SETTINGS.disabledBuiltInRuleIds).toEqual([]);
    expect(DEFAULT_SETTINGS.excludedHosts).toEqual([]);
  });

  it('does not alias stored custom rule matchers across loads', async () => {
    const customRule: CustomRule = {
      id: 'custom-ip',
      dnrId: 3001,
      name: 'Registered IP service',
      description: 'Test-only registered IP and port pair',
      category: 'custom',
      defaultEnabled: true,
      matcher: { kind: 'host-port', host: '1.1.1.1', port: 8000 },
      transformer: 'atrust-ip-port',
    };
    await saveSettings({ ...DEFAULT_SETTINGS, customRules: [customRule] });

    const firstLoad = await loadSettings();
    firstLoad.customRules[0]!.matcher.host = 'mutated.example';

    expect((await loadSettings()).customRules[0]!.matcher.host).toBe('1.1.1.1');
  });

  it('exposes a Task 8 client seam that requests complete background replacement', async () => {
    const { enableAllCquDomains: _, ...next } = { ...DEFAULT_SETTINGS, enabled: false };
    const sendMessage = mockSendMessage().mockResolvedValue({ ok: true, revision: 4 });

    await expect(replaceSettingsViaBackground(next, 3)).resolves.toEqual({ ok: true, revision: 4 });

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'replace-settings', settings: next, expectedRevision: 3,
    });
  });

  it.each([
    { ok: true },
    { ok: true, revision: -1 },
    { ok: true, revision: 1.5 },
    { ok: true, revision: Number.MAX_SAFE_INTEGER + 1 },
  ])('rejects malformed successful replacement response %#', async (response) => {
    const { enableAllCquDomains: _, ...next } = DEFAULT_SETTINGS;
    mockSendMessage().mockResolvedValue(response);

    await expect(replaceSettingsViaBackground(next, 0)).resolves.toEqual({
      ok: false,
      code: 'operation-failed',
      error: 'Background operation failed',
    });
  });

  it.each([3, 2, 5])(
    'rejects successful replacement revision %s when expected revision is 3',
    async (revision) => {
      const { enableAllCquDomains: _, ...next } = DEFAULT_SETTINGS;
      mockSendMessage().mockResolvedValue({ ok: true, revision });

      await expect(replaceSettingsViaBackground(next, 3)).resolves.toEqual({
        ok: false,
        code: 'operation-failed',
        error: 'Background operation failed',
      });
    },
  );

  it.each([
    undefined,
    { ok: true },
    { ok: true, snapshot: { settings: DEFAULT_SETTINGS, revision: -1 } },
    { ok: true, snapshot: { settings: { ...DEFAULT_SETTINGS, enabled: 'yes' }, revision: 1 } },
  ])('returns null for malformed background snapshot %#', async (response) => {
    mockSendMessage().mockResolvedValue(response);

    await expect(getSettingsSnapshotViaBackground()).resolves.toBeNull();
  });

  it('returns a cloned validated background snapshot', async () => {
    const remote = { settings: { ...DEFAULT_SETTINGS, excludedHosts: ['A.CQU.EDU.CN'] }, revision: 7 };
    mockSendMessage().mockResolvedValue({ ok: true, snapshot: remote });

    const result = await getSettingsSnapshotViaBackground();

    expect(result).toEqual({
      settings: { ...DEFAULT_SETTINGS, excludedHosts: ['a.cqu.edu.cn'] },
      revision: 7,
    });
    result!.settings.excludedHosts.push('mutated.cqu.edu.cn');
    expect(remote.settings.excludedHosts).toEqual(['A.CQU.EDU.CN']);
  });

  it('increments a persisted revision for every queued settings write', async () => {
    await saveSettings(DEFAULT_SETTINGS);
    expect((await loadSettingsSnapshot()).revision).toBe(1);
    await updateSettings((current) => ({ ...current, enabled: false }));
    expect(await loadSettingsSnapshot()).toMatchObject({ revision: 2, settings: { enabled: false } });
  });

  it('normalizes replaceable arrays and rejects unsafe or colliding custom rules', () => {
    const base = {
      enabled: true,
      disabledBuiltInRuleIds: [' core-sso ', 'core-sso'],
      excludedHosts: [' B.CQU.EDU.CN ', 'b.cqu.edu.cn'],
      customRules: [createCustomRule()],
    };
    expect(validateEditableSettings(base)).toMatchObject({
      disabledBuiltInRuleIds: ['core-sso'], excludedHosts: ['b.cqu.edu.cn'],
    });
    expect(() => validateEditableSettings({
      ...base, customRules: [{ ...createCustomRule(), id: 'core-sso' }],
    })).toThrow(/rule ID/i);
    expect(() => validateEditableSettings({
      ...base, customRules: [{ ...createCustomRule(), dnrId: 1001 }],
    })).toThrow(/DNR/i);
    expect(() => validateEditableSettings({
      ...base,
      customRules: [createCustomRule(), { ...createCustomRule(), id: 'other', dnrId: 3001 }],
    })).toThrow(/DNR/i);
    expect(() => validateEditableSettings({
      ...base,
      customRules: [{
        ...createCustomRule(), matcher: { kind: 'host', host: 'x.atrust.cqu.edu.cn' },
      }],
    })).toThrow(/host rule/i);
    expect(() => validateEditableSettings({
      ...base,
      customRules: [{ ...createCustomRule(), matcher: { kind: 'host', host: 'example.com' } }],
    })).toThrow(/host rule/i);
    expect(() => validateEditableSettings({
      ...base,
      customRules: [{
        ...createCustomRule(),
        matcher: { kind: 'host-port', host: '1.1.1.1', port: 443 },
        transformer: 'atrust-ip-port',
      }],
    })).toThrow(/matcher kind/i);
  });

  it.each([10_000, 80_000])('rejects custom DNR ID outside the UI allocation range: %s', (dnrId) => {
    expect(() => validateEditableSettings({
      enabled: true,
      disabledBuiltInRuleIds: [],
      excludedHosts: [],
      customRules: [{ ...createCustomRule(), dnrId }],
    })).toThrow(/DNR/i);
  });

  it('rejects a custom source that duplicates a built-in host', () => {
    expect(() => validateEditableSettings({
      enabled: true,
      disabledBuiltInRuleIds: [],
      excludedHosts: [],
      customRules: [{
        ...createCustomRule(),
        dnrId: 10_001,
        matcher: { kind: 'host', host: 'SSO.CQU.EDU.CN' },
      }],
    })).toThrow(/built-in|内置/i);
  });

  it('rejects duplicate canonical custom source hosts', () => {
    expect(() => validateEditableSettings({
      enabled: true,
      disabledBuiltInRuleIds: [],
      excludedHosts: [],
      customRules: [
        { ...createCustomRule(), dnrId: 10_001 },
        {
          ...createCustomRule(),
          id: 'second-custom',
          dnrId: 10_002,
          matcher: { kind: 'host', host: ' LIBRARY.CQU.EDU.CN ' },
        },
      ],
    })).toThrow(/host|域名/i);
  });

  it('serializes concurrent mutators without losing fields or hosts', async () => {
    await saveSettings(DEFAULT_SETTINGS);
    const firstStarted = deferred<void>();
    const releaseFirst = deferred<void>();
    const addHost = updateSettings(async (current) => {
      firstStarted.resolve();
      await releaseFirst.promise;
      return { ...current, excludedHosts: [...current.excludedHosts, 'one.cqu.edu.cn'] };
    });
    await firstStarted.promise;
    const customRule = createCustomRule();
    const addRule = updateSettings((current) => ({
      ...current,
      customRules: [...current.customRules, customRule],
      excludedHosts: [...current.excludedHosts, 'two.cqu.edu.cn'],
    }));
    releaseFirst.resolve();

    await Promise.all([addHost, addRule]);

    expect(await loadSettings()).toEqual({
      ...DEFAULT_SETTINGS,
      customRules: [customRule],
      excludedHosts: ['one.cqu.edu.cn', 'two.cqu.edu.cn'],
    });
  });

  it('orders a direct save and a queued custom mutation through one writer queue', async () => {
    const storageWrite = deferred<void>();
    const originalSet = browser.storage.local.set.bind(browser.storage.local) as StorageSet;
    mockStorageSet().mockImplementationOnce(async (items) => {
      await storageWrite.promise;
      await originalSet(items);
    }).mockImplementation(originalSet);
    const saving = saveSettings({
      ...DEFAULT_SETTINGS,
      excludedHosts: ['saved.cqu.edu.cn'],
    });
    const customRule = createCustomRule();
    const updating = updateSettings((current) => ({
      ...current,
      customRules: [customRule],
    }));
    storageWrite.resolve();

    await Promise.all([saving, updating]);

    expect(await loadSettings()).toEqual({
      ...DEFAULT_SETTINGS,
      excludedHosts: ['saved.cqu.edu.cn'],
      customRules: [customRule],
    });
  });

  it('enables without prompting when the exact optional origins are already granted', async () => {
    const contains = mockPermissionContains().mockResolvedValue(true);
    const request = mockPermissionRequest().mockResolvedValue(true);

    await expect(setAllCquMode(true)).resolves.toBe(true);

    expect(contains).toHaveBeenCalledWith(CQU_OPTIONAL_ORIGINS);
    expect(request).toHaveBeenCalledWith(CQU_OPTIONAL_ORIGINS);
    expect((await loadSettings()).enableAllCquDomains).toBe(true);
  });

  it('invokes the all-CQU permission request before a deferred containment check resolves', async () => {
    const containment = deferred<boolean>();
    mockPermissionContains().mockReturnValue(containment.promise);
    const request = mockPermissionRequest().mockResolvedValue(true);

    const enabling = setAllCquMode(true);

    expect(browser.permissions.contains).toHaveBeenCalledWith(CQU_OPTIONAL_ORIGINS);
    expect(request).toHaveBeenCalledWith(CQU_OPTIONAL_ORIGINS);
    containment.resolve(false);
    await expect(enabling).resolves.toBe(true);
  });

  it('requests only the exact optional origins and enables after permission is granted', async () => {
    mockPermissionContains().mockResolvedValue(false);
    const request = mockPermissionRequest().mockResolvedValue(true);

    await expect(setAllCquMode(true)).resolves.toBe(true);

    expect(request).toHaveBeenCalledWith(CQU_OPTIONAL_ORIGINS);
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'persist-all-cqu-mode',
      enabled: true,
    });
    expect((await loadSettings()).enableAllCquDomains).toBe(true);
  });

  it('keeps settings disabled when the optional permission request is denied', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, enableAllCquDomains: true });
    mockPermissionContains().mockResolvedValue(false);
    mockPermissionRequest().mockResolvedValue(false);
    const storageSet = vi.spyOn(browser.storage.local, 'set');

    await expect(setAllCquMode(true)).resolves.toBe(false);

    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'persist-all-cqu-mode',
      enabled: false,
    });
    expect((await loadSettings()).enableAllCquDomains).toBe(false);
    expect(storageSet).toHaveBeenCalled();
  });

  it('rolls back a newly granted permission when background persistence returns an error', async () => {
    mockPermissionContains().mockResolvedValue(false);
    mockPermissionRequest().mockResolvedValue(true);
    const remove = mockPermissionRemove().mockResolvedValue(true);
    mockSendMessage().mockResolvedValue({ ok: false, error: 'background unavailable' });

    await expect(setAllCquMode(true)).resolves.toBe(false);

    expect(remove).toHaveBeenCalledWith(CQU_OPTIONAL_ORIGINS);
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'persist-all-cqu-mode',
      enabled: true,
    });
  });

  it('does not write local storage in the permission-caller context', async () => {
    mockPermissionContains().mockResolvedValue(true);
    mockPermissionRequest().mockResolvedValue(true);
    mockSendMessage().mockResolvedValue({ ok: true, revision: 1 });
    const storageSet = vi.spyOn(browser.storage.local, 'set');

    await expect(setAllCquMode(true)).resolves.toBe(true);

    expect(storageSet).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'permission containment check rejects',
      arrange: () => mockPermissionContains().mockRejectedValue(new Error('contains failed')),
    },
    {
      label: 'permission request rejects',
      arrange: () => {
        mockPermissionContains().mockResolvedValue(false);
        mockPermissionRequest().mockRejectedValue(new Error('request failed'));
      },
    },
  ])('keeps mode disabled without rejecting when $label', async ({ arrange }) => {
    await saveSettings({ ...DEFAULT_SETTINGS, enableAllCquDomains: true });
    arrange();

    await expect(setAllCquMode(true)).resolves.toBe(false);

    expect((await loadSettings()).enableAllCquDomains).toBe(false);
  });

  it('reloads settings after a delayed permission request before enabling', async () => {
    const permissionRequest = deferred<boolean>();
    mockPermissionContains().mockResolvedValue(false);
    mockPermissionRequest().mockReturnValue(permissionRequest.promise);
    const enabling = setAllCquMode(true);
    await vi.waitFor(() => expect(browser.permissions.request).toHaveBeenCalled());

    const concurrentRule = createCustomRule();
    await saveSettings({
      ...DEFAULT_SETTINGS,
      excludedHosts: ['excluded.cqu.edu.cn'],
      customRules: [concurrentRule],
    });
    permissionRequest.resolve(true);

    await expect(enabling).resolves.toBe(true);
    expect(await loadSettings()).toEqual({
      ...DEFAULT_SETTINGS,
      enableAllCquDomains: true,
      excludedHosts: ['excluded.cqu.edu.cn'],
      customRules: [concurrentRule],
    });
  });

  it('rolls back only a newly acquired grant when enabling storage fails', async () => {
    mockPermissionContains().mockResolvedValue(false);
    mockPermissionRequest().mockResolvedValue(true);
    const remove = mockPermissionRemove().mockRejectedValue(new Error('rollback unavailable'));
    const originalSet = browser.storage.local.set.bind(browser.storage.local) as StorageSet;
    mockStorageSet()
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockImplementation(originalSet);

    await expect(setAllCquMode(true)).resolves.toBe(false);

    expect(remove).toHaveBeenCalledWith(CQU_OPTIONAL_ORIGINS);
    expect((await loadSettings()).enableAllCquDomains).toBe(false);
  });

  it('does not remove an existing grant when enabling storage fails', async () => {
    mockPermissionContains().mockResolvedValue(true);
    const remove = mockPermissionRemove();
    const originalSet = browser.storage.local.set.bind(browser.storage.local) as StorageSet;
    mockStorageSet()
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockImplementation(originalSet);

    await expect(setAllCquMode(true)).resolves.toBe(false);

    expect(remove).not.toHaveBeenCalled();
    expect((await loadSettings()).enableAllCquDomains).toBe(false);
  });

  it('disables through settings and removes exactly the optional origins', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, enableAllCquDomains: true });
    const remove = mockPermissionRemove().mockResolvedValue(true);

    await expect(setAllCquMode(false)).resolves.toBe(true);

    expect(remove).toHaveBeenCalledWith(CQU_OPTIONAL_ORIGINS);
    expect((await loadSettings()).enableAllCquDomains).toBe(false);
  });

  it.each([
    { label: 'returns false', remove: () => Promise.resolve(false) },
    { label: 'rejects', remove: () => Promise.reject(new Error('permission API unavailable')) },
  ])(
    'keeps settings disabled and reports failure when permission removal $label',
    async ({ remove }) => {
      await saveSettings({ ...DEFAULT_SETTINGS, enableAllCquDomains: true });
      mockPermissionRemove().mockImplementation(remove);

      await expect(setAllCquMode(false)).resolves.toBe(false);

      expect((await loadSettings()).enableAllCquDomains).toBe(false);
    },
  );

  it('reloads concurrent settings after a failed permission removal before disabling', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, enableAllCquDomains: true });
    const permissionRemoval = deferred<boolean>();
    mockPermissionRemove().mockReturnValue(permissionRemoval.promise);
    const disabling = setAllCquMode(false);
    await vi.waitFor(() => expect(browser.permissions.remove).toHaveBeenCalled());

    const concurrentRule = createCustomRule();
    await saveSettings({
      ...DEFAULT_SETTINGS,
      enableAllCquDomains: true,
      excludedHosts: ['concurrent.cqu.edu.cn'],
      customRules: [concurrentRule],
    });
    permissionRemoval.resolve(false);

    await expect(disabling).resolves.toBe(false);
    expect(await loadSettings()).toEqual({
      ...DEFAULT_SETTINGS,
      enableAllCquDomains: false,
      excludedHosts: ['concurrent.cqu.edu.cn'],
      customRules: [concurrentRule],
    });
  });
});
