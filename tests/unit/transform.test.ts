import { describe, expect, it } from 'vitest';
import {
  applyTransformer,
  assertCasServicePreserved,
  hasTopLevelCasTicket,
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

  it.each([
    'https://1.1.1.1/path',
    'https://[::1]/path',
    'https://localhost/path',
    'https://_bad.cqu.edu.cn/path',
    'https://bad-.cqu.edu.cn/path',
  ])('rejects IP literals and non-DNS hosts %s', (input) => {
    expect(() => toAtrustDomainUrl(input)).toThrow();
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

  it.each([
    'http://127.1:8000/path',
    'http://0x7f.1:8000/path',
    'http://0177.0.0.1:8000/path',
    'http://2130706433:8000/path',
  ])('rejects non-canonical IPv4 authority %s', (input) => {
    expect(() => toAtrustIpPortUrl(input)).toThrow();
  });

  it.each([
    ['http://1.1.1.1:80/path', 'https://1-1-1-1-80-p.atrust.cqu.edu.cn/path'],
    ['https://1.1.1.1:443/path', 'https://1-1-1-1-443-p.atrust.cqu.edu.cn/path'],
  ])('preserves explicit default port in %s', (input, expected) => {
    expect(toAtrustIpPortUrl(input)).toBe(expected);
  });

  it('rejects userinfo in the raw authority', () => {
    expect(() => toAtrustIpPortUrl('http://user@1.1.1.1:8000/path')).toThrow('unsupported URL');
  });
});

describe('Youth League transform', () => {
  it('builds the public content.jsp address and preserves the fragment', () => {
    expect(toYouthPublicUrl('https://youth.cqu.edu.cn/info/1009/24264.htm#print')).toBe(
      'https://youth.cqu.edu.cn/content.jsp?urltype=news.NewsContentUrl&wbtreeid=1009&wbnewsid=24264#print',
    );
  });

  it('preserves state and redirect_uri values with the fragment', () => {
    const input =
      'https://youth.cqu.edu.cn/info/1009/24264.htm?state=opaque%2Bstate&redirect_uri=https%3A%2F%2Fclient.example%2Fcb%3Fa%3D1%26b%3Dtwo#details';
    expect(toYouthPublicUrl(input)).toBe(
      'https://youth.cqu.edu.cn/content.jsp?state=opaque%2Bstate&redirect_uri=https%3A%2F%2Fclient.example%2Fcb%3Fa%3D1%26b%3Dtwo&urltype=news.NewsContentUrl&wbtreeid=1009&wbnewsid=24264#details',
    );
  });

  it('preserves duplicate protected parameters in their original order', () => {
    const input =
      'https://youth.cqu.edu.cn/info/1009/24264.htm?state=first&redirect_uri=https%3A%2F%2Fa.example%2Fcb&foo=1&state=second&redirect_uri=https%3A%2F%2Fb.example%2Fcb&foo=2';
    expect(toYouthPublicUrl(input)).toBe(
      'https://youth.cqu.edu.cn/content.jsp?state=first&redirect_uri=https%3A%2F%2Fa.example%2Fcb&foo=1&state=second&redirect_uri=https%3A%2F%2Fb.example%2Fcb&foo=2&urltype=news.NewsContentUrl&wbtreeid=1009&wbnewsid=24264',
    );
  });

  it('keeps the decoded redirect_uri unchanged without normalizing its encoding', () => {
    const input =
      'https://youth.cqu.edu.cn/info/1009/24264.htm?redirect_uri=https%3a%2f%2fclient.example%2fcb%3fq%3da%2520b';
    const output = toYouthPublicUrl(input);
    expect(output).toContain('redirect_uri=https%3a%2f%2fclient.example%2fcb%3fq%3da%2520b');
    expect(new URL(output).searchParams.getAll('redirect_uri')).toEqual(
      new URL(input).searchParams.getAll('redirect_uri'),
    );
  });

  it('removes conflicting Youth parameters so generated values win', () => {
    const input =
      'https://youth.cqu.edu.cn/info/1009/24264.htm?urltype=evil&%77btreeid=9&state=keep&wbnewsid=8&urltype=again#conflict';
    const output = toYouthPublicUrl(input);
    const outputUrl = new URL(output);
    expect(output).toBe(
      'https://youth.cqu.edu.cn/content.jsp?state=keep&urltype=news.NewsContentUrl&wbtreeid=1009&wbnewsid=24264#conflict',
    );
    expect(outputUrl.searchParams.getAll('urltype')).toEqual(['news.NewsContentUrl']);
    expect(outputUrl.searchParams.getAll('wbtreeid')).toEqual(['1009']);
    expect(outputUrl.searchParams.getAll('wbnewsid')).toEqual(['24264']);
  });
});

describe('invariants', () => {
  it('recognizes aTrust and CQU hosts', () => {
    expect(isAtrustUrl('https://atrust.cqu.edu.cn/portal/#!/login')).toBe(true);
    expect(isAtrustUrl('https://x-s.atrust.cqu.edu.cn/')).toBe(true);
    expect(isCquDomain('https://foo.cqu.edu.cn/')).toBe(true);
  });

  it('accepts an unchanged decoded CAS service', () => {
    const before = 'https://sso.cqu.edu.cn/login?service=https%3A%2F%2Fmy.cqu.edu.cn%2Fcb%3Fa%3D1';
    const after = toAtrustDomainUrl(before);
    expect(() => assertCasServicePreserved(before, after)).not.toThrow();
  });

  it('rejects a missing CAS service', () => {
    const before = 'https://sso.cqu.edu.cn/login?service=https%3A%2F%2Fmy.cqu.edu.cn%2Fcb';
    const after = 'https://sso-cqu-edu-cn-s.atrust.cqu.edu.cn/login';
    expect(() => assertCasServicePreserved(before, after)).toThrow('CAS service changed');
  });

  it('rejects a changed CAS service', () => {
    const before = 'https://sso.cqu.edu.cn/login?service=https%3A%2F%2Fmy.cqu.edu.cn%2Fcb';
    const after = 'https://sso-cqu-edu-cn-s.atrust.cqu.edu.cn/login?service=https%3A%2F%2Fevil.example%2Fcb';
    expect(() => assertCasServicePreserved(before, after)).toThrow('CAS service changed');
  });

  it('rejects an added duplicate CAS service', () => {
    const before = 'https://sso.cqu.edu.cn/login?service=https%3A%2F%2Fmy.cqu.edu.cn%2Fcb';
    const after =
      'https://sso-cqu-edu-cn-s.atrust.cqu.edu.cn/login?service=https%3A%2F%2Fmy.cqu.edu.cn%2Fcb&service=https%3A%2F%2Fmy.cqu.edu.cn%2Fcb';
    expect(() => assertCasServicePreserved(before, after)).toThrow('CAS service changed');
  });

  it('rejects a mutation to the second CAS service', () => {
    const before =
      'https://sso.cqu.edu.cn/login?service=https%3A%2F%2Ffirst.cqu.edu.cn%2Fcb&service=https%3A%2F%2Fsecond.cqu.edu.cn%2Fcb';
    const after =
      'https://sso-cqu-edu-cn-s.atrust.cqu.edu.cn/login?service=https%3A%2F%2Ffirst.cqu.edu.cn%2Fcb&service=https%3A%2F%2Fevil.example%2Fcb';
    expect(() => assertCasServicePreserved(before, after)).toThrow('CAS service changed');
  });
});

describe('top-level CAS ticket detection', () => {
  it.each([
    'https://client.cqu.edu.cn/callback?ticket=synthetic',
    'https://client.cqu.edu.cn/callback?state=x&ticket',
    'https://client.cqu.edu.cn/callback?t%69cket=synthetic',
    'https://client.cqu.edu.cn/callback?%74%69%63%6b%65%74=synthetic',
    'https://client.cqu.edu.cn/callback?%74%69%63%6B%65%74=synthetic',
  ])('recognizes the exact decoded lowercase key in %s', (input) => {
    expect(hasTopLevelCasTicket(new URL(input))).toBe(true);
  });

  it.each([
    'https://client.cqu.edu.cn/callback?Ticket=synthetic',
    'https://client.cqu.edu.cn/callback?%54icket=synthetic',
    'https://client.cqu.edu.cn/callback?ticketing=synthetic',
    'https://client.cqu.edu.cn/callback?foo%26ticket=synthetic',
    'https://client.cqu.edu.cn/start?service=https%3A%2F%2Fclient.example%2Fcallback%3Fticket%3Dsynthetic',
  ])('rejects non-top-level or non-exact ticket text in %s', (input) => {
    expect(hasTopLevelCasTicket(new URL(input))).toBe(false);
  });
});

describe('transformer dispatch', () => {
  it.each([
    [
      'atrust-domain' as const,
      'https://sso.cqu.edu.cn/login',
      'https://sso-cqu-edu-cn-s.atrust.cqu.edu.cn/login',
    ],
    [
      'atrust-ip-port' as const,
      'http://1.1.1.1:8000/path',
      'https://1-1-1-1-8000-p.atrust.cqu.edu.cn/path',
    ],
    [
      'youth-public' as const,
      'https://youth.cqu.edu.cn/info/1009/24264.htm',
      'https://youth.cqu.edu.cn/content.jsp?urltype=news.NewsContentUrl&wbtreeid=1009&wbnewsid=24264',
    ],
  ])('dispatches the %s transformer', (transformer, input, expected) => {
    expect(applyTransformer(transformer, input)).toBe(expected);
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
