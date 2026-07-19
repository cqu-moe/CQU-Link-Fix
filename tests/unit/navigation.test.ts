import type { Browser } from 'wxt/browser';
import { describe, expect, it } from 'vitest';
import { decideAllCquRewrite } from '../../src/background/navigation';
import { DEFAULT_SETTINGS, type ExtensionSettings } from '../../src/storage/settings';

function enabledSettings(
  overrides: Partial<ExtensionSettings> = {},
): ExtensionSettings {
  return {
    ...DEFAULT_SETTINGS,
    enableAllCquDomains: true,
    ...overrides,
  };
}

function navigationInput(
  url: string,
  overrides: Partial<
    Pick<Browser.webNavigation.WebNavigationBaseCallbackDetails, 'tabId' | 'frameId'>
  > = {},
): { tabId: number; frameId: number; url: string } {
  return { tabId: 7, frameId: 0, url, ...overrides };
}

describe('all-CQU navigation decision', () => {
  it('rewrites a CQU hostname while preserving path, query, fragment, and CAS parameters', () => {
    const input =
      'http://Foo.CQU.EDU.CN/a?q=1&service=https%3A%2F%2Ffirst.cqu.edu.cn%2Fcb&redirect_uri=https%3a%2f%2fclient.example%2fcb%3fq%3da%2520b&state=x&service=https%3A%2F%2Fsecond.cqu.edu.cn%2Fcb#part';

    expect(decideAllCquRewrite(navigationInput(input), enabledSettings())).toBe(
      'https://foo-cqu-edu-cn-s.atrust.cqu.edu.cn/a?q=1&service=https%3A%2F%2Ffirst.cqu.edu.cn%2Fcb&redirect_uri=https%3a%2f%2fclient.example%2fcb%3fq%3da%2520b&state=x&service=https%3A%2F%2Fsecond.cqu.edu.cn%2Fcb#part',
    );
  });

  it('does not rewrite top-level CAS ticket callbacks but preserves nested service text', () => {
    expect(
      decideAllCquRewrite(
        navigationInput('https://foo.cqu.edu.cn/callback?ticket=synthetic&state=x'),
        enabledSettings(),
      ),
    ).toBeNull();

    const nested =
      'https://foo.cqu.edu.cn/start?service=https%3A%2F%2Fclient.example%2Fcallback%3Fticket%3Dsynthetic';
    expect(decideAllCquRewrite(navigationInput(nested), enabledSettings())).toBe(
      'https://foo-cqu-edu-cn-s.atrust.cqu.edu.cn/start?service=https%3A%2F%2Fclient.example%2Fcallback%3Fticket%3Dsynthetic',
    );
  });

  it.each([
    ['subframe', navigationInput('https://foo.cqu.edu.cn/', { frameId: 1 })],
    ['invalid tab', navigationInput('https://foo.cqu.edu.cn/', { tabId: -1 })],
  ])('ignores a $label navigation', (_label, details) => {
    expect(decideAllCquRewrite(details, enabledSettings())).toBeNull();
  });

  it.each([
    ['malformed URL', 'not a URL'],
    ['unsupported scheme', 'ftp://foo.cqu.edu.cn/path'],
    ['username', 'https://user@foo.cqu.edu.cn/path'],
    ['password', 'https://user:secret@foo.cqu.edu.cn/path'],
    ['aTrust gateway', 'https://atrust.cqu.edu.cn/portal/#!/login'],
    ['aTrust destination', 'https://foo-cqu-edu-cn-s.atrust.cqu.edu.cn/path'],
    ['IPv4 literal', 'https://1.1.1.1/path'],
    ['non-CQU host', 'https://example.com/path'],
    ['CQU lookalike', 'https://foo.cqu.edu.cn.evil.example/path'],
    ['non-default port', 'https://foo.cqu.edu.cn:8443/path'],
  ])('safely ignores a $label', (_label, url) => {
    expect(() => decideAllCquRewrite(navigationInput(url), enabledSettings())).not.toThrow();
    expect(decideAllCquRewrite(navigationInput(url), enabledSettings())).toBeNull();
  });

  it.each([
    'http://foo.cqu.edu.cn:80/path?q=1#part',
    'https://foo.cqu.edu.cn:443/path?q=1#part',
  ])('accepts a canonical default port in %s', (url) => {
    expect(decideAllCquRewrite(navigationInput(url), enabledSettings())).toBe(
      'https://foo-cqu-edu-cn-s.atrust.cqu.edu.cn/path?q=1#part',
    );
  });

  it('normalizes case and whitespace in exact excluded hosts', () => {
    expect(
      decideAllCquRewrite(
        navigationInput('https://foo.cqu.edu.cn/path'),
        enabledSettings({ excludedHosts: ['  FOO.CQU.EDU.CN  '] }),
      ),
    ).toBeNull();
  });

  it.each([
    enabledSettings({ enabled: false }),
    enabledSettings({ enableAllCquDomains: false }),
  ])('returns null when the relevant switch is disabled', (settings) => {
    expect(decideAllCquRewrite(navigationInput('https://foo.cqu.edu.cn/'), settings)).toBeNull();
  });
});
