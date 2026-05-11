/**
 * Vite middleware that serves real Fluent UI UMDs on demand for deployed/extracted
 * PCF controls. Bundles `@fluentui/react` (v8) or `@fluentui/react-components` (v9)
 * with esbuild on first request, caches the IIFE bundle to disk, and exposes the
 * library under the versioned globals deployed bundles expect (FluentUIReactv940 etc.).
 *
 * Why we bundle on demand instead of vendoring a UMD or pulling from a CDN:
 *  - Neither @fluentui/react nor @fluentui/react-components ships a UMD on npm.
 *    They publish ESM + CJS only (designed for tree-shaking).
 *  - Vendoring would commit ~7 MB of prebuilt bundles to the harness repo.
 *  - Loading from MS's UCI CDN would pin us to undocumented, hash-rotated URLs.
 *
 * On-demand npm-install + esbuild is slow on first run (10–60 s incl. install)
 * but reproducible, version-stable, and fully offline after first build.
 *
 * Cache layout: harness/.fluent-cache/<v8|v9>/<version>/
 *   - package.json   — minimal manifest pinning the requested fluent version
 *   - node_modules/  — npm-installed dep tree (gitignored)
 *   - entry.js       — generated stub that re-exports under window globals
 *   - bundle.js      — esbuild output (IIFE), what we serve
 */

import type { Connect, Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import * as esbuild from 'esbuild';

export const FLUENT_CDN_BASE = '/__pcf/fluent-cdn';

interface FluentTarget {
  major: 'v8' | 'v9';
  npmPkg: string;
  /** Globals to assign the namespace export to (window.<name> = F). The first
   *  one is the canonical name; the rest are aliases for manifest drift. */
  globals: string[];
  /** React peer that pairs with this Fluent line. Bundled into the same UMD. */
  reactVersion: string;
}

const TARGETS: Record<string, FluentTarget> = {
  v8: {
    major: 'v8',
    npmPkg: '@fluentui/react',
    globals: ['FluentUIReact', 'FluentUIReactv8290', 'FluentUIReactv81211'],
    reactVersion: '17.0.2',
  },
  v9: {
    major: 'v9',
    npmPkg: '@fluentui/react-components',
    globals: ['FluentUIReactv940', 'FluentUIReactv946'],
    reactVersion: '17.0.2',
  },
};

function getCacheRoot(): string {
  // Resolve relative to the harness/ folder where Vite is invoked.
  return path.resolve(process.cwd(), '.fluent-cache');
}

async function runNpmInstall(cacheDir: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('npm', ['install', '--silent', '--no-audit', '--no-fund', '--no-progress'], {
      cwd: cacheDir,
      shell: true,
      stdio: 'inherit',
    });
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`npm install exited with code ${code}`)));
    child.on('error', reject);
  });
}

async function buildBundle(target: FluentTarget, version: string, cacheDir: string, outFile: string): Promise<void> {
  const pkgJsonPath = path.join(cacheDir, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(pkgJsonPath, JSON.stringify({
      name: `pcfwb-fluent-cache-${target.major}-${version}`,
      version: '0.0.0',
      private: true,
      dependencies: {
        [target.npmPkg]: version,
        react: target.reactVersion,
        'react-dom': target.reactVersion,
      },
    }, null, 2));
  }

  const installedMarker = path.join(cacheDir, 'node_modules', target.npmPkg, 'package.json');
  if (!fs.existsSync(installedMarker)) {
    console.log(`[pcf-workbench] fluent-cdn: installing ${target.npmPkg}@${version} (this is a one-time per-version cost)…`);
    const start = Date.now();
    await runNpmInstall(cacheDir);
    console.log(`[pcf-workbench] fluent-cdn: install done in ${((Date.now() - start) / 1000).toFixed(1)}s`);
  }

  const entryPath = path.join(cacheDir, 'entry.js');
  const aliasAssignments = target.globals.map(name => `  g.${name} = F;`).join('\n');
  fs.writeFileSync(entryPath, `import * as F from '${target.npmPkg}';
const g = (typeof window !== 'undefined') ? window : globalThis;
${aliasAssignments}
// Marker so platform-libs can detect that the real Fluent UMD loaded for this version.
g.__pcfwbFluentReal = g.__pcfwbFluentReal || {};
g.__pcfwbFluentReal['${target.major}'] = '${version}';
`);

  console.log(`[pcf-workbench] fluent-cdn: bundling ${target.npmPkg}@${version} with esbuild…`);
  const start = Date.now();
  // External-globals plugin: resolve `react` and `react-dom` (and their /jsx-runtime
  // entry points) to the host page's window.React / window.ReactDOM. This is critical
  // for Fluent components to share the SAME React instance as the PCF bundle that
  // hosts them — otherwise hooks find a null dispatcher (React error #321).
  const externalGlobalsPlugin: esbuild.Plugin = {
    name: 'external-globals',
    setup(build) {
      const externals: Record<string, string> = {
        'react': 'window.React',
        'react-dom': 'window.ReactDOM',
        'react-dom/client': 'window.ReactDOM',
      };
      const jsxRuntimeShim = `var React = window.React;
function jsx(type, props, key) {
  if (props == null) return React.createElement(type, key != null ? { key: key } : null);
  var children = props.children;
  var rest = {};
  for (var k in props) { if (k !== 'children') rest[k] = props[k]; }
  if (key != null) rest.key = key;
  return React.createElement(type, rest, children);
}
exports.jsx = jsx;
exports.jsxs = jsx;
exports.jsxDEV = jsx;
exports.Fragment = React.Fragment;`;
      const jsxFilter = /^react\/jsx-(dev-)?runtime$/;
      const externalsFilter = new RegExp('^(' + Object.keys(externals).map(k => k.replace(/[\\/]/g, '\\$&')).join('|') + ')$');
      build.onResolve({ filter: jsxFilter }, args => ({ path: args.path, namespace: 'jsx-runtime-shim' }));
      build.onLoad({ filter: /.*/, namespace: 'jsx-runtime-shim' }, () => ({
        contents: jsxRuntimeShim,
        loader: 'js',
      }));
      build.onResolve({ filter: externalsFilter }, args => ({ path: args.path, namespace: 'external-globals' }));
      build.onLoad({ filter: /.*/, namespace: 'external-globals' }, args => ({
        contents: `module.exports = ${externals[args.path]};`,
        loader: 'js',
      }));
    },
  };
  await esbuild.build({
    entryPoints: [entryPath],
    bundle: true,
    outfile: outFile,
    format: 'iife',
    target: ['es2017'],
    platform: 'browser',
    minify: true,
    absWorkingDir: cacheDir,
    nodePaths: [path.join(cacheDir, 'node_modules')],
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.js': 'jsx' },
    plugins: [externalGlobalsPlugin],
    logLevel: 'warning',
  });
  const sizeKb = (fs.statSync(outFile).size / 1024).toFixed(1);
  console.log(`[pcf-workbench] fluent-cdn: bundle ready in ${((Date.now() - start) / 1000).toFixed(1)}s (${sizeKb} KB)`);
}

export function fluentCdnMiddleware(): Connect.NextHandleFunction {
  // Dedupe parallel requests for the same bundle while a build is in flight.
  const inflight = new Map<string, Promise<void>>();

  return async (req, res, next) => {
    if (!req.url || !req.url.startsWith(FLUENT_CDN_BASE + '/')) return next();

    const rel = req.url.slice(FLUENT_CDN_BASE.length).replace(/^\/+/, '').split('?')[0];
    // Accept either /<v>/<version> or /<v>/<version>/bundle.js
    const parts = rel.split('/').filter(Boolean);
    const major = parts[0];
    const version = parts[1];
    const target = TARGETS[major];
    if (!target || !version || !/^\d+\.\d+\.\d+$/.test(version)) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'text/plain');
      res.end(`Bad fluent-cdn path. Expected ${FLUENT_CDN_BASE}/<v8|v9>/<x.y.z>(/bundle.js)?`);
      return;
    }

    const cacheDir = path.join(getCacheRoot(), target.major, version);
    const outFile = path.join(cacheDir, 'bundle.js');

    try {
      if (!fs.existsSync(outFile)) {
        let p = inflight.get(outFile);
        if (!p) {
          p = buildBundle(target, version, cacheDir, outFile)
            .finally(() => inflight.delete(outFile));
          inflight.set(outFile, p);
        }
        await p;
      }
      const buf = fs.readFileSync(outFile);
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Content-Length', String(buf.length));
      res.end(buf);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[pcf-workbench] fluent-cdn error:', err);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain');
      res.end(`fluent-cdn error: ${msg}`);
    }
  };
}

export function fluentCdnPlugin(): Plugin {
  return {
    name: 'pcf-workbench:fluent-cdn',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(fluentCdnMiddleware());
    },
  };
}
