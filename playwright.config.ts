import { defineConfig, devices } from "@playwright/test";

// Preferir a mesma origem do Chrome manual (localhost vs 127.0.0.1).
const baseURL = process.env.E2E_BASE_URL?.trim() || "http://localhost:3000";
const skipWebServer = process.env.E2E_SKIP_WEBSERVER === "1";

/**
 * Smokes MVP (checklist). Requer app no ar + credenciais:
 *   E2E_EMAIL / E2E_PASSWORD  (opcional E2E_BASE_URL)
 * Sem credenciais: testes autenticados são skipped.
 * Sem app: sobe `npm run dev` (desliga com E2E_SKIP_WEBSERVER=1).
 */
export default defineConfig({
    testDir: "./e2e",
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    workers: 1,
    timeout: 120_000,
    expect: { timeout: 30_000 },
    reporter: [["list"]],
    use: {
        ...devices["Desktop Chrome"],
        baseURL,
        trace: "on-first-retry",
        screenshot: "only-on-failure",
        video: "off",
    },
    projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
    webServer: skipWebServer
        ? undefined
        : {
              command: "npm run dev -- --port 3000",
              url: `${baseURL.replace(/\/$/, "")}/login`,
              reuseExistingServer: true,
              timeout: 180_000,
          },
});
