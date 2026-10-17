import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // All test files share one database, so run them one at a time.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
