import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 20000,
    setupFiles: ['test/setup.ts'],
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
