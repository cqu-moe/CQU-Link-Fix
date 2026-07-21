import { defineConfig } from 'wxt';
import { EXTENSION_NAME, EXTENSION_VERSION } from './src/meta';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifestVersion: 3,
  manifest: {
    name: EXTENSION_NAME,
    version: EXTENSION_VERSION,
    description: 'Rewrite and repair Chongqing University links.',
    permissions: [
      'storage',
      'activeTab',
      'declarativeNetRequestWithHostAccess',
      'webNavigation',
    ],
    host_permissions: [
      '*://sso.cqu.edu.cn/*',
      '*://youth.cqu.edu.cn/*',
      'https://sso-cqu-edu-cn-s.atrust.cqu.edu.cn/*',
    ],
    optional_host_permissions: ['*://cqu.edu.cn/*', '*://*.cqu.edu.cn/*'],
    icons: {
      '16': 'icon/16.png',
      '32': 'icon/32.png',
      '48': 'icon/48.png',
      '128': 'icon/128.png',
    },
    action: {
      default_icon: {
        '16': 'icon/16.png',
        '32': 'icon/32.png',
        '48': 'icon/48.png',
        '128': 'icon/128.png',
      },
    },
  },
});
