import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  acquireCustomPermissionLease,
  releaseCustomPermissionLease,
} from '../../src/background/custom-permission-leases';
import { CUSTOM_PERMISSION_LEASE_TTL_MS } from '../../src/custom-permission-lease';
import type { CustomRule } from '../../src/rules/types';
import { DEFAULT_SETTINGS, saveSettings } from '../../src/storage/settings';

const LIBRARY_ORIGINS = [
  '*://library.cqu.edu.cn/*',
  'https://library-cqu-edu-cn-s.atrust.cqu.edu.cn/*',
] as const;
const NEWS_ORIGINS = [
  '*://news.cqu.edu.cn/*',
  'https://news-cqu-edu-cn-s.atrust.cqu.edu.cn/*',
] as const;

function customRule(host: string, dnrId = 10_001): CustomRule {
  return {
    id: crypto.randomUUID(), dnrId, name: host, description: host,
    category: 'custom', defaultEnabled: true,
    matcher: { kind: 'host', host }, transformer: 'atrust-domain',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

describe('custom permission leases', () => {
  beforeEach(() => fakeBrowser.reset());

  it('persists a nonce-bound exact-origin lease in session storage', async () => {
    const lease = await acquireCustomPermissionLease([...LIBRARY_ORIGINS], 1_000);

    expect(lease.nonce).toMatch(/^[0-9a-f-]{36}$/);
    expect(lease.expiresAt).toBe(1_000 + CUSTOM_PERMISSION_LEASE_TTL_MS);
    expect(await browser.storage.session.get()).toEqual(expect.objectContaining({
      customPermissionLeases: [{
        nonce: lease.nonce,
        origins: LIBRARY_ORIGINS,
        createdAt: 1_000,
        expiresAt: 1_000 + CUSTOM_PERMISSION_LEASE_TTL_MS,
      }],
    }));
  });

  it.each([
    ['broad wildcard', ['*://*.cqu.edu.cn/*', 'https://x-s.atrust.cqu.edu.cn/*']],
    ['IP source', ['*://1.1.1.1/*', 'https://1-1-1-1-s.atrust.cqu.edu.cn/*']],
    ['wrong target', ['*://library.cqu.edu.cn/*', 'https://other-s.atrust.cqu.edu.cn/*']],
    ['extra origin', [...LIBRARY_ORIGINS, 'https://extra.cqu.edu.cn/*']],
    ['reversed pair', [LIBRARY_ORIGINS[1], LIBRARY_ORIGINS[0]]],
  ])('rejects an invalid exact origin pair: %s', async (_label, origins) => {
    await expect(acquireCustomPermissionLease(origins, 1_000)).rejects.toThrow();
    expect(await browser.storage.session.get()).toEqual({});
  });

  it('release reports origins required by persisted rules and other active leases', async () => {
    await saveSettings({
      ...DEFAULT_SETTINGS,
      customRules: [customRule('library.cqu.edu.cn')],
    });
    const library = await acquireCustomPermissionLease([...LIBRARY_ORIGINS], 1_000);
    await acquireCustomPermissionLease([...NEWS_ORIGINS], 1_001);

    const result = await releaseCustomPermissionLease(library.nonce, 1_002);

    expect(result.requiredOrigins).toEqual([...LIBRARY_ORIGINS, ...NEWS_ORIGINS].sort());
  });

  it('cleans expired leases after a service-worker restart and rejects stale release', async () => {
    const expired = await acquireCustomPermissionLease([...LIBRARY_ORIGINS], 1_000);
    const now = 1_000 + CUSTOM_PERMISSION_LEASE_TTL_MS + 1;
    const active = await acquireCustomPermissionLease([...NEWS_ORIGINS], now);

    await expect(releaseCustomPermissionLease(expired.nonce, now)).rejects.toThrow(/lease/i);
    await expect(releaseCustomPermissionLease(active.nonce, now)).resolves.toEqual({
      requiredOrigins: [],
    });
  });

  it('drops malformed persisted lease entries during cleanup', async () => {
    await browser.storage.session.set({
      customPermissionLeases: [
        { nonce: 'forged', origins: ['*://*.cqu.edu.cn/*'], createdAt: 1, expiresAt: 99_999 },
        {
          nonce: '00000000-0000-4000-8000-000000000001',
          origins: LIBRARY_ORIGINS,
          createdAt: 3_000,
          expiresAt: 3_000 + CUSTOM_PERMISSION_LEASE_TTL_MS,
        },
      ],
    });

    const lease = await acquireCustomPermissionLease([...LIBRARY_ORIGINS], 2_000);

    expect((await browser.storage.session.get()).customPermissionLeases).toEqual([
      expect.objectContaining({ nonce: lease.nonce }),
    ]);
  });

  it('samples acquisition time inside the serialized mutation boundary', async () => {
    const writeGate = deferred<void>();
    const originalSet = browser.storage.session.set.bind(browser.storage.session);
    const storageSet = vi.spyOn(browser.storage.session, 'set')
      .mockImplementationOnce(async (items) => {
        await writeGate.promise;
        await originalSet(items);
      })
      .mockImplementation(originalSet);
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const blocker = acquireCustomPermissionLease([...LIBRARY_ORIGINS]);
    await vi.waitFor(() => expect(storageSet).toHaveBeenCalledOnce());
    const delayed = acquireCustomPermissionLease([...NEWS_ORIGINS]);

    now.mockReturnValue(200_000);
    writeGate.resolve();
    await blocker;

    await expect(delayed).resolves.toMatchObject({
      expiresAt: 200_000 + CUSTOM_PERMISSION_LEASE_TTL_MS,
    });
  });

  it('samples release time after queued work and refuses a lease expired while waiting', async () => {
    const library = await acquireCustomPermissionLease([...LIBRARY_ORIGINS], 1_000);
    const writeGate = deferred<void>();
    const originalSet = browser.storage.session.set.bind(browser.storage.session);
    const storageSet = vi.spyOn(browser.storage.session, 'set')
      .mockImplementationOnce(async (items) => {
        await writeGate.promise;
        await originalSet(items);
      })
      .mockImplementation(originalSet);
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_001);
    const blocker = acquireCustomPermissionLease([...NEWS_ORIGINS]);
    await vi.waitFor(() => expect(storageSet).toHaveBeenCalledOnce());
    const delayedRelease = releaseCustomPermissionLease(library.nonce);

    now.mockReturnValue(200_000);
    writeGate.resolve();
    await blocker;

    await expect(delayedRelease).rejects.toThrow(/expired|not found/i);
  });
});
