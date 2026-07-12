import {
  parseSettingsMutationResponse,
  parseSettingsSnapshotResponse,
} from './settings-codec';
import type {
  EditableSettings,
  ReplaceSettingsResult,
  SettingsSnapshot,
} from './settings-types';

export async function replaceSettingsViaBackground(
  next: EditableSettings,
  expectedRevision: number,
): Promise<ReplaceSettingsResult> {
  const result = await sendSettingsMutationMessage({
    type: 'replace-settings',
    settings: structuredClone(next),
    expectedRevision,
  });
  if (
    result.ok &&
    (!Number.isSafeInteger(expectedRevision + 1) || result.revision !== expectedRevision + 1)
  ) return { ok: false, code: 'operation-failed', error: 'Background operation failed' };
  return result;
}

export async function getSettingsSnapshotViaBackground(): Promise<SettingsSnapshot | null> {
  try {
    const response = await browser.runtime.sendMessage({ type: 'get-settings-snapshot' }) as unknown;
    return parseSettingsSnapshotResponse(response);
  } catch {
    return null;
  }
}

async function sendSettingsMutationMessage(message: unknown): Promise<ReplaceSettingsResult> {
  try {
    return parseSettingsMutationResponse(await browser.runtime.sendMessage(message) as unknown);
  } catch {
    return { ok: false, code: 'operation-failed', error: 'Background operation failed' };
  }
}
