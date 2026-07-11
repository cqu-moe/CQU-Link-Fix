import { MAX_REWRITE_TAB_ID, type RewriteRecord } from './rewrite-record';
import {
  validateEditableSettings,
  type EditableSettings,
  type SettingsSnapshot,
} from './storage/settings';
import {
  isCustomPermissionLeaseNonce,
  parseCustomPermissionCleanupOrigins,
  parseCustomPermissionOriginPair,
  type CustomPermissionOriginPair,
} from './custom-permission-lease';

export const MAX_MESSAGE_TAB_ID = MAX_REWRITE_TAB_ID;

export type BackgroundMessage =
  | { type: 'get-tab-state'; tabId: number }
  | { type: 'open-original-once'; tabId: number }
  | { type: 'exclude-current-host'; tabId: number }
  | { type: 'get-settings-snapshot' }
  | { type: 'replace-settings'; settings: EditableSettings; expectedRevision: number }
  | { type: 'reconcile-all-cqu-mode'; requested: boolean }
  | { type: 'acquire-custom-permission-lease'; origins: CustomPermissionOriginPair }
  | {
      type: 'renew-custom-permission-lease';
      nonce: string;
      origins: CustomPermissionOriginPair;
    }
  | { type: 'release-custom-permission-lease'; nonce: string; cleanupOrigins: string[] };

export type BackgroundResponse =
  | { ok: true; state: RewriteRecord | null }
  | { ok: true }
  | { ok: true; revision: number }
  | { ok: true; revision: number; enabled: boolean }
  | { ok: true; snapshot: SettingsSnapshot }
  | { ok: true; leaseNonce: string }
  | { ok: true; leaseExpiresAt: number }
  | {
      ok: false;
      error: string;
      code?: 'settings-conflict' | 'settings-apply-failed' | 'operation-failed';
    };

export function isBackgroundMessage(value: unknown): value is BackgroundMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.type === 'get-settings-snapshot') return Object.keys(candidate).length === 1;
  if (candidate.type === 'reconcile-all-cqu-mode') {
    return Object.keys(candidate).length === 2 && typeof candidate.requested === 'boolean';
  }
  if (candidate.type === 'acquire-custom-permission-lease') {
    if (Object.keys(candidate).length !== 2) return false;
    try { parseCustomPermissionOriginPair(candidate.origins); return true; } catch { return false; }
  }
  if (candidate.type === 'renew-custom-permission-lease') {
    if (
      Object.keys(candidate).length !== 3 ||
      !isCustomPermissionLeaseNonce(candidate.nonce)
    ) return false;
    try { parseCustomPermissionOriginPair(candidate.origins); return true; } catch { return false; }
  }
  if (candidate.type === 'release-custom-permission-lease') {
    if (
      Object.keys(candidate).length !== 3 ||
      !isCustomPermissionLeaseNonce(candidate.nonce)
    ) return false;
    try { parseCustomPermissionCleanupOrigins(candidate.cleanupOrigins); return true; } catch { return false; }
  }
  if (candidate.type === 'replace-settings') {
    if (
      Object.keys(candidate).length !== 3 ||
      !Number.isSafeInteger(candidate.expectedRevision) ||
      (candidate.expectedRevision as number) < 0
    ) return false;
    try { validateEditableSettings(candidate.settings); return true; } catch { return false; }
  }
  if (
    !Number.isInteger(candidate.tabId) ||
    (candidate.tabId as number) < 0 ||
    (candidate.tabId as number) > MAX_MESSAGE_TAB_ID
  ) {
    return false;
  }
  if (Object.keys(candidate).length !== 2) return false;
  return (
    candidate.type === 'get-tab-state' ||
    candidate.type === 'open-original-once' ||
    candidate.type === 'exclude-current-host'
  );
}
