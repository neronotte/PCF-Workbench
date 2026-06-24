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
import { deriveColumnBindingsFromCandidates } from '../lib/auto-column-bindings';

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

/**
 * Inject `<all-attributes/>` into the entity element of a FetchXML so every
 * column of the row entity comes back from Dataverse, regardless of which
 * `<attribute>` entries the saved view defined. PCF dataset controls call
 * `record.getValue(<property-set>)` with their manifest column names — many
 * lookups (e.g. `_msdyn_product_value`) are NOT included in stock system
 * views because the view shows the display name via a `<link-entity>`. If
 * we send only the view's attributes the OData response won't include the
 * lookup foreign key, `getValue` returns null, and the control crashes on
 * `.id.guid`. Adding `<all-attributes/>` is the simplest fix and mirrors
 * how UCI augments the underlying query with bound columns. Existing
 * `<attribute>` entries are stripped (they're redundant with all-attributes
 * and Dataverse rejects mixing the two on the same entity).
 */
function injectAllAttributes(fetchXml: string): string {
  // Find the OUTER <entity name="..."> element of the root <fetch>. Don't
  // touch nested <link-entity> elements — those still want explicit columns.
  const entityRe = /<entity\b[^>]*>/i;
  const openMatch = entityRe.exec(fetchXml);
  if (!openMatch) return fetchXml;
  const openIdx = openMatch.index + openMatch[0].length;
  // Find the matching close. Naive: take everything to the first </entity>
  // that isn't inside a <link-entity>. We do this by walking entity tags.
  let depth = 1;
  let i = openIdx;
  const len = fetchXml.length;
  const linkOpen = /<link-entity\b/gi;
  const linkClose = /<\/link-entity>/gi;
  const entClose = /<\/entity>/gi;
  // Simpler approach: take innerXml from openIdx to first </entity> not in a
  // link block. We'll regex search forward.
  let closeIdx = -1;
  while (i < len) {
    linkOpen.lastIndex = i; entClose.lastIndex = i;
    const nextLink = linkOpen.exec(fetchXml);
    const nextEnt = entClose.exec(fetchXml);
    if (!nextEnt) break;
    if (nextLink && nextLink.index < nextEnt.index) {
      // skip past matching </link-entity>
      linkClose.lastIndex = nextLink.index;
      const m = linkClose.exec(fetchXml);
      if (!m) break;
      i = m.index + m[0].length;
      continue;
    }
    closeIdx = nextEnt.index;
    break;
  }
  if (closeIdx < 0) return fetchXml;
  const inner = fetchXml.slice(openIdx, closeIdx);
  // Strip top-level <attribute .../> from the outer entity inner XML. Be
  // careful not to strip attributes inside <link-entity>.
  let depthInner = 0;
  const out: string[] = [];
  const tokenRe = /<\/?(?:link-entity|attribute|all-attributes)\b[^>]*\/?>/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(inner)) !== null) {
    const tag = m[0];
    out.push(inner.slice(last, m.index));
    const isLinkOpen = /^<link-entity\b/i.test(tag);
    const isLinkClose = /^<\/link-entity\b/i.test(tag);
    const isAttr = /^<attribute\b/i.test(tag);
    const isAllAttr = /^<all-attributes\b/i.test(tag);
    if (isLinkOpen && !/\/>$/.test(tag)) {
      depthInner++;
      out.push(tag);
    } else if (isLinkClose) {
      depthInner = Math.max(0, depthInner - 1);
      out.push(tag);
    } else if ((isAttr || isAllAttr) && depthInner === 0) {
      // drop — we'll inject <all-attributes/> at the front
    } else {
      out.push(tag);
    }
    last = m.index + tag.length;
  }
  out.push(inner.slice(last));
  const newInner = '<all-attributes/>' + out.join('');
  return fetchXml.slice(0, openIdx) + newInner + fetchXml.slice(closeIdx);
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
  const setDatasetBinding = useHarnessStore(s => s.setDatasetBinding);

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

      void liveRetrieveByFetchXml(orgUrl, entityType, injectAllAttributes(view.fetchXml))
        .then(({ entities }) => {
          if (fetchId !== inflightRef.current[ds.name]) return; // stale
          addLiveFetches(entityType, entities as Record<string, any>[]);
          // Sample the first row's keys so the maker can see (in the log)
          // every field that's available for property-set bindings. Helps
          // debug "control returned null on .id.guid" crashes.
          const rowKeys = entities[0]
            ? Object.keys(entities[0]).filter(k => !k.startsWith('@'))
            : [];
          addLogEntry({
            category: 'data', method: 'live.datasetRecords.ok',
            args: { dataset: ds.name, entityType, viewId, count: entities.length, sampleKeys: rowKeys.slice(0, 40) },
          });

          // Post-fetch auto-derive: the system view's <attribute> list often
          // omits lookup columns (because the view shows the display name via
          // <link-entity>), so derive-on-adopt couldn't map them. Now that
          // we have the actual row keys (including `_<lookup>_value`), fill
          // in any property-set that's still unbound.
          if (ds.columns.length > 0 && rowKeys.length > 0) {
            const current = useHarnessStore.getState().datasetBindings[ds.name];
            const unboundColumns = ds.columns.filter(c => !current?.columnBindings?.[c.name]);
            if (unboundColumns.length > 0) {
              const { bindings: extra, matched: extraMatched } =
                deriveColumnBindingsFromCandidates(unboundColumns, rowKeys, undefined);
              if (extraMatched.length > 0) {
                setDatasetBinding(ds.name, {
                  ...current!,
                  columnBindings: { ...(current?.columnBindings ?? {}), ...extra },
                });
                addLogEntry({
                  category: 'data', method: 'live.datasetRecords.autoBind',
                  args: { dataset: ds.name, matched: extraMatched },
                });
              }
            }
          }
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
