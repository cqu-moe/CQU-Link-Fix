import {
  isCustomPermissionLeaseNonce,
  parseCustomPermissionOriginPair,
  parseRequiredCustomPermissionOrigins,
  type CustomPermissionLeaseHandle,
  type CustomPermissionOriginPair,
  type CustomPermissionLeaseRelease,
} from '../custom-permission-lease';
import type { ExactOriginPermission } from './custom-rule';

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function acquireCustomPermissionLeaseViaBackground(
  permission: ExactOriginPermission,
): Promise<CustomPermissionLeaseHandle | null> {
  let origins: CustomPermissionOriginPair;
  try { origins = parseCustomPermissionOriginPair(permission.origins); } catch { return null; }
  try {
    const response = await browser.runtime.sendMessage({
      type: 'acquire-custom-permission-lease',
      origins,
    }) as unknown;
    if (
      !isPlainObject(response) ||
      !hasExactKeys(response, ['leaseNonce', 'ok']) ||
      response.ok !== true ||
      !isCustomPermissionLeaseNonce(response.leaseNonce)
    ) return null;
    return { nonce: response.leaseNonce };
  } catch {
    return null;
  }
}

export async function releaseCustomPermissionLeaseViaBackground(
  nonce: string,
): Promise<CustomPermissionLeaseRelease | null> {
  if (!isCustomPermissionLeaseNonce(nonce)) return null;
  try {
    const response = await browser.runtime.sendMessage({
      type: 'release-custom-permission-lease',
      nonce,
    }) as unknown;
    if (
      !isPlainObject(response) ||
      !hasExactKeys(response, ['ok', 'requiredOrigins']) ||
      response.ok !== true
    ) return null;
    return { requiredOrigins: parseRequiredCustomPermissionOrigins(response.requiredOrigins) };
  } catch {
    return null;
  }
}
