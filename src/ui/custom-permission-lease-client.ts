import {
  isCustomPermissionLeaseNonce,
  parseCustomPermissionCleanupOrigins,
  parseCustomPermissionOriginPair,
  type CustomPermissionLeaseHandle,
  type CustomPermissionOriginPair,
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

export async function renewCustomPermissionLeaseViaBackground(
  nonce: string,
  permission: ExactOriginPermission,
): Promise<boolean> {
  if (!isCustomPermissionLeaseNonce(nonce)) return false;
  let origins: CustomPermissionOriginPair;
  try { origins = parseCustomPermissionOriginPair(permission.origins); } catch { return false; }
  try {
    const response = await browser.runtime.sendMessage({
      type: 'renew-custom-permission-lease',
      nonce,
      origins,
    }) as unknown;
    return isPlainObject(response) &&
      hasExactKeys(response, ['leaseExpiresAt', 'ok']) &&
      response.ok === true &&
      Number.isSafeInteger(response.leaseExpiresAt) &&
      (response.leaseExpiresAt as number) >= 0;
  } catch {
    return false;
  }
}

export async function releaseCustomPermissionLeaseViaBackground(
  nonce: string,
  cleanupOrigins: readonly string[] = [],
): Promise<boolean> {
  if (!isCustomPermissionLeaseNonce(nonce)) return false;
  let normalizedCleanup: string[];
  try { normalizedCleanup = parseCustomPermissionCleanupOrigins(cleanupOrigins); } catch { return false; }
  try {
    const response = await browser.runtime.sendMessage({
      type: 'release-custom-permission-lease',
      nonce,
      cleanupOrigins: normalizedCleanup,
    }) as unknown;
    return isPlainObject(response) && hasExactKeys(response, ['ok']) && response.ok === true;
  } catch {
    return false;
  }
}
