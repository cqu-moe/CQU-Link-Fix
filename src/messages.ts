export type BackgroundMessage =
  | { type: 'get-tab-state'; tabId: number }
  | { type: 'open-original-once'; tabId: number }
  | { type: 'exclude-current-host'; tabId: number };

export function isBackgroundMessage(value: unknown): value is BackgroundMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { type?: unknown; tabId?: unknown };
  if (!Number.isInteger(candidate.tabId) || (candidate.tabId as number) < 0) return false;
  return (
    candidate.type === 'get-tab-state' ||
    candidate.type === 'open-original-once' ||
    candidate.type === 'exclude-current-host'
  );
}
