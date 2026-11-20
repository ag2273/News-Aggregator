import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    // Every suite shares one DATA_DIR on purpose (it is how the stores work), so
    // parallel workers race on the same JSON files and tests flake. Run the
    // suites in one process: the whole run takes ~12s either way.
    fileParallelism: false,
  },
});
