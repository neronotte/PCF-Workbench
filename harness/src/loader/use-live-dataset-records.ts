/**
 * Auto-fetch live dataset records when in Live mode.
 *
 * For each manifest dataset, resolves the active binding's view (mirroring
 * what the dataset shim does in `resolveViewForBinding`). If the resolved
 * view carries a FetchXML payload (savedquery / userquery / inline), fires
 * `liveRetrieveByFetchXml` and lands the rows in `liveFetchBuffer` so the
 * sync `getEntityData(entity)` path returns them on the next render.
 *
 * Re-runs when any of these change:
 *  - dataSource flips to live
 *  - liveProfile.orgUrl changes
 *  - any binding's view selector changes (we key on a stable digest of
 *    `{ entityType, viewId, fetchXml }` per dataset)
 *  - reloadEpoch bumps (top bar Reload, FormChrome refresh, etc.)
 *
 * Errors are surfaced via `addLogEntry` with category 'data'. Stale-response
 * suppression uses a per-dataset inflight ref so view-switching mid-fetch
 * doesn't overwrite the newer result.
 */

import { useEffect, useRef } from 'react';
import { useHarnessStore } from '../store/harness-store';
import {
  liveRetrieveByFetchXml,
  DvProxyError,
  getCachedLiveView,
} from '../api/dv-client';
import { resolveViewForBinding } from '../shim/context-factory';
import type { ManifestDataSet } from '../types/manifest';

function classifyError(err: unknown): string {
  if (err instanceof DvProxyError) {
    if (err.status === 404) return 'Entity set not found';
    if (err.status === 403) return 'Access denied';
    if (err.status === 401) return 'Reauthentication required';
    if (err.status === 400) return `Bad FetchXML: ${err.body.message}`;
    return `${err.body.error}: ${err.body.message}`;
  }
  return (err as Error).message;
}

export function useLiveDatasetRecords() {
  const dataSource = useHarnessStore(s => s.dataSource);
  const connectionState = useHarnessStore(s => s.liveConnectionState);
  const orgUrl = useHarnessStore(s => s.liveProfile?.orgUrl ?? '');
  const reloadEpoch = useHarnessStore(s => s.reloadEpoch);
  const manifest = useHarnessStore(s => s.manifest);
  const datasetBindings = useHarnessStore(s => s.datasetBindings);
  const addLiveFetches = useHarnessStore(s => s.addLiveFetches);
  const addLogEntry = useHarnessStore(s => s.addLogEntry);

  // Per-dataset inflight counter — keyed by dataset name. Each new fetch
  // increments; only the response whose id matches at completion is kept.
  const inflightRef = useRef<Record<string, number>>({});

  // Build a digest of the active view per dataset so the effect's dep list
  // is stable across renders that don't actually change view state. Touch
  // getCachedLiveView so live-cache hydration also re-triggers (the cache
  // populates async from LiveViewsRow's auto-fetch).
  const dataSets: ManifestDataSet[] = manifest?.dataSets ?? [];
  const viewDigests = dataSets.map(ds => {
    const binding = datasetBindings[ds.name];
    const view = resolveViewForBinding(ds, binding, ds.name);
    // Probe the live cache so a cache miss → cache hit transition between
    // renders re-runs the effect (returns same string when nothing cached).
    if (binding && !view.fetchXml && typeof binding.view === 'object' && 'viewId' in binding.view && binding.view.viewId) {
      getCachedLiveView(binding.view.viewId);
    }
    return `${ds.name}|${view.entityType}|${view.viewId}|${(view.fetchXml ?? '').length}`;
  });
  const digestKey = viewDigests.join('||');

  useEffect(() => {
    if (dataSource !== 'live' || !orgUrl || dataSets.length === 0) return;

    for (const ds of dataSets) {
      const binding = datasetBindings[ds.name];
      const view = resolveViewForBinding(ds, binding, ds.name);
      if (!view.fetchXml || !view.entityType) continue;

      const fetchId = (inflightRef.current[ds.name] ?? 0) + 1;
      inflightRef.current[ds.name] = fetchId;
      const entityType = view.entityType;
      const viewId = view.viewId;

      addLogEntry({
        category: 'data', method: 'live.datasetRecords.fetch',
        args: { dataset: ds.name, entityType, viewId, reloadEpoch },
      });

      void liveRetrieveByFetchXml(orgUrl, entityType, view.fetchXml)
        .then(({ entities }) => {
          if (fetchId !== inflightRef.current[ds.name]) return; // stale
          addLiveFetches(entityType, entities as Record<string, any>[]);
          addLogEntry({
            category: 'data', method: 'live.datasetRecords.ok',
            args: { dataset: ds.name, entityType, viewId, count: entities.length },
          });
        })
        .catch(err => {
          if (fetchId !== inflightRef.current[ds.name]) return; // stale
          addLogEntry({
            category: 'data', method: 'live.datasetRecords.error',
            args: { dataset: ds.name, entityType, viewId, message: classifyError(err) },
          });
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSource, orgUrl, reloadEpoch, digestKey]);
}
