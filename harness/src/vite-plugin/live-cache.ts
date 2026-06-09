/**
 * M2.P7 — On-disk response cache for the live Dataverse proxy.
 *
 * Goal: make second-and-subsequent runs offline-fast. The proxy still does the
 * round-trip on a cache miss (and on writes), but for GETs we replay the
 * previously-captured response from disk and skip both the auth flow and the
 * upstream HTTPS request.
 *
 * Cache lives under `os.tmpdir()/pcf-workbench/live-cache/<orgHash>/` so it
 * survives across `npm run dev` restarts but can't leak into the repo. Each
 * entry is a single JSON file (no SQLite dep) keyed by SHA-256 of
 * `<org>|<method>|<fullPath>`. We persist body as base64 to keep binary-safe.
 *
 * Writes (POST/PATCH/DELETE) invalidate the entity-set the URL targets —
 * e.g. PATCH `/api/data/v9.2/accounts(<guid>)` clears every cached GET whose
 * path starts with `/api/data/v9.2/accounts`. Conservative but correct.
 *
 * Env knobs (read at module init):
 * - `PCF_LIVE_CACHE`            'off' disables the cache entirely. Default on.
 * - `PCF_LIVE_CACHE_TTL_SECONDS' 0 (default) = no expiry; positive integer =
 *                                 entries older than N seconds are treated as
 *                                 misses (and lazily deleted on read).
 *
 * Per-request override: clients can send `x-pcf-cache: bypass` to force a
 * live refresh, or `x-pcf-cache: only` to fail with 504 if no cache entry.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type CacheStatus = 'hit' | 'miss' | 'stale' | 'bypass' | 'disabled' | 'write-invalidate' | 'store';
export type CacheDirective = 'normal' | 'bypass' | 'only';

export interface CacheEntry {
  status: number;
  headers: Record<string, string>;
  body: string;       // base64
  savedAt: number;    // epoch ms
  key: {
    org: string;
    method: string;
    path: string;
  };
}

export interface CacheStats {
  enabled: boolean;
  ttlSeconds: number;
  hits: number;
  misses: number;
  stores: number;
  invalidations: number;
  bypasses: number;
  staleEvictions: number;
  entries: number;
  sizeBytes: number;
  rootDir: string;
}

/* -------------------------------------------------------------------------- */
/* Module state                                                               */
/* -------------------------------------------------------------------------- */

const ENABLED = (process.env.PCF_LIVE_CACHE ?? 'on').toLowerCase() !== 'off';
const TTL_SECONDS = (() => {
  const raw = process.env.PCF_LIVE_CACHE_TTL_SECONDS;
  if (!raw) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
})();

const ROOT = path.join(os.tmpdir(), 'pcf-workbench', 'live-cache');

const counters = {
  hits: 0,
  misses: 0,
  stores: 0,
  invalidations: 0,
  bypasses: 0,
  staleEvictions: 0,
};

/* -------------------------------------------------------------------------- */
/* Key + path helpers                                                         */
/* -------------------------------------------------------------------------- */

function hash(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function orgDir(orgUrl: string): string {
  return path.join(ROOT, hash(orgUrl).slice(0, 16));
}

function entryFile(orgUrl: string, method: string, fullPath: string): string {
  const key = `${orgUrl}|${method.toUpperCase()}|${fullPath}`;
  return path.join(orgDir(orgUrl), `${hash(key)}.json`);
}

function ensureDir(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore — write will surface the real error
  }
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

export function isEnabled(): boolean {
  return ENABLED;
}

/** Parse the `x-pcf-cache` request header into a directive. */
export function parseCacheDirective(value: string | string[] | undefined): CacheDirective {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return 'normal';
  const v = raw.toLowerCase().trim();
  if (v === 'bypass' || v === 'no-cache' || v === 'reload') return 'bypass';
  if (v === 'only' || v === 'only-if-cached') return 'only';
  return 'normal';
}

/** Look up a cached entry. Returns null on disabled / miss / stale-and-evicted. */
export function getCached(orgUrl: string, method: string, fullPath: string): CacheEntry | null {
  if (!ENABLED) return null;
  if (method.toUpperCase() !== 'GET') return null;
  const file = entryFile(orgUrl, method, fullPath);
  if (!fs.existsSync(file)) {
    counters.misses++;
    return null;
  }
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const entry = JSON.parse(raw) as CacheEntry;
    if (TTL_SECONDS > 0) {
      const ageSec = (Date.now() - entry.savedAt) / 1000;
      if (ageSec > TTL_SECONDS) {
        counters.staleEvictions++;
        try { fs.unlinkSync(file); } catch { /* ignore */ }
        return null;
      }
    }
    counters.hits++;
    return entry;
  } catch {
    counters.misses++;
    return null;
  }
}

/** Store a successful GET response. Non-2xx responses are not cached. */
export function putCached(
  orgUrl: string,
  method: string,
  fullPath: string,
  status: number,
  headers: Record<string, string>,
  body: Buffer,
): void {
  if (!ENABLED) return;
  if (method.toUpperCase() !== 'GET') return;
  if (status < 200 || status >= 300) return;
  const file = entryFile(orgUrl, method, fullPath);
  ensureDir(path.dirname(file));
  const entry: CacheEntry = {
    status,
    headers,
    body: body.toString('base64'),
    savedAt: Date.now(),
    key: { org: orgUrl, method: method.toUpperCase(), path: fullPath },
  };
  try {
    fs.writeFileSync(file, JSON.stringify(entry), 'utf8');
    counters.stores++;
  } catch {
    // best-effort; cache misses are tolerable
  }
}

/** Extract the entity-set name from a Web API path, e.g.
 *  `/api/data/v9.2/accounts(<guid>)?$select=name` -> `accounts`.
 *  Returns null when the path doesn't look like an entity-set URL. */
export function extractEntitySet(fullPath: string): string | null {
  const m = /\/api\/data\/v[0-9.]+\/([A-Za-z_][A-Za-z0-9_]*)/.exec(fullPath);
  return m ? m[1] : null;
}

/** Invalidate every cached GET for an entity-set in the given org. Returns
 *  the number of entries removed. */
export function invalidateEntitySet(orgUrl: string, entitySet: string): number {
  if (!ENABLED) return 0;
  const dir = orgDir(orgUrl);
  if (!fs.existsSync(dir)) return 0;
  const prefix = `/api/data/`;
  let removed = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const full = path.join(dir, f);
    try {
      const entry = JSON.parse(fs.readFileSync(full, 'utf8')) as CacheEntry;
      const p = entry.key?.path ?? '';
      if (p.startsWith(prefix) && new RegExp(`\\/v[0-9.]+\\/${entitySet}(?:[\\(?]|$)`).test(p)) {
        fs.unlinkSync(full);
        removed++;
      }
    } catch {
      // Corrupt entry — remove it anyway
      try { fs.unlinkSync(full); removed++; } catch { /* ignore */ }
    }
  }
  if (removed > 0) counters.invalidations += removed;
  return removed;
}

/** Wipe the entire cache. Returns count removed. */
export function clearAll(): number {
  if (!fs.existsSync(ROOT)) return 0;
  let removed = 0;
  for (const orgFolder of fs.readdirSync(ROOT)) {
    const dir = path.join(ROOT, orgFolder);
    let isDir = false;
    try { isDir = fs.statSync(dir).isDirectory(); } catch { /* ignore */ }
    if (!isDir) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        fs.unlinkSync(path.join(dir, f));
        removed++;
      } catch { /* ignore */ }
    }
    try { fs.rmdirSync(dir); } catch { /* ignore (non-empty) */ }
  }
  return removed;
}

/** Note a per-request cache bypass for stats. */
export function noteBypass(): void {
  counters.bypasses++;
}

export function getStats(): CacheStats {
  let entries = 0;
  let sizeBytes = 0;
  if (fs.existsSync(ROOT)) {
    for (const orgFolder of fs.readdirSync(ROOT)) {
      const dir = path.join(ROOT, orgFolder);
      let isDir = false;
      try { isDir = fs.statSync(dir).isDirectory(); } catch { /* ignore */ }
      if (!isDir) continue;
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.json')) continue;
        try {
          const s = fs.statSync(path.join(dir, f));
          entries++;
          sizeBytes += s.size;
        } catch { /* ignore */ }
      }
    }
  }
  return {
    enabled: ENABLED,
    ttlSeconds: TTL_SECONDS,
    hits: counters.hits,
    misses: counters.misses,
    stores: counters.stores,
    invalidations: counters.invalidations,
    bypasses: counters.bypasses,
    staleEvictions: counters.staleEvictions,
    entries,
    sizeBytes,
    rootDir: ROOT,
  };
}

/** Test helper — resets in-memory counters. Disk state untouched. */
export function __resetCountersForTest(): void {
  counters.hits = 0;
  counters.misses = 0;
  counters.stores = 0;
  counters.invalidations = 0;
  counters.bypasses = 0;
  counters.staleEvictions = 0;
}
