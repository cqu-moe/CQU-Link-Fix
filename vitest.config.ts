import { configDefaults, defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'happy-dom',
    restoreMocks: true,
    include: ['tests/unit/**/*.test.ts'],
    exclude: [...configDefaults.exclude, '.worktrees/**', 'tests/e2e/**'],
  },
});
