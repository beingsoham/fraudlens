import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    // Integration tests share one PostgreSQL database, so they run in a single
    // worker. Running them in parallel would have each suite truncating tables
    // the others are mid-way through using.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    include: ['tests/**/*.test.js'],
    setupFiles: ['./tests/setup.js'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      exclude: ['src/generated/**', 'src/server.js'],
      reporter: ['text-summary', 'lcov'],
    },
  },
});
