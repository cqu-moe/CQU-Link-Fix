export type SerialQueue = <T>(operation: () => Promise<T>) => Promise<T>;

export function createSerialQueue(): SerialQueue {
  let tail = Promise.resolve();
  return function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const current = tail.then(operation, operation);
    tail = current.then(() => undefined, () => undefined);
    return current;
  };
}
