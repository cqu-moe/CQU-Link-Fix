import {
  CUSTOM_PERMISSION_LEASE_TTL_MS,
  customPermissionOriginsForHost,
  isCustomPermissionLeaseNonce,
  parseCustomPermissionCleanupOrigins,
  parseCustomPermissionLeaseRecord,
  parseCustomPermissionOriginPair,
  type CustomPermissionLeaseRecord,
  type CustomPermissionLeaseReleaseOptions,
} from '../custom-permission-lease';
import { loadSettings, type ExtensionSettings } from '../storage/settings';
import { queueBackgroundOperation } from './coordination';

const LEASES_KEY = 'customPermissionLeases';
const PENDING_CLEANUP_KEY = 'customPermissionCleanupOrigins';

async function loadActiveLeases(now: number): Promise<CustomPermissionLeaseRecord[]> {
  const stored = await browser.storage.session.get(LEASES_KEY);
  const values = stored[LEASES_KEY];
  if (!Array.isArray(values)) return [];
  return values.flatMap((value) => {
    const parsed = parseCustomPermissionLeaseRecord(value, now);
    return parsed ? [parsed] : [];
  });
}

async function writeLeases(leases: readonly CustomPermissionLeaseRecord[]): Promise<void> {
  await browser.storage.session.set({ [LEASES_KEY]: structuredClone(leases) });
}

async function loadPendingCleanupOrigins(): Promise<string[]> {
  const stored = await browser.storage.session.get(PENDING_CLEANUP_KEY);
  try {
    return parseCustomPermissionCleanupOrigins(stored[PENDING_CLEANUP_KEY] ?? []);
  } catch {
    return [];
  }
}

async function writePendingCleanupOrigins(origins: readonly string[]): Promise<void> {
  await browser.storage.session.set({
    [PENDING_CLEANUP_KEY]: parseCustomPermissionCleanupOrigins(origins),
  });
}

async function removeExactOrigins(origins: readonly string[]): Promise<void> {
  if (origins.length === 0) return;
  const removed = await browser.permissions.remove({ origins: [...origins] });
  if (removed !== false) return;
  const stillGranted = await Promise.all(origins.map((origin) =>
    browser.permissions.contains({ origins: [origin] }),
  ));
  if (stillGranted.some(Boolean)) throw new Error('Custom permission cleanup was not completed');
}

async function settlePendingCleanup(
  candidates: readonly string[],
  settings: ExtensionSettings,
  activeLeases: readonly CustomPermissionLeaseRecord[],
): Promise<void> {
  const pending = parseCustomPermissionCleanupOrigins([
    ...await loadPendingCleanupOrigins(),
    ...candidates,
  ]);
  if (pending.length === 0) return;

  // Persist the debt before attempting a fallible permission API call.
  await writePendingCleanupOrigins(pending);
  const requiredOrigins = new Set(activeLeases.flatMap((lease) => lease.origins));
  for (const rule of settings.customRules) {
    if (rule.matcher.kind !== 'host') continue;
    for (const origin of customPermissionOriginsForHost(rule.matcher.host)) {
      requiredOrigins.add(origin);
    }
  }
  const removableOrigins = pending.filter((origin) => !requiredOrigins.has(origin));
  await removeExactOrigins(removableOrigins);
  await writePendingCleanupOrigins(
    pending.filter((origin) => requiredOrigins.has(origin)),
  );
}

export async function cleanupDeletedCustomRulePermissions(
  next: ExtensionSettings,
  previous: ExtensionSettings,
  now = Date.now(),
): Promise<void> {
  const nextRuleIds = new Set(next.customRules.map((rule) => rule.id));
  const cleanupCandidates = new Set(
    previous.customRules
      .filter((rule) => !nextRuleIds.has(rule.id) && rule.matcher.kind === 'host')
      .flatMap((rule) => customPermissionOriginsForHost(rule.matcher.host)),
  );
  if (cleanupCandidates.size === 0) return;

  const activeLeases = await loadActiveLeases(now);
  await settlePendingCleanup([...cleanupCandidates], next, activeLeases);
}

export function retryPendingCustomPermissionCleanup(now = Date.now()): Promise<void> {
  return queueBackgroundOperation(async () => {
    const settings = await loadSettings();
    const activeLeases = await loadActiveLeases(now);
    await settlePendingCleanup([], settings, activeLeases);
  });
}

export async function acquireCustomPermissionLease(
  originsInput: unknown,
  now?: number,
): Promise<{ nonce: string; expiresAt: number }> {
  const origins = parseCustomPermissionOriginPair(originsInput);
  return queueBackgroundOperation(async () => {
    const mutationNow = now ?? Date.now();
    const leases = await loadActiveLeases(mutationNow);
    const record: CustomPermissionLeaseRecord = {
      nonce: crypto.randomUUID(),
      origins,
      createdAt: mutationNow,
      expiresAt: mutationNow + CUSTOM_PERMISSION_LEASE_TTL_MS,
    };
    await writeLeases([...leases, record]);
    return { nonce: record.nonce, expiresAt: record.expiresAt };
  });
}

export async function renewCustomPermissionLease(
  nonce: string,
  originsInput: unknown,
  now?: number,
): Promise<{ expiresAt: number }> {
  if (!isCustomPermissionLeaseNonce(nonce)) throw new Error('Custom permission lease nonce is invalid');
  const origins = parseCustomPermissionOriginPair(originsInput);
  return queueBackgroundOperation(async () => {
    const mutationNow = now ?? Date.now();
    const leases = await loadActiveLeases(mutationNow);
    const matching = leases.filter((lease) => lease.nonce === nonce);
    if (
      matching.length !== 1 ||
      matching[0]!.origins[0] !== origins[0] ||
      matching[0]!.origins[1] !== origins[1]
    ) {
      await writeLeases(leases);
      throw new Error('Custom permission lease was not found, expired, or did not match');
    }
    const renewed = leases.map((lease): CustomPermissionLeaseRecord =>
      lease.nonce === nonce
        ? {
            ...lease,
            createdAt: mutationNow,
            expiresAt: mutationNow + CUSTOM_PERMISSION_LEASE_TTL_MS,
          }
        : lease,
    );
    await writeLeases(renewed);
    return { expiresAt: mutationNow + CUSTOM_PERMISSION_LEASE_TTL_MS };
  });
}

export async function releaseCustomPermissionLease(
  nonce: string,
  options: CustomPermissionLeaseReleaseOptions = {},
): Promise<void> {
  if (!isCustomPermissionLeaseNonce(nonce)) throw new Error('Custom permission lease nonce is invalid');
  const cleanupOrigins = parseCustomPermissionCleanupOrigins(options.cleanupOrigins ?? []);
  return queueBackgroundOperation(async () => {
    const mutationNow = options.now ?? Date.now();
    const leases = await loadActiveLeases(mutationNow);
    const releasing = leases.find((lease) => lease.nonce === nonce);
    if (!releasing) {
      await writeLeases(leases);
      throw new Error('Custom permission lease was not found or expired');
    }
    if (cleanupOrigins.some((origin) => !releasing.origins.includes(origin))) {
      throw new Error('Custom permission cleanup exceeds the released lease');
    }
    const remaining = leases.filter((lease) => lease.nonce !== nonce);
    const settings = await loadSettings();
    await writeLeases(remaining);
    await settlePendingCleanup(cleanupOrigins, settings, remaining);
  });
}
