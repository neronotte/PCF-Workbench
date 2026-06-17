#!/usr/bin/env node
/**
 * M12.M1 — Cross-platform publish builder.
 *
 * Stages the publishable tarball under publish-staging/. `npm pack` (or
 * `npm publish`) reads from there.
 *
 *   1. vite build  — harness UI → publish-staging/dist/
 *   2. esbuild     — CLI bundle  → publish-staging/bin/pcfworkbench.js
 *                    Bundles bin/pcf-harness.ts + its src/ imports into a
 *                    single ESM file. Externalises native / heavy deps that
 *                    are listed in dependencies (Vite, Playwright, Fluent,
 *                    React) — those resolve from the user's node_modules at
 *                    runtime.
 *   3. README + LICENSE + schema → staging
 *   4. Rewritten package.json (no devDependencies, single bin, clean files)
 *
 * The original harness/ source tree is never modified — staging is throw-away.
 */

import { execSync } from 'node:child_process';
import { build as esbuild } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const harnessRoot = path.resolve(__dirname, '..');
const stagingDir = path.join(harnessRoot, 'publish-staging');

function run(cmd, opts = {}) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: harnessRoot, ...opts });
}

function rmrf(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

console.log('[publish] M12.M1 — building publishable tarball');

// 1. Reset staging
rmrf(stagingDir);
fs.mkdirSync(stagingDir, { recursive: true });
fs.mkdirSync(path.join(stagingDir, 'bin'), { recursive: true });

// 2. Build the harness CLI bundle.
//    The harness UI itself is shipped as src/ + index.html (no prebuilt
//    dist/) — see DESIGN.md §2. Vite dev-mode transforms the source at
//    request time so the `virtual:pcf-manifest` module re-resolves per
//    PCF_CONTROL_PATH change. Hence: NO `vite build` step here.
console.log('\n[publish] Skipping dist/ — virtual:pcf-manifest forces dev mode.');

// 3. Bundle the CLI with esbuild.
const pkg = JSON.parse(fs.readFileSync(path.join(harnessRoot, 'package.json'), 'utf8'));
const externalDeps = [
  ...Object.keys(pkg.dependencies ?? {}),
  // Node built-ins are always external; esbuild handles them automatically
  // when platform=node, but list explicitly for clarity:
  'node:*',
];
console.log('\n$ esbuild bin/pcfworkbench.ts');
await esbuild({
  entryPoints: [path.join(harnessRoot, 'bin', 'pcfworkbench.ts')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  outfile: path.join(stagingDir, 'bin', 'pcfworkbench.js'),
  external: externalDeps,
  // The source bin/pcfworkbench.ts already starts with `#!/usr/bin/env node`,
  // and esbuild preserves that shebang. Adding another via `banner` would
  // produce two shebangs and Node would syntax-error on line 2.
  logLevel: 'info',
});

// 4. Copy src/ + index.html — the harness UI source Vite dev-mode serves.
//    Excluded: tests/, *.test.ts, *.spec.ts (build-time only).
function shouldShipSource(file) {
  if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) return false;
  if (file.endsWith('.spec.ts') || file.endsWith('.spec.tsx')) return false;
  if (file.endsWith('.test.ts.map')) return false;
  return true;
}
function copyDirFiltered(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      // Skip tests/ entirely
      if (entry.name === 'tests' || entry.name === '__tests__') continue;
      copyDirFiltered(s, d);
    } else if (shouldShipSource(s)) {
      fs.copyFileSync(s, d);
    }
  }
}
copyDirFiltered(path.join(harnessRoot, 'src'), path.join(stagingDir, 'src'));

const indexHtml = path.join(harnessRoot, 'index.html');
if (fs.existsSync(indexHtml)) {
  fs.copyFileSync(indexHtml, path.join(stagingDir, 'index.html'));
}

// Also ship the dev-mode tsconfig + vite.config.ts so Vite resolves modules
// the same way it does in the repo. The CLI uses `configFile: false` and
// programmatic plugins, but Vite still reads tsconfig for TS settings.
const devTsconfig = path.join(harnessRoot, 'tsconfig.json');
if (fs.existsSync(devTsconfig)) {
  fs.copyFileSync(devTsconfig, path.join(stagingDir, 'tsconfig.json'));
}

// 4. Rewrite package.json for the published tarball.
const stagingPkg = {
  name: pkg.name,
  version: pkg.version,
  description: pkg.description,
  keywords: pkg.keywords,
  homepage: pkg.homepage,
  bugs: pkg.bugs,
  repository: pkg.repository,
  license: pkg.license,
  author: pkg.author,
  type: pkg.type,
  bin: { pcfworkbench: './bin/pcfworkbench.js' },
  files: ['bin/', 'src/', 'index.html', 'tsconfig.json', 'docs/', 'README.md', 'LICENSE'],
  engines: pkg.engines,
  dependencies: pkg.dependencies,
  publishConfig: pkg.publishConfig,
};
fs.writeFileSync(
  path.join(stagingDir, 'package.json'),
  JSON.stringify(stagingPkg, null, 2),
);

// 5. README + LICENSE
const publishReadme = path.join(harnessRoot, 'scripts', 'README.publish.md');
const fallbackReadme = path.join(harnessRoot, '..', 'README.md');
const readmeSrc = fs.existsSync(publishReadme) ? publishReadme : fallbackReadme;
fs.copyFileSync(readmeSrc, path.join(stagingDir, 'README.md'));

const licenseSrc = fs.existsSync(path.join(harnessRoot, 'LICENSE'))
  ? path.join(harnessRoot, 'LICENSE')
  : path.join(harnessRoot, '..', 'LICENSE');
fs.copyFileSync(licenseSrc, path.join(stagingDir, 'LICENSE'));

// 6. Selected docs (loop report schema, examples, agent playbooks)
const docsToShip = [
  'ai-loop-report.schema.json',
  'ai-build-loop.md',
  'ai-loop-skill.md',
  'examples/pcf-loop.yml',
];
for (const rel of docsToShip) {
  const src = path.join(harnessRoot, 'docs', rel);
  if (!fs.existsSync(src)) continue;
  const dest = path.join(stagingDir, 'docs', rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

// 7. Make the CLI entry executable on Unix (chmod +x)
const cliPath = path.join(stagingDir, 'bin', 'pcfworkbench.js');
if (fs.existsSync(cliPath)) {
  try { fs.chmodSync(cliPath, 0o755); } catch { /* Windows */ }
}

console.log('\n[publish] Staging ready at:', stagingDir);
console.log('[publish] Next:');
console.log('  cd publish-staging && npm pack --dry-run    # inspect file list');
console.log('  cd publish-staging && npm publish            # actual publish (latest)');
console.log('  cd publish-staging && npm publish --tag beta # publish to beta channel instead');

