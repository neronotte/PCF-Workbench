// M9 — Build watcher client.
//
// Subscribes to the dev server's `/api/build-watch/events` SSE stream and
// publishes the current status to React via `useSyncExternalStore`. Lives
// outside Zustand because it's transient session-only state with a simple
// shape — no need to entangle it with the bigger store.

import { useSyncExternalStore } from 'react';

export type BuildPhase = 'idle' | 'compiling' | 'success' | 'error' | 'disabled';

export interface BuildStatus {
  phase: BuildPhase;
  durationMs?: number;
  errors?: string[];
  seq: number;
  at: string;
}

const INITIAL: BuildStatus = {
  phase: 'idle',
  seq: 0,
  at: new Date(0).toISOString(),
};

let current: BuildStatus = INITIAL;
let version = 0;
const subs = new Set<() => void>();
let eventSource: EventSource | null = null;
let started = false;
let snapshotCacheVersion = -1;
let snapshotCache: BuildStatus = INITIAL;

function notify() {
  version++;
  for (const cb of subs) {
    try { cb(); } catch { /* swallow */ }
  }
}

function getSnapshot(): BuildStatus {
  if (snapshotCacheVersion !== version) {
    snapshotCache = current;
    snapshotCacheVersion = version;
  }
  return snapshotCache;
}

function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => { subs.delete(cb); };
}

function start() {
  if (started) return;
  started = true;
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
  try {
    eventSource = new EventSource('/api/build-watch/events');
    eventSource.onmessage = (ev) => {
      try {
        const next = JSON.parse(ev.data) as BuildStatus;
        if (next && typeof next.seq === 'number') {
          current = next;
          notify();
        }
      } catch { /* ignore malformed */ }
    };
    eventSource.onerror = () => {
      // EventSource auto-reconnects; on hard failure (server stopped) we'll
      // sit at the last status indefinitely. That's fine — once Vite restarts
      // the connection re-establishes.
    };
  } catch {
    // Fall back to one-off snapshot via /api/build-watch/status.
    fetch('/api/build-watch/status').then(r => r.json()).then((d) => {
      if (d?.status) {
        current = d.status;
        notify();
      }
    }).catch(() => { /* ignore */ });
  }
}

/** React hook returning the live build-watcher status. */
export function useBuildStatus(): BuildStatus {
  start();
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
