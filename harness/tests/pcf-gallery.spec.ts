/**
 * Phase 5 — Playwright validation loop across the PCF Gallery corpus.
 *
 * Boots the harness once (the test runner expects it already running on
 * HARNESS_URL), then for every `buildStatus: ok` entry in the build report:
 *
 *   1. POST /api/switch-control with the control's directory
 *   2. Wait for the harness to load the new bundle
 *   3. For each scenario in test-scenarios.json: load via ?scenario= URL,
 *      capture screenshot + console errors + lifecycle errors
 *   4. Aggregate into __visual__/gallery-report.json
 *
 * Pass criteria: control mounts, no console errors, no harness "Control init
 * failed" banner. Visual diffs are NOT compared — this run captures baselines.
 *
 * Run from harness/ with the harness already running:
 *   $env:PCF_CONTROL_PATH = "..\samples\ConformanceTester\ConformanceTester"
 *   npx vite --port 8181 --host 127.0.0.1
 *
 * Then in another terminal:
 *   $env:HARNESS_URL = "http://127.0.0.1:8181"
 *   npx playwright test tests/pcf-gallery.spec.ts --reporter=list
 *
 * Optional env knobs:
 *   GALLERY_LIMIT=5       only run first N controls (smoke test)
 *   GALLERY_OWNER=javiqb  only that owner
 *   GALLERY_SKIP_VISUAL=1 skip screenshot capture (faster iteration)
 */

import { test, expect, type ConsoleMessage, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GALLERY_ROOT = process.env.PCF_GALLERY_ROOT || 'C:\\Github.Copilot\\PowerApps\\PCFGallery';
const BUILD_REPORT = path.join(GALLERY_ROOT, '_catalog', 'pcf-gallery-build-report.json');
const SCREENSHOT_DIR = path.resolve(__dirname, '..', '__visual__', 'gallery');
const RUN_REPORT = path.resolve(__dirname, '..', '__visual__', 'gallery-report.json');
// JSONL spool — one line per ResultRow. Survives Playwright worker restarts
// after test timeouts (which would otherwise wipe a module-scope array).
const RUN_SPOOL = path.resolve(__dirname, '..', '__visual__', 'gallery-results.jsonl');

const LIMIT = process.env.GALLERY_LIMIT ? parseInt(process.env.GALLERY_LIMIT, 10) : undefined;
const OWNER_FILTER = process.env.GALLERY_OWNER;
const SKIP_VISUAL = process.env.GALLERY_SKIP_VISUAL === '1';

const CONTROL_LOAD_TIMEOUT_MS = 25000;
const CONTROL_LOAD_TIMEOUT_LARGE_MS = 60000;
const LARGE_BUNDLE_BYTES = 2 * 1024 * 1024; // 2MB
const SCENARIO_LOAD_WAIT_MS = 2500;

interface BuildEntry {
  owner: string;
  repo: string;
  pcfProjectDir: string;
  controls: Array<{ manifestPath: string; namespace: string; constructor: string; bundlePath?: string; bundleBytes?: number }>;
  installStatus: string;
  buildStatus: string;
}

interface ScenarioFile {
  name: string;
  description?: string;
}

interface ResultRow {
  owner: string;
  repo: string;
  control: string;
  scenario: string;
  status: 'pass' | 'fail' | 'no-bundle' | 'load-timeout' | 'switch-error';
  consoleErrors: string[];
  consoleWarnings: string[];
  pageErrors: string[];
  controlBannerError?: string;
  durationMs: number;
  screenshot?: string;
}

function slug(s: string) {
  return s.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 80);
}

function loadQueue(): Array<{ entry: BuildEntry; controlDir: string; scenarios: ScenarioFile[]; control: BuildEntry['controls'][number] }> {
  const report = JSON.parse(fs.readFileSync(BUILD_REPORT, 'utf8')) as { entries: BuildEntry[] };
  const queue: Array<{ entry: BuildEntry; controlDir: string; scenarios: ScenarioFile[]; control: BuildEntry['controls'][number] }> = [];

  for (const entry of report.entries) {
    if (entry.buildStatus !== 'ok') continue;
    if (OWNER_FILTER && entry.owner.toLowerCase() !== OWNER_FILTER.toLowerCase()) continue;

    const repoDir = path.join(GALLERY_ROOT, `${entry.owner}-${entry.repo}`);
    for (const ctrl of entry.controls) {
      const manifestAbs = path.resolve(repoDir, ctrl.manifestPath);
      const controlDir = path.dirname(manifestAbs);
      const scenarioFile = path.join(controlDir, 'test-scenarios.json');
      if (!fs.existsSync(scenarioFile)) continue;
      const bundleAbs = ctrl.bundlePath ? path.resolve(repoDir, ctrl.bundlePath) : '';
      if (!bundleAbs || !fs.existsSync(bundleAbs)) continue;
      let scenarios: ScenarioFile[];
      try {
        scenarios = JSON.parse(fs.readFileSync(scenarioFile, 'utf8'));
      } catch {
        continue;
      }
      if (!Array.isArray(scenarios) || scenarios.length === 0) continue;
      queue.push({ entry, controlDir, scenarios, control: ctrl });
    }
  }

  return LIMIT ? queue.slice(0, LIMIT) : queue;
}

const queue = loadQueue();
const results: ResultRow[] = [];

function spoolRow(row: ResultRow): void {
  results.push(row);
  try {
    fs.appendFileSync(RUN_SPOOL, JSON.stringify(row) + '\n', 'utf8');
  } catch {
    // best-effort; don't fail tests if the spool file is locked
  }
}

test.describe.configure({ mode: 'default' });
// Each test = one control × all its scenarios. With ~5 scenarios at ~3s
// each plus switch + initial-load, 180s gives generous headroom.
test.setTimeout(180_000);

test.beforeAll(async () => {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  // NOTE: do NOT truncate RUN_SPOOL here. Playwright spawns a new worker
  // after a test timeout, and that worker also runs beforeAll — truncating
  // would wipe results from the previous worker. The caller is responsible
  // for `Remove-Item __visual__/gallery-results.jsonl` before each run.
  console.log(`Gallery validation queue: ${queue.length} (control × all-scenarios) entries`);
  console.log(`Screenshots: ${SCREENSHOT_DIR}`);
  console.log(`Spool:       ${RUN_SPOOL}`);
  console.log(`Report:      ${RUN_REPORT}`);
});

test.afterAll(async () => {
  // Read every row from the spool — this is the source of truth across
  // worker restarts (Playwright spawns a fresh worker after a test timeout,
  // which would wipe a module-scope `results` array).
  let spoolRows: ResultRow[] = [];
  try {
    spoolRows = fs.readFileSync(RUN_SPOOL, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l) as ResultRow);
  } catch {
    spoolRows = results.slice();
  }
  const summary = {
    runAt: new Date().toISOString(),
    harnessUrl: process.env.HARNESS_URL,
    options: { limit: LIMIT, owner: OWNER_FILTER, skipVisual: SKIP_VISUAL },
    counts: spoolRows.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {}),
    totalControls: new Set(spoolRows.map(r => `${r.owner}/${r.repo}/${r.control}`)).size,
    totalScenarios: spoolRows.length,
    rows: spoolRows,
  };
  fs.writeFileSync(RUN_REPORT, JSON.stringify(summary, null, 2) + '\n', 'utf8');
  console.log('\n' + '─'.repeat(60));
  console.log(`Gallery run done: ${spoolRows.length} scenarios across ${summary.totalControls} controls`);
  for (const [k, v] of Object.entries(summary.counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(15)} ${v}`);
  }
});

async function switchControl(page: Page, controlDir: string): Promise<void> {
  const res = await page.request.post('/api/switch-control', {
    data: { controlDir },
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok()) {
    throw new Error(`switch-control returned ${res.status()}: ${await res.text()}`);
  }
}

async function waitForControlMount(page: Page, timeoutMs: number): Promise<{ mounted: boolean; bannerError?: string }> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const banner = page.locator('[data-test-id="control-error-banner"]');
    if (await banner.count() > 0 && await banner.first().isVisible()) {
      return { mounted: false, bannerError: (await banner.first().innerText()).slice(0, 500) };
    }
    const container = page.locator('[data-test-id="pcf-control-container"]');
    if (await container.count() > 0) {
      const html = await container.first().innerHTML();
      if (html && html.length > 0) return { mounted: true };
    }
    await page.waitForTimeout(150);
  }
  return { mounted: false };
}

for (const item of queue) {
  const ctrlLabel = `${item.entry.owner}/${item.entry.repo}/${item.control.constructor}`;
  test(ctrlLabel, async ({ page }) => {
    const consoleErrors: string[] = [];
    const consoleWarnings: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      // React logs deprecation/key warnings as console.error in dev mode.
      // These are noisy but don't block control behaviour, so keep them out
      // of the pass/fail signal. We still surface them in the report under a
      // separate field so reviewers can spot loud controls.
      if (/^Warning:/.test(text)) {
        consoleWarnings.push(text.slice(0, 400));
        return;
      }
      // Source-map / favicon 404s are harness noise, not control bugs.
      if (/Failed to load resource/.test(text) && /(favicon|\.map)/.test(text)) {
        return;
      }
      consoleErrors.push(text.slice(0, 400));
    });
    page.on('pageerror', (err) => {
      pageErrors.push((err.message ?? String(err)).slice(0, 400));
    });

    // Bring the harness to a known starting point.
    await page.goto('/');

    // Switch the harness to this gallery control. The /api/switch-control
    // endpoint mutates plugin state, then triggers a full-reload over WS.
    try {
      await switchControl(page, item.controlDir);
    } catch (err: any) {
      spoolRow({
        owner: item.entry.owner,
        repo: item.entry.repo,
        control: item.control.constructor,
        scenario: '(switch)',
        status: 'switch-error',
        consoleErrors: [],
        consoleWarnings: [],
        pageErrors: [err?.message ?? String(err)],
        durationMs: 0,
      });
      // Don't fail the suite — we want the report to keep going.
      return;
    }

    // Give the WS reload a moment, then load the harness fresh.
    await page.waitForTimeout(400);
    await page.goto('/');

    const t0 = Date.now();
    // H2 — Large bundles (PDF/Docx/canvas controls) take longer than 25s to
    // download + parse on a cold harness. Auto-extend the mount timeout when
    // we know the bundle is heavy.
    const bundleSize = item.control.bundleBytes ?? 0;
    const mountTimeout = bundleSize >= LARGE_BUNDLE_BYTES ? CONTROL_LOAD_TIMEOUT_LARGE_MS : CONTROL_LOAD_TIMEOUT_MS;
    const { mounted, bannerError } = await waitForControlMount(page, mountTimeout);
    if (!mounted) {
      spoolRow({
        owner: item.entry.owner,
        repo: item.entry.repo,
        control: item.control.constructor,
        scenario: '(initial-load)',
        status: bannerError ? 'fail' : 'load-timeout',
        consoleErrors: consoleErrors.slice(),
        consoleWarnings: consoleWarnings.slice(),
        pageErrors: pageErrors.slice(),
        controlBannerError: bannerError,
        durationMs: Date.now() - t0,
      });
      return;
    }

    // Iterate scenarios. We pre-clear the per-page error buffers so each
    // scenario captures only what happened during its own load.
    for (const sc of item.scenarios) {
      consoleErrors.length = 0;
      consoleWarnings.length = 0;
      pageErrors.length = 0;

      const scStart = Date.now();
      await page.goto(`/?scenario=${encodeURIComponent(sc.name)}`);
      await page.waitForTimeout(SCENARIO_LOAD_WAIT_MS);

      const banner = page.locator('[data-test-id="control-error-banner"]');
      let scBanner: string | undefined;
      if (await banner.count() > 0 && await banner.first().isVisible()) {
        scBanner = (await banner.first().innerText()).slice(0, 500);
      }

      let screenshotName: string | undefined;
      if (!SKIP_VISUAL) {
        screenshotName = `${slug(item.entry.owner)}__${slug(item.entry.repo)}__${slug(item.control.constructor)}__${slug(sc.name)}.png`;
        try {
          await page.locator('[data-test-id="pcf-control-container"]').first().screenshot({
            path: path.join(SCREENSHOT_DIR, screenshotName),
            timeout: 5000,
          });
        } catch {
          screenshotName = undefined;
        }
      }

      const status: ResultRow['status'] = scBanner ? 'fail' : (consoleErrors.length === 0 && pageErrors.length === 0 ? 'pass' : 'fail');
      spoolRow({
        owner: item.entry.owner,
        repo: item.entry.repo,
        control: item.control.constructor,
        scenario: sc.name,
        status,
        consoleErrors: consoleErrors.slice(),
        consoleWarnings: consoleWarnings.slice(),
        pageErrors: pageErrors.slice(),
        controlBannerError: scBanner,
        durationMs: Date.now() - scStart,
        screenshot: screenshotName,
      });
    }

    // Suite must not fail just because a community control had errors —
    // we capture them in the report. Just assert the test ran.
    expect(item.scenarios.length).toBeGreaterThan(0);
  });
}
