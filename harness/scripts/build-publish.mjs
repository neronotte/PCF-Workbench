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

// 2. Build the harness UI (Vite)
run('npm run build');
copyDir(path.join(harnessRoot, 'dist'), path.join(stagingDir, 'dist'));

// 3. Bundle the CLI with esbuild.
//    - external: deps the user's npm install resolves at runtime.
//    - internal: src/loader/error-diagnostics + anything else under src/ used
//      by bin/ — gets bundled into a single .js to avoid shipping src/.
const pkg = JSON.parse(fs.readFileSync(path.join(harnessRoot, 'package.json'), 'utf8'));
const externalDeps = [
  ...Object.keys(pkg.dependencies ?? {}),
  // Node built-ins are always external; esbuild handles them automatically
  // when platform=node, but list explicitly for clarity:
  'node:*',
];
console.log('\n$ esbuild bin/pcf-harness.ts');
await esbuild({
  entryPoints: [path.join(harnessRoot, 'bin', 'pcf-harness.ts')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  outfile: path.join(stagingDir, 'bin', 'pcfworkbench.js'),
  external: externalDeps,
  banner: {
    // Ensure the shebang is preserved at the top of the bundled output.
    js: '#!/usr/bin/env node',
  },
  logLevel: 'info',
});

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
  files: ['bin/', 'dist/', 'docs/', 'README.md', 'LICENSE'],
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
console.log('  cd publish-staging && npm publish --tag beta # actual publish (M3)');

