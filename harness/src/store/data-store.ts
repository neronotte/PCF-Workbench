/**
 * In-memory entity data store.
 * Loaded from data.json in the PCF project directory (if present).
 * Falls back to empty collections.
 *
 * In Live mode (M2.P1), reads are first served from
 * `useHarnessStore.liveRecordCache` (one record per logical entity, fetched
 * from the user's PAC-authenticated org). Writes still go to the in-memory
 * mock store — Live writes throw at the WebAPI shim layer in P1.
 */

import { useHarnessStore } from './harness-store';
import { getEntityMetadata } from './metadata-store';

let entityStore: Record<string, Record<string, any>[]> = {};
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

/**
 * Mark the active scenario dirty after a mock-data mutation. Skipped when:
 *   - we're inside `withDirtySuppression` (scenario apply / reset)
 *   - there is no active scenario (initial boot, gallery mode)
 *   - we're in live mode (live edits are NOT scenario-scoped — they hit
 *     Dataverse directly and would be discarded by Save)
 *
 * Called by `addEntityRecord` / `updateEntityRecord` / `deleteEntityRecord`
 * but NOT by `loadEntityData` / `replaceMockEntityData` (those are the
 * scenario-apply path and the initial-load path, neither of which is a
 * user edit).
 */
function markScenarioDirtyForData(): void {
  const s = useHarnessStore.getState();
  if (s.dataSource === 'live') return;
  s.markDirty();
}

export function loadEntityData(data: Record<string, any[]>): void {
  entityStore = { ...data };
  notify();
}

export function getEntityData(entityType: string): Record<string, any>[] {
  // In live mode, prefer the cached page record for this entity type. If it
  // hasn't been fetched yet (or fetch errored) the array is empty — bound
  // properties resolve to null and the control re-renders once the fetch
  // completes and bumps dataVersion.
  const s = useHarnessStore.getState();
  if (s.dataSource === 'live') {
    const cached = s.liveRecordCache[entityType];
    return cached ? [cached] : [];
  }
  return entityStore[entityType] ?? [];
}

export function getEntityStoreKeys(): string[] {
  // Live mode: surface entity names that currently have a cached record so
  // dataset fallbacks can find them.
  const s = useHarnessStore.getState();
  if (s.dataSource === 'live') return Object.keys(s.liveRecordCache);
  return Object.keys(entityStore);
}

export function clearEntityData(): void {
  entityStore = {};
  notify();
}

/**
 * Delete a single entity table from the mock store. Used by DataPanel's
 * inline trash affordance. No-op if the table doesn't exist.
 */
export function deleteEntityTable(entityType: string): boolean {
  if (!(entityType in entityStore)) return false;
  const next = { ...entityStore };
  delete next[entityType];
  entityStore = next;
  notify();
  return true;
}

/**
 * Create an empty entity table. Used by DataPanel's "+ Add" affordance.
 * Returns `false` if a table with that name already exists.
 */
export function createEntityTable(entityType: string): boolean {
  if (entityType in entityStore) return false;
  entityStore = { ...entityStore, [entityType]: [] };
  notify();
  return true;
}

/**
 * Snapshot the in-memory MOCK entity table only. Bypasses the live cache
 * regardless of `dataSource` so scenario Save never accidentally serializes
 * live Dataverse records (rubber-duck #4).
 */
export function getMockEntityDataSnapshot(): Record<string, Record<string, any>[]> {
  // Deep clone — scenarios are immutable once saved.
  const out: Record<string, Record<string, any>[]> = {};
  for (const [k, v] of Object.entries(entityStore)) {
    out[k] = v.map(r => ({ ...r }));
  }
  return out;
}

/**
 * Replace the entire mock entity table. Used by scenario Load when the
 * loaded scenario carries a `dataRecords` snapshot. Notifies subscribers
 * (DataPanel, WebAPI shim) so dependent UI re-renders.
 */
export function replaceMockEntityData(data: Record<string, Record<string, any>[]>): void {
  // Defensive clone — caller may hold references to the source scenario.
  const cloned: Record<string, Record<string, any>[]> = {};
  for (const [k, v] of Object.entries(data)) {
    cloned[k] = v.map(r => ({ ...r }));
  }
  entityStore = cloned;
  notify();
}

/**
 * Merge incoming records into the existing mock store. Per-entity upsert
 * keyed by id; unrelated entities are left untouched. Used by the
 * "Snapshot live → mock" capture so adding a live record set never wipes
 * other mock entities the scenario already had loaded (M2 follow-up).
 *
 * Returns counts of net-new records added per entity (existing records
 * that were updated count as 0 here — they're not "added").
 */
export function mergeMockEntityData(
  data: Record<string, Record<string, any>[]>,
): { entityCount: number; addedCount: number; updatedCount: number } {
  let entityCount = 0;
  let addedCount = 0;
  let updatedCount = 0;
  const next: Record<string, Record<string, any>[]> = { ...entityStore };
  for (const [entityType, incoming] of Object.entries(data)) {
    if (!incoming.length) continue;
    entityCount++;
    const existing = next[entityType] ? [...next[entityType]] : [];
    // Resolve the authoritative id column. Order:
    //   1. Metadata-store PrimaryIdAttribute (e.g. systemform → formid)
    //   2. <entityType>id convention
    //   3. Heuristic: any key ending with 'id' / generic 'id'
    const meta = getEntityMetadata(entityType);
    const idField =
      meta?.primaryIdAttribute
      ?? (incoming.find(r => r[`${entityType}id`] != null) ? `${entityType}id` : undefined)
      ?? findIdField(incoming[0])
      ?? 'id';
    const indexById = new Map<string, number>();
    existing.forEach((r, i) => {
      const id = r[idField];
      if (id != null) indexById.set(String(id), i);
    });
    for (const rec of incoming) {
      const id = rec[idField];
      const key = id != null ? String(id) : null;
      if (key && indexById.has(key)) {
        existing[indexById.get(key)!] = { ...rec };
        updatedCount++;
      } else {
        existing.push({ ...rec });
        if (key) indexById.set(key, existing.length - 1);
        addedCount++;
      }
    }
    next[entityType] = existing;
  }
  entityStore = next;
  notify();
  return { entityCount, addedCount, updatedCount };
}

/**
 * Variant of mergeMockEntityData that accepts the live-fetch buffer shape
 * `{ [entityType]: { [id]: record } }`. Callers (e.g. snapshotLiveToMock)
 * already have authoritative ids as object keys — no id-field detection
 * heuristics needed. Use this whenever you have keyed input; it's the
 * robust path. Existing entities not in `data` are preserved.
 */
export function mergeKeyedMockEntityData(
  data: Record<string, Record<string, Record<string, any>>>,
): {
  entityCount: number;
  addedCount: number;
  updatedCount: number;
  perEntity: Record<string, { added: number; updated: number; total: number; idField: string }>;
} {
  let entityCount = 0;
  let addedCount = 0;
  let updatedCount = 0;
  const perEntity: Record<string, { added: number; updated: number; total: number; idField: string }> = {};
  const next: Record<string, Record<string, any>[]> = { ...entityStore };
  for (const [entityType, byId] of Object.entries(data)) {
    const ids = Object.keys(byId);
    if (ids.length === 0) continue;
    entityCount++;
    const existing = next[entityType] ? [...next[entityType]] : [];
    // Determine the existing-mock id column from metadata so we can find
    // matches against incoming records keyed by the live buffer id.
    const meta = getEntityMetadata(entityType);
    const idField =
      meta?.primaryIdAttribute
      ?? (existing[0] && existing[0][`${entityType}id`] != null ? `${entityType}id` : undefined)
      ?? (existing[0] ? findIdField(existing[0]) : undefined)
      ?? `${entityType}id`;
    const indexById = new Map<string, number>();
    existing.forEach((r, i) => {
      const id = r[idField];
      if (id != null) indexById.set(String(id), i);
    });
    let entityAdded = 0;
    let entityUpdated = 0;
    for (const id of ids) {
      const rec = { ...byId[id] };
      // Ensure the record carries the id under the resolved id column so
      // downstream consumers (UI editor, scenario serialisation) can find it.
      if (rec[idField] == null) rec[idField] = id;
      if (indexById.has(id)) {
        existing[indexById.get(id)!] = rec;
        updatedCount++;
        entityUpdated++;
      } else {
        existing.push(rec);
        indexById.set(id, existing.length - 1);
        addedCount++;
        entityAdded++;
      }
    }
    next[entityType] = existing;
    perEntity[entityType] = {
      added: entityAdded,
      updated: entityUpdated,
      total: existing.length,
      idField,
    };
  }
  entityStore = next;
  notify();
  return { entityCount, addedCount, updatedCount, perEntity };
}

/** Subscribe to data store mutations. Returns an unsubscribe function. */
export function subscribeData(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function findIdField(record: Record<string, any>): string | undefined {
  return Object.keys(record).find(k => k.toLowerCase().endsWith('id') || k === 'id');
}

export function addEntityRecord(entityType: string, record: Record<string, any>): Record<string, any> {
  const list = entityStore[entityType] ? [...entityStore[entityType]] : [];
  // Auto-assign an id if none supplied
  const idField = list[0] ? findIdField(list[0]) : undefined;
  const guid = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
  if (idField && record[idField] == null) record[idField] = guid;
  else if (!idField && record.id == null) record.id = guid;
  list.push(record);
  entityStore = { ...entityStore, [entityType]: list };
  notify();
  markScenarioDirtyForData();
  return record;
}

export function updateEntityRecord(entityType: string, id: string, patch: Record<string, any>): boolean {
  const list = entityStore[entityType];
  if (!list) return false;
  const idField = list[0] ? findIdField(list[0]) : undefined;
  if (!idField) return false;
  const idx = list.findIndex(r => String(r[idField]) === String(id));
  if (idx < 0) return false;
  const updated = [...list];
  updated[idx] = { ...updated[idx], ...patch };
  entityStore = { ...entityStore, [entityType]: updated };
  notify();
  markScenarioDirtyForData();
  return true;
}

export function deleteEntityRecord(entityType: string, id: string): boolean {
  const list = entityStore[entityType];
  if (!list) return false;
  const idField = list[0] ? findIdField(list[0]) : undefined;
  if (!idField) return false;
  const filtered = list.filter(r => String(r[idField]) !== String(id));
  if (filtered.length === list.length) return false;
  entityStore = { ...entityStore, [entityType]: filtered };
  notify();
  markScenarioDirtyForData();
  return true;
}
