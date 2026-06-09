/**
 * Browser-side client for the Vite plugin's Dataverse proxy.
 *
 * Talks to `/__pcf/dv/*` (same-origin) — never directly to the org.
 * Reads the per-session secret from `<meta name="pcf-session">` injected by
 * the dataverse-security plugin; the proxy rejects requests without it.
 *
 * Adapts live OData responses (`{ value, "@odata.nextLink" }`) to the
 * existing offline shim contract (`{ entities, nextLink }`) so that the
 * rest of the harness UI keeps working unchanged regardless of dataSource.
 */

import { useHarnessStore, type PublicProfile } from '../store/harness-store';
import { loadMetadata, getEntityMetadata } from '../store/metadata-store';

const PROXY_BASE = '/__pcf/dv';

let sessionSecretCache: string | null = null;

/** Returns the per-session secret injected by dataverse-security plugin via
 *  `<meta name="pcf-session">`. Exported so other callers (cache admin panel)
 *  can attach the required `x-pcf-session` header without re-implementing the
 *  lookup. Throws if the meta tag is missing. */
export function getSessionSecret(): string {
  if (sessionSecretCache) return sessionSecretCache;
  if (typeof document === 'undefined') {
    throw new Error('dv-client: document not available (server-side render?)');
  }
  const meta = document.querySelector('meta[name="pcf-session"]');
  const value = meta?.getAttribute('content') ?? '';
  if (!value) {
    throw new Error(
      'dv-client: <meta name="pcf-session"> not found on the page. ' +
        'Is the dataverse-security plugin enabled?',
    );
  }
  sessionSecretCache = value;
  return value;
}

function buildHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    Accept: 'application/json',
    'x-pcf-session': getSessionSecret(),
    ...extra,
  };
}

export interface ProxyErrorBody {
  error: string;
  message: string;
  meta?: Record<string, unknown>;
}

export class DvProxyError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ProxyErrorBody,
  ) {
    super(`[${status}] ${body.error}: ${body.message}`);
    this.name = 'DvProxyError';
  }
}

async function parseError(res: Response): Promise<DvProxyError> {
  let body: ProxyErrorBody;
  try {
    body = (await res.json()) as ProxyErrorBody;
  } catch {
    body = { error: 'upstream-error', message: `HTTP ${res.status} ${res.statusText}` };
  }
  return new DvProxyError(res.status, body);
}

function maybeFlagReauth(err: DvProxyError, orgUrl: string): void {
  if (err.body.error === 'pac-reauth-required' || err.body.error === 'pac-profile-missing') {
    useHarnessStore.getState().setPacReauthRequired({ org: orgUrl });
  }
}

/* -------------------------------------------------------------------------- */
/* Profile listing                                                             */
/* -------------------------------------------------------------------------- */

export interface ProfileListResponse {
  profiles: PublicProfile[];
  current: string | null;
}

export async function listProfiles(): Promise<ProfileListResponse> {
  const res = await fetch(`${PROXY_BASE}/profiles`, { headers: buildHeaders() });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as ProfileListResponse;
}

/* -------------------------------------------------------------------------- */
/* Raw GET                                                                     */
/* -------------------------------------------------------------------------- */

export async function dvGet<T = unknown>(orgUrl: string, path: string, prefer?: string): Promise<T> {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${PROXY_BASE}${path}${sep}org=${encodeURIComponent(orgUrl)}`;
  const headers = buildHeaders(prefer ? { Prefer: prefer } : undefined);
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const err = await parseError(res);
    maybeFlagReauth(err, orgUrl);
    throw err;
  }
  useHarnessStore.getState().setPacReauthRequired(null);
  return (await res.json()) as T;
}

/* -------------------------------------------------------------------------- */
/* OData response adapter                                                      */
/* -------------------------------------------------------------------------- */

interface ODataValueResponse<T = Record<string, unknown>> {
  value: T[];
  '@odata.nextLink'?: string;
  '@odata.count'?: number;
}

export interface AdaptedMultiResponse {
  entities: Record<string, unknown>[];
  nextLink?: string;
  totalRecordCount?: number;
}

export function adaptMultiResponse(raw: ODataValueResponse): AdaptedMultiResponse {
  return {
    entities: raw.value ?? [],
    nextLink: raw['@odata.nextLink'],
    totalRecordCount: raw['@odata.count'],
  };
}

/* -------------------------------------------------------------------------- */
/* Entity set name resolver                                                    */
/* -------------------------------------------------------------------------- */

export interface EntityResolved {
  entitySetName: string;
  primaryNameAttribute?: string;
  primaryIdAttribute?: string;
}

const entityMetaInflight = new Map<string, Promise<EntityResolved>>();

/**
 * Resolve the OData EntitySetName + PrimaryName/PrimaryId attributes for a
 * Dataverse logical entity name. Cached in `entitySetCache` (single string-
 * shaped slot per entity for back-compat: serialised JSON if extra fields
 * are present). Falls back to `${logicalName}s` on any failure so a single
 * 401/403 doesn't poison the rest of the session.
 */
export async function resolveEntityMetadata(orgUrl: string, logicalName: string): Promise<EntityResolved> {
  const cache = useHarnessStore.getState().entitySetCache;
  const cached = cache[logicalName];
  if (cached) {
    if (cached.startsWith('{')) {
      try { return JSON.parse(cached) as EntityResolved; } catch { /* fall through */ }
    }
    return { entitySetName: cached };
  }

  const inflight = entityMetaInflight.get(logicalName);
  if (inflight) return inflight;

  const path = `/api/data/v9.2/EntityDefinitions(LogicalName='${encodeURIComponent(logicalName)}')`
    + `?$select=EntitySetName,PrimaryNameAttribute,PrimaryIdAttribute`;
  const p = (async () => {
    try {
      const r = await dvGet<{ EntitySetName?: string; PrimaryNameAttribute?: string; PrimaryIdAttribute?: string }>(orgUrl, path);
      const resolved: EntityResolved = {
        entitySetName: r.EntitySetName ?? `${logicalName}s`,
        primaryNameAttribute: r.PrimaryNameAttribute,
        primaryIdAttribute: r.PrimaryIdAttribute,
      };
      useHarnessStore.getState().setEntitySetName(logicalName, JSON.stringify(resolved));
      return resolved;
    } catch (e) {
      useHarnessStore.getState().addLogEntry({
        category: 'webAPI',
        method: 'live.resolveEntityMetadata.fallback',
        args: { logicalName, error: (e as Error).message },
      });
      const fallback: EntityResolved = { entitySetName: `${logicalName}s` };
      useHarnessStore.getState().setEntitySetName(logicalName, fallback.entitySetName);
      return fallback;
    } finally {
      entityMetaInflight.delete(logicalName);
    }
  })();
  entityMetaInflight.set(logicalName, p);
  return p;
}

export async function resolveEntitySetName(orgUrl: string, logicalName: string): Promise<string> {
  return (await resolveEntityMetadata(orgUrl, logicalName)).entitySetName;
}

/* -------------------------------------------------------------------------- */
/* High-level retrieve helpers used by the live web-api shim                   */
/* -------------------------------------------------------------------------- */

export async function liveRetrieveMultiple(
  orgUrl: string,
  logicalEntity: string,
  options: string | undefined,
  maxPageSize: number | undefined,
): Promise<AdaptedMultiResponse> {
  const setName = await resolveEntitySetName(orgUrl, logicalEntity);
  const query = options
    ? options.startsWith('?') ? options : `?${options}`
    : '';
  const path = `/api/data/v9.2/${setName}${query}`;
  const prefer = maxPageSize ? `odata.maxpagesize=${maxPageSize}` : undefined;
  const raw = await dvGet<ODataValueResponse>(orgUrl, path, prefer);
  return adaptMultiResponse(raw);
}

export async function liveRetrieveSingle(
  orgUrl: string,
  logicalEntity: string,
  id: string,
  options: string | undefined,
): Promise<Record<string, unknown>> {
  const setName = await resolveEntitySetName(orgUrl, logicalEntity);
  const normalId = id.replace(/[{}]/g, '');
  const query = options
    ? options.startsWith('?') ? options : `?${options}`
    : '';
  const path = `/api/data/v9.2/${setName}(${normalId})${query}`;
  return await dvGet<Record<string, unknown>>(orgUrl, path);
}

/**
 * Fetch the current page record from Dataverse with no $select / $expand —
 * driven by the harness page-record auto-fetch hook so bound properties
 * (resolved sync via `getEntityData`) can populate from a real org record.
 *
 * Returns the raw OData record with `@odata.*` annotations preserved so the
 * existing `resolveColumnValue` path picks up `@OData.Community.Display.V1.FormattedValue`
 * and `_<lookup>_value` shapes.
 */
export async function liveRetrievePageRecord(
  orgUrl: string,
  logicalEntity: string,
  id: string,
): Promise<{ record: Record<string, any>; primaryName: string | null }> {
  const meta = await resolveEntityMetadata(orgUrl, logicalEntity);
  // Fire attribute-metadata fetch in parallel with the record fetch — we
  // don't await it because record rendering doesn't strictly need it (display
  // names + types are progressive enhancement). Errors are logged and ignored.
  void ensureLiveAttributeMetadata(orgUrl, logicalEntity);
  const normalId = id.replace(/[{}]/g, '');
  const record = await dvGet<Record<string, any>>(orgUrl, `/api/data/v9.2/${meta.entitySetName}(${normalId})`);
  const primaryName = meta.primaryNameAttribute && record[meta.primaryNameAttribute] != null
    ? String(record[meta.primaryNameAttribute])
    : null;
  return { record, primaryName };
}

/* -------------------------------------------------------------------------- */
/* M2.P4 — Live writes (create / update / delete)                              */
/*                                                                            */
/* All three flow through the same proxy path with the appropriate verb. The  */
/* proxy adds Authorization, return=representation Prefer, and (for           */
/* update/delete) If-Match: * for unconditional writes.                        */
/* -------------------------------------------------------------------------- */

async function dvFetch<T>(
  orgUrl: string,
  path: string,
  init: { method: string; body?: string; ifMatch?: string },
): Promise<{ status: number; headers: Headers; body: T | null }> {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${PROXY_BASE}${path}${sep}org=${encodeURIComponent(orgUrl)}`;
  const extra: Record<string, string> = {};
  if (init.body !== undefined) extra['Content-Type'] = 'application/json';
  if (init.ifMatch) extra['If-Match'] = init.ifMatch;
  const res = await fetch(url, { method: init.method, headers: buildHeaders(extra), body: init.body });
  if (!res.ok) {
    const err = await parseError(res);
    maybeFlagReauth(err, orgUrl);
    throw err;
  }
  useHarnessStore.getState().setPacReauthRequired(null);
  // Empty body on 204 — Dataverse returns 204 for delete and (without
  // return=representation) for update. With return=representation update
  // returns 200 + body.
  let body: T | null = null;
  if (res.status !== 204) {
    const text = await res.text();
    if (text) {
      try { body = JSON.parse(text) as T; } catch { body = null; }
    }
  }
  return { status: res.status, headers: res.headers, body };
}

export interface LiveCreateResult {
  id: string;
  record?: Record<string, any>;
}

/**
 * Create a record in the real Dataverse org. Resolves the entity-set name
 * via metadata, POSTs the payload with `Prefer: return=representation`, and
 * extracts the new id from either the `OData-EntityId` header or the
 * returned record.
 */
export async function liveCreateRecord(
  orgUrl: string,
  logicalEntity: string,
  data: Record<string, any>,
): Promise<LiveCreateResult> {
  const setName = await resolveEntitySetName(orgUrl, logicalEntity);
  const path = `/api/data/v9.2/${setName}`;
  const { headers, body } = await dvFetch<Record<string, any>>(orgUrl, path, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  const idFromBody = body && typeof body === 'object' ? extractIdFromRecord(body, logicalEntity) : null;
  const idFromHeader = extractIdFromODataEntityId(headers.get('OData-EntityId') || headers.get('Location'));
  const id = idFromBody ?? idFromHeader ?? '';
  return { id, record: body ?? undefined };
}

export async function liveUpdateRecord(
  orgUrl: string,
  logicalEntity: string,
  id: string,
  data: Record<string, any>,
): Promise<{ record?: Record<string, any> }> {
  const setName = await resolveEntitySetName(orgUrl, logicalEntity);
  const normalId = id.replace(/[{}]/g, '');
  const path = `/api/data/v9.2/${setName}(${normalId})`;
  const { body } = await dvFetch<Record<string, any>>(orgUrl, path, {
    method: 'PATCH',
    body: JSON.stringify(data),
    ifMatch: '*',
  });
  return { record: body ?? undefined };
}

export async function liveDeleteRecord(
  orgUrl: string,
  logicalEntity: string,
  id: string,
): Promise<void> {
  const setName = await resolveEntitySetName(orgUrl, logicalEntity);
  const normalId = id.replace(/[{}]/g, '');
  const path = `/api/data/v9.2/${setName}(${normalId})`;
  await dvFetch<unknown>(orgUrl, path, { method: 'DELETE', ifMatch: '*' });
}

function extractIdFromRecord(record: Record<string, any>, logicalEntity: string): string | null {
  const candidates = [`${logicalEntity}id`, 'id'];
  for (const k of candidates) {
    if (typeof record[k] === 'string' && record[k]) return record[k];
  }
  // Fallback — first GUID-shaped field
  for (const v of Object.values(record)) {
    if (typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return v;
  }
  return null;
}

function extractIdFromODataEntityId(header: string | null): string | null {
  if (!header) return null;
  // Shape: https://<org>.crm.dynamics.com/api/data/v9.2/contacts(1c1cc1cc-1111-...)
  const m = header.match(/\(([0-9a-f-]+)\)\s*$/i);
  return m ? m[1] : null;
}

/* -------------------------------------------------------------------------- */
/* Attribute-metadata fetcher (DisplayName + AttributeType)                    */
/* -------------------------------------------------------------------------- */

const attrMetaInflight = new Map<string, Promise<void>>();
const attrMetaLoaded = new Set<string>();

/**
 * Fetch attribute metadata (LogicalName, DisplayName, AttributeType + option
 * sets for Picklist/State/Status attributes) for a Dataverse entity in live
 * mode and merge it into the metadata store. The store's
 * `parseDataverseEntity` already understands the
 * `EntityDefinitions(...)?$expand=Attributes` shape, so we just hand it the
 * raw response. Idempotent + once-per-entity per session.
 *
 * In live mode this ALWAYS overwrites any prior mock-derived entry — the
 * real org is the source of truth. In mock mode this is a no-op.
 *
 * Two parallel fetches:
 *   1. Basic attribute list (LogicalName/DisplayName/AttributeType) — fast.
 *   2. PicklistAttributeMetadata typed-cast with OptionSet expansion —
 *      slower but resolves option-set labels for choice columns. Merged on
 *      top of (1) before handing to loadMetadata.
 */
export async function ensureLiveAttributeMetadata(orgUrl: string, logicalName: string): Promise<void> {
  if (useHarnessStore.getState().dataSource !== 'live') return;
  if (attrMetaLoaded.has(logicalName)) return;
  const inflight = attrMetaInflight.get(logicalName);
  if (inflight) return inflight;

  const basePath = `/api/data/v9.2/EntityDefinitions(LogicalName='${encodeURIComponent(logicalName)}')`
    + `?$select=LogicalName,DisplayName,SchemaName,PrimaryNameAttribute,PrimaryIdAttribute`
    + `&$expand=Attributes($select=LogicalName,DisplayName,AttributeType)`;
  // Picklist/State/Status options. The typed-cast filters the Attributes
  // collection to choice-typed entries and expands their OptionSet.
  const picklistPath = `/api/data/v9.2/EntityDefinitions(LogicalName='${encodeURIComponent(logicalName)}')`
    + `/Attributes/Microsoft.Dynamics.CRM.PicklistAttributeMetadata`
    + `?$select=LogicalName,AttributeType&$expand=OptionSet($select=Options)`;

  const p = (async () => {
    try {
      const [entity, picklistRaw] = await Promise.all([
        dvGet<any>(orgUrl, basePath),
        dvGet<{ value: any[] }>(orgUrl, picklistPath).catch(() => ({ value: [] })),
      ]);
      // Merge OptionSet onto the matching attributes in `entity.Attributes`
      // so parseDataverseEntity picks them up via its existing OptionSet
      // branch. Keys are case-sensitive logical names per OData.
      if (entity?.Attributes && Array.isArray(picklistRaw.value)) {
        const byLogical = new Map<string, any>();
        for (const a of picklistRaw.value) {
          if (a?.LogicalName) byLogical.set(a.LogicalName, a);
        }
        for (const attr of entity.Attributes) {
          const pl = byLogical.get(attr?.LogicalName);
          if (pl?.OptionSet) attr.OptionSet = pl.OptionSet;
        }
      }
      loadMetadata({ [logicalName]: entity });
      attrMetaLoaded.add(logicalName);
      useHarnessStore.getState().addLogEntry({
        category: 'webAPI',
        method: 'live.attributeMetadata.ok',
        args: {
          logicalName,
          attributes: Array.isArray(entity?.Attributes) ? entity.Attributes.length : 0,
          picklists: Array.isArray(picklistRaw.value) ? picklistRaw.value.length : 0,
        },
      });
      // Bump dataVersion so any in-flight render picks up the new display
      // names, column types, and option-set labels.
      useHarnessStore.setState(s => ({ dataVersion: s.dataVersion + 1 }));
    } catch (e) {
      useHarnessStore.getState().addLogEntry({
        category: 'webAPI',
        method: 'live.attributeMetadata.error',
        args: { logicalName, error: (e as Error).message },
      });
    } finally {
      attrMetaInflight.delete(logicalName);
    }
  })();
  attrMetaInflight.set(logicalName, p);
  return p;
}

/** Returns the set of entities that have been hydrated with live metadata
 *  in this session. Used by the Data panel inspector. */
export function getLiveLoadedEntities(): string[] {
  return Array.from(attrMetaLoaded).sort();
}

/** Test seam: clear in-process attribute-metadata caches. */
export function __clearLiveAttributeMetadataCache(): void {
  attrMetaInflight.clear();
  attrMetaLoaded.clear();
}

/* -------------------------------------------------------------------------- */
/* Extracted-controls API (M9.P2 chunk 3)                                     */
/* -------------------------------------------------------------------------- */

const EXTRACTED_BASE = '/api/extracted';

export interface ExtractedMeta {
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
}

export interface CachedExtractDto {
  safe: string;
  controlDir: string;
  projectRoot: string;
  cacheBase: string;
  meta: ExtractedMeta | null;
  isComplete: boolean;
}

export interface ExtractedListResponse {
  defaultCacheBase: string;
  extracts: CachedExtractDto[];
}

export async function listExtractedControls(): Promise<ExtractedListResponse> {
  const res = await fetch(`${EXTRACTED_BASE}/list`, { headers: buildHeaders() });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as ExtractedListResponse;
}

export interface ExtractDeployedRequest {
  orgUrl: string;
  controlName: string;
  outBase?: string;
}

export interface ExtractDeployedResponse {
  controlDir: string;
  projectRoot: string;
  meta: ExtractedMeta;
}

export async function extractDeployedControl(
  req: ExtractDeployedRequest,
): Promise<ExtractDeployedResponse> {
  const res = await fetch(`${EXTRACTED_BASE}/extract`, {
    method: 'POST',
    headers: buildHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const err = await parseError(res);
    maybeFlagReauth(err, req.orgUrl);
    throw err;
  }
  return (await res.json()) as ExtractDeployedResponse;
}

export async function deleteExtractedControl(safe: string, cacheBase?: string): Promise<void> {
  const res = await fetch(`${EXTRACTED_BASE}/delete`, {
    method: 'POST',
    headers: buildHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ safe, cacheBase }),
  });
  if (!res.ok) throw await parseError(res);
}

export interface DeployedControlSummary {
  customcontrolid: string;
  name: string;
  version: string | null;
  namespace: string | null;
  constructor: string | null;
}

export interface ListDeployedControlsResponse {
  orgUrl: string;
  controls: DeployedControlSummary[];
}

export async function listDeployedControls(orgUrl: string): Promise<ListDeployedControlsResponse> {
  const res = await fetch(`${EXTRACTED_BASE}/list-controls?orgUrl=${encodeURIComponent(orgUrl)}`, {
    headers: buildHeaders(),
  });
  if (!res.ok) {
    const err = await parseError(res);
    maybeFlagReauth(err, orgUrl);
    throw err;
  }
  return (await res.json()) as ListDeployedControlsResponse;
}

export const __test__ = {
  PROXY_BASE,
  adaptMultiResponse,
};
