import type { RewriteRecord } from './background/session';
import type { ExtensionSettings } from './storage/settings';

export const MAX_MESSAGE_TAB_ID = 1_147_483_647;

export type BackgroundMessage =
  | { type: 'get-tab-state'; tabId: number }
  | { type: 'open-original-once'; tabId: number }
  | { type: 'exclude-current-host'; tabId: number }
  | { type: 'replace-settings'; settings: ExtensionSettings }
  | { type: 'persist-all-cqu-mode'; enabled: boolean };

export type BackgroundResponse =
  | { ok: true; state: RewriteRecord | null }
  | { ok: true }
  | { ok: false; error: string };

export function isBackgroundMessage(value: unknown): value is BackgroundMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { type?: unknown; tabId?: unknown };
  if (
    candidate.type === 'replace-settings' ||
    candidate.type === 'persist-all-cqu-mode'
  ) {
    return true;
  }
  if (
    !Number.isInteger(candidate.tabId) ||
    (candidate.tabId as number) < 0 ||
    (candidate.tabId as number) > MAX_MESSAGE_TAB_ID
  ) {
    return false;
  }
  return (
    candidate.type === 'get-tab-state' ||
    candidate.type === 'open-original-once' ||
    candidate.type === 'exclude-current-host'
  );
}
