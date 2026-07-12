import { queueBackgroundOperation } from '../background/coordination';
import {
  decodeStoredSettings,
  isSafeSettingsRevision,
  validateEditableSettings,
} from './settings-codec';
import type {
  EditableSettings,
  ExtensionSettings,
  SettingsMutationHooks,
  SettingsSnapshot,
} from './settings-types';

const SETTINGS_KEY = 'settings';
const SETTINGS_REVISION_KEY = 'settingsRevision';

export async function loadSettings(): Promise<ExtensionSettings> {
  return (await loadSettingsSnapshot()).settings;
}

export async function loadCommittedSettings(): Promise<ExtensionSettings> {
  return (await loadCommittedSettingsSnapshot()).settings;
}

export function loadCommittedSettingsSnapshot(): Promise<SettingsSnapshot> {
  return queueBackgroundOperation(loadSettingsSnapshot);
}

export async function loadSettingsSnapshot(): Promise<SettingsSnapshot> {
  const stored = await browser.storage.local.get([SETTINGS_KEY, SETTINGS_REVISION_KEY]);
  const revision = stored[SETTINGS_REVISION_KEY];
  return {
    settings: decodeStoredSettings(stored[SETTINGS_KEY]),
    revision: isSafeSettingsRevision(revision) ? revision : 0,
  };
}

export async function saveSettings(next: ExtensionSettings): Promise<void> {
  const snapshot = structuredClone(next);
  await queueBackgroundOperation(async () => {
    const current = await loadSettingsSnapshot();
    await writeSettings(snapshot, current.revision + 1);
  });
}

async function writeSettings(next: ExtensionSettings, revision: number): Promise<void> {
  await browser.storage.local.set({
    [SETTINGS_KEY]: structuredClone(next),
    [SETTINGS_REVISION_KEY]: revision,
  });
}

export async function updateSettings(
  mutator: (current: ExtensionSettings) => ExtensionSettings | Promise<ExtensionSettings>,
  hooks?: SettingsMutationHooks,
): Promise<ExtensionSettings> {
  return (await updateSettingsSnapshot(mutator, hooks)).settings;
}

export function updateSettingsSnapshot(
  mutator: (current: ExtensionSettings) => ExtensionSettings | Promise<ExtensionSettings>,
  hooks?: SettingsMutationHooks,
): Promise<SettingsSnapshot> {
  return queueBackgroundOperation(async () => {
    const snapshot = await loadSettingsSnapshot();
    const mutated = await mutator(snapshot.settings);
    if (mutated === snapshot.settings) return structuredClone(snapshot);
    const next = structuredClone(mutated);
    const revision = snapshot.revision + 1;
    await writeAndApplySettings(snapshot, next, revision, hooks);
    return { settings: structuredClone(next), revision };
  });
}

export class SettingsRevisionConflict extends Error {
  constructor() {
    super('Settings changed since they were loaded');
    this.name = 'SettingsRevisionConflict';
  }
}

export function replaceSettingsAtRevision(
  editable: EditableSettings,
  expectedRevision: number,
  hooks?: SettingsMutationHooks,
): Promise<SettingsSnapshot> {
  return queueBackgroundOperation(async () => {
    const current = await loadSettingsSnapshot();
    if (current.revision !== expectedRevision) throw new SettingsRevisionConflict();
    const validated = validateEditableSettings(editable);
    const settings = { ...validated, enableAllCquDomains: current.settings.enableAllCquDomains };
    const revision = current.revision + 1;
    await writeAndApplySettings(current, settings, revision, hooks);
    return { settings: structuredClone(settings), revision };
  });
}

export class SettingsApplyFailed extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SettingsApplyFailed';
  }
}

async function writeAndApplySettings(
  previous: SettingsSnapshot,
  next: ExtensionSettings,
  revision: number,
  hooks?: SettingsMutationHooks,
): Promise<void> {
  await writeSettings(next, revision);
  if (!hooks) return;
  try {
    await hooks.apply(next);
    await hooks.afterApply?.(next, previous.settings);
  } catch (error) {
    try {
      await writeSettings(previous.settings, previous.revision);
      await hooks.apply(previous.settings);
    } catch (rollbackError) {
      throw new SettingsApplyFailed(
        'Settings application failed and rollback could not be completed',
        { cause: new AggregateError([error, rollbackError]) },
      );
    }
    const detail = error instanceof Error && error.message ? `: ${error.message}` : '';
    throw new SettingsApplyFailed(`Settings application failed${detail}`, { cause: error });
  }
}
