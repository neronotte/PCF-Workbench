import type { Plugin, ViteDevServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { parseManifest } from '../parser/manifest-parser';
import { parseResx } from '../parser/resx-parser';
import { scanWorkspace } from '../scanner/workspace-scanner';
import type { ManifestConfig } from '../types/manifest';
import {
  extractDeployedControl,
  listCachedExtracts,
  deleteCachedExtract,
  ExtractError,
  safeName as extractSafeName,
} from './extract-control';
import { getSessionSecret } from './dataverse-security';
import crypto from 'node:crypto';

const VIRTUAL_ID = 'virtual:pcf-manifest';
const RESOLVED_ID = '\0' + VIRTUAL_ID;

interface PcfPluginState {
  manifest: ManifestConfig | null;
  controlDir: string;
  projectRoot: string;
  outDir: string;
  cssFiles: string[];
  hasDataJson: boolean;
  /** RESX strings bucketed by LCID. 1033 is default; 0 holds strings from
   *  RESX files whose filename has no recognizable LCID. */
  resxStrings: Record<number, Record<string, string>>;
  isGalleryMode: boolean;
  workspaceRoot: string;
  /** True when the server was started in gallery mode (no PCF_CONTROL_PATH) */
  launchedAsGallery: boolean;
}

function resolveOutDir(controlDir: string, manifest: ManifestConfig): string {
  // Walk up from control dir to find the project root (where out/ lives)
  // Control dir is e.g. BookingStatusTransitionControl/BookingStatusTransitionControl/
  // out/ is at BookingStatusTransitionControl/out/controls/BookingStatusTransitionControl/
  let projectRoot = controlDir;
  // Check if out/ exists at this level, otherwise go up
  for (let i = 0; i < 4; i++) {
    const outPath = path.join(projectRoot, 'out', 'controls');
    if (fs.existsSync(outPath)) {
      // Find the subdirectory containing bundle.js
      const entries = fs.readdirSync(outPath);
      for (const entry of entries) {
        const bundlePath = path.join(outPath, entry, 'bundle.js');
        if (fs.existsSync(bundlePath)) {
          return path.join(outPath, entry);
        }
      }
    }
    projectRoot = path.dirname(projectRoot);
  }
  throw new Error(
    `Could not find compiled bundle. Run 'npm run build' in the PCF project first.\n` +
    `Searched from: ${controlDir}`
  );
}

/** Pinned defaults when the bundle references a Fluent major that the manifest
 *  doesn't declare a version for. Keep these on stable, widely-deployed lines —
 *  Fluent v8 LTS-ish and the v9 release series UCI shipped during M9 testing. */
const FLUENT_DEFAULT_VERSION: Record<'v8' | 'v9', string> = {
  v8: '8.121.1',
  v9: '9.46.0',
};

/**
 * Scan the compiled bundle for `FluentUIReactv<digits>` global references and
 * return the set of Fluent majors needed (with a chosen npm version per major).
 *
 * Why this is necessary (M9 finding): a deployed bundle's manifest is not a
 * reliable source of truth for which Fluent versions it actually imports.
 * Production controls routinely use v8 utilities (color, styling) alongside
 * v9 components in the same bundle while the manifest declares only one.
 *
 * Version selection rule per major:
 *   1. If the manifest's Fluent platform-library entry matches this major, use
 *      that version (best fidelity to what the control was built against).
 *   2. Otherwise use FLUENT_DEFAULT_VERSION[major].
 *
 * Returns undefined if the bundle references no Fluent globals at all.
 */
function detectFluentNeeds(
  outDir: string,
  manifest: ManifestConfig,
): { v8?: string; v9?: string } | undefined {
  const bundlePath = path.join(outDir, 'bundle.js');
  if (!fs.existsSync(bundlePath)) return undefined;
  let source: string;
  try {
    source = fs.readFileSync(bundlePath, 'utf-8');
  } catch {
    return undefined;
  }

  const matches = source.matchAll(/FluentUIReactv(\d+)/g);
  const majors = new Set<'v8' | 'v9'>();
  for (const m of matches) {
    const lead = m[1][0];
    if (lead === '8') majors.add('v8');
    else if (lead === '9') majors.add('v9');
  }
  if (majors.size === 0) return undefined;

  const declaredFluent = manifest.resources.platformLibraries.find(l => l.name === 'Fluent');
  const declaredMajor: 'v8' | 'v9' | null = declaredFluent
    ? declaredFluent.version.split('.')[0] === '9' ? 'v9' : 'v8'
    : null;

  const out: { v8?: string; v9?: string } = {};
  for (const m of majors) {
    out[m] = (declaredMajor === m && declaredFluent)
      ? declaredFluent.version
      : FLUENT_DEFAULT_VERSION[m];
  }
  console.log(
    `[pcf-workbench] Fluent needs (from bundle scan): ${Object.entries(out).map(([k, v]) => `${k}@${v}`).join(', ')}`
  );
  return out;
}

function loadControl(state: PcfPluginState): void {
  if (!state.controlDir) return;

  const manifestPath = path.join(state.controlDir, 'ControlManifest.Input.xml');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`ControlManifest.Input.xml not found at: ${manifestPath}`);
  }
  const xmlContent = fs.readFileSync(manifestPath, 'utf-8');
  state.manifest = parseManifest(xmlContent);

  state.outDir = resolveOutDir(state.controlDir, state.manifest);

  // Resolve project root
  state.projectRoot = state.controlDir;
  let searchDir = state.controlDir;
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(searchDir, 'out'))) {
      state.projectRoot = searchDir;
      break;
    }
    searchDir = path.dirname(searchDir);
  }

  // Check for data.json
  state.hasDataJson = [
    path.join(state.controlDir, 'data.json'),
    path.join(state.projectRoot, 'data.json'),
  ].some(p => fs.existsSync(p));

  // CSS files
  state.cssFiles = state.manifest.resources.css.map(c => c.path);

  // M9 — detect Fluent majors actually referenced by the compiled bundle.
  // Deployed controls routinely mix Fluent v8 and v9: the manifest may declare
  // only one but the bundle imports both (e.g. v8 color utils + v9 UI). Without
  // this scan, the loader can only load one major, which leaves the other major's
  // globals undefined → cryptic runtime crashes (e.g. "undefined.gap" when v8 is
  // aliased over v9 calls to shorthands.gap).
  state.manifest.resources.fluentNeeds = detectFluentNeeds(state.outDir, state.manifest);

  // RESX — bucketed by LCID parsed from filename like `name.1033.resx`.
  // Files without a 4-digit LCID stem fall into bucket 0 (treated as default).
  state.resxStrings = {};
  function scanResxRecursive(dir: string) {
    if (!fs.existsSync(dir)) return;
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name !== 'node_modules') {
          scanResxRecursive(path.join(dir, entry.name));
        } else if (entry.isFile() && entry.name.endsWith('.resx')) {
          const m = entry.name.match(/\.(\d{4})\.resx$/);
          const lcid = m ? Number(m[1]) : 0;
          const parsed = parseResx(fs.readFileSync(path.join(dir, entry.name), 'utf-8'));
          if (!state.resxStrings[lcid]) state.resxStrings[lcid] = {};
          Object.assign(state.resxStrings[lcid], parsed);
        }
      }
    } catch { /* skip unreadable dirs */ }
  }
  scanResxRecursive(state.controlDir);
  if (state.outDir !== state.controlDir) scanResxRecursive(state.outDir);

  state.isGalleryMode = false;

  console.log(`[pcf-workbench] Loaded: ${state.manifest.namespace}.${state.manifest.constructor} v${state.manifest.version}`);
  console.log(`[pcf-workbench] Type: ${state.manifest.controlType}`);
  console.log(`[pcf-workbench] Bundle: ${state.outDir}/bundle.js`);
  console.log(`[pcf-workbench] Project root: ${state.projectRoot}`);
  console.log(`[pcf-workbench] Properties: ${state.manifest.properties.map(p => p.name).join(', ')}`);
  console.log(`[pcf-workbench] data.json: ${state.hasDataJson ? 'found' : 'not found'}`);
  const lcidBuckets = Object.keys(state.resxStrings).map(Number);
  const totalResx = lcidBuckets.reduce((n, l) => n + Object.keys(state.resxStrings[l]).length, 0);
  if (totalResx > 0) {
    console.log(`[pcf-workbench] RESX: ${totalResx} strings across ${lcidBuckets.length} locale${lcidBuckets.length === 1 ? '' : 's'} [${lcidBuckets.sort((a, b) => a - b).join(', ')}]`);
  }
}

export function pcfPlugin(): Plugin {
  const state: PcfPluginState = {
    manifest: null,
    controlDir: '',
    projectRoot: '',
    outDir: '',
    cssFiles: [],
    hasDataJson: false,
    resxStrings: {},
    isGalleryMode: false,
    workspaceRoot: '',
    launchedAsGallery: false,
  };

  let serverRef: ViteDevServer | null = null;

  return {
    name: 'pcf-harness',

    config() {
      const controlPath = process.env.PCF_CONTROL_PATH;
      const explicitRoot = process.env.PCF_WORKSPACE_ROOT;

      if (explicitRoot) {
        state.workspaceRoot = path.resolve(explicitRoot);
      } else if (controlPath) {
        // Derive workspace root from the control path — walk up until we
        // find a parent that isn't the control itself (heuristic: go up
        // past nested ControlName/ControlName/ structure to the gallery root).
        let candidate = path.resolve(controlPath);
        for (let i = 0; i < 5; i++) {
          const parent = path.dirname(candidate);
          if (parent === candidate) break;
          candidate = parent;
          // Stop if this directory contains multiple child dirs with manifests
          try {
            const children = fs.readdirSync(candidate, { withFileTypes: true })
              .filter(e => e.isDirectory() && !['node_modules', 'out', '.git', '.vs'].includes(e.name));
            let manifestCount = 0;
            for (const child of children) {
              const childPath = path.join(candidate, child.name);
              try {
                const walk = (dir: string, depth: number): boolean => {
                  if (depth > 3) return false;
                  const entries = fs.readdirSync(dir, { withFileTypes: true });
                  for (const e of entries) {
                    if (e.isFile() && e.name === 'ControlManifest.Input.xml') return true;
                    if (e.isDirectory() && !['node_modules', 'out', '.git'].includes(e.name)) {
                      if (walk(path.join(dir, e.name), depth + 1)) return true;
                    }
                  }
                  return false;
                };
                if (walk(childPath, 0)) manifestCount++;
              } catch { /* skip */ }
              if (manifestCount >= 2) break;
            }
            if (manifestCount >= 2) {
              state.workspaceRoot = candidate;
              break;
            }
          } catch { /* skip */ }
        }
        if (!state.workspaceRoot) {
          // Fallback: use the grandparent of the control path
          state.workspaceRoot = path.resolve(controlPath, '..', '..');
        }
      } else {
        state.workspaceRoot = path.resolve(process.cwd(), '..');
      }

      if (!controlPath) {
        // Gallery mode — no specific control, show the catalog
        state.isGalleryMode = true;
        state.launchedAsGallery = true;
        console.log('[pcf-workbench] Gallery mode — scanning workspace for controls');
        console.log(`[pcf-workbench] Workspace root: ${state.workspaceRoot}`);
        return;
      }
      state.controlDir = path.resolve(controlPath);
      console.log(`[pcf-workbench] Single-control mode — gallery root: ${state.workspaceRoot}`);
    },

    buildStart() {
      if (!state.controlDir) return;
      loadControl(state);
    },

    resolveId(id: string) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },

    transformIndexHtml() {
      if (!state.manifest) return [];
      const libs = state.manifest.resources.platformLibraries;
      const tags: Array<{ tag: string; attrs: Record<string, string>; injectTo: 'head-prepend' }> = [];

      // Inject React UMD scripts BEFORE everything else so globals exist
      // when the PCF bundle loads
      let reactLib = libs.find(l => l.name === 'React');

      // M9 / extracted controls: deployed manifests often only declare Fluent,
      // but the bundle still references the React global because pcf-scripts
      // externalizes React in production builds. UCI provides React implicitly.
      // If Fluent is declared without React, infer React 16 (Fluent v9 baseline).
      if (!reactLib && libs.some(l => l.name === 'Fluent')) {
        reactLib = { name: 'React', version: '16.14.0' };
      }

      if (reactLib) {
        const major = reactLib.version.split('.')[0];
        if (major === '16') {
          tags.push(
            { tag: 'script', attrs: { src: 'https://unpkg.com/react@16.14.0/umd/react.development.js' }, injectTo: 'head-prepend' },
            { tag: 'script', attrs: { src: 'https://unpkg.com/react-dom@16.14.0/umd/react-dom.development.js' }, injectTo: 'head-prepend' },
          );
        } else if (major === '18') {
          tags.push(
            { tag: 'script', attrs: { src: 'https://unpkg.com/react@18.3.1/umd/react.development.js' }, injectTo: 'head-prepend' },
            { tag: 'script', attrs: { src: 'https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js' }, injectTo: 'head-prepend' },
          );
        }
      }
      return tags;
    },


    load(id: string) {
      if (id === RESOLVED_ID) {
        return `export const manifest = ${JSON.stringify(state.manifest)};
export const bundlePath = "/pcf-bundle/bundle.js";
export const cssFiles = ${JSON.stringify(state.cssFiles.map(f => '/pcf-css/' + f))};
export const hasDataJson = ${state.hasDataJson};
export const resxStrings = ${JSON.stringify(state.resxStrings)};
export const isGalleryMode = ${state.isGalleryMode};
export const controlDir = ${JSON.stringify(state.controlDir)};
export const launchedAsGallery = ${state.launchedAsGallery};`;
      }
    },

    configureServer(server: ViteDevServer) {
      serverRef = server;

      // API: switch to a control or back to gallery
      server.middlewares.use('/api/switch-control', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = '';
        req.on('data', (chunk: string) => body += chunk);
        req.on('end', () => {
          try {
            const { controlDir } = JSON.parse(body);

            if (!controlDir) {
              console.log(`[pcf-workbench] Switching to gallery mode`);
              state.controlDir = '';
              state.manifest = null;
              state.outDir = '';
              state.cssFiles = [];
              state.resxStrings = {};
              state.hasDataJson = false;
              state.isGalleryMode = true;
            } else {
              console.log(`[pcf-workbench] Switching to: ${controlDir}`);
              state.controlDir = path.resolve(controlDir);
              loadControl(state);
            }

            // Invalidate ALL modules in the graph to force fresh virtual module
            server.moduleGraph.invalidateAll();

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));

            // Send full reload after response is sent
            setTimeout(() => {
              server.ws.send({ type: 'full-reload', path: '*' });
            }, 100);
          } catch (err: any) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      });

      /* -------------------------------------------------------------------- */
      /* M9.P2 chunk 3 — extracted-controls API (Gallery "Deployed" tab)      */
      /* -------------------------------------------------------------------- */
      // Gated by the per-session `x-pcf-session` secret (same as the dv proxy).
      // Cache locations:
      //   1. harness/.pcf-extracted/   — default, set by the CLI + the
      //      in-process extractor (gitignored).
      //   2. samples/_extracted/       — legacy location from M9.P1; still
      //      readable so existing extracts survive the move.
      const harnessRootForExtracts = process.cwd();
      const extractCacheBases = [
        path.join(harnessRootForExtracts, '.pcf-extracted'),
        path.resolve(harnessRootForExtracts, '..', 'samples', '_extracted'),
      ];
      const defaultExtractCacheBase = extractCacheBases[0];

      function checkExtractedSession(req: any, res: any): boolean {
        const presented = req.headers['x-pcf-session'];
        const expected = getSessionSecret();
        if (typeof presented !== 'string') {
          res.statusCode = 403;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'forbidden', message: 'Missing or invalid x-pcf-session header.' }));
          return false;
        }
        const a = Buffer.from(presented, 'utf8');
        const b = Buffer.from(expected, 'utf8');
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
          res.statusCode = 403;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'forbidden', message: 'Missing or invalid x-pcf-session header.' }));
          return false;
        }
        return true;
      }

      server.middlewares.use('/api/extracted', (req, res, next) => {
        if (!req.url) return next();
        const urlPath = req.url.split('?')[0];
        const method = req.method ?? 'GET';

        if (!checkExtractedSession(req, res)) return;

        // GET /api/extracted/list
        if (method === 'GET' && (urlPath === '/list' || urlPath === '/' || urlPath === '')) {
          try {
            const extracts = listCachedExtracts(extractCacheBases);
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            res.end(JSON.stringify({ defaultCacheBase: defaultExtractCacheBase, extracts }));
          } catch (err: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: 'list-failed', message: err.message }));
          }
          return;
        }

        // POST /api/extracted/extract  body: { orgUrl, controlName, outBase? }
        if (method === 'POST' && urlPath === '/extract') {
          let body = '';
          req.on('data', (c: string) => body += c);
          req.on('end', () => {
            (async () => {
              try {
                const parsed = JSON.parse(body || '{}') as { orgUrl?: string; controlName?: string; outBase?: string };
                const { orgUrl, controlName } = parsed;
                if (!orgUrl || !controlName) {
                  res.statusCode = 400;
                  res.setHeader('Content-Type', 'application/json; charset=utf-8');
                  res.end(JSON.stringify({ error: 'bad-request', message: 'orgUrl and controlName are required.' }));
                  return;
                }
                // Force the cache to one of the recognized bases so we never
                // accidentally write somewhere arbitrary based on client input.
                const requestedBase = parsed.outBase ? path.resolve(parsed.outBase) : defaultExtractCacheBase;
                const allowedBase = extractCacheBases.find(
                  (b) => path.resolve(b) === requestedBase,
                ) ?? defaultExtractCacheBase;

                console.log(`[pcf-workbench] Extracting "${controlName}" from ${orgUrl} -> ${allowedBase}`);
                const result = await extractDeployedControl({
                  orgUrl,
                  controlName,
                  outBase: allowedBase,
                });
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.setHeader('Cache-Control', 'no-store');
                res.end(JSON.stringify({
                  controlDir: result.controlDir,
                  projectRoot: result.projectRoot,
                  meta: result.meta,
                }));
              } catch (err: any) {
                if (err instanceof ExtractError) {
                  res.statusCode = 400;
                  res.setHeader('Content-Type', 'application/json; charset=utf-8');
                  res.end(JSON.stringify({ error: err.code, message: err.message }));
                } else {
                  res.statusCode = 500;
                  res.setHeader('Content-Type', 'application/json; charset=utf-8');
                  res.end(JSON.stringify({ error: 'extract-failed', message: err?.message ?? String(err) }));
                }
              }
            })();
          });
          return;
        }

        // POST /api/extracted/delete  body: { safe, cacheBase? }
        if (method === 'POST' && urlPath === '/delete') {
          let body = '';
          req.on('data', (c: string) => body += c);
          req.on('end', () => {
            try {
              const parsed = JSON.parse(body || '{}') as { safe?: string; cacheBase?: string };
              const { safe } = parsed;
              if (!safe || safe !== extractSafeName(safe)) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ error: 'bad-request', message: 'safe must be a sanitized folder name.' }));
                return;
              }
              const requestedBase = parsed.cacheBase ? path.resolve(parsed.cacheBase) : defaultExtractCacheBase;
              const allowedBase = extractCacheBases.find(
                (b) => path.resolve(b) === requestedBase,
              );
              if (!allowedBase) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ error: 'bad-request', message: 'cacheBase is not a recognized extract cache.' }));
                return;
              }
              deleteCachedExtract(allowedBase, safe);
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ ok: true }));
            } catch (err: any) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ error: 'delete-failed', message: err?.message ?? String(err) }));
            }
          });
          return;
        }

        next();
      });

      // Watch bundle.js for changes and notify client for hot reload
      if (state.outDir) {
        try {
          let debounceTimer: ReturnType<typeof setTimeout> | null = null;
          fs.watch(state.outDir, { recursive: false }, (_eventType, filename) => {
            if (filename === 'bundle.js' || filename === 'ControlManifest.xml') {
              if (debounceTimer) clearTimeout(debounceTimer);
              debounceTimer = setTimeout(() => {
                console.log(`[pcf-workbench] Bundle changed — sending reload signal`);
                server.ws.send({
                  type: 'custom',
                  event: 'pcf-bundle-changed',
                  data: { timestamp: Date.now() },
                });
              }, 500);
            }
          });
          console.log(`[pcf-workbench] Watching for bundle changes: ${state.outDir}`);
        } catch {
          console.warn(`[pcf-workbench] Could not watch bundle directory (hot reload disabled)`);
        }
      }

      // Serve bundle.js and other files from the PCF out directory
      server.middlewares.use('/pcf-bundle', (req, res, next) => {
        if (!state.outDir || !req.url) return next();
        // Strip query string before resolving file path
        const urlPath = req.url.split('?')[0];
        const filePath = path.join(state.outDir, urlPath);
        if (fs.existsSync(filePath)) {
          const ext = path.extname(filePath);
          const mimeTypes: Record<string, string> = {
            '.js': 'application/javascript',
            '.css': 'text/css',
            '.json': 'application/json',
            '.xml': 'application/xml',
            '.svg': 'image/svg+xml',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.otf': 'font/otf',
            '.ttf': 'font/ttf',
            '.woff': 'font/woff',
            '.woff2': 'font/woff2',
          };
          res.setHeader('Content-Type', mimeTypes[ext] ?? 'application/octet-stream');
          res.setHeader('Cache-Control', 'no-cache');
          fs.createReadStream(filePath).pipe(res);
        } else {
          next();
        }
      });

      // List all resource files in the bundle output (images, fonts, etc.)
      server.middlewares.use('/api/bundle-resources', (req, res) => {
        if (!state.outDir) {
          res.setHeader('Content-Type', 'application/json');
          res.end('[]');
          return;
        }
        const resourceExtsForList = new Set(['.svg', '.png', '.jpg', '.jpeg', '.gif', '.otf', '.ttf', '.woff', '.woff2', '.resx']);
        const files: string[] = [];
        function walk(dir: string) {
          try {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              if (entry.isDirectory()) {
                walk(path.join(dir, entry.name));
              } else if (resourceExtsForList.has(path.extname(entry.name).toLowerCase())) {
                // Return filename only (getResource uses just the filename)
                files.push(entry.name);
              }
            }
          } catch { /* skip */ }
        }
        walk(state.outDir);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify([...new Set(files)]));
      });

      // Fallback: serve control resources (images, fonts) from outDir for relative path references
      // This handles <img src="images/WorkOrder.svg"> in compiled bundles
      const resourceExts = new Set(['.svg', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.otf', '.ttf', '.woff', '.woff2', '.eot']);
      server.middlewares.use((req, res, next) => {
        if (!state.outDir || !req.url) return next();
        const urlPath = req.url.split('?')[0];
        const ext = path.extname(urlPath).toLowerCase();
        if (!resourceExts.has(ext)) return next();
        const filePath = path.join(state.outDir, urlPath);
        if (fs.existsSync(filePath)) {
          const mimeMap: Record<string, string> = {
            '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon',
            '.otf': 'font/otf', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2',
          };
          res.setHeader('Content-Type', mimeMap[ext] ?? 'application/octet-stream');
          res.setHeader('Cache-Control', 'no-cache');
          fs.createReadStream(filePath).pipe(res);
          return;
        }
        next();
      });

      // Serve data.json from control dir or project root
      server.middlewares.use('/pcf-data', (req, res, next) => {
        if (!req.url) return next();
        const urlPath = req.url.split('?')[0];
        if (urlPath === '/data.json' || urlPath === '/') {
          // Search control dir first, then project root
          const candidates = [
            path.join(state.controlDir, 'data.json'),
            path.join(state.projectRoot, 'data.json'),
          ];
          for (const filePath of candidates) {
            if (fs.existsSync(filePath)) {
              res.setHeader('Content-Type', 'application/json');
              res.setHeader('Cache-Control', 'no-cache');
              fs.createReadStream(filePath).pipe(res);
              return;
            }
          }
        }
        // Serve entity metadata (display names and types)
        // Supports: metadata.json (simple or Dataverse API format)
        //           EntityDefinitions_*.json (raw Dataverse API exports)
        if (urlPath === '/metadata.json') {
          // Collect all metadata sources
          const metaFiles: string[] = [];
          const searchDirs = [state.controlDir, state.projectRoot];
          for (const dir of searchDirs) {
            if (!dir || !fs.existsSync(dir)) continue;
            // Check for metadata.json
            const metaPath = path.join(dir, 'metadata.json');
            if (fs.existsSync(metaPath)) metaFiles.push(metaPath);
            // Check for EntityDefinitions_*.json files (raw Dataverse exports)
            try {
              for (const file of fs.readdirSync(dir)) {
                if (file.startsWith('EntityDefinitions_') && file.endsWith('.json')) {
                  metaFiles.push(path.join(dir, file));
                }
              }
            } catch { /* skip */ }
          }

          if (metaFiles.length > 0) {
            // Merge all metadata files into a single array response
            // The client-side loadMetadata() handles both formats
            const merged: any[] = [];
            for (const filePath of metaFiles) {
              try {
                const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                merged.push(content);
              } catch { /* skip invalid files */ }
            }
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-cache');
            res.end(JSON.stringify(merged));
            return;
          }

          res.setHeader('Content-Type', 'application/json');
          res.end('[]');
          return;
        }

        // Serve execute-mocks.json (mock responses for Xrm.WebApi.execute / context.webAPI.execute)
        if (urlPath === '/execute-mocks.json') {
          const candidates = [
            path.join(state.controlDir, 'execute-mocks.json'),
            path.join(state.projectRoot, 'execute-mocks.json'),
          ];
          for (const filePath of candidates) {
            if (fs.existsSync(filePath)) {
              res.setHeader('Content-Type', 'application/json');
              res.setHeader('Cache-Control', 'no-cache');
              fs.createReadStream(filePath).pipe(res);
              return;
            }
          }
          res.setHeader('Content-Type', 'application/json');
          res.end('{}');
          return;
        }

        // Serve test-scenarios.json
        if (urlPath === '/test-scenarios.json') {
          const scenarioCandidates = [
            path.join(state.controlDir, 'test-scenarios.json'),
            path.join(state.projectRoot, 'test-scenarios.json'),
          ];
          for (const filePath of scenarioCandidates) {
            if (fs.existsSync(filePath)) {
              res.setHeader('Content-Type', 'application/json');
              res.setHeader('Cache-Control', 'no-cache');
              fs.createReadStream(filePath).pipe(res);
              return;
            }
          }
        }

        // Return empty data if no file found
        res.setHeader('Content-Type', 'application/json');
        res.end(urlPath === '/test-scenarios.json' ? '[]' : '{}');
      });

      // Serve CSS from the control source directory
      server.middlewares.use('/pcf-css', (req, res, next) => {
        if (!state.controlDir || !req.url) return next();
        const urlPath = req.url.split('?')[0];
        // Check controlDir first, then outDir (compiled controls have CSS alongside bundle)
        const candidates = [
          path.join(state.controlDir, urlPath),
          state.outDir ? path.join(state.outDir, urlPath) : '',
        ].filter(Boolean);
        for (const filePath of candidates) {
          if (fs.existsSync(filePath)) {
            res.setHeader('Content-Type', 'text/css');
            res.setHeader('Cache-Control', 'no-cache');
            fs.createReadStream(filePath).pipe(res);
            return;
          }
        }
        next();
      });

      // Workspace root API — get or change the gallery scan root
      server.middlewares.use('/api/workspace-root', (req, res) => {
        if (req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ root: state.workspaceRoot }));
          return;
        }
        if (req.method === 'POST') {
          let body = '';
          req.on('data', (chunk: string) => body += chunk);
          req.on('end', () => {
            try {
              const { root } = JSON.parse(body);
              const resolved = path.resolve(root);
              if (!fs.existsSync(resolved)) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: `Directory not found: ${resolved}` }));
                return;
              }
              state.workspaceRoot = resolved;
              console.log(`[pcf-workbench] Workspace root changed to: ${resolved}`);
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true, root: resolved }));
            } catch (err: any) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: err.message }));
            }
          });
          return;
        }
        res.statusCode = 405;
        res.end();
      });

      // Gallery API — scan workspace for all PCF controls
      server.middlewares.use('/api/gallery', (req, res, next) => {
        if (!req.url) return next();
        const urlPath = req.url.split('?')[0];

        if (urlPath === '/controls' || urlPath === '/') {
          try {
            const controls = scanWorkspace(state.workspaceRoot);
            // Strip absolute paths for security, send relative + metadata
            const entries = controls.map(c => ({
              namespace: c.manifest.namespace,
              constructor: c.manifest.constructor,
              version: c.manifest.version,
              controlType: c.manifest.controlType,
              displayNameKey: c.manifest.displayNameKey,
              descriptionKey: c.manifest.descriptionKey,
              properties: c.manifest.properties,
              featureUsage: c.manifest.featureUsage,
              platformLibraries: c.manifest.resources.platformLibraries,
              cssCount: c.manifest.resources.css.length,
              hasBuild: c.hasBuild,
              hasDataJson: c.hasDataJson,
              hasTestScenarios: c.hasTestScenarios,
              hasThumbnail: c.hasThumbnail,
              controlDir: c.controlDir,
              lastModified: c.lastModified,
              bundleSize: c.bundleSize,
              packageSize: c.packageSize,
              isPrivate: c.isPrivate,
            }));
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(entries));
          } catch (err: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        next();
      });

      // Serve thumbnail images from control directories
      // URL: /api/thumbnail?dir=<controlDir>
      server.middlewares.use('/api/thumbnail', (req, res, next) => {
        if (!req.url) return next();
        const params = new URLSearchParams(req.url.includes('?') ? req.url.split('?')[1] : '');
        const controlDir = params.get('dir');
        if (!controlDir) { res.statusCode = 400; res.end(); return; }

        try {
          // Check for thumbnail.gif/jpg/png files (gif first for animated thumbnails)
          for (const ext of ['gif', 'jpg', 'jpeg', 'png']) {
            const thumbPath = path.join(controlDir, `thumbnail.${ext}`);
            if (fs.existsSync(thumbPath)) {
              res.setHeader('Content-Type', `image/${ext === 'jpg' ? 'jpeg' : ext}`);
              res.setHeader('Cache-Control', 'no-cache');
              fs.createReadStream(thumbPath).pipe(res);
              return;
            }
          }
          // Also check project root (parent directories)
          let searchDir = controlDir;
          for (let i = 0; i < 3; i++) {
            searchDir = path.dirname(searchDir);
            for (const ext of ['gif', 'jpg', 'jpeg', 'png']) {
              const thumbPath = path.join(searchDir, `thumbnail.${ext}`);
              if (fs.existsSync(thumbPath)) {
                res.setHeader('Content-Type', `image/${ext === 'jpg' ? 'jpeg' : ext}`);
                res.setHeader('Cache-Control', 'no-cache');
                fs.createReadStream(thumbPath).pipe(res);
                return;
              }
            }
          }
          res.statusCode = 404;
          res.end();
        } catch {
          res.statusCode = 404;
          res.end();
        }
      });
    },
  };
}
