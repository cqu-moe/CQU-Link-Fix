import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const files = [
  'entrypoints/options/main.ts',
  'src/ui/options-controller.ts',
  'entrypoints/popup/main.ts',
  'src/ui/popup-controller.ts',
];

describe('settings UI dependency boundary', () => {
  it.each(files)('%s never imports or calls the direct settings writer', async (relativePath) => {
    const source = await readFile(resolve(process.cwd(), relativePath), 'utf8');

    expect(source).not.toMatch(/\bsaveSettings\b/);
  });

  it('reuses the exported settings host validator in custom parsing', async () => {
    const source = await readFile(resolve(process.cwd(), 'src/ui/custom-rule.ts'), 'utf8');

    expect(source).toMatch(/normalizeCustomCquHost/);
    expect(source).not.toMatch(/endsWith\(['"]\.cqu\.edu\.cn['"]\)/);
  });

  it('derives rule provenance instead of accepting a custom boolean', async () => {
    const source = await readFile(resolve(process.cwd(), 'src/ui/options-controller.ts'), 'utf8');

    expect(source).not.toMatch(/custom:\s*boolean/);
  });

  it('carries exact custom permission origins as a tuple contract', async () => {
    const source = await readFile(resolve(process.cwd(), 'src/ui/custom-rule.ts'), 'utf8');

    expect(source).toMatch(/origins:\s*CustomPermissionOriginPair/);
    expect(source).not.toMatch(/interface ExactOriginPermission\s*{\s*origins:\s*string\[\]/s);
  });
});
