/**
 * Phase 3 — Build cloned pcf.gallery controls.
 *
 * Reads the Phase 2 clone report, walks each repo's package.json(s), runs
 * npm install + npm run build (or `npx pcf-scripts build`), verifies the
 * resulting bundle.js, and writes a structured build report.
 *
 * Usage:
 *   tsx scripts/build-pcf-gallery.ts [--limit N] [--owner <owner>] [--repo <name>] [--rebuild]
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

const DEFAULT_ROOT = process.env.PCF_GALLERY_ROOT || 'C:\\Github.Copilot\\PowerApps\\PCFGallery';
const CLONE_REPORT = path.join(DEFAULT_ROOT, '_catalog', 'pcf-gallery-clone-report.json');
const BUILD_REPORT = path.join(DEFAULT_ROOT, '_catalog', 'pcf-gallery-build-report.json');
const INSTALL_TIMEOUT_MS = 240000;
const BUILD_TIMEOUT_MS   = 180000;

interface ClonedRepo {
  owner: string;
  repo: string;
  packageManager?: 'npm' | 'yarn' | 'pnpm' | 'unknown';
  controls: Array<{ manifestPath: string; namespace: string; constructor: string; controlType?: string; boundDataTypes: string[] }>;
}

interface BuildEntry {
  owner: string;
  repo: string;
  packageJsonPath: string;       // relative to repo root, the package.json we built against
  pcfProjectDir: string;          // relative to repo root, the dir that contains it
  controls: Array<{
    manifestPath: string;
    namespace: string;
    constructor: string;
    bundlePath?: string;          // relative to repo root, if found post-build
    bundleBytes?: number;
  }>;
  installStatus: 'ok' | 'failed' | 'skipped';
  installDurationMs?: number;
  installError?: string;
  buildStatus: 'ok' | 'failed' | 'skipped';
  buildDurationMs?: number;
  buildError?: string;
  buildCommand?: string;
}

function relWin(p: string) { return p.replace(/\\/g, '/'); }

/** Find the package.json that should be built for each manifest.
 *  Walks UP from each manifest looking for a package.json whose deps include
 *  pcf-scripts. Groups manifests under the same package.json. */
function locateBuildables(repoRoot: string, controls: ClonedRepo['controls']): Array<{ packageJsonPath: string; controls: ClonedRepo['controls'] }> {
  const groups = new Map<string, ClonedRepo['controls']>();
  for (const c of controls) {
    const manifestFull = path.join(repoRoot, c.manifestPath);
    let dir = path.dirname(manifestFull);
    let pkgPath: string | null = null;
    while (dir.length > repoRoot.length - 1) {
      const candidate = path.join(dir, 'package.json');
      if (fs.existsSync(candidate)) {
        try {
          const j = JSON.parse(fs.readFileSync(candidate, 'utf8'));
          const allDeps = { ...j.dependencies, ...j.devDependencies };
          if (allDeps['pcf-scripts'] || allDeps['@pcf/scripts'] || j.scripts?.build || j.scripts?.['build:pcf']) {
            pkgPath = candidate;
            break;
          }
        } catch { /* malformed package.json */ }
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    if (!pkgPath) continue;
    const key = pkgPath;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }
  return [...groups.entries()].map(([packageJsonPath, ctrls]) => ({ packageJsonPath, controls: ctrls }));
}

/** Find the produced bundle for a given control after build. */
function findBundle(pcfProjectDir: string, ctor: string): { path: string; bytes: number } | null {
  // Standard pcf-scripts output: <pcfProjectDir>/out/controls/<ctor>/bundle.js
  const candidate = path.join(pcfProjectDir, 'out', 'controls', ctor, 'bundle.js');
  if (fs.existsSync(candidate)) {
    return { path: candidate, bytes: fs.statSync(candidate).size };
  }
  // Some repos use a custom output dir — do a shallow walk for bundle.js
  const outDir = path.join(pcfProjectDir, 'out');
  if (fs.existsSync(outDir)) {
    const stack = [outDir];
    while (stack.length) {
      const d = stack.pop()!;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) stack.push(full);
        else if (e.name === 'bundle.js' && d.endsWith(ctor)) return { path: full, bytes: fs.statSync(full).size };
      }
    }
  }
  return null;
}

function runCmd(cwd: string, cmd: string, args: string[], timeoutMs: number): { ok: boolean; durationMs: number; error?: string } {
  const start = Date.now();
  // npm/npx on Windows is a .cmd shim → use shell to resolve it.
  const result = spawnSync(cmd, args, {
    cwd,
    shell: true,
    timeout: timeoutMs,
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=4096' },
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const durationMs = Date.now() - start;
  if (result.error) return { ok: false, durationMs, error: `spawn error: ${result.error.message}` };
  if (result.status !== 0) {
    const stderr = (result.stderr || '').toString().trim();
    const stdoutTail = (result.stdout || '').toString().trim().split('\n').slice(-10).join('\n');
    return { ok: false, durationMs, error: `exit ${result.status}\nSTDERR: ${stderr.slice(-1500)}\nSTDOUT(tail): ${stdoutTail.slice(-1000)}` };
  }
  return { ok: true, durationMs };
}

async function main() {
  const args = process.argv.slice(2);
  const getArg = (n: string): string | undefined => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const limit = getArg('--limit') ? Number(getArg('--limit')) : undefined;
  const ownerFilter = getArg('--owner');
  const repoFilter = getArg('--repo');
  const rebuild = args.includes('--rebuild');

  if (!fs.existsSync(CLONE_REPORT)) {
    console.error(`Clone report not found: ${CLONE_REPORT}. Run clone-pcf-gallery.ts first.`);
    process.exit(2);
  }
  const cloneRep = JSON.parse(fs.readFileSync(CLONE_REPORT, 'utf8')) as { repos: ClonedRepo[] };

  // Load prior build report if present, for resume
  const prior = new Map<string, BuildEntry>();
  if (fs.existsSync(BUILD_REPORT) && !rebuild) {
    try {
      const j = JSON.parse(fs.readFileSync(BUILD_REPORT, 'utf8')) as { entries: BuildEntry[] };
      for (const e of j.entries) prior.set(`${e.owner}/${e.repo}/${e.packageJsonPath}`, e);
    } catch { /* ignore */ }
  }

  let repos = cloneRep.repos.filter(r => r.controls.length > 0);
  if (ownerFilter) repos = repos.filter(r => r.owner === ownerFilter);
  if (repoFilter) repos = repos.filter(r => r.repo === repoFilter);
  if (limit) repos = repos.slice(0, limit);

  console.log(`Building ${repos.length} repos (${prior.size} prior build entries cached; --rebuild to force).\n`);

  const entries: BuildEntry[] = [];
  let totalOk = 0, totalFail = 0, totalSkipped = 0, bundlesFound = 0;
  let repoIdx = 0;
  for (const r of repos) {
    repoIdx++;
    const repoRoot = path.join(DEFAULT_ROOT, `${r.owner}-${r.repo}`);
    if (!fs.existsSync(repoRoot)) {
      console.log(`[${repoIdx}/${repos.length}] ${r.owner}/${r.repo}  SKIP (clone dir missing)`);
      continue;
    }
    const builds = locateBuildables(repoRoot, r.controls);
    if (!builds.length) {
      console.log(`[${repoIdx}/${repos.length}] ${r.owner}/${r.repo}  SKIP (no pcf-scripts package.json)`);
      totalSkipped++;
      continue;
    }

    for (const b of builds) {
      const pcfProjectDir = path.dirname(b.packageJsonPath);
      const projectRel = relWin(path.relative(repoRoot, pcfProjectDir)) || '.';
      const pkgRel = relWin(path.relative(repoRoot, b.packageJsonPath));
      const cacheKey = `${r.owner}/${r.repo}/${pkgRel}`;
      const cached = prior.get(cacheKey);

      const header = `[${repoIdx}/${repos.length}] ${r.owner}/${r.repo} (${projectRel || 'root'})`.padEnd(72);

      if (cached && cached.buildStatus === 'ok' && !rebuild) {
        // Already built successfully — just verify bundles still present
        let allPresent = true;
        for (const c of b.controls) {
          const bundle = findBundle(pcfProjectDir, c.constructor);
          if (!bundle) { allPresent = false; break; }
        }
        if (allPresent) {
          console.log(`${header} CACHED (build OK)`);
          entries.push(cached);
          totalOk++;
          bundlesFound += b.controls.length;
          continue;
        }
      }

      const entry: BuildEntry = {
        owner: r.owner, repo: r.repo,
        packageJsonPath: pkgRel,
        pcfProjectDir: projectRel,
        controls: b.controls.map(c => ({
          manifestPath: c.manifestPath,
          namespace: c.namespace,
          constructor: c.constructor,
        })),
        installStatus: 'skipped',
        buildStatus: 'skipped',
      };

      // npm install (skip if node_modules already present and not --rebuild)
      const needInstall = !fs.existsSync(path.join(pcfProjectDir, 'node_modules')) || rebuild;
      if (needInstall) {
        process.stdout.write(`${header} installing... `);
        const inst = runCmd(pcfProjectDir, 'npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], INSTALL_TIMEOUT_MS);
        entry.installDurationMs = inst.durationMs;
        if (!inst.ok) {
          entry.installStatus = 'failed';
          entry.installError = inst.error;
          console.log(`FAIL (install, ${(inst.durationMs / 1000).toFixed(1)}s)`);
          totalFail++;
          entries.push(entry);
          continue;
        }
        entry.installStatus = 'ok';
        process.stdout.write(`OK (${(inst.durationMs / 1000).toFixed(1)}s); `);
      } else {
        entry.installStatus = 'skipped';
        process.stdout.write(`${header} node_modules cached; `);
      }

      // npm run build (fall back to npx pcf-scripts build)
      let pkgJson: any;
      try { pkgJson = JSON.parse(fs.readFileSync(b.packageJsonPath, 'utf8')); } catch { pkgJson = {}; }
      const hasBuild = !!pkgJson.scripts?.build;
      const cmd = hasBuild ? 'npm run build' : 'npx pcf-scripts build';
      entry.buildCommand = cmd;
      process.stdout.write('building... ');
      const buildRes = runCmd(pcfProjectDir, cmd.split(' ')[0], cmd.split(' ').slice(1), BUILD_TIMEOUT_MS);
      entry.buildDurationMs = buildRes.durationMs;
      if (!buildRes.ok) {
        entry.buildStatus = 'failed';
        entry.buildError = buildRes.error;
        console.log(`FAIL (build, ${(buildRes.durationMs / 1000).toFixed(1)}s)`);
        totalFail++;
        entries.push(entry);
        continue;
      }
      entry.buildStatus = 'ok';

      // Find produced bundles. pcf-scripts is known to sometimes report exit 0
      // even when ESLint or webpack fail mid-stream — so if NO bundle was
      // produced for ANY control, downgrade to failed.
      let foundCount = 0;
      for (const ctrl of entry.controls) {
        const bundle = findBundle(pcfProjectDir, ctrl.constructor);
        if (bundle) {
          ctrl.bundlePath = relWin(path.relative(repoRoot, bundle.path));
          ctrl.bundleBytes = bundle.bytes;
          foundCount++;
          bundlesFound++;
        }
      }
      if (foundCount === 0) {
        entry.buildStatus = 'failed';
        entry.buildError = (entry.buildError ?? '') + '\nNote: build exit was 0 but no bundle.js was produced for any control (likely silent ESLint/webpack failure).';
        console.log(`silent FAIL (build exit 0 but no bundles, ${(buildRes.durationMs / 1000).toFixed(1)}s)`);
        totalFail++;
        entries.push(entry);
        continue;
      }
      console.log(`built OK (${(buildRes.durationMs / 1000).toFixed(1)}s, ${foundCount}/${entry.controls.length} bundles)`);
      totalOk++;
      entries.push(entry);

      // Write incremental report every 5 builds
      if (entries.length % 5 === 0) writeReport(entries);
    }
  }

  writeReport(entries);

  console.log(`\nDone. ${totalOk} OK, ${totalFail} failed, ${totalSkipped} skipped. ${bundlesFound} bundles produced.`);
  console.log(`Report: ${BUILD_REPORT}`);
}

function writeReport(entries: BuildEntry[]) {
  const ok = entries.filter(e => e.buildStatus === 'ok').length;
  const failed = entries.filter(e => e.buildStatus === 'failed' || e.installStatus === 'failed').length;
  const bundles = entries.flatMap(e => e.controls).filter(c => c.bundlePath).length;
  fs.writeFileSync(BUILD_REPORT, JSON.stringify({
    builtAt: new Date().toISOString(),
    totalEntries: entries.length,
    ok, failed,
    bundlesProduced: bundles,
    entries,
  }, null, 2), 'utf8');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
