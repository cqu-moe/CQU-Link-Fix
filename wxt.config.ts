import { defineConfig } from 'wxt';
import { EXTENSION_NAME, EXTENSION_VERSION } from './src/meta';

export default defineConfig({
  manifestVersion: 3,
  manifest: {
    name: EXTENSION_NAME,
    version: EXTENSION_VERSION,
    description: 'Rewrite and repair Chongqing University links.',
    permissions: ['storage'],
  },
});
