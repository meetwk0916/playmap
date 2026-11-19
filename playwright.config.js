const { defineConfig } = require('@playwright/test');
const previewUrl = require('./scripts/local-preview.cjs');

module.exports = defineConfig({
  globalSetup: './scripts/check-local-server.cjs',
  testDir: './tests',
  testMatch: '**/*.spec.js',
  use: {
    baseURL: previewUrl,
    viewport: { width: 375, height: 812 }
  },
  webServer: {
    command: 'npm run dev',
    url: previewUrl,
    reuseExistingServer: true
  }
});
