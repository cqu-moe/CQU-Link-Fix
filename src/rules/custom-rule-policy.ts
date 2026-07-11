import { BUILT_IN_RULES } from './builtins';

export const CUSTOM_DNR_ID_MIN = 10_001;
export const CUSTOM_DNR_ID_MAX = 79_999;

const BUILT_IN_SOURCE_HOSTS = new Set(
  BUILT_IN_RULES.map((rule) => rule.matcher.host.toLowerCase()),
);

export function normalizeDnsHost(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (
    !normalized ||
    normalized.length > 253 ||
    !normalized.split('.').every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(label),
    )
  ) {
    return null;
  }
  return normalized;
}

export function normalizeCustomCquHost(value: unknown): string {
  const host = normalizeDnsHost(value);
  if (!host || !(host === 'cqu.edu.cn' || host.endsWith('.cqu.edu.cn'))) {
    throw new Error('首版仅支持 CQU 域名');
  }
  if (host === 'atrust.cqu.edu.cn' || host.endsWith('.atrust.cqu.edu.cn')) {
    throw new Error('不能把 aTrust 地址作为源地址');
  }
  return host;
}

export function assertCustomDnrId(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < CUSTOM_DNR_ID_MIN ||
    (value as number) > CUSTOM_DNR_ID_MAX
  ) {
    throw new Error('Custom DNR rule ID is outside the safe custom range');
  }
  return value as number;
}

export function isBuiltInSourceHost(host: string): boolean {
  return BUILT_IN_SOURCE_HOSTS.has(host);
}
