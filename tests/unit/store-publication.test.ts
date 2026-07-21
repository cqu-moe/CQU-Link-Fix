import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const resolve = (relativePath: string) => path.join(root, relativePath);
const read = (relativePath: string) => readFile(resolve(relativePath), 'utf8');

const readPngDimensions = async (relativePath: string) => {
  const png = await readFile(resolve(relativePath));
  expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
};

describe('store publication documents', () => {
  it('publishes a bilingual privacy policy with local-only data handling', async () => {
    const policy = await read('PRIVACY.md');

    expect(policy).toContain('# CQU Link Fix 隐私政策');
    expect(policy).toContain('# CQU Link Fix Privacy Policy');
    expect(policy).toContain('storage.local');
    expect(policy).toContain('storage.session');
    expect(policy).toContain('CAS ticket');
    expect(policy).toContain('不会向开发者服务器');
    expect(policy).toContain('does not transmit');
    expect(policy).toContain('Chrome Web Store User Data Policy');
    expect(policy).toContain('https://github.com/cqu-moe/CQU-Link-Fix/issues');
  });

  it('keeps paste-ready store copy, disclosures, reviewer notes, and checklist complete', async () => {
    const [listing, disclosures, reviewer, checklist] = await Promise.all([
      read('docs/store/listing-copy.md'),
      read('docs/store/privacy-and-permissions.md'),
      read('docs/store/reviewer-instructions.md'),
      read('docs/store/submission-checklist.md'),
    ]);

    expect(listing).toContain('在本机修正重庆大学相关网站的顶层导航链接');
    expect(listing).toContain('Independent community project');
    expect(disclosures).toContain('declarativeNetRequestWithHostAccess');
    expect(disclosures).toContain('Web browsing activity');
    expect(disclosures).toContain('Remote code');
    expect(reviewer).toContain('无需扩展账号');
    expect(reviewer).toContain('Do not provide personal CQU credentials');
    expect(checklist).toContain(
      'https://github.com/cqu-moe/CQU-Link-Fix/blob/main/PRIVACY.md',
    );

    for (const document of [listing, disclosures, reviewer, checklist]) {
      expect(document).not.toMatch(/\b(?:TBD|TODO|PLACEHOLDER)\b/i);
    }
  });

  it('generates draft store artwork at exact marketplace dimensions', async () => {
    await expect(
      readPngDimensions('docs/store/assets/draft-screenshot-options-1280x800.png'),
    ).resolves.toEqual({ width: 1280, height: 800 });
    await expect(
      readPngDimensions('docs/store/assets/draft-screenshot-popup-1280x800.png'),
    ).resolves.toEqual({ width: 1280, height: 800 });
    await expect(
      readPngDimensions('docs/store/assets/draft-small-promo-440x280.png'),
    ).resolves.toEqual({ width: 440, height: 280 });
    await expect(
      readPngDimensions('docs/store/assets/edge-logo-300x300.png'),
    ).resolves.toEqual({ width: 300, height: 300 });
  });
});
