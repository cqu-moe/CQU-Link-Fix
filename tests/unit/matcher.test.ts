import { describe, expect, it } from 'vitest';
import {
  compileMatcherRedirects,
  exactHostMatcherHost,
  matcherDnrHandlesUrl,
  matcherRangeLabel,
  matcherSourceHosts,
  matchesRuleMatcher,
  permissionOriginsForRule,
} from '../../src/rules/matcher';
import type { RuleDefinition } from '../../src/rules/types';

describe('central matcher behavior', () => {
  it('matches host, explicit host-port, and Youth article variants', () => {
    expect(matchesRuleMatcher(
      'https://sso.cqu.edu.cn/login',
      new URL('https://sso.cqu.edu.cn/login'),
      { kind: 'host', host: 'sso.cqu.edu.cn' },
    )).toBe(true);
    expect(matchesRuleMatcher(
      'http://1.1.1.1:80/path',
      new URL('http://1.1.1.1:80/path'),
      { kind: 'host-port', host: '1.1.1.1', port: 80 },
    )).toBe(true);
    expect(matchesRuleMatcher(
      'https://youth.cqu.edu.cn/info/1009/24264.htm',
      new URL('https://youth.cqu.edu.cn/info/1009/24264.htm'),
      { kind: 'youth-article', host: 'youth.cqu.edu.cn' },
    )).toBe(true);
  });

  it('owns display, source-host, and exact-host semantics', () => {
    const hostPort = { kind: 'host-port' as const, host: '1.1.1.1', port: 8000 };
    expect(matcherRangeLabel(hostPort)).toBe('1.1.1.1:8000');
    expect(matcherSourceHosts(hostPort)).toEqual(['1.1.1.1']);
    expect(exactHostMatcherHost(hostPort)).toBeNull();
    expect(exactHostMatcherHost({ kind: 'host', host: 'library.cqu.edu.cn' }))
      .toBe('library.cqu.edu.cn');
  });

  it('owns permission and navigation capability semantics', () => {
    const domain: RuleDefinition = {
      id: 'domain', dnrId: 10_001, name: 'domain', description: 'domain',
      category: 'custom', defaultEnabled: true,
      matcher: { kind: 'host', host: 'library.cqu.edu.cn' },
      transformer: 'atrust-domain',
    };
    expect(permissionOriginsForRule(domain)).toEqual([
      '*://library.cqu.edu.cn/*',
      'https://library-cqu-edu-cn-s.atrust.cqu.edu.cn/*',
    ]);
    expect(matcherDnrHandlesUrl(
      { kind: 'youth-article', host: 'youth.cqu.edu.cn' },
      new URL('https://youth.cqu.edu.cn/info/1009/24264.htm?state=x'),
    )).toBe(false);
  });

  it('compiles matcher-specific redirects behind the central interface', () => {
    expect(compileMatcherRedirects(
      { kind: 'host', host: 'sso.cqu.edu.cn' },
      1001,
      99_999,
    )[0]).toMatchObject({
      id: 1001,
      priority: 99_999,
      action: {
        redirect: {
          regexSubstitution: 'https://sso-cqu-edu-cn-s.atrust.cqu.edu.cn\\1',
        },
      },
    });
  });
});
