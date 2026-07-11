import {
  CUSTOM_PERMISSION_LEASE_TTL_MS,
  customPermissionOriginsForHost,
  isCustomPermissionLeaseNonce,
  parseCustomPermissionLeaseRecord,
  parseCustomPermissionOriginPair,
  type CustomPermissionLeaseRecord,
  type CustomPermissionLeaseRelease,
} from '../custom-permission-lease';
import { loadSettings } from '../storage/settings';

const LEASES_KEY = 'customPermissionLeases';
let leaseQueue = Promise.resolve();

function queueLeaseMutation<T>(operation: () => Promise<T>): Promise<T> {
  const current = leaseQueue.then(operation, operation);
  leaseQueue = current.then(() => undefined, () => undefined);
  return current;
}

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

export async function acquireCustomPermissionLease(
  originsInput: unknown,
  now?: number,
): Promise<{ nonce: string; expiresAt: number }> {
  const origins = parseCustomPermissionOriginPair(originsInput);
  return queueLeaseMutation(async () => {
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

export async function releaseCustomPermissionLease(
  nonce: string,
  now?: number,
): Promise<CustomPermissionLeaseRelease> {
  if (!isCustomPermissionLeaseNonce(nonce)) throw new Error('Custom permission lease nonce is invalid');
  return queueLeaseMutation(async () => {
    const mutationNow = now ?? Date.now();
    const leases = await loadActiveLeases(mutationNow);
    if (!leases.some((lease) => lease.nonce === nonce)) {
      await writeLeases(leases);
      throw new Error('Custom permission lease was not found or expired');
    }
    const remaining = leases.filter((lease) => lease.nonce !== nonce);
    const settings = await loadSettings();
    const requiredOrigins = new Set(remaining.flatMap((lease) => lease.origins));
    for (const rule of settings.customRules) {
      if (rule.matcher.kind !== 'host') continue;
      for (const origin of customPermissionOriginsForHost(rule.matcher.host)) {
        requiredOrigins.add(origin);
      }
    }
    await writeLeases(remaining);
    return { requiredOrigins: [...requiredOrigins].sort() };
  });
}
