import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../../src/storage/settings';
import type { CustomRule } from '../../src/rules/types';

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
});
