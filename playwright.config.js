// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/browser",
  fullyParallel: true,
  workers: 2,
  use: { baseURL: "http://127.0.0.1:8787", trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev -- --ip 127.0.0.1 --port 8787",
    url: "http://127.0.0.1:8787",
    reuseExistingServer: !process.env.CI,
    env: { WRANGLER_SEND_METRICS: "false" },
  },
});
