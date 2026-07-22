import { vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

export function resetFakeBrowser(): void {
  fakeBrowser.reset();
  Object.defineProperty(browser.declarativeNetRequest, 'updateStaticRules', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
  Object.defineProperty(browser.declarativeNetRequest, 'updateEnabledRulesets', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
}
