import { describe, expect, it } from 'vitest';
import type { RewriteRecord } from '../../src/rewrite-record';
import { buildPopupModel } from '../../src/ui/popup-model';

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

describe('popup model', () => {
  it('explains a recorded rewrite whose target matches the current request URL', () => {
    expect(buildPopupModel(
      'https://sso-cqu-edu-cn-s.atrust.cqu.edu.cn/login#finished',
      rewriteRecord(),
    )).toMatchObject({
      status: '已通过 aTrust 打开',
      originalHost: 'sso.cqu.edu.cn',
      targetHost: 'sso-cqu-edu-cn-s.atrust.cqu.edu.cn',
      canBypass: true,
      canExclude: true,
      ruleId: 'core-sso',
      error: null,
    });
  });

  it('shows an unchanged page without enabling bypass', () => {
    expect(buildPopupModel('https://example.com/', null)).toMatchObject({
      status: '当前页面未改写',
      originalHost: 'example.com',
      targetHost: 'example.com',
      canBypass: false,
      canExclude: true,
      ruleId: null,
      error: null,
    });
  });

  it('does not describe or offer bypass for a stale record on an unrelated page', () => {
    expect(buildPopupModel(
      'https://library.cqu.edu.cn/',
      rewriteRecord({ error: 'net::ERR_CONNECTION_REFUSED' }),
    )).toMatchObject({
      status: '当前页面未改写',
      originalHost: 'library.cqu.edu.cn',
      targetHost: 'library.cqu.edu.cn',
      canBypass: false,
      canExclude: false,
      ruleId: null,
      error: null,
    });
  });

  it('surfaces a detected navigation error only for the matching target', () => {
    expect(buildPopupModel(
      'https://sso-cqu-edu-cn-s.atrust.cqu.edu.cn/login',
      rewriteRecord({ error: 'net::ERR_CONNECTION_REFUSED' }),
    )).toMatchObject({
      status: 'aTrust 页面加载失败',
      canBypass: true,
      error: 'net::ERR_CONNECTION_REFUSED',
    });
  });

  it.each([undefined, null, '', 'not a url', 'chrome://extensions/'])(
    'is total and non-actionable for a missing, invalid, or restricted URL: %s',
    (tabUrl) => {
      expect(buildPopupModel(tabUrl, rewriteRecord())).toEqual({
        status: '此页面不支持链接改写',
        originalHost: '—',
        targetHost: '—',
        canBypass: false,
        canExclude: false,
        ruleId: null,
        error: null,
      });
    },
  );

  it('does not throw or expose actions when a record contains invalid URLs', () => {
    expect(buildPopupModel(
      'https://sso-cqu-edu-cn-s.atrust.cqu.edu.cn/login',
      rewriteRecord({ originalUrl: 'invalid', targetUrl: 'also invalid' }),
    )).toMatchObject({
      status: '当前页面未改写',
      canBypass: false,
      canExclude: false,
      ruleId: null,
      error: null,
    });
  });
});
