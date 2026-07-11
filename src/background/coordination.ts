let backgroundOperationQueue = Promise.resolve();

export function queueBackgroundOperation<T>(operation: () => Promise<T>): Promise<T> {
  const current = backgroundOperationQueue.then(operation, operation);
  backgroundOperationQueue = current.then(
    () => undefined,
    () => undefined,
  );
  return current;
}
