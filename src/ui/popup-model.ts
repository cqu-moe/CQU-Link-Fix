import {
  parseSafeHttpUrl,
  sameRequestUrl,
  type RewriteRecord,
} from '../rewrite-record';

export interface PopupModel {
  status: string;
  originalHost: string;
  targetHost: string;
  canBypass: boolean;
  canExclude: boolean;
  ruleId: string | null;
  error: string | null;
}

const UNSUPPORTED_MODEL: PopupModel = {
  status: '此页面不支持链接改写',
  originalHost: '—',
  targetHost: '—',
  canBypass: false,
  canExclude: false,
  ruleId: null,
  error: null,
};

export function buildPopupModel(
  tabUrl: string | null | undefined,
  record: RewriteRecord | null | undefined,
): PopupModel {
  const current = parseSafeHttpUrl(tabUrl);
  if (!current) return { ...UNSUPPORTED_MODEL };

  const unchanged: PopupModel = {
    status: '当前页面未改写',
    originalHost: current.hostname,
    targetHost: current.hostname,
    canBypass: false,
    canExclude: true,
    ruleId: null,
    error: null,
  };
  if (!record) return unchanged;

  const original = parseSafeHttpUrl(record.originalUrl);
  const target = parseSafeHttpUrl(record.targetUrl);
  if (
    !original ||
    !target ||
    !sameRequestUrl(tabUrl ?? '', record.targetUrl)
  ) {
    return unchanged;
  }

  const error = typeof record.error === 'string' && record.error.length > 0
    ? record.error
    : null;
  return {
    status: record.ruleId === 'addon-youth-public'
      ? error ? '团委公网页面加载失败' : '已转换为团委公网链接'
      : error ? 'aTrust 页面加载失败' : '已通过 aTrust 打开',
    originalHost: original.hostname,
    targetHost: target.hostname,
    canBypass: true,
    canExclude: true,
    ruleId: record.ruleId,
    error,
  };
}
