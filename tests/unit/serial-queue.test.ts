import { describe, expect, it } from 'vitest';
import { createSerialQueue } from '../../src/serial-queue';

describe('serial queue', () => {
  it('preserves order and recovers after a rejected operation', async () => {
    const enqueue = createSerialQueue();
    const order: string[] = [];
    const first = enqueue(async () => {
      order.push('first');
      throw new Error('expected failure');
    });
    const second = enqueue(async () => {
      order.push('second');
      return 2;
    });

    await expect(first).rejects.toThrow('expected failure');
    await expect(second).resolves.toBe(2);
    expect(order).toEqual(['first', 'second']);
  });

  it('keeps independent queue instances isolated', async () => {
    const left = createSerialQueue();
    const right = createSerialQueue();
    let release!: () => void;
    const blocked = left(() => new Promise<void>((resolve) => { release = resolve; }));

    await expect(right(async () => 'ready')).resolves.toBe('ready');
    release();
    await blocked;
  });
});
