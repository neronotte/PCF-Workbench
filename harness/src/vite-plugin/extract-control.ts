/**
 * Reusable extraction core for deployed PCF controls.
 *
 * Pulls a `customcontrol` row + its `bundle.js` webresource from a Dataverse
 * org via OData and stages it on disk as a synthetic workspace the harness
 * can load (either via PCF_CONTROL_PATH or via the gallery scanner).
 *
 * Used by:
 *   - bin/extract-control.ts            (CLI wrapper)
 *   - vite-plugin/pcf-plugin.ts         (POST /__pcf/extracted/extract)
 *
 * Auth is delegated to acquireDataverseToken (M2.P1 PAC token cache).
 */

import path from 'node:path';
import fs from 'node:fs';
import https from 'node:https';
import { URL } from 'node:url';

import { acquireDataverseToken, normalizeOrgUrl } from './dataverse-proxy';

export interface ExtractMeta {
  extractedAt: string;
  orgUrl: string;
  extractedBy: string;
  customcontrolid: string;
  deployedName: string;
  namespace: string;
  constructor: string;
  version: string;
  compatibledatatypes: string | null;
  manifestBytes: number;
  bundleBytes: number;
  bundleWebresourceName: string;
  requiredFluentMajors: Array<'v8' | 'v9'>;
  /** Per-resource extraction results for CSS/img webresources declared in the manifest. */
  resources?: Array<{ kind: 'css' | 'img'; path: string; webresourceName: string; status: 'ok' | 'missing' | 'failed'; bytes?: number; error?: string }>;
}

export interface ExtractResult {
  /** The directory the harness should be pointed at (contains
   *  ControlManifest.Input.xml). */
  controlDir: string;
  /** The parent dir containing the synthetic project layout
   *  (controlDir + out/controls/<safe>/bundle.js + .extract-meta.json). */
  projectRoot: string;
  manifestPath: string;
  bundlePath: string;
  metaPath: string;
  meta: ExtractMeta;
}

export interface ExtractOptions {
  /** Dataverse org URL (e.g. https://contoso.crm.dynamics.com). */
  orgUrl: string;
  /** Full deployed control name (e.g. MscrmControls.Slider.LinearSliderControl). */
  controlName: string;
  /** Output base directory. The control is staged at `<outBase>/<safe>/`. */
  outBase: string;
}

export class ExtractError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'control-not-found'
      | 'manifest-missing'
      | 'manifest-unparseable'
      | 'bundle-not-found'
      | 'http-error'
      | 'auth-failed',
  ) {
    super(message);
    this.name = 'ExtractError';
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

export function safeName(controlName: string): string {
  // msdyn_FieldService.TimePromised -> TimePromised
  // Falls back to a sanitized full name if no dot is present.
  const tail = controlName.includes('.') ? controlName.split('.').pop()! : controlName;
  return tail.replace(/[^A-Za-z0-9_-]/g, '_');
}

function odataGet(orgUrl: string, token: string, pathAndQuery: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = new URL(pathAndQuery, normalizeOrgUrl(orgUrl) + '/');
    const req = https.request(
      {
        method: 'GET',
        host: url.hostname,
        path: url.pathname + url.search,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'OData-MaxVersion': '4.0',
          'OData-Version': '4.0',
          Prefer: 'odata.include-annotations="*"',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if ((res.statusCode ?? 0) >= 400) {
            reject(new ExtractError(
              `HTTP ${res.statusCode} ${pathAndQuery}\n${body.slice(0, 500)}`,
              'http-error',
            ));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new ExtractError(
              `Bad JSON from ${pathAndQuery}: ${(e as Error).message}`,
              'http-error',
            ));
          }
        });
      },
    );
    req.on('error', (e) => reject(new ExtractError(`Network error: ${e.message}`, 'http-error')));
    req.end();
  });
}

function detectFluentMajors(bundleSource: string): Array<'v8' | 'v9'> {
  const found = new Set<'v8' | 'v9'>();
  for (const m of bundleSource.matchAll(/FluentUIReactv(\d+)/g)) {
    const lead = m[1][0];
    if (lead === '8') found.add('v8');
    else if (lead === '9') found.add('v9');
  }
  return [...found].sort() as Array<'v8' | 'v9'>;
}

/* -------------------------------------------------------------------------- */
/* Core                                                                       */
/* -------------------------------------------------------------------------- */

/** Extract a deployed control. Throws ExtractError on any failure mode the
 *  caller might want to surface to a user (manifest missing, bundle missing,
 *  auth failed, etc). All other errors propagate as-is. */
export async function extractDeployedControl(opts: ExtractOptions): Promise<ExtractResult> {
  const { orgUrl, controlName, outBase } = opts;

  let tokenInfo: Awaited<ReturnType<typeof acquireDataverseToken>>;
  try {
    tokenInfo = await acquireDataverseToken(orgUrl);
  } catch (e) {
    throw new ExtractError(
      `Failed to acquire token for ${orgUrl}: ${(e as Error).message}`,
      'auth-failed',
    );
  }

  const safe = safeName(controlName);
  const projectRoot = path.resolve(outBase, safe);
  const controlDir = path.join(projectRoot, safe);
  const bundleDir = path.join(projectRoot, 'out', 'controls', safe);

  const select = '$select=customcontrolid,name,manifest,clientjson,version,compatibledatatypes';
  const filter = `$filter=name eq '${encodeURIComponent(controlName).replace(/'/g, "''")}'`;
  const query = `api/data/v9.2/customcontrols?${select}&${filter}`;
  const result = await odataGet(orgUrl, tokenInfo.token, query);
  const rows: Array<{
    customcontrolid: string;
    name: string;
    manifest: string;
    clientjson: string;
    version: string;
    compatibledatatypes: string | null;
  }> = result.value ?? [];

  if (!rows.length) {
    throw new ExtractError(
      `No customcontrol row found for name="${controlName}".`,
      'control-not-found',
    );
  }
  const row = rows[0];
  if (!row.manifest) {
    throw new ExtractError(`Row for "${controlName}" is missing the manifest column.`, 'manifest-missing');
  }

  const nsMatch = row.manifest.match(/<control[^>]*\snamespace="([^"]+)"/);
  const ctorMatch = row.manifest.match(/<control[^>]*\sconstructor="([^"]+)"/);
  if (!nsMatch || !ctorMatch) {
    throw new ExtractError(
      `Could not parse namespace/constructor from manifest XML.`,
      'manifest-unparseable',
    );
  }
  const ns = nsMatch[1];
  const ctor = ctorMatch[1];
  const wrBundleName = `cc_${ns}.${ctor}/bundle.js`;

  const wrQuery = `api/data/v9.2/webresourceset?$select=name,webresourcetype,content&$filter=` +
    encodeURIComponent(`name eq '${wrBundleName}'`);
  const wrResult = await odataGet(orgUrl, tokenInfo.token, wrQuery);
  if (!wrResult.value?.length) {
    throw new ExtractError(
      `Bundle webresource not found: ${wrBundleName}. ` +
        `(This control may be a platform-only OOB control whose bundle is served from CDN, not Dataverse.)`,
      'bundle-not-found',
    );
  }
  const wr = wrResult.value[0];
  const decodedBundle = Buffer.from(wr.content, 'base64').toString('utf8');

  fs.mkdirSync(controlDir, { recursive: true });
  fs.mkdirSync(bundleDir, { recursive: true });

  const manifestPath = path.join(controlDir, 'ControlManifest.Input.xml');
  fs.writeFileSync(manifestPath, row.manifest, 'utf8');

  const bundlePath = path.join(bundleDir, 'bundle.js');
  fs.writeFileSync(bundlePath, decodedBundle, 'utf8');

  // Fetch every CSS/img resource declared in the manifest. Webresource naming
  // convention: cc_<ns>.<ctor>/<manifest-relative-path>. Tolerate missing
  // resources (some manifests reference files that aren't uploaded).
  const cssEntries = Array.from(row.manifest.matchAll(/<css\s+path="([^"]+)"/g)).map(m => ({ kind: 'css' as const, path: m[1] }));
  const imgEntries = Array.from(row.manifest.matchAll(/<img\s+path="([^"]+)"/g)).map(m => ({ kind: 'img' as const, path: m[1] }));
  const resourceResults: NonNullable<ExtractMeta['resources']> = [];
  for (const entry of [...cssEntries, ...imgEntries]) {
    const wrName = `cc_${ns}.${ctor}/${entry.path}`;
    const target = path.join(bundleDir, entry.path);
    try {
      const q = `api/data/v9.2/webresourceset?$select=name,webresourcetype,content&$filter=` +
        encodeURIComponent(`name eq '${wrName.replace(/'/g, "''")}'`);
      const r = await odataGet(orgUrl, tokenInfo.token, q);
      const hit = r.value?.[0] as { content: string; webresourcetype: number } | undefined;
      if (!hit) {
        resourceResults.push({ kind: entry.kind, path: entry.path, webresourceName: wrName, status: 'missing' });
        continue;
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const isText = hit.webresourcetype === 2 || hit.webresourcetype === 3 || hit.webresourcetype === 4;
      if (isText) {
        fs.writeFileSync(target, Buffer.from(hit.content, 'base64').toString('utf8'), 'utf8');
      } else {
        fs.writeFileSync(target, Buffer.from(hit.content, 'base64'));
      }
      resourceResults.push({ kind: entry.kind, path: entry.path, webresourceName: wrName, status: 'ok', bytes: Math.floor(hit.content.length * 3 / 4) });
    } catch (e) {
      resourceResults.push({ kind: entry.kind, path: entry.path, webresourceName: wrName, status: 'failed', error: (e as Error).message });
    }
  }

  const meta: ExtractMeta = {
    extractedAt: new Date().toISOString(),
    orgUrl,
    extractedBy: tokenInfo.account.username,
    customcontrolid: row.customcontrolid,
    deployedName: row.name,
    namespace: ns,
    constructor: ctor,
    version: row.version,
    compatibledatatypes: row.compatibledatatypes,
    manifestBytes: row.manifest.length,
    bundleBytes: decodedBundle.length,
    bundleWebresourceName: wr.name,
    requiredFluentMajors: detectFluentMajors(decodedBundle),
    resources: resourceResults,
  };
  const metaPath = path.join(projectRoot, '.extract-meta.json');
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');

  return { controlDir, projectRoot, manifestPath, bundlePath, metaPath, meta };
}

/* -------------------------------------------------------------------------- */
/* Catalog (list all customcontrol rows in an org)                            */
/* -------------------------------------------------------------------------- */

export interface DeployedControlSummary {
  customcontrolid: string;
  name: string;
  version: string | null;
  /** Parsed from the manifest XML when available — purely for display in the picker. */
  namespace: string | null;
  constructor: string | null;
}

/** List every deployed PCF control (`customcontrol` row) in the org.
 *  Used by the Deployed-tab picker so the user can search & multi-select
 *  instead of typing the fully-qualified name by hand. */
export async function listDeployedControlsCatalog(orgUrl: string): Promise<DeployedControlSummary[]> {
  let tokenInfo: Awaited<ReturnType<typeof acquireDataverseToken>>;
  try {
    tokenInfo = await acquireDataverseToken(orgUrl);
  } catch (e) {
    throw new ExtractError(
      `Failed to acquire token for ${orgUrl}: ${(e as Error).message}`,
      'auth-failed',
    );
  }

  // We pull manifest only so we can derive namespace/constructor for display.
  // customcontrol rows are typically small in count (hundreds at most) so this
  // is fine; if we ever see orgs with very large catalogs we can drop manifest.
  const select = '$select=customcontrolid,name,version,manifest';
  const query = `api/data/v9.2/customcontrols?${select}&$orderby=name`;
  const result = await odataGet(orgUrl, tokenInfo.token, query);
  const rows: Array<{
    customcontrolid: string;
    name: string;
    version: string | null;
    manifest: string | null;
  }> = result.value ?? [];

  return rows.map(r => {
    let ns: string | null = null;
    let ctor: string | null = null;
    if (r.manifest) {
      const nsMatch = r.manifest.match(/<control[^>]*\snamespace="([^"]+)"/);
      const ctorMatch = r.manifest.match(/<control[^>]*\sconstructor="([^"]+)"/);
      ns = nsMatch?.[1] ?? null;
      ctor = ctorMatch?.[1] ?? null;
    }
    return {
      customcontrolid: r.customcontrolid,
      name: r.name,
      version: r.version ?? null,
      namespace: ns,
      constructor: ctor,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Cache discovery                                                            */
/* -------------------------------------------------------------------------- */

export interface CachedExtract {
  /** safe-name folder (e.g. "TimePromised"). */
  safe: string;
  /** Absolute path to the control directory (the one with
   *  ControlManifest.Input.xml). Pass this to `/api/switch-control`. */
  controlDir: string;
  /** Absolute path to the project root (parent of controlDir). */
  projectRoot: string;
  /** Where this extract lives — e.g. "harness/.pcf-extracted" or
   *  "samples/_extracted" — useful for the UI to label the source. */
  cacheBase: string;
  meta: ExtractMeta | null;
  /** True when both manifest + bundle are present on disk. */
  isComplete: boolean;
}

/** Scan one or more cache directories for staged extracts. Each entry is a
 *  subfolder containing `.extract-meta.json` (preferred) or simply matching
 *  the `<safe>/<safe>/ControlManifest.Input.xml` layout the extractor writes. */
export function listCachedExtracts(cacheBases: string[]): CachedExtract[] {
  const out: CachedExtract[] = [];
  for (const base of cacheBases) {
    if (!fs.existsSync(base)) continue;
    let entries: string[];
    try {
      entries = fs.readdirSync(base);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const projectRoot = path.join(base, entry);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(projectRoot);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;

      const metaPath = path.join(projectRoot, '.extract-meta.json');
      let meta: ExtractMeta | null = null;
      if (fs.existsSync(metaPath)) {
        try {
          meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as ExtractMeta;
        } catch {
          meta = null;
        }
      }

      const safe = entry;
      const controlDir = path.join(projectRoot, safe);
      const manifestPath = path.join(controlDir, 'ControlManifest.Input.xml');
      const bundlePath = path.join(projectRoot, 'out', 'controls', safe, 'bundle.js');
      const isComplete = fs.existsSync(manifestPath) && fs.existsSync(bundlePath);

      // Skip directories that aren't actually extracts (no meta + no manifest).
      if (!meta && !fs.existsSync(manifestPath)) continue;

      out.push({ safe, controlDir, projectRoot, cacheBase: base, meta, isComplete });
    }
  }
  // Most recently extracted first; fallback to safe-name asc.
  out.sort((a, b) => {
    const aT = a.meta?.extractedAt ?? '';
    const bT = b.meta?.extractedAt ?? '';
    if (aT && bT) return bT.localeCompare(aT);
    if (aT) return -1;
    if (bT) return 1;
    return a.safe.localeCompare(b.safe);
  });
  return out;
}

/** Delete a cached extract. Refuses to traverse outside `cacheBase`. */
export function deleteCachedExtract(cacheBase: string, safe: string): void {
  const target = path.join(cacheBase, safe);
  const rel = path.relative(cacheBase, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Refusing to delete outside cache base: ${target}`);
  }
  if (!fs.existsSync(target)) return;
  fs.rmSync(target, { recursive: true, force: true });
}
