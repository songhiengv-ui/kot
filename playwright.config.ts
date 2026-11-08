import { defineConfig, devices } from '@playwright/test'

// E2E against a production build (the service worker only registers in production) on the dev Supabase project.
// Each run creates throwaway users and deletes them afterwards (e2e/users.ts). Usage: npm run e2e
const PORT = 3200
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false, workers: 1,
  retries: 0,
  reporter: 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'android-chrome', use: { ...devices['Pixel 7'], launchOptions: { args: ['--use-fake-device-for-media-stream'] } } },
    { name: 'iphone-safari', use: { ...devices['iPhone 14'] } },
  ],
  webServer: { command: `npm run build && npx next start -p ${PORT}`, port: PORT, timeout: 240_000, reuseExistingServer: true },
})
