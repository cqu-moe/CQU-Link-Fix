export const MAX_REWRITE_TAB_ID = 1_147_483_647;

export interface RewriteRecord {
  tabId: number;
  ruleId: string;
  originalUrl: string;
  targetUrl: string;
  recordedAt: number;
  generation: string;
  navigationSequence: number;
  error?: string;
}

export function parseSafeHttpUrl(value: string | null | undefined): URL | null {
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

export function canonicalRequestUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Rewrite URL must be a valid HTTP(S) URL');
  }
  if (!parseSafeHttpUrl(value)) {
    throw new Error('Rewrite URL must be a safe HTTP(S) URL');
  }
  url.hash = '';
  return url.toString();
}

export function sameRequestUrl(left: string, right: string): boolean {
  try {
    return canonicalRequestUrl(left) === canonicalRequestUrl(right);
  } catch {
    return false;
  }
}

export function isRewriteRecord(
  value: unknown,
  expectedTabId?: number,
): value is RewriteRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<RewriteRecord>;
  return (
    Number.isInteger(record.tabId) &&
    (record.tabId as number) >= 0 &&
    (record.tabId as number) <= MAX_REWRITE_TAB_ID &&
    (expectedTabId === undefined || record.tabId === expectedTabId) &&
    typeof record.ruleId === 'string' &&
    record.ruleId.length > 0 &&
    typeof record.originalUrl === 'string' &&
    typeof record.targetUrl === 'string' &&
    typeof record.recordedAt === 'number' &&
    Number.isFinite(record.recordedAt) &&
    typeof record.generation === 'string' &&
    record.generation.length > 0 &&
    Number.isInteger(record.navigationSequence) &&
    (record.navigationSequence as number) >= 0 &&
    (record.error === undefined || typeof record.error === 'string')
  );
}
