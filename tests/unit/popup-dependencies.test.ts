import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const controllerPath = resolve(process.cwd(), 'src/ui/popup-controller.ts');

describe('popup dependency boundary', () => {
  it('imports background message contracts as types only', async () => {
    const source = await readFile(controllerPath, 'utf8');

    expect(source).toMatch(
      /import\s+type\s*{[^}]*BackgroundMessage[^}]*BackgroundResponse[^}]*}\s*from\s*'\.\.\/messages';/s,
    );
    expect(source).not.toMatch(
      /import\s*{[^}]*MAX_MESSAGE_TAB_ID[^}]*}\s*from\s*'\.\.\/messages';/s,
    );
  });

  it('imports the tab ID limit directly from the pure rewrite record module', async () => {
    const source = await readFile(controllerPath, 'utf8');

    expect(source).toMatch(
      /import\s*{[^}]*MAX_REWRITE_TAB_ID[^}]*}\s*from\s*'\.\.\/rewrite-record';/s,
    );
  });
});
