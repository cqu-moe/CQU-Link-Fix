import { describe, expect, it } from 'vitest';
import { EXTENSION_NAME, EXTENSION_VERSION } from '../../src/meta';

describe('extension metadata', () => {
  it('exposes stable initial metadata', () => {
    expect(EXTENSION_NAME).toBe('CQU Link Fix');
    expect(EXTENSION_VERSION).toBe('0.2.0');
  });
});
