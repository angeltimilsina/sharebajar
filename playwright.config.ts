import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3000);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 20_000 },
  retries: process.env.CI ? 1 : 0,
  // Tests start with the demo notice already accepted (one test checks the notice itself).
  use: { baseURL: `http://localhost:${PORT}`, trace: "off", storageState: { cookies: [{ name: "bajar_consent", value: "v1", domain: "localhost", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" }], origins: [] } },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }, grepInvert: /@mobile/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@mobile/ },
  ],
  webServer: { command: "npm run dev", port: PORT, reuseExistingServer: true, timeout: 120_000 },
});
