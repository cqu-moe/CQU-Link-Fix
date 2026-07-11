import { normalizeCustomCquHost } from './rules/custom-rule-policy';

export const CUSTOM_PERMISSION_LEASE_TTL_MS = 120_000;
export const CUSTOM_PERMISSION_LEASE_RENEW_INTERVAL_MS =
  Math.floor(CUSTOM_PERMISSION_LEASE_TTL_MS / 3);

export type CustomPermissionOriginPair = [string, string];

export interface CustomPermissionLeaseRecord {
  nonce: string;
  origins: CustomPermissionOriginPair;
  createdAt: number;
  expiresAt: number;
}

export interface CustomPermissionLeaseHandle {
  nonce: string;
}

export interface CustomPermissionLeaseReleaseOptions {
  cleanupOrigins?: string[];
  now?: number;
}

const LEASE_NONCE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SOURCE_ORIGIN = /^\*:\/\/([^/]+)\/\*$/;
const TARGET_ORIGIN = /^https:\/\/([a-z0-9-]*cqu-edu-cn-s\.atrust\.cqu\.edu\.cn)\/\*$/;

export function isCustomPermissionLeaseNonce(value: unknown): value is string {
  return typeof value === 'string' && LEASE_NONCE.test(value);
}

export function customPermissionOriginsForHost(hostInput: unknown): CustomPermissionOriginPair {
  const host = normalizeCustomCquHost(hostInput);
  return [
    `*://${host}/*`,
    `https://${host.replaceAll('.', '-')}-s.atrust.cqu.edu.cn/*`,
  ];
}

export function parseCustomPermissionOriginPair(value: unknown): CustomPermissionOriginPair {
  if (!Array.isArray(value) || value.length !== 2 || value.some((origin) => typeof origin !== 'string')) {
    throw new Error('Custom permission lease requires one exact source/target pair');
  }
  const source = value[0] as string;
  const sourceMatch = SOURCE_ORIGIN.exec(source);
  if (!sourceMatch) throw new Error('Custom permission source origin is invalid');
  const expected = customPermissionOriginsForHost(sourceMatch[1]);
  if (source !== expected[0] || value[1] !== expected[1]) {
    throw new Error('Custom permission origin pair is invalid');
  }
  return [...expected];
}

export function parseCustomPermissionCleanupOrigins(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((origin) =>
    typeof origin !== 'string' || !isStrictCustomPermissionOrigin(origin),
  )) throw new Error('Custom permission cleanup origins are invalid');
  return [...new Set(value)].sort();
}

export function isStrictCustomPermissionOrigin(origin: string): boolean {
  const sourceMatch = SOURCE_ORIGIN.exec(origin);
  if (sourceMatch) {
    try { return customPermissionOriginsForHost(sourceMatch[1])[0] === origin; } catch { return false; }
  }
  return TARGET_ORIGIN.test(origin);
}

export function parseCustomPermissionLeaseRecord(
  value: unknown,
  now: number,
): CustomPermissionLeaseRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    Object.keys(candidate).sort().join(',') !== 'createdAt,expiresAt,nonce,origins' ||
    !isCustomPermissionLeaseNonce(candidate.nonce) ||
    !Number.isSafeInteger(candidate.createdAt) ||
    (candidate.createdAt as number) < 0 ||
    (candidate.createdAt as number) > now ||
    !Number.isSafeInteger(candidate.expiresAt) ||
    candidate.expiresAt !== (candidate.createdAt as number) + CUSTOM_PERMISSION_LEASE_TTL_MS ||
    (candidate.expiresAt as number) <= now
  ) return null;
  try {
    return {
      nonce: candidate.nonce,
      origins: parseCustomPermissionOriginPair(candidate.origins),
      createdAt: candidate.createdAt as number,
      expiresAt: candidate.expiresAt as number,
    };
  } catch {
    return null;
  }
}
