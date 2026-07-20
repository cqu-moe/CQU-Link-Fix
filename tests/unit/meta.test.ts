import { describe, expect, it } from 'vitest';
import packageJson from '../../package.json' with { type: 'json' };
import { EXTENSION_NAME, EXTENSION_VERSION } from '../../src/meta';

describe('extension metadata', () => {
  it('exposes stable initial metadata', () => {
    expect(EXTENSION_NAME).toBe('CQU Link Fix');
    expect(EXTENSION_VERSION).toBe(packageJson.version);
  });
});
