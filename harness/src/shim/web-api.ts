import type { HarnessStore } from '../store/harness-store';
import { addEntityRecord, updateEntityRecord, deleteEntityRecord } from '../store/data-store';
import { getEntityMetadata } from '../store/metadata-store';
import { getEntityStoreKeys } from '../store/data-store';
import { pushDialog } from './dialog-bus';
import { getExecuteMock } from '../store/execute-mock-store';
import { liveRetrieveMultiple, liveRetrieveSingle, liveCreateRecord, liveUpdateRecord, liveDeleteRecord, DvProxyError } from '../api/dv-client';
import { confirmLiveWrite } from '../lib/live-write-gate';
import { seedAdditionalEntity } from '../store/form-store';

const NETWORK_DELAYS: Record<string, number> = {
  online: 0,
  offline: 0,
  slow3g: 2000,
  fast3g: 500,
  custom: 0,
};

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Parse a single OData condition into a predicate function.
 */
function parseSingleCondition(expr: string): ((e: Record<string, any>) => boolean) | null {
  // Strip outer parens carefully:
  //  (a) Asymmetric leftovers from splitting a parenthesized OR group like
  //      `(field eq A or field eq B)` — each side arrives with one excess
  //      `(` or `)` attached. Only strip when overall paren counts are
  //      unbalanced (i.e. truly leftover halves), not when balanced like
  //      `contains(name,'foo')`.
  //  (b) Balanced wrapping parens around the entire expression, e.g.
  //      `(a eq 1 and b eq 2)`.
  let trimmed = expr.trim();
  let openCount = (trimmed.match(/\(/g) || []).length;
  let closeCount = (trimmed.match(/\)/g) || []).length;
  while (trimmed.startsWith('(') && openCount > closeCount) {
    trimmed = trimmed.slice(1).trimStart();
    openCount--;
  }
  while (trimmed.endsWith(')') && closeCount > openCount) {
    trimmed = trimmed.slice(0, -1).trimEnd();
    closeCount--;
  }
  while (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    let depth = 0;
    let wrapsAll = true;
    for (let i = 0; i < trimmed.length; i++) {
      if (trimmed[i] === '(') depth++;
      else if (trimmed[i] === ')') depth--;
      if (depth === 0 && i < trimmed.length - 1) { wrapsAll = false; break; }
    }
    if (!wrapsAll) break;
    trimmed = trimmed.slice(1, -1).trim();
  }

  // contains(field,'value')
  const containsMatch = trimmed.match(/^contains\((\w+),\s*'([^']*)'\)$/i);
  if (containsMatch) {
    const [, field, value] = containsMatch;
    return e => String(e[field] ?? '').toLowerCase().includes(value.toLowerCase());
  }

  // field eq null
  const eqNullMatch = trimmed.match(/^(\w+)\s+eq\s+null$/i);
  if (eqNullMatch) {
    const [, field] = eqNullMatch;
    return e => e[field] == null || e[field] === '' || e[field] === 'null';
  }

  // field ne null
  const neNullMatch = trimmed.match(/^(\w+)\s+ne\s+null$/i);
  if (neNullMatch) {
    const [, field] = neNullMatch;
    return e => e[field] != null && e[field] !== '' && e[field] !== 'null';
  }

  // field eq 'value' or field eq guid (unquoted)
  const eqMatch = trimmed.match(/^(\w+)\s+eq\s+'([^']*)'/i) ?? trimmed.match(/^(\w+)\s+eq\s+(\S+)$/i);
  if (eqMatch) {
    const [, field, value] = eqMatch;
    return e => String(e[field]) === value;
  }

  // field ne 'value'
  const neMatch = trimmed.match(/^(\w+)\s+ne\s+'([^']*)'/i) ?? trimmed.match(/^(\w+)\s+ne\s+(\S+)$/i);
  if (neMatch) {
    const [, field, value] = neMatch;
    return e => String(e[field]) !== value;
  }

  // Comparison operators: ge, gt, le, lt (dates, numbers, strings)
  const cmpMatch = trimmed.match(/^(\w+)\s+(ge|gt|le|lt)\s+'?([^']*?)'?$/i);
  if (cmpMatch) {
    const [, field, op, value] = cmpMatch;
    return e => {
      const fieldVal = e[field];
      if (fieldVal == null) return false;
      // Try date comparison first, then numeric, then string
      const dField = new Date(fieldVal).getTime();
      const dValue = new Date(value).getTime();
      if (!isNaN(dField) && !isNaN(dValue)) {
        switch (op.toLowerCase()) {
          case 'ge': return dField >= dValue;
          case 'gt': return dField > dValue;
          case 'le': return dField <= dValue;
          case 'lt': return dField < dValue;
        }
      }
      const nField = Number(fieldVal);
      const nValue = Number(value);
      if (!isNaN(nField) && !isNaN(nValue)) {
        switch (op.toLowerCase()) {
          case 'ge': return nField >= nValue;
          case 'gt': return nField > nValue;
          case 'le': return nField <= nValue;
          case 'lt': return nField < nValue;
        }
      }
      // Fallback: string comparison
      const sField = String(fieldVal);
      switch (op.toLowerCase()) {
        case 'ge': return sField >= value;
        case 'gt': return sField > value;
        case 'le': return sField <= value;
        case 'lt': return sField < value;
      }
      return false;
    };
  }

  // startswith(field,'value')
  const startsMatch = trimmed.match(/^startswith\((\w+),\s*'([^']*)'\)$/i);
  if (startsMatch) {
    const [, field, value] = startsMatch;
    return e => String(e[field] ?? '').toLowerCase().startsWith(value.toLowerCase());
  }

  // endswith(field,'value')
  const endsMatch = trimmed.match(/^endswith\((\w+),\s*'([^']*)'\)$/i);
  if (endsMatch) {
    const [, field, value] = endsMatch;
    return e => String(e[field] ?? '').toLowerCase().endsWith(value.toLowerCase());
  }

  return null;
}

/**
 * Parse a basic OData $filter string into a predicate function.
 * Supports: and, or, eq, ne, eq null, contains, startswith, endswith
 *
 * Exported for unit testing (M11.M4). Pure function — no store coupling.
 */
export function parseFilter(filter: string | undefined): (entity: Record<string, any>) => boolean {
  if (!filter) return () => true;

  // Split on top-level ' and ' first
  const andGroups = filter.split(/ and /i);
  const andPredicates: Array<(e: Record<string, any>) => boolean> = [];

  for (const andGroup of andGroups) {
    // Each AND group may contain OR conditions
    const orParts = andGroup.split(/ or /i);
    const orPredicates: Array<(e: Record<string, any>) => boolean> = [];

    for (const orPart of orParts) {
      const predicate = parseSingleCondition(orPart);
      if (predicate) orPredicates.push(predicate);
    }

    if (orPredicates.length > 0) {
      // OR: at least one must match
      andPredicates.push(entity => orPredicates.some(p => p(entity)));
    }
  }

  // AND: all groups must match
  return (entity) => andPredicates.every(p => p(entity));
}

/** Exported for unit testing (M11.M4). Pure. */
/**
 * Real-Dataverse-style validation against the metadata store. When metadata
 * for the queried entity is present, we strictly check the entity logical
 * name and every field referenced in $select / $orderby / $filter — exactly
 * what the Dataverse Web API does, which surfaces controls that ship with
 * subtly wrong table/column names (mixed case, typos, custom-schema-name
 * confusion) instead of silently returning empty rows.
 *
 * Throws a `DataverseValidationError` and pushes an error dialog when
 * invalid. No-op (returns) when no metadata is loaded for the entity —
 * keeps existing controls without schema working as best-effort.
 */
class DataverseValidationError extends Error {
  readonly errorCode: number;
  readonly status: number;
  readonly raw: { error: { code: string; message: string } };
  constructor(message: string, errorCode = -2147217149) {
    super(message);
    this.name = 'DataverseValidationError';
    this.errorCode = errorCode;
    this.status = 400;
    this.raw = { error: { code: '0x8004531c', message } };
  }
}

function extractFilterFields(filter: string): string[] {
  const out = new Set<string>();
  const opRe = /\b([A-Za-z_][A-Za-z0-9_]*)\s+(eq|ne|gt|ge|lt|le)\s/g;
  let m: RegExpExecArray | null;
  while ((m = opRe.exec(filter))) out.add(m[1]);
  const fnRe = /\b(?:contains|startswith|endswith)\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,/g;
  while ((m = fnRe.exec(filter))) out.add(m[1]);
  return Array.from(out);
}

function suggestEntity(requested: string, candidates: string[]): string | null {
  const lc = requested.toLowerCase();
  const hit = candidates.find(c => c.toLowerCase() === lc);
  return hit ?? null;
}

function suggestField(requested: string, candidates: string[]): string | null {
  const lc = requested.toLowerCase();
  const hit = candidates.find(c => c.toLowerCase() === lc);
  return hit ?? null;
}

function reportValidationError(method: string, entityType: string, message: string, details: string): never {
  // Console — every PCF developer is in DevTools.
  // eslint-disable-next-line no-console
  console.error(`[pcf-workbench] ${method}(${entityType}) validation failed: ${message}\n${details}`);
  // Dialog — every PCF tester is on the harness page.
  pushDialog<import('./dialog-bus').ErrorDialogRequest>({
    kind: 'error',
    options: {
      message: `WebAPI validation: ${message}`,
      details,
      errorCode: -2147217149,
    },
    resolve: () => undefined,
  });
  throw new DataverseValidationError(`${message}. ${details}`);
}

function validateEntityAndFields(
  method: string,
  entityType: string,
  opts: { select?: string[] | null; orderbyField?: string; filter?: string },
): void {
  const meta = getEntityMetadata(entityType);
  if (!meta) {
    // No schema — try to detect case-only mismatch against the data store so
    // makers see "did you mean" instead of an empty result for the common
    // PascalCase-vs-lowercase footgun.
    const dataKeys = getEntityStoreKeys();
    if (!dataKeys.includes(entityType)) {
      const near = suggestEntity(entityType, dataKeys);
      if (near) {
        reportValidationError(
          method,
          entityType,
          `Entity "${entityType}" not found`,
          `Did you mean "${near}"? Entity logical names in Dataverse are case-sensitive.`,
        );
      }
    }
    return; // best-effort, no schema to validate against
  }
  const knownColumns = Object.keys(meta.columns ?? {});
  const checkField = (kind: string, name: string) => {
    if (!knownColumns.includes(name)) {
      const near = suggestField(name, knownColumns);
      reportValidationError(
        method,
        entityType,
        `${kind} field "${name}" does not exist on entity "${entityType}"`,
        near
          ? `Did you mean "${near}"? (case-sensitive). Known fields: ${knownColumns.slice(0, 8).join(', ')}${knownColumns.length > 8 ? '…' : ''}`
          : `Known fields: ${knownColumns.slice(0, 8).join(', ')}${knownColumns.length > 8 ? '…' : ''}`,
      );
    }
  };
  if (opts.select) for (const f of opts.select) checkField('$select', f);
  if (opts.orderbyField) checkField('$orderby', opts.orderbyField);
  if (opts.filter) for (const f of extractFilterFields(opts.filter)) checkField('$filter', f);
}

export function parseSelect(select: string | undefined): string[] | null {
  if (!select) return null;
  return select.split(',').map(s => s.trim());
}

/** Exported for unit testing (M11.M4). Pure.
 *
 * Mirrors real Dataverse: even when `$select` doesn't list it, the primary
 * id attribute is always returned (the server adds it implicitly). Pass
 * `primaryIdAttribute` to opt in to that behaviour — when omitted, the
 * select is taken literally (preserves prior unit-test expectations).
 */
export function applySelect(
  entity: Record<string, any>,
  columns: string[] | null,
  primaryIdAttribute?: string,
): Record<string, any> {
  if (!columns) return { ...entity };
  const effective = primaryIdAttribute && !columns.includes(primaryIdAttribute)
    ? [...columns, primaryIdAttribute]
    : columns;
  const result: Record<string, any> = {};
  for (const col of effective) {
    if (col in entity) result[col] = entity[col];
  }
  // Also include OData annotations for selected columns (formatted values, lookup metadata)
  for (const key of Object.keys(entity)) {
    if (!key.includes('@')) continue;
    const baseCol = key.split('@')[0];
    if (effective.some(c => baseCol === c || baseCol === `_${c}_value` || c === baseCol)) {
      result[key] = entity[key];
    }
  }
  return result;
}

/**
 * Creates a WebAPI shim that mirrors the real Dynamics 365 behavior:
 *
 *  context.webAPI  — auto-routes to online or offline store (always works)
 *  webAPI.online   — always hits the server (fails when offline)
 *  webAPI.offline  — always hits the local store (no latency)
 *
 * In the harness, "online store" = data.json + network latency,
 * and "offline store" = data.json with zero latency (instant).
 */
export function createWebApiShim(
  getState: () => HarnessStore,
  getEntityData: (entityType: string) => Record<string, any>[],
) {
  const log = (method: string, args?: any, result?: any) =>
    getState().addLogEntry({ category: 'webAPI', method, args, result, coverage: 'implemented' });

  /**
   * Apply network latency. In 'online-only' mode, rejects when offline.
   * In 'auto' mode (default for context.webAPI), serves from local store when offline.
   */
  async function applyNetworkConditions(mode: 'auto' | 'online-only' | 'offline-only' = 'auto'): Promise<void> {
    const state = getState();

    if (mode === 'online-only' && state.networkMode === 'offline') {
      throw new Error('Network unavailable — Xrm.WebApi.online called while device is offline');
    }

    // Offline-only mode and auto-mode-when-offline: no latency (instant local store access)
    if (mode === 'offline-only' || state.networkMode === 'offline') {
      return;
    }

    const delayMs = state.networkMode === 'custom'
      ? state.customLatencyMs
      : NETWORK_DELAYS[state.networkMode] ?? 0;
    if (delayMs > 0) await delay(delayMs);
  }

  function estimateSize(obj: any): number {
    try { return JSON.stringify(obj).length; } catch { return 0; }
  }

  // Build CRUD methods parameterized by network mode
  function buildApi(mode: 'auto' | 'online-only' | 'offline-only') {
    const prefix = mode === 'online-only' ? 'online.' : mode === 'offline-only' ? 'offline.' : '';

    return {
      async createRecord(entityType: string, data: Record<string, any>): Promise<any> {
        const start = performance.now();
        log(`${prefix}createRecord`, { entityType, data });
        if (getState().dataSource === 'live') {
          const profile = getState().liveProfile;
          if (!profile) {
            const err = 'Live mode requires a selected PAC profile (Data panel → Live → pick org).';
            getState().addWebApiCall({
              method: `${prefix}createRecord`, entityType, durationMs: performance.now() - start,
              responseSize: 0, recordCount: 0, error: err,
            });
            throw new Error(err);
          }
          const ok = await confirmLiveWrite({
            method: 'create', entityType, payload: data, orgUrl: profile.orgUrl,
          });
          if (!ok) {
            const err = 'Live write cancelled by user';
            getState().addWebApiCall({
              method: `${prefix}createRecord`, entityType, durationMs: performance.now() - start,
              responseSize: 0, recordCount: 0, error: err,
            });
            throw new Error(err);
          }
          try {
            const result = await liveCreateRecord(profile.orgUrl, entityType, data);
            const duration = performance.now() - start;
            log(`${prefix}createRecord.live`, { entityType, id: result.id, durationMs: Math.round(duration) });
            getState().addWebApiCall({
              method: `${prefix}createRecord`, entityType, durationMs: duration,
              responseSize: estimateSize(result), recordCount: 1,
            });
            return { id: result.id, entityType };
          } catch (e) {
            const err = e instanceof DvProxyError ? `[live] ${e.body.error}: ${e.body.message}` : (e as Error).message;
            getState().addWebApiCall({
              method: `${prefix}createRecord`, entityType, durationMs: performance.now() - start,
              responseSize: 0, recordCount: 0, error: err,
            });
            throw e;
          }
        }
        await applyNetworkConditions(mode);
        const record = addEntityRecord(entityType, { ...data });
        const idField = Object.keys(record).find(k => k.toLowerCase().endsWith('id') || k === 'id') ?? 'id';
        const id = String(record[idField]);
        const result = { id, entityType };
        getState().addWebApiCall({
          method: `${prefix}createRecord`, entityType, durationMs: performance.now() - start,
          responseSize: estimateSize(result), recordCount: 1,
        });
        return result;
      },

      async deleteRecord(entityType: string, id: string): Promise<any> {
        const start = performance.now();
        log(`${prefix}deleteRecord`, { entityType, id });
        if (getState().dataSource === 'live') {
          const profile = getState().liveProfile;
          if (!profile) {
            const err = 'Live mode requires a selected PAC profile (Data panel → Live → pick org).';
            getState().addWebApiCall({
              method: `${prefix}deleteRecord`, entityType, durationMs: performance.now() - start,
              responseSize: 0, recordCount: 0, error: err,
            });
            throw new Error(err);
          }
          const ok = await confirmLiveWrite({
            method: 'delete', entityType, recordId: id, orgUrl: profile.orgUrl,
          });
          if (!ok) {
            const err = 'Live write cancelled by user';
            getState().addWebApiCall({
              method: `${prefix}deleteRecord`, entityType, durationMs: performance.now() - start,
              responseSize: 0, recordCount: 0, error: err,
            });
            throw new Error(err);
          }
          try {
            await liveDeleteRecord(profile.orgUrl, entityType, id);
            const duration = performance.now() - start;
            log(`${prefix}deleteRecord.live`, { entityType, id, durationMs: Math.round(duration) });
            getState().addWebApiCall({
              method: `${prefix}deleteRecord`, entityType, durationMs: duration,
              responseSize: 0, recordCount: 0,
            });
            return { entityType, id };
          } catch (e) {
            const err = e instanceof DvProxyError ? `[live] ${e.body.error}: ${e.body.message}` : (e as Error).message;
            getState().addWebApiCall({
              method: `${prefix}deleteRecord`, entityType, durationMs: performance.now() - start,
              responseSize: 0, recordCount: 0, error: err,
            });
            throw e;
          }
        }
        await applyNetworkConditions(mode);
        deleteEntityRecord(entityType, id);
        getState().addWebApiCall({
          method: `${prefix}deleteRecord`, entityType, durationMs: performance.now() - start,
          responseSize: 0, recordCount: 0,
        });
        return { entityType, id };
      },

      async updateRecord(entityType: string, id: string, data: Record<string, any>): Promise<any> {
        const start = performance.now();
        log(`${prefix}updateRecord`, { entityType, id, data });
        if (getState().dataSource === 'live') {
          const profile = getState().liveProfile;
          if (!profile) {
            const err = 'Live mode requires a selected PAC profile (Data panel → Live → pick org).';
            getState().addWebApiCall({
              method: `${prefix}updateRecord`, entityType, durationMs: performance.now() - start,
              responseSize: 0, recordCount: 0, error: err,
            });
            throw new Error(err);
          }
          const ok = await confirmLiveWrite({
            method: 'update', entityType, recordId: id, payload: data, orgUrl: profile.orgUrl,
          });
          if (!ok) {
            const err = 'Live write cancelled by user';
            getState().addWebApiCall({
              method: `${prefix}updateRecord`, entityType, durationMs: performance.now() - start,
              responseSize: 0, recordCount: 0, error: err,
            });
            throw new Error(err);
          }
          try {
            await liveUpdateRecord(profile.orgUrl, entityType, id, data);
            const duration = performance.now() - start;
            log(`${prefix}updateRecord.live`, { entityType, id, durationMs: Math.round(duration) });
            getState().addWebApiCall({
              method: `${prefix}updateRecord`, entityType, durationMs: duration,
              responseSize: estimateSize(data), recordCount: 1,
            });
            return { entityType, id };
          } catch (e) {
            const err = e instanceof DvProxyError ? `[live] ${e.body.error}: ${e.body.message}` : (e as Error).message;
            getState().addWebApiCall({
              method: `${prefix}updateRecord`, entityType, durationMs: performance.now() - start,
              responseSize: 0, recordCount: 0, error: err,
            });
            throw e;
          }
        }
        await applyNetworkConditions(mode);
        updateEntityRecord(entityType, id, data);
        getState().addWebApiCall({
          method: `${prefix}updateRecord`, entityType, durationMs: performance.now() - start,
          responseSize: estimateSize(data), recordCount: 1,
        });
        return { entityType, id };
      },

      async retrieveMultipleRecords(
        entityType: string,
        options?: string,
        maxPageSize?: number,
      ): Promise<{ entities: Record<string, any>[]; nextLink?: string }> {
        const start = performance.now();
        log(`${prefix}retrieveMultipleRecords`, { entityType, options, maxPageSize });

        // ---- Live branch ---------------------------------------------------
        const state = getState();
        if (state.dataSource === 'live') {
          const profile = state.liveProfile;
          if (!profile) {
            const err = 'Live mode requires a selected PAC profile (Data panel → Live → pick org).';
            getState().addWebApiCall({
              method: `${prefix}retrieveMultipleRecords`, entityType, durationMs: performance.now() - start,
              responseSize: 0, recordCount: 0, options, error: err,
            });
            throw new Error(err);
          }
          try {
            const adapted = await liveRetrieveMultiple(profile.orgUrl, entityType, options, maxPageSize);
            const duration = performance.now() - start;
            const size = estimateSize(adapted);
            log(`${prefix}retrieveMultipleRecords.live`, {
              entityType, count: adapted.entities.length, durationMs: Math.round(duration), sizeBytes: size,
            });
            getState().addWebApiCall({
              method: `${prefix}retrieveMultipleRecords`, entityType, durationMs: duration,
              responseSize: size, recordCount: adapted.entities.length, options,
            });
            // Buffer for later "Snapshot live → mock" capture.
            getState().addLiveFetches(entityType, adapted.entities as Record<string, any>[]);
            return { entities: adapted.entities as Record<string, any>[], nextLink: adapted.nextLink };
          } catch (e) {
            const err = e instanceof DvProxyError
              ? `[live] ${e.body.error}: ${e.body.message}`
              : (e as Error).message;
            getState().addWebApiCall({
              method: `${prefix}retrieveMultipleRecords`, entityType, durationMs: performance.now() - start,
              responseSize: 0, recordCount: 0, options, error: err,
            });
            throw e;
          }
        }

        // ---- Mock branch (existing behaviour, unchanged) -------------------
        await applyNetworkConditions(mode);

        let entities = getEntityData(entityType);

        // Parse OData options: ?$filter=...&$select=...&$top=...&$orderby=...
        if (options) {
          const params = new URLSearchParams(options.startsWith('?') ? options.slice(1) : options);
          const filter = params.get('$filter') ?? undefined;
          const select = params.get('$select') ?? undefined;
          const top = params.get('$top');
          const orderby = params.get('$orderby');

          // Metadata-driven validation. Throws (and shows an error dialog)
          // when the entity logical name or any referenced field doesn't
          // exist — mirroring real Dataverse behaviour so controls don't
          // silently get empty results from a mis-cased query.
          const selectFields = parseSelect(select);
          const orderbyField = orderby ? orderby.split(' ')[0] : undefined;
          validateEntityAndFields(`${prefix}retrieveMultipleRecords`, entityType, {
            select: selectFields,
            orderbyField,
            filter,
          });

          const predicate = parseFilter(filter);
          entities = entities.filter(predicate);

          if (orderby) {
            const [field, dir] = orderby.split(' ');
            const mult = dir?.toLowerCase() === 'desc' ? -1 : 1;
            entities.sort((a, b) => {
              const va = a[field], vb = b[field];
              if (va < vb) return -1 * mult;
              if (va > vb) return 1 * mult;
              return 0;
            });
          }

          if (top) entities = entities.slice(0, parseInt(top, 10));

          if (selectFields) {
            const meta = getEntityMetadata(entityType);
            const primaryId = meta?.primaryIdAttribute;
            entities = entities.map(e => applySelect(e, selectFields, primaryId));
          }
        }

        if (maxPageSize && entities.length > maxPageSize) {
          entities = entities.slice(0, maxPageSize);
        }

        const result = { entities };
        const duration = performance.now() - start;
        const size = estimateSize(result);
        log(`${prefix}retrieveMultipleRecords.result`, { entityType, count: entities.length, durationMs: Math.round(duration), sizeBytes: size });
        getState().addWebApiCall({
          method: `${prefix}retrieveMultipleRecords`, entityType, durationMs: duration,
          responseSize: size, recordCount: entities.length, options,
        });
        return result;
      },

      async retrieveRecord(
        entityType: string,
        id: string,
        options?: string,
      ): Promise<Record<string, any>> {
        const start = performance.now();
        log(`${prefix}retrieveRecord`, { entityType, id, options });

        // ---- Live branch ---------------------------------------------------
        const state = getState();
        if (state.dataSource === 'live') {
          const profile = state.liveProfile;
          if (!profile) {
            const err = 'Live mode requires a selected PAC profile (Data panel → Live → pick org).';
            getState().addWebApiCall({
              method: `${prefix}retrieveRecord`, entityType, durationMs: performance.now() - start,
              responseSize: 0, recordCount: 0, options, error: err,
            });
            throw new Error(err);
          }
          try {
            const record = await liveRetrieveSingle(profile.orgUrl, entityType, id, options);
            const duration = performance.now() - start;
            const size = estimateSize(record);
            log(`${prefix}retrieveRecord.live`, { entityType, id, durationMs: Math.round(duration), sizeBytes: size }, record);
            getState().addWebApiCall({
              method: `${prefix}retrieveRecord`, entityType, durationMs: duration,
              responseSize: size, recordCount: 1, options,
            });
            // Buffer for later "Snapshot live → mock" capture.
            // Pass the request id explicitly so the buffer can key the
            // record even when the response projection (`?$select=...`)
            // omits the primary key column (e.g. systemform → formid).
            getState().addLiveFetch(entityType, record as Record<string, any>, id);
            return record as Record<string, any>;
          } catch (e) {
            const err = e instanceof DvProxyError
              ? `[live] ${e.body.error}: ${e.body.message}`
              : (e as Error).message;
            getState().addWebApiCall({
              method: `${prefix}retrieveRecord`, entityType, durationMs: performance.now() - start,
              responseSize: 0, recordCount: 0, options, error: err,
            });
            throw e;
          }
        }

        // ---- Mock branch (existing behaviour, unchanged) -------------------
        await applyNetworkConditions(mode);

        const all = getEntityData(entityType);
        // Normalize ID: strip curly braces, lowercase
        const normalId = id.replace(/[{}]/g, '').toLowerCase();

        // Find by common ID field naming patterns
        const record = all.find(e => {
          for (const key of Object.keys(e)) {
            const val = String(e[key] ?? '').replace(/[{}]/g, '').toLowerCase();
            if ((key.toLowerCase().endsWith('id') || key === 'id') && val === normalId) {
              return true;
            }
          }
          return false;
        });

        if (!record) {
          const errMsg = `Record not found: ${entityType}(${id}). Available: ${all.length} records`;
          log(`${prefix}retrieveRecord.notFound`, { entityType, id, availableRecords: all.length });
          getState().addWebApiCall({
            method: `${prefix}retrieveRecord`, entityType, durationMs: performance.now() - start,
            responseSize: 0, recordCount: 0, options, error: errMsg,
          });
          throw new Error(errMsg);
        }

        let result = { ...record };
        if (options) {
          const params = new URLSearchParams(options.startsWith('?') ? options.slice(1) : options);
          const select = parseSelect(params.get('$select') ?? undefined);
          if (select) {
            const meta = getEntityMetadata(entityType);
            result = applySelect(record, select, meta?.primaryIdAttribute);
          }
        }

        const duration = performance.now() - start;
        const size = estimateSize(result);
        log(`${prefix}retrieveRecord.result`, { entityType, id, durationMs: Math.round(duration), sizeBytes: size }, result);
        getState().addWebApiCall({
          method: `${prefix}retrieveRecord`, entityType, durationMs: duration,
          responseSize: size, recordCount: 1, options,
        });
        // When a systemform record is loaded, auto-seed the form-store with
        // the metadata columns of its target entity so getAttribute/getControl
        // resolve fields for forms that target a different entity than the
        // page record (e.g. a control hosted on a parent record rendering a
        // quick-create form for a related entity).
        if (entityType === 'systemform') {
          const otc = (record as Record<string, any>).objecttypecode;
          if (typeof otc === 'string' && otc.length > 0) {
            seedAdditionalEntity(otc);
          }
        }
        return result;
      },

      async execute(request: any): Promise<any> {
        const start = performance.now();
        const meta = typeof request?.getMetadata === 'function' ? request.getMetadata() : {};
        const actionName = meta.operationName
          ?? request?.operationType ?? request?.functionName ?? 'unknown';
        log(`${prefix}execute`, { action: actionName, request });
        await applyNetworkConditions(mode);

        // Check for a user-defined mock response in execute-mocks.json
        const mock = getExecuteMock(actionName);
        let responseBody: Record<string, any>;

        if (mock !== undefined) {
          responseBody = typeof mock === 'object' && mock !== null ? { ...mock } : { value: mock };
          log(`${prefix}execute.mock`, { action: actionName, source: 'execute-mocks.json' }, responseBody);
        } else {
          // Default response matching common Dataverse action patterns
          responseBody = {
            Response: JSON.stringify({ Description: 'Success' }),
            value: null,
          };
          // Copy request parameters into the response as output properties
          if (meta.parameterTypes) {
            for (const key of Object.keys(meta.parameterTypes)) {
              if (request[key] !== undefined && !(key in responseBody)) {
                responseBody[key] = request[key];
              }
            }
          }
          log(`${prefix}execute.default`, { action: actionName, hint: 'Add this action to execute-mocks.json for a custom response' });
        }

        getState().addWebApiCall({
          method: `${prefix}execute`, entityType: actionName, durationMs: performance.now() - start,
          responseSize: estimateSize(responseBody), recordCount: 0,
        });

        const bodyText = JSON.stringify(responseBody);
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          type: 'basic',
          redirected: false,
          url: '',
          headers: {
            get: (name: string) => {
              if (name.toLowerCase() === 'content-type') return 'application/json';
              return null;
            },
            has: (name: string) => name.toLowerCase() === 'content-type',
            forEach: (cb: (value: string, key: string) => void) => {
              cb('application/json', 'content-type');
            },
          },
          body: null,
          bodyUsed: false,
          json: () => Promise.resolve(responseBody),
          text: () => Promise.resolve(bodyText),
          clone() { return this; },
          arrayBuffer: () => Promise.resolve(new TextEncoder().encode(bodyText).buffer),
          blob: () => Promise.resolve(new Blob([bodyText], { type: 'application/json' })),
          formData: () => Promise.resolve(new FormData()),
        };
      },

      async executeMultiple(requests: any[]): Promise<any[]> {
        const results = [];
        for (const req of requests) {
          results.push(await this.execute(req));
        }
        return results;
      },
    };
  }

  // context.webAPI — auto-routes (works online and offline)
  const autoApi = buildApi('auto');

  // Attach .online and .offline sub-APIs (mirrors Xrm.WebApi.online / Xrm.WebApi.offline)
  return Object.assign(autoApi, {
    online: buildApi('online-only'),
    offline: buildApi('offline-only'),
  });
}
