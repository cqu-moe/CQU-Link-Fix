import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (relativePath: string) => readFile(path.join(root, relativePath), 'utf8');

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
});
