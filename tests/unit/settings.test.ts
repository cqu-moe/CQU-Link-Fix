import type { Browser } from 'wxt/browser';
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  setAllCquMode,
} from '../../src/storage/settings';
import type { CustomRule } from '../../src/rules/types';

const CQU_OPTIONAL_ORIGINS = {
  origins: ['*://cqu.edu.cn/*', '*://*.cqu.edu.cn/*'],
};

type PermissionOperation = (
  permissions: Browser.permissions.Permissions,
) => Promise<boolean>;

function mockPermissionContains(): MockInstance<PermissionOperation> {
  return vi.spyOn(browser.permissions, 'contains') as unknown as MockInstance<PermissionOperation>;
}

function mockPermissionRequest(): MockInstance<PermissionOperation> {
  return vi.spyOn(browser.permissions, 'request') as unknown as MockInstance<PermissionOperation>;
}

function mockPermissionRemove(): MockInstance<PermissionOperation> {
  return vi.spyOn(browser.permissions, 'remove') as unknown as MockInstance<PermissionOperation>;
}

describe('settings storage', () => {
  beforeEach(() => fakeBrowser.reset());

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

  it('enables without prompting when the exact optional origins are already granted', async () => {
    const contains = mockPermissionContains().mockResolvedValue(true);
    const request = mockPermissionRequest();

    await expect(setAllCquMode(true)).resolves.toBe(true);

    expect(contains).toHaveBeenCalledWith(CQU_OPTIONAL_ORIGINS);
    expect(request).not.toHaveBeenCalled();
    expect((await loadSettings()).enableAllCquDomains).toBe(true);
  });

  it('requests only the exact optional origins and enables after permission is granted', async () => {
    mockPermissionContains().mockResolvedValue(false);
    const request = mockPermissionRequest().mockResolvedValue(true);

    await expect(setAllCquMode(true)).resolves.toBe(true);

    expect(request).toHaveBeenCalledWith(CQU_OPTIONAL_ORIGINS);
    expect((await loadSettings()).enableAllCquDomains).toBe(true);
  });

  it('keeps settings disabled when the optional permission request is denied', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, enableAllCquDomains: true });
    mockPermissionContains().mockResolvedValue(false);
    mockPermissionRequest().mockResolvedValue(false);
    const storageSet = vi.spyOn(browser.storage.local, 'set');

    await expect(setAllCquMode(true)).resolves.toBe(false);

    expect((await loadSettings()).enableAllCquDomains).toBe(false);
    expect(storageSet).toHaveBeenCalled();
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
});
