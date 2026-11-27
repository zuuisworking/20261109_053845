const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.js'],
    setupFiles: ['tests/setup.js'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['backend/src/**/*.js'],
      exclude: [
        'backend/src/server.js',
        'backend/src/database/seedAdmin.js',
        'backend/src/database/migrate*.js',
      ],
    },
  },
});
