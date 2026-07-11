import type { RewriteRecord } from '../background/session';

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

function parseHttpUrl(value: string | null | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      !url.hostname
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function canonicalRequestUrl(url: URL): string {
  const canonical = new URL(url);
  canonical.hash = '';
  return canonical.toString();
}

export function buildPopupModel(
  tabUrl: string | null | undefined,
  record: RewriteRecord | null | undefined,
): PopupModel {
  const current = parseHttpUrl(tabUrl);
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

  const original = parseHttpUrl(record.originalUrl);
  const target = parseHttpUrl(record.targetUrl);
  if (
    !original ||
    !target ||
    canonicalRequestUrl(current) !== canonicalRequestUrl(target)
  ) {
    return { ...unchanged, canExclude: false };
  }

  const error = typeof record.error === 'string' && record.error.length > 0
    ? record.error
    : null;
  return {
    status: error ? 'aTrust 页面加载失败' : '已通过 aTrust 打开',
    originalHost: original.hostname,
    targetHost: target.hostname,
    canBypass: true,
    canExclude: true,
    ruleId: record.ruleId,
    error,
  };
}
