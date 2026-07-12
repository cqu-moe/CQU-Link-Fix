import {
  parseDnrReconciliationStatus,
  type DnrReconciliationStatus,
} from '../rules/dnr-status';

export async function getDnrStatusViaBackground(): Promise<DnrReconciliationStatus | null> {
  try {
    const response = await browser.runtime.sendMessage({ type: 'get-dnr-status' }) as unknown;
    if (!response || typeof response !== 'object' || Array.isArray(response)) return null;
    const candidate = response as Record<string, unknown>;
    if (
      Object.keys(candidate).length !== 2 ||
      candidate.ok !== true ||
      !('dnrStatus' in candidate)
    ) return null;
    return parseDnrReconciliationStatus(candidate.dnrStatus);
  } catch {
    return null;
  }
}
