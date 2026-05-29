/**
 * Phase 2 — Clone selected pcf.gallery entries.
 *
 * Reads the catalog from Phase 1, applies a stratified selection (tag +
 * framework diversity, dedupes by repo, prefers quality signals), shallow-
 * clones each unique repo into GALLERY_ROOT, walks for manifests, and writes
 * a .gallery-meta.json per repo.
 *
 * Usage:
 *   tsx scripts/clone-pcf-gallery.ts [--target N] [--tag <tag>...] [--all] [--dry-run]
 *
 * Defaults: target ~60 entries (≈50 unique repos), stratified across top 10 tags.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

const DEFAULT_ROOT = process.env.PCF_GALLERY_ROOT || 'C:\\Github.Copilot\\PowerApps\\PCFGallery';
const CATALOG_PATH = path.join(DEFAULT_ROOT, '_catalog', 'pcf-gallery-catalog.json');

interface CatalogEntry {
  slug: string;
  name: string;
  summary: string;
  tags: string[];
  supports: { modelDriven: boolean; canvas: boolean; powerPages: boolean };
  hasLicense: boolean;
  hasManagedSolution: boolean;
  downloadUrl?: string | null;
  download?: { kind: string; owner?: string; repo?: string; ref?: string };
}

interface RepoMeta {
  owner: string;
  repo: string;
  cloneUrl: string;
  clonedAt?: string;
  cloneError?: string;
  packageManager?: 'npm' | 'yarn' | 'pnpm' | 'unknown';
  nodeHint?: string;
  controls: Array<{
    manifestPath: string;       // relative to repo root
    namespace: string;
    constructor: string;
    controlType?: string;        // 'standard' | 'virtual'
    boundDataTypes: string[];   // e.g. ['SingleLine.Text']
    matchedGallerySlugs: string[]; // catalog entries that point at this repo
  }>;
}

/** Pick a stratified selection of entries. */
function selectEntries(all: CatalogEntry[], target: number, tagFilter?: string[]): CatalogEntry[] {
  const candidates = all.filter(e => e.download?.kind === 'github-repo' && e.download.owner && e.download.repo);
  if (tagFilter?.length) {
    return candidates.filter(e => e.tags.some(t => tagFilter.includes(t.toLowerCase())));
  }

  // Stratify across top 12 tags; pick ~5 entries per tag; prefer managed-solution and framework diversity.
  const tagCounts = new Map<string, number>();
  for (const e of candidates) for (const t of e.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  const topTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(t => t[0]);

  const selected = new Map<string, CatalogEntry>();
  const seenRepos = new Set<string>();
  const repoKey = (e: CatalogEntry) => `${e.download!.owner}/${e.download!.repo}`;

  // Pass 1: stratify by top tags
  for (const tag of topTags) {
    const inTag = candidates
      .filter(e => e.tags.includes(tag))
      .sort((a, b) => Number(b.hasManagedSolution) - Number(a.hasManagedSolution)); // managed first
    let picked = 0;
    for (const e of inTag) {
      if (picked >= 5) break;
      if (seenRepos.has(repoKey(e))) continue;
      selected.set(e.slug, e);
      seenRepos.add(repoKey(e));
      picked++;
      if (selected.size >= target) break;
    }
    if (selected.size >= target) break;
  }

  // Pass 2: framework coverage — make sure we have some canvas + power-pages
  const ensureFrameworks: Array<keyof CatalogEntry['supports']> = ['canvas', 'powerPages'];
  for (const fw of ensureFrameworks) {
    const minimum = fw === 'powerPages' ? 3 : 8;
    const current = [...selected.values()].filter(e => e.supports[fw]).length;
    if (current >= minimum) continue;
    const need = minimum - current;
    const extras = candidates
      .filter(e => e.supports[fw] && !seenRepos.has(repoKey(e)) && e.hasManagedSolution)
      .slice(0, need);
    for (const e of extras) { selected.set(e.slug, e); seenRepos.add(repoKey(e)); }
  }

  // Pass 3: fill remaining slots with random managed-solution entries
  if (selected.size < target) {
    const remaining = candidates
      .filter(e => !seenRepos.has(repoKey(e)) && e.hasManagedSolution)
      .sort(() => Math.random() - 0.5);
    for (const e of remaining) {
      if (selected.size >= target) break;
      selected.set(e.slug, e);
      seenRepos.add(repoKey(e));
    }
  }

  return [...selected.values()];
}

function repoDir(root: string, owner: string, repo: string): string {
  return path.join(root, `${owner}-${repo}`);
}

function safeCloneUrl(owner: string, repo: string): string {
  return `https://github.com/${owner}/${repo}.git`;
}

/** git clone --depth 1, idempotent. Returns true if newly cloned, false if already present. */
function cloneRepo(cloneUrl: string, dest: string): { newlyCloned: boolean; error?: string } {
  if (fs.existsSync(path.join(dest, '.git'))) return { newlyCloned: false };
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    execFileSync('git', ['clone', '--depth', '1', '--quiet', cloneUrl, dest], { stdio: 'pipe', timeout: 60000 });
    return { newlyCloned: true };
  } catch (e) {
    return { newlyCloned: false, error: (e as Error).message };
  }
}

/** Recursively find all ControlManifest.Input.xml under a directory (skipping node_modules / out / dist / .git). */
function findManifests(rootDir: string): string[] {
  const hits: string[] = [];
  const skip = new Set(['node_modules', '.git', 'out', 'dist', 'bin', 'obj']);
  function walk(d: string) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      if (skip.has(ent.name)) continue;
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile() && ent.name === 'ControlManifest.Input.xml') hits.push(full);
    }
  }
  walk(rootDir);
  return hits;
}

/** Parse namespace/constructor/control-type/bound data-types from a manifest XML string. */
function parseManifest(xml: string) {
  const ns = /<control[^>]*\snamespace="([^"]+)"/.exec(xml)?.[1] ?? '';
  const ctor = /<control[^>]*\sconstructor="([^"]+)"/.exec(xml)?.[1] ?? '';
  const controlType = /<control[^>]*\scontrol-type="([^"]+)"/.exec(xml)?.[1];
  // Walk every <property ... /> element and check for usage="bound" + of-type or of-type-group
  // (attributes can appear in any order, so a single regex won't work reliably).
  const boundDataTypes: string[] = [];
  const propRe = /<property\b([^/>]*)\/?>/g;
  let pm: RegExpExecArray | null;
  while ((pm = propRe.exec(xml))) {
    const attrs = pm[1];
    if (!/\busage\s*=\s*"bound"/.test(attrs)) continue;
    const ofType = /\bof-type\s*=\s*"([^"]+)"/.exec(attrs)?.[1];
    const ofGroup = /\bof-type-group\s*=\s*"([^"]+)"/.exec(attrs)?.[1];
    if (ofType) boundDataTypes.push(ofType);
    if (ofGroup) boundDataTypes.push(`group:${ofGroup}`);
  }
  return { namespace: ns, constructor: ctor, controlType, boundDataTypes: [...new Set(boundDataTypes)] };
}

function detectPackageManager(repoRoot: string): RepoMeta['packageManager'] {
  if (fs.existsSync(path.join(repoRoot, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(repoRoot, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(repoRoot, 'package-lock.json'))) return 'npm';
  if (fs.existsSync(path.join(repoRoot, 'package.json'))) return 'npm'; // default
  return 'unknown';
}

function detectNodeHint(repoRoot: string): string | undefined {
  const nvmrc = path.join(repoRoot, '.nvmrc');
  if (fs.existsSync(nvmrc)) return fs.readFileSync(nvmrc, 'utf8').trim();
  const pkg = path.join(repoRoot, 'package.json');
  if (fs.existsSync(pkg)) {
    try {
      const j = JSON.parse(fs.readFileSync(pkg, 'utf8'));
      if (j.engines?.node) return `engines.node=${j.engines.node}`;
    } catch { /* ignore */ }
  }
  return undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const getArg = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const target = getArg('--target') ? Number(getArg('--target')) : 60;
  const tagFilter = args.includes('--tag') ? args.slice(args.indexOf('--tag') + 1).filter(a => !a.startsWith('--')) : undefined;
  const dryRun = args.includes('--dry-run');
  const all = args.includes('--all');

  if (!fs.existsSync(CATALOG_PATH)) {
    console.error(`Catalog not found: ${CATALOG_PATH}. Run scrape-pcf-gallery.ts first.`);
    process.exit(2);
  }
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8')) as { entries: CatalogEntry[] };

  const selected = all
    ? catalog.entries.filter(e => e.download?.kind === 'github-repo')
    : selectEntries(catalog.entries, target, tagFilter);

  console.log(`Selected ${selected.length} entries (target=${target}, tagFilter=${tagFilter?.join(',') ?? 'none'})`);

  // Group by repo
  const byRepo = new Map<string, { owner: string; repo: string; slugs: string[] }>();
  for (const e of selected) {
    const key = `${e.download!.owner}/${e.download!.repo}`;
    const grp = byRepo.get(key) ?? { owner: e.download!.owner!, repo: e.download!.repo!, slugs: [] };
    grp.slugs.push(e.slug);
    byRepo.set(key, grp);
  }
  console.log(`→ ${byRepo.size} unique repos to clone.`);

  if (dryRun) {
    for (const grp of byRepo.values()) {
      console.log(`  ${grp.owner}/${grp.repo}  (slugs: ${grp.slugs.join(', ')})`);
    }
    return;
  }

  fs.mkdirSync(DEFAULT_ROOT, { recursive: true });
  let cloneOk = 0, cloneFail = 0, alreadyPresent = 0, manifestTotal = 0;
  const repoMetas: RepoMeta[] = [];
  let i = 0;
  for (const grp of byRepo.values()) {
    i++;
    const dest = repoDir(DEFAULT_ROOT, grp.owner, grp.repo);
    const url = safeCloneUrl(grp.owner, grp.repo);
    const prefix = `  [${i}/${byRepo.size}] ${grp.owner}/${grp.repo}`.padEnd(70);

    const { newlyCloned, error } = cloneRepo(url, dest);
    let status: string;
    if (error) { cloneFail++; status = `FAIL ${error.split('\n')[0].slice(0, 60)}`; }
    else if (newlyCloned) { cloneOk++; status = 'CLONED'; }
    else { alreadyPresent++; status = 'EXISTS'; }

    const meta: RepoMeta = { owner: grp.owner, repo: grp.repo, cloneUrl: url, controls: [] };
    if (error) meta.cloneError = error;
    else {
      meta.clonedAt = new Date().toISOString();
      meta.packageManager = detectPackageManager(dest);
      meta.nodeHint = detectNodeHint(dest);
      // Find manifests
      const manifests = findManifests(dest);
      manifestTotal += manifests.length;
      for (const m of manifests) {
        const xml = fs.readFileSync(m, 'utf8');
        const parsed = parseManifest(xml);
        meta.controls.push({
          manifestPath: path.relative(dest, m).replace(/\\/g, '/'),
          namespace: parsed.namespace,
          constructor: parsed.constructor,
          controlType: parsed.controlType,
          boundDataTypes: parsed.boundDataTypes,
          matchedGallerySlugs: grp.slugs,
        });
      }
      fs.writeFileSync(path.join(dest, '.gallery-meta.json'), JSON.stringify(meta, null, 2), 'utf8');
    }
    repoMetas.push(meta);
    console.log(`${prefix} ${status}${meta.controls.length ? `, ${meta.controls.length} manifest(s)` : ''}`);
  }

  // Write a summary report
  const summaryPath = path.join(DEFAULT_ROOT, '_catalog', 'pcf-gallery-clone-report.json');
  fs.writeFileSync(summaryPath, JSON.stringify({
    clonedAt: new Date().toISOString(),
    totalRepos: byRepo.size,
    cloneOk,
    cloneFail,
    alreadyPresent,
    manifestTotal,
    repos: repoMetas,
  }, null, 2), 'utf8');

  console.log(`\nDone. ${cloneOk} cloned, ${alreadyPresent} already present, ${cloneFail} failed. ${manifestTotal} manifests across all repos.`);
  console.log(`Summary: ${summaryPath}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
