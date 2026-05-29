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

    // Pre-seed scenario state so the ScenarioHeader's first-load auto-generate
    // dialog (P3) never appears — its backdrop would intercept the ct-run-all
    // click otherwise. We seed a single "Default" scenario marked active,
    // matching the state a returning user would land in.
    await page.addInitScript(() => {
        const controlId = "PcfWorkbench.ConformanceTester";
        localStorage.setItem(
            `pcf-workbench-scenarios-${controlId}`,
            JSON.stringify([{ schemaVersion: 2, name: "Default", savedAt: new Date().toISOString() }]),
        );
        localStorage.setItem(`pcf-workbench-active-scenario-${controlId}`, "Default");
        // Belt-and-braces: even if scenario state above is wiped or a different
        // control loads, this global flag suppresses the first-load
        // auto-generate dialog for the entire harness session.
        localStorage.setItem("pcf-workbench-suppress-autogen-all", "1");
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

    // P1 + P2 + writeback acceptance: every fc-, ec-, xrm-, context-, and wb- row must pass.
    const gatedPrefixes = ["fc-", "ec-", "xrm-", "context-", "wb-"];
    const failures = report.filter(
        (r) => gatedPrefixes.some((p) => r.id.startsWith(p)) && r.status !== "pass",
    );
    expect(failures, `Rows that did not pass: ${JSON.stringify(failures, null, 2)}`).toEqual([]);

    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
});

// ---------------------------------------------------------------------------
// Bound-value highlight — separate spec because it needs the side panel,
// not the in-control conformance grid. We programmatically bind the input
// `record` to the `name` column via a pre-seeded scenario, drive a writeback
// from the control, and assert the chip flips to data-fresh="true" with a
// changed value. Timer-driven highlight (not a CSS animation) so we assert
// on the data attribute / class, not on getAnimations().
// ---------------------------------------------------------------------------
test("PropertyEditor: bound chip highlights after writeback", async ({ page }) => {
    await page.addInitScript(() => {
        const controlId = "PcfWorkbench.ConformanceTester";
        localStorage.setItem(
            `pcf-workbench-scenarios-${controlId}`,
            JSON.stringify([{
                schemaVersion: 2,
                name: "Default",
                savedAt: new Date().toISOString(),
                propertyValues: { record: "$name" },
                pageContext: { typeName: "account", entityId: "glow-record-1" },
                dataRecords: {
                    account: [
                        { accountid: "glow-record-1", name: "Initial Name" },
                    ],
                },
            }]),
        );
        localStorage.setItem(`pcf-workbench-active-scenario-${controlId}`, "Default");
        localStorage.setItem("pcf-workbench-suppress-autogen-all", "1");
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const chip = page.locator('[data-test-id="pe-bound-chip-record"]');
    const badge = page.locator('[data-test-id="pe-bound-updated-record"]');
    await expect(chip).toBeVisible({ timeout: 15_000 });
    await expect(chip).toHaveText("Initial Name");

    // Wait for the initial scenario-apply highlight to clear (timer-driven,
    // ~3s) so we can detect a *fresh* highlight after the writeback.
    await expect.poll(
        async () => chip.getAttribute("data-fresh"),
        { timeout: 6_000, message: "initial highlight should clear before writeback" },
    ).toBe("false");

    // Drive a writeback by clicking the wb-record-set conformance row's Run.
    const runBtn = page.locator('[data-test-id="ct-run-wb-record-set"] button');
    await runBtn.scrollIntoViewIfNeeded();
    await runBtn.click();

    // The chip should flip to data-fresh="true" and the "↻ updated" badge
    // should become visible.
    await expect(chip).toHaveAttribute("data-fresh", "true", { timeout: 3_000 });
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText(/updated/);

    // And the displayed value should reflect the writeback.
    await expect(chip).not.toHaveText("Initial Name");

    // After ~3s the highlight clears again.
    await expect.poll(
        async () => chip.getAttribute("data-fresh"),
        { timeout: 6_000, message: "highlight should clear after timeout" },
    ).toBe("false");
});
