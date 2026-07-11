import { describe, expect, it } from 'vitest';
import {
  assertCasServicePreserved,
  isAtrustUrl,
  isCquDomain,
  toAtrustDomainUrl,
  toAtrustIpPortUrl,
  toYouthPublicUrl,
} from '../../src/rules/transform';

describe('aTrust domain transform', () => {
  it('forces HTTPS and preserves the complete suffix', () => {
    const input = 'http://sso.cqu.edu.cn/login?service=https%3A%2F%2Fmy.cqu.edu.cn%2Fcb#login';
    expect(toAtrustDomainUrl(input)).toBe(
      'https://sso-cqu-edu-cn-s.atrust.cqu.edu.cn/login?service=https%3A%2F%2Fmy.cqu.edu.cn%2Fcb#login',
    );
  });

  it('refuses to rewrite an aTrust hostname twice', () => {
    expect(() => toAtrustDomainUrl('https://sso-cqu-edu-cn-s.atrust.cqu.edu.cn/login')).toThrow('already uses aTrust');
  });
});

describe('aTrust IP and port transform', () => {
  it('requires and encodes a complete IPv4 and port', () => {
    expect(toAtrustIpPortUrl('http://1.1.1.1:8000/path?q=1')).toBe(
      'https://1-1-1-1-8000-p.atrust.cqu.edu.cn/path?q=1',
    );
  });

  it.each(['http://1.1.1.1/path', 'http://[::1]:8000/path', 'ftp://1.1.1.1:8000/path'])(
    'rejects unsupported input %s',
    (input) => expect(() => toAtrustIpPortUrl(input)).toThrow(),
  );
});

describe('Youth League transform', () => {
  it('builds the public content.jsp address and preserves the fragment', () => {
    expect(toYouthPublicUrl('https://youth.cqu.edu.cn/info/1009/24264.htm#print')).toBe(
      'https://youth.cqu.edu.cn/content.jsp?urltype=news.NewsContentUrl&wbtreeid=1009&wbnewsid=24264#print',
    );
  });
});

describe('invariants', () => {
  it('recognizes aTrust and CQU hosts', () => {
    expect(isAtrustUrl('https://x-s.atrust.cqu.edu.cn/')).toBe(true);
    expect(isCquDomain('https://foo.cqu.edu.cn/')).toBe(true);
  });

  it('accepts an unchanged decoded CAS service', () => {
    const before = 'https://sso.cqu.edu.cn/login?service=https%3A%2F%2Fmy.cqu.edu.cn%2Fcb%3Fa%3D1';
    const after = toAtrustDomainUrl(before);
    expect(() => assertCasServicePreserved(before, after)).not.toThrow();
  });
});

it.each([
  ['https://SSO.CQU.EDU.CN', 'https://sso-cqu-edu-cn-s.atrust.cqu.edu.cn/'],
  ['https://sso.cqu.edu.cn/?a=1&b=two', 'https://sso-cqu-edu-cn-s.atrust.cqu.edu.cn/?a=1&b=two'],
  [
    'https://sso.cqu.edu.cn/login?service=https%3A%2F%2Fx.cqu.edu.cn%2Fcb%3Fa%3D1%26b%3D2#x',
    'https://sso-cqu-edu-cn-s.atrust.cqu.edu.cn/login?service=https%3A%2F%2Fx.cqu.edu.cn%2Fcb%3Fa%3D1%26b%3D2#x',
  ],
])('rewrites %s without losing URL components', (input, expected) => {
  expect(toAtrustDomainUrl(input)).toBe(expected);
});
