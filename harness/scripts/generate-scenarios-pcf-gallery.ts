/**
 * Phase 4 — Generate `test-scenarios.json` for every successful PCF Gallery build.
 *
 * Reads the Phase 3 build report (`pcf-gallery-build-report.json`) and, for each
 * entry whose `buildStatus === 'ok'`, parses every produced manifest, calls
 * `generateScenarios()` (the same heuristic the harness UI uses), and writes
 * `test-scenarios.json` next to the manifest.
 *
 * Output: `pcf-gallery-scenario-report.json` next to the build report,
 * summarising how many scenarios each control got and any parse errors.
 *
 * Usage (from harness/):
 *   npx tsx scripts/generate-scenarios-pcf-gallery.ts             # all ok entries
 *   npx tsx scripts/generate-scenarios-pcf-gallery.ts --limit 10  # first 10
 *   npx tsx scripts/generate-scenarios-pcf-gallery.ts --owner javiqb
 *   npx tsx scripts/generate-scenarios-pcf-gallery.ts --force     # overwrite existing
 *
 * The script never touches a manifest, repo, or harness — it only emits JSON
 * scenario files. Safe to re-run; existing test-scenarios.json files are
 * preserved unless --force is passed.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseManifest } from '../src/parser/manifest-parser';
import { generateScenarios } from '../src/lib/scenario-heuristic';

const DEFAULT_ROOT = process.env.PCF_GALLERY_ROOT || 'C:\\Github.Copilot\\PowerApps\\PCFGallery';
const BUILD_REPORT = path.join(DEFAULT_ROOT, '_catalog', 'pcf-gallery-build-report.json');
const SCENARIO_REPORT = path.join(DEFAULT_ROOT, '_catalog', 'pcf-gallery-scenario-report.json');
const SCENARIO_COUNT = 5;

interface BuildReportControl {
  manifestPath: string;
  namespace: string;
  constructor: string;
  bundlePath: string;
  bundleBytes: number;
}

interface BuildReportEntry {
  owner: string;
  repo: string;
  packageJsonPath: string;
  pcfProjectDir: string;
  controls: BuildReportControl[];
  installStatus: string;
  buildStatus: string;
}

interface BuildReport {
  builtAt: string;
  totalEntries: number;
  ok: number;
  failed: number;
  entries: BuildReportEntry[];
}

interface ScenarioReportRow {
  owner: string;
  repo: string;
  manifestPath: string;
  namespace: string;
  constructor: string;
  status: 'written' | 'skipped-existing' | 'no-properties' | 'manifest-missing' | 'parse-error' | 'write-error';
  scenarioCount?: number;
  scenarioFile?: string;
  error?: string;
}

interface CliOptions {
  limit?: number;
  owner?: string;
  force: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit') opts.limit = parseInt(argv[++i] ?? '', 10);
    else if (a === '--owner') opts.owner = argv[++i];
    else if (a === '--force') opts.force = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: generate-scenarios-pcf-gallery.ts [--limit N] [--owner O] [--force]');
      process.exit(0);
    }
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(BUILD_REPORT)) {
    console.error(`Build report not found: ${BUILD_REPORT}`);
    console.error('Run scripts/build-pcf-gallery.ts first.');
    process.exit(1);
  }

  const report: BuildReport = JSON.parse(fs.readFileSync(BUILD_REPORT, 'utf8'));
  const okEntries = report.entries.filter(e => e.buildStatus === 'ok');

  let queue = okEntries;
  if (opts.owner) queue = queue.filter(e => e.owner.toLowerCase() === opts.owner!.toLowerCase());
  if (opts.limit && opts.limit > 0) queue = queue.slice(0, opts.limit);

  console.log(`Build report has ${report.entries.length} entries (${report.ok} ok, ${report.failed} failed).`);
  console.log(`Generating scenarios for ${queue.length} ok entries${opts.owner ? ` (owner=${opts.owner})` : ''}${opts.limit ? ` (limit ${opts.limit})` : ''}${opts.force ? ' (--force)' : ''}.`);
  console.log('');

  const rows: ScenarioReportRow[] = [];
  const counts = { written: 0, skipped: 0, empty: 0, missingManifest: 0, parseError: 0, writeError: 0, totalScenarios: 0 };

  for (let i = 0; i < queue.length; i++) {
    const entry = queue[i];
    const repoDir = path.join(DEFAULT_ROOT, `${entry.owner}-${entry.repo}`);
    const idx = `[${(i + 1).toString().padStart(3)}/${queue.length}]`;

    for (const ctrl of entry.controls) {
      // manifestPath is relative to the repo root (not pcfProjectDir).
      const manifestAbs = path.resolve(repoDir, ctrl.manifestPath);
      const controlDir = path.dirname(manifestAbs);
      const scenarioFile = path.join(controlDir, 'test-scenarios.json');
      const row: ScenarioReportRow = {
        owner: entry.owner,
        repo: entry.repo,
        manifestPath: ctrl.manifestPath,
        namespace: ctrl.namespace,
        constructor: ctrl.constructor,
        status: 'written',
      };

      if (!fs.existsSync(manifestAbs)) {
        row.status = 'manifest-missing';
        row.error = manifestAbs;
        counts.missingManifest++;
        rows.push(row);
        console.log(`${idx} MISSING ${entry.owner}/${entry.repo} ${ctrl.constructor}: manifest not on disk`);
        continue;
      }

      if (!opts.force && fs.existsSync(scenarioFile)) {
        row.status = 'skipped-existing';
        row.scenarioFile = path.relative(repoDir, scenarioFile).replace(/\\/g, '/');
        counts.skipped++;
        rows.push(row);
        console.log(`${idx} SKIP    ${entry.owner}/${entry.repo} ${ctrl.constructor}: test-scenarios.json already exists`);
        continue;
      }

      let manifest: ReturnType<typeof parseManifest>;
      try {
        const xml = fs.readFileSync(manifestAbs, 'utf8');
        manifest = parseManifest(xml);
      } catch (err: any) {
        row.status = 'parse-error';
        row.error = err?.message ?? String(err);
        counts.parseError++;
        rows.push(row);
        console.log(`${idx} PARSE   ${entry.owner}/${entry.repo} ${ctrl.constructor}: ${row.error}`);
        continue;
      }

      const properties = manifest.properties ?? [];
      const dataSets = manifest.dataSets ?? [];
      const scenarios = generateScenarios(properties, dataSets, { count: SCENARIO_COUNT });

      if (scenarios.length === 0) {
        row.status = 'no-properties';
        row.scenarioCount = 0;
        counts.empty++;
        rows.push(row);
        console.log(`${idx} EMPTY   ${entry.owner}/${entry.repo} ${ctrl.constructor}: no properties or datasets`);
        continue;
      }

      try {
        fs.writeFileSync(scenarioFile, JSON.stringify(scenarios, null, 2) + '\n', 'utf8');
        row.scenarioCount = scenarios.length;
        row.scenarioFile = path.relative(repoDir, scenarioFile).replace(/\\/g, '/');
        counts.written++;
        counts.totalScenarios += scenarios.length;
        rows.push(row);
        console.log(`${idx} OK      ${entry.owner}/${entry.repo} ${ctrl.constructor}: ${scenarios.length} scenarios → ${row.scenarioFile}`);
      } catch (err: any) {
        row.status = 'write-error';
        row.error = err?.message ?? String(err);
        counts.writeError++;
        rows.push(row);
        console.log(`${idx} WRITE   ${entry.owner}/${entry.repo} ${ctrl.constructor}: ${row.error}`);
      }
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    options: opts,
    counts,
    totalControls: rows.length,
    rows,
  };

  fs.writeFileSync(SCENARIO_REPORT, JSON.stringify(summary, null, 2) + '\n', 'utf8');

  console.log('');
  console.log('────────────────────────────────────────────────────────────');
  console.log(`Done. Controls processed: ${rows.length}`);
  console.log(`  written:           ${counts.written}  (${counts.totalScenarios} scenarios total)`);
  console.log(`  skipped (existing): ${counts.skipped}`);
  console.log(`  no properties:     ${counts.empty}`);
  console.log(`  manifest missing:  ${counts.missingManifest}`);
  console.log(`  parse error:       ${counts.parseError}`);
  console.log(`  write error:       ${counts.writeError}`);
  console.log(`Report: ${SCENARIO_REPORT}`);
}

main();
