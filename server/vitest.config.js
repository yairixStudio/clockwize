import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.js'],
    // Every test file gets its own module registry, so its own in-memory database
    isolate: true,
    pool: 'forks',
    testTimeout: 20000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      include: ['routes/**', 'middleware/**', 'utils/**', 'app.js', 'database.js', 'backup.js'],
      reporter: ['text-summary', 'lcov']
    }
  }
});
