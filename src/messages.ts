import { MAX_REWRITE_TAB_ID, type RewriteRecord } from './rewrite-record';
import {
  validateEditableSettings,
  type EditableSettings,
  type SettingsSnapshot,
} from './storage/settings';

export const MAX_MESSAGE_TAB_ID = MAX_REWRITE_TAB_ID;

export type BackgroundMessage =
  | { type: 'get-tab-state'; tabId: number }
  | { type: 'open-original-once'; tabId: number }
  | { type: 'exclude-current-host'; tabId: number }
  | { type: 'get-settings-snapshot' }
  | { type: 'replace-settings'; settings: EditableSettings; expectedRevision: number }
  | { type: 'persist-all-cqu-mode'; enabled: boolean };

export type BackgroundResponse =
  | { ok: true; state: RewriteRecord | null }
  | { ok: true }
  | { ok: true; revision: number }
  | { ok: true; snapshot: SettingsSnapshot }
  | { ok: false; error: string; code?: 'settings-conflict' | 'operation-failed' };

export function isBackgroundMessage(value: unknown): value is BackgroundMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.type === 'get-settings-snapshot') return Object.keys(candidate).length === 1;
  if (candidate.type === 'persist-all-cqu-mode') {
    return Object.keys(candidate).length === 2 && typeof candidate.enabled === 'boolean';
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
