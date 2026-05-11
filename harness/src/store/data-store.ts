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

let entityStore: Record<string, Record<string, any>[]> = {};
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
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
  return true;
}
