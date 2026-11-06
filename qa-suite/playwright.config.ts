import { defineConfig, devices } from '@playwright/test';

/**
 * Env:  E2E_BASE_URL (default http://localhost:3000)   E2E_EMAIL / E2E_PASSWORD  (a dedicated TEST account on a staging/preview project, never a real user)
 *       E2E_STACK_SLUG  a public stack owned by a DIFFERENT account (so the Remix button shows)     E2E_STACK_TITLE  its title
 *       E2E_SEED=1 + SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY  let e2e/support/admin.ts seed/clean test data (staging only)
 *   npx playwright test            |  npx playwright test --ui  |  npx playwright show-report
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
export default defineConfig({
  testDir: './e2e', testMatch: /.*\.(spec|setup)\.ts/, outputDir: 'test-results',
  timeout: 90_000, expect: { timeout: 15_000 }, fullyParallel: false, workers: 1,       // the flows share one test account and one vault
  retries: process.env.CI ? 2 : 0, reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'retain-on-failure', locale: 'en-US', timezoneId: 'UTC' },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    { name: 'guest', testMatch: /full-flow\.spec\.ts/, grep: /@guest/, use: { ...devices['Desktop Chrome'] } },
    { name: 'authed', testMatch: /full-flow\.spec\.ts/, grep: /@authed/, dependencies: ['setup'], use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/user.json' } },
    { name: 'mobile-guest', testMatch: /full-flow\.spec\.ts/, grep: /@guest/, use: { ...devices['Pixel 7'] } },
  ],
  webServer: process.env.E2E_START_SERVER ? { command: process.env.E2E_START_SERVER, url: baseURL, reuseExistingServer: true, timeout: 120_000 } : undefined,
});
