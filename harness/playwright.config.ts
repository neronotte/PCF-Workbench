import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "./tests",
    timeout: 60_000,
    expect: { timeout: 10_000 },
    reporter: [["list"]],
    use: {
        baseURL: process.env.HARNESS_URL ?? "http://127.0.0.1:8181",
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        viewport: { width: 1920, height: 1080 },
    },
});
