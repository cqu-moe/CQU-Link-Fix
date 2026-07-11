import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  acquireCustomPermissionLeaseViaBackground,
  releaseCustomPermissionLeaseViaBackground,
  renewCustomPermissionLeaseViaBackground,
} from '../../src/ui/custom-permission-lease-client';
import type { ExactOriginPermission } from '../../src/ui/custom-rule';

const PERMISSION: ExactOriginPermission = {
  origins: [
    '*://library.cqu.edu.cn/*',
    'https://library-cqu-edu-cn-s.atrust.cqu.edu.cn/*',
  ],
};
const NONCE = '00000000-0000-4000-8000-000000000001';
type SendMessage = (message: unknown) => Promise<unknown>;

function mockSendMessage(): MockInstance<SendMessage> {
  return vi.spyOn(browser.runtime, 'sendMessage') as unknown as MockInstance<SendMessage>;
}

describe('custom permission lease client', () => {
  beforeEach(() => fakeBrowser.reset());

  it('uses typed acquire, renew, and release background messages', async () => {
    const send = mockSendMessage()
      .mockResolvedValueOnce({ ok: true, leaseNonce: NONCE })
      .mockResolvedValueOnce({ ok: true, leaseExpiresAt: 123_000 })
      .mockResolvedValueOnce({ ok: true, requiredOrigins: [...PERMISSION.origins].reverse() });

    await expect(acquireCustomPermissionLeaseViaBackground(PERMISSION)).resolves.toEqual({
      nonce: NONCE,
    });
    await expect(renewCustomPermissionLeaseViaBackground(NONCE, PERMISSION)).resolves.toBe(true);
    await expect(releaseCustomPermissionLeaseViaBackground(NONCE)).resolves.toEqual({
      requiredOrigins: [...PERMISSION.origins].sort(),
    });
    expect(send).toHaveBeenNthCalledWith(1, {
      type: 'acquire-custom-permission-lease',
      origins: PERMISSION.origins,
    });
    expect(send).toHaveBeenNthCalledWith(2, {
      type: 'renew-custom-permission-lease',
      nonce: NONCE,
      origins: PERMISSION.origins,
    });
    expect(send).toHaveBeenNthCalledWith(3, {
      type: 'release-custom-permission-lease',
      nonce: NONCE,
    });
  });

  it.each([
    { ok: true },
    { ok: true, leaseNonce: 'forged' },
    { ok: true, leaseNonce: NONCE, extra: true },
    { ok: false, error: 'failed' },
  ])('fails closed on malformed acquire response %#', async (response) => {
    mockSendMessage().mockResolvedValue(response);

    await expect(acquireCustomPermissionLeaseViaBackground(PERMISSION)).resolves.toBeNull();
  });

  it.each([
    { ok: true },
    { ok: true, leaseExpiresAt: -1 },
    { ok: true, leaseExpiresAt: 123_000, extra: true },
    { ok: false, error: 'failed' },
  ])('fails closed on malformed renew response %#', async (response) => {
    mockSendMessage().mockResolvedValue(response);

    await expect(renewCustomPermissionLeaseViaBackground(NONCE, PERMISSION)).resolves.toBe(false);
  });

  it.each([
    { ok: true },
    { ok: true, requiredOrigins: ['*://*.cqu.edu.cn/*'] },
    { ok: true, requiredOrigins: 'not-an-array' },
  ])('fails closed on malformed release response %#', async (response) => {
    mockSendMessage().mockResolvedValue(response);

    await expect(releaseCustomPermissionLeaseViaBackground(NONCE)).resolves.toBeNull();
  });
});
