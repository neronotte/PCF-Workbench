import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VISUAL_DIR = path.resolve(__dirname, "..", "__visual__");
fs.mkdirSync(VISUAL_DIR, { recursive: true });

test("ConformanceTester: P1+P2 rows pass", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
    page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(`console.error: ${msg.text()}`);
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const root = page.locator("[data-test-id=ct-root]");
    await expect(root).toBeVisible({ timeout: 30_000 });
    await root.scrollIntoViewIfNeeded();

    const runAll = page.locator("[data-test-id=ct-run-all]");
    await runAll.scrollIntoViewIfNeeded();
    await runAll.click();

    // Auto-dismiss any harness dialog that appears while runAll is awaiting one.
    // Alert/Confirm dialogs from Xrm.Utility await a primary-button click; we click
    // the surface's primary button (OK / Confirm) until idle reaches 0.
    const idleBadge = page.locator("[data-test-id=ct-summary-idle]");
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
        const idleText = (await idleBadge.innerText().catch(() => "")) ?? "";
        if (/^0 idle$/.test(idleText.trim())) break;
        // Fluent v9 with modalType="alert" emits role="alertdialog".
        const primary = page.locator(
            '[role="alertdialog"] button:has-text("OK"), [role="alertdialog"] button:has-text("Confirm"), [role="dialog"] button:has-text("OK"), [role="dialog"] button:has-text("Confirm")'
        ).first();
        if (await primary.isVisible().catch(() => false)) {
            await primary.click().catch(() => {});
        }
        await page.waitForTimeout(100);
    }

    const passText = await page.locator("[data-test-id=ct-summary-pass]").innerText();
    const failText = await page.locator("[data-test-id=ct-summary-fail]").innerText();
    const naText = await page.locator("[data-test-id=ct-summary-na]").innerText();
    const idleText = await idleBadge.innerText();

    await page.screenshot({ path: path.join(VISUAL_DIR, "conformance-p3.png"), fullPage: true });

    const rows = await page.locator('[data-test-id^="ct-row-"][data-test-id$="-status"]').all();
    const report: Array<{ id: string; status: string; detail: string }> = [];
    for (const row of rows) {
        const tid = await row.getAttribute("data-test-id");
        if (!tid) continue;
        const id = tid.replace(/^ct-row-/, "").replace(/-status$/, "");
        const badge = row.locator("[data-status]");
        const status = (await badge.getAttribute("data-status")) ?? "unknown";
        const detail = (await page.locator(`[data-test-id="ct-row-${id}-detail"]`).innerText()) ?? "";
        report.push({ id, status, detail });
    }
    fs.writeFileSync(
        path.join(VISUAL_DIR, "conformance-p3.json"),
        JSON.stringify({ summary: { passText, failText, naText, idleText }, rows: report, consoleErrors }, null, 2),
    );

    expect(idleText.trim(), `idle should be 0; rows: ${JSON.stringify(report.filter(r => r.status === 'idle'), null, 2)}`).toMatch(/^0 idle$/);

    // P1 + P2 acceptance: every fc-, ec-, and xrm- row must pass.
    const gatedPrefixes = ["fc-", "ec-", "xrm-", "context-"];
    const failures = report.filter(
        (r) => gatedPrefixes.some((p) => r.id.startsWith(p)) && r.status !== "pass",
    );
    expect(failures, `Rows that did not pass: ${JSON.stringify(failures, null, 2)}`).toEqual([]);

    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
});
