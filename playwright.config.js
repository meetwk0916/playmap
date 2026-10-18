const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  globalSetup: './scripts/check-local-server.cjs',
  testDir: './tests',
  testMatch: '**/*.spec.js',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 375, height: 812 }
  },
  webServer: {
    command: 'npm run dev',
    port: 4173,
    reuseExistingServer: true
  }
});
