import { createSerialQueue } from '../serial-queue';

const NAVIGATION_SEQUENCE_KEY = 'navigation:sequence';
const COMMITTED_PREFIX = 'navigation:committed:';
const queue = createSerialQueue();

function committedKey(tabId: number): string {
  return `${COMMITTED_PREFIX}${tabId}`;
}

function sequenceOf(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : 0;
}

export function allocateNavigationSequence(): Promise<number> {
  return queue(async () => {
    const stored = await browser.storage.session.get(NAVIGATION_SEQUENCE_KEY);
    const sequence = sequenceOf(stored[NAVIGATION_SEQUENCE_KEY]) + 1;
    await browser.storage.session.set({ [NAVIGATION_SEQUENCE_KEY]: sequence });
    return sequence;
  });
}

export function commitNavigation(tabId: number): Promise<number> {
  return queue(async () => {
    const stored = await browser.storage.session.get(NAVIGATION_SEQUENCE_KEY);
    const sequence = sequenceOf(stored[NAVIGATION_SEQUENCE_KEY]) + 1;
    await browser.storage.session.set({
      [NAVIGATION_SEQUENCE_KEY]: sequence,
      [committedKey(tabId)]: sequence,
    });
    return sequence;
  });
}

export async function getCommittedNavigationSequence(tabId: number): Promise<number> {
  const key = committedKey(tabId);
  const stored = await browser.storage.session.get(key);
  return sequenceOf(stored[key]);
}

export function clearCommittedNavigation(tabId: number): Promise<void> {
  return queue(() => browser.storage.session.remove(committedKey(tabId)));
}
