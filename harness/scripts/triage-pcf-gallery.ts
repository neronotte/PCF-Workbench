/**
 * Phase 4C — Triage failed PCF Gallery builds.
 *
 * Reads `pcf-gallery-build-report.json`, classifies every entry whose
 * installStatus or buildStatus is not `ok` into a small set of buckets,
 * and emits `pcf-gallery-triage-report.json` next to the build report.
 *
 * Buckets:
 *   - install-timeout            : npm install hit the timeout (default 240s)
 *   - install-spawn-error        : spawn ETIMEDOUT / ENOENT
 *   - install-eresolve           : npm peer-dep conflict
 *   - install-other              : everything else under installStatus=failed
 *   - silent-no-bundle           : exit=0 but no bundle.js (lint-as-error swallowed)
 *   - build-non-zero             : exit≠0 (genuine compile failure)
 *   - skipped                    : derivative of an upstream failure
 *
 * Repos with multiple failed manifests are coalesced — we report one row per
 * (owner, repo) so 9 carfup failures don't drown out 9 unique problems.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const DEFAULT_ROOT = process.env.PCF_GALLERY_ROOT || 'C:\\Github.Copilot\\PowerApps\\PCFGallery';
const BUILD_REPORT = path.join(DEFAULT_ROOT, '_catalog', 'pcf-gallery-build-report.json');
const TRIAGE_REPORT = path.join(DEFAULT_ROOT, '_catalog', 'pcf-gallery-triage-report.json');

type Bucket =
  | 'install-timeout'
  | 'install-spawn-error'
  | 'install-eresolve'
  | 'install-other'
  | 'silent-no-bundle'
  | 'build-non-zero'
  | 'skipped';

interface BuildReportEntry {
  owner: string;
  repo: string;
  packageJsonPath: string;
  pcfProjectDir: string;
  controls: Array<{ manifestPath: string; namespace: string; constructor: string }>;
  installStatus: string;
  buildStatus: string;
  installError?: string;
  buildError?: string;
  installDurationMs?: number;
  buildDurationMs?: number;
}

interface BuildReport {
  builtAt: string;
  totalEntries: number;
  ok: number;
  failed: number;
  entries: BuildReportEntry[];
}

interface TriageRow {
  owner: string;
  repo: string;
  bucket: Bucket;
  manifestCount: number;
  installStatus: string;
  buildStatus: string;
  durationMs: number;
  signature: string;
  rawError?: string;
}

function classify(e: BuildReportEntry): { bucket: Bucket; signature: string; raw?: string } {
  const ie = e.installError ?? '';
  const be = e.buildError ?? '';

  if (e.installStatus === 'failed') {
    if (/ETIMEDOUT/i.test(ie)) return { bucket: 'install-timeout', signature: 'npm install timed out (>240s)', raw: ie };
    if (/spawn(Sync)? .* (ENOENT|ETIMEDOUT|EACCES)/i.test(ie)) return { bucket: 'install-spawn-error', signature: 'spawn error during install', raw: ie };
    if (/ERESOLVE|peer dep|peerDependencies/i.test(ie)) return { bucket: 'install-eresolve', signature: 'npm peer-dep / ERESOLVE conflict', raw: ie };
    return { bucket: 'install-other', signature: 'install failed (other)', raw: ie || '(no installError captured)' };
  }

  if (e.buildStatus === 'skipped') {
    return { bucket: 'skipped', signature: 'build skipped (upstream install failure)', raw: ie || be };
  }

  if (/no bundle\.js was produced/i.test(be) || /silent ESLint/i.test(be)) {
    return { bucket: 'silent-no-bundle', signature: 'build exit=0 but no bundle.js (silent lint/webpack failure)', raw: be };
  }

  return { bucket: 'build-non-zero', signature: 'build exit≠0 (compile/lint error)', raw: be || '(no buildError captured)' };
}

function main() {
  if (!fs.existsSync(BUILD_REPORT)) {
    console.error(`Build report not found: ${BUILD_REPORT}`);
    process.exit(1);
  }
  const report: BuildReport = JSON.parse(fs.readFileSync(BUILD_REPORT, 'utf8'));
  const failedEntries = report.entries.filter(e => e.installStatus !== 'ok' || e.buildStatus !== 'ok');

  // Coalesce entries with the same (owner, repo) so a single repo shows up
  // once with a manifestCount, not N times.
  const byRepo = new Map<string, BuildReportEntry[]>();
  for (const e of failedEntries) {
    const key = `${e.owner}/${e.repo}`;
    if (!byRepo.has(key)) byRepo.set(key, []);
    byRepo.get(key)!.push(e);
  }

  const rows: TriageRow[] = [];
  for (const [key, entries] of byRepo) {
    const head = entries[0];
    const cls = classify(head);
    const totalManifests = entries.reduce((n, e) => n + (e.controls?.length ?? 0), 0);
    rows.push({
      owner: head.owner,
      repo: head.repo,
      bucket: cls.bucket,
      manifestCount: totalManifests,
      installStatus: head.installStatus,
      buildStatus: head.buildStatus,
      durationMs: (head.installDurationMs ?? 0) + (head.buildDurationMs ?? 0),
      signature: cls.signature,
      rawError: cls.raw?.slice(0, 400),
    });
  }

  const byBucket = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.bucket] = (acc[r.bucket] ?? 0) + 1;
    return acc;
  }, {});
  const totalFailedManifests = rows.reduce((n, r) => n + r.manifestCount, 0);

  const summary = {
    generatedAt: new Date().toISOString(),
    totalReposFailed: rows.length,
    totalManifestsFailed: totalFailedManifests,
    byBucket,
    rows: rows.sort((a, b) => a.bucket.localeCompare(b.bucket) || a.owner.localeCompare(b.owner)),
  };

  fs.writeFileSync(TRIAGE_REPORT, JSON.stringify(summary, null, 2) + '\n', 'utf8');

  console.log('PCF Gallery — failure triage');
  console.log('────────────────────────────────────────────────────────────');
  console.log(`Failed repos:     ${rows.length}`);
  console.log(`Failed manifests: ${totalFailedManifests}`);
  console.log('');
  console.log('By bucket:');
  for (const [b, n] of Object.entries(byBucket).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${b.padEnd(22)} ${n}`);
  }
  console.log('');
  console.log('Per-repo:');
  for (const r of summary.rows) {
    console.log(`  [${r.bucket.padEnd(22)}] ${r.owner}/${r.repo}  (${r.manifestCount} manifest${r.manifestCount === 1 ? '' : 's'})`);
  }
  console.log('');
  console.log(`Report: ${TRIAGE_REPORT}`);
}

main();
