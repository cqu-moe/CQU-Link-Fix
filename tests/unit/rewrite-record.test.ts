import { describe, expect, it } from 'vitest';
import {
  MAX_REWRITE_TAB_ID,
  canonicalRequestUrl,
  isRewriteRecord,
  parseSafeHttpUrl,
  sameRequestUrl,
  type RewriteRecord,
} from '../../src/rewrite-record';

function rewriteRecord(overrides: Partial<RewriteRecord> = {}): RewriteRecord {
  return {
    tabId: 7,
    ruleId: 'core-sso',
    originalUrl: 'https://sso.cqu.edu.cn/login',
    targetUrl: 'https://sso-cqu-edu-cn-s.atrust.cqu.edu.cn/login',
    recordedAt: 1,
    generation: '7:1:test',
    navigationSequence: 1,
    ...overrides,
  };
}

describe('shared rewrite record safety', () => {
  it('validates the complete record structure and optional expected tab', () => {
    expect(isRewriteRecord(rewriteRecord(), 7)).toBe(true);
    expect(isRewriteRecord(rewriteRecord(), 8)).toBe(false);
    expect(isRewriteRecord(rewriteRecord({ tabId: MAX_REWRITE_TAB_ID + 1 }))).toBe(false);
    expect(isRewriteRecord(rewriteRecord({ navigationSequence: -1 }))).toBe(false);
    expect(isRewriteRecord(rewriteRecord({ recordedAt: Number.POSITIVE_INFINITY }))).toBe(false);
    expect(isRewriteRecord({ ...rewriteRecord(), error: 500 })).toBe(false);
  });

  it('parses only safe HTTP(S) URLs without throwing', () => {
    expect(parseSafeHttpUrl('https://sso.cqu.edu.cn/login')?.hostname).toBe('sso.cqu.edu.cn');
    expect(parseSafeHttpUrl('chrome://extensions/')).toBeNull();
    expect(parseSafeHttpUrl('https://user@example.com/')).toBeNull();
    expect(parseSafeHttpUrl('not a url')).toBeNull();
    expect(parseSafeHttpUrl(undefined)).toBeNull();
  });

  it('preserves canonical URL error messages and ignores fragments when comparing requests', () => {
    expect(canonicalRequestUrl('https://EXAMPLE.com:443/path#one')).toBe('https://example.com/path');
    expect(sameRequestUrl('https://example.com/path#one', 'https://example.com/path#two')).toBe(true);
    expect(sameRequestUrl('invalid', 'invalid')).toBe(false);
    expect(() => canonicalRequestUrl('invalid')).toThrow('Rewrite URL must be a valid HTTP(S) URL');
    expect(() => canonicalRequestUrl('chrome://extensions/')).toThrow(
      'Rewrite URL must be a safe HTTP(S) URL',
    );
  });
});
