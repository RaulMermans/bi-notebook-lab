import { defineConfig, devices } from '@playwright/test'

/**
 * Sprint 16 Part G — release-level E2E suite. Deliberately scoped to the
 * critical journeys that exercise this sprint's biggest genuinely-new
 * surfaces (portable project import/export, first-time Free Lab) rather
 * than the brief's full five-journey list — see docs/E2E_TESTING.md for
 * which journeys are covered and which are explicitly deferred.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
