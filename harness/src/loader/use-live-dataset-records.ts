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

/**
 * Inject a `<filter><condition attribute=<fk> operator='eq' value=<id>/></filter>`
 * into the outer entity of a FetchXML so an Associated-host dataset is
 * scoped to records that point back at the page-context parent. Mirrors
 * how UCI augments the underlying query with the relationship filter when
 * rendering an Associated grid.
 *
 * If the FetchXML already has a top-level `<filter>`, we append a new
 * `<condition>` inside it (preserves the maker's own filter). Otherwise
 * we add a fresh `<filter type="and">`. Nested link-entity filters are
 * untouched.
 */
function injectParentFilter(
  fetchXml: string,
  fkAttribute: string,
  parentId: string,
): string {
  if (!fkAttribute || !parentId) return fetchXml;
  const condition = `<condition attribute="${fkAttribute}" operator="eq" value="${parentId}"/>`;
  // Find outer <entity ...> open tag.
  const entityRe = /<entity\b[^>]*>/i;
  const openMatch = entityRe.exec(fetchXml);
  if (!openMatch) return fetchXml;
  const openIdx = openMatch.index + openMatch[0].length;
  // Walk inside the outer entity (skipping any link-entity blocks) to find
  // the first top-level <filter ...> open tag, OR the </entity> close.
  let i = openIdx;
  const len = fetchXml.length;
  while (i < len) {
    // Skip link-entity blocks
    const linkOpen = /<link-entity\b/gi; linkOpen.lastIndex = i;
    const filterOpen = /<filter\b[^>]*>/gi; filterOpen.lastIndex = i;
    const entClose = /<\/entity>/gi; entClose.lastIndex = i;
    const nextLink = linkOpen.exec(fetchXml);
    const nextFilter = filterOpen.exec(fetchXml);
    const nextClose = entClose.exec(fetchXml);
    if (!nextClose) return fetchXml;
    // Earliest of the three wins.
    const candidates = [nextLink, nextFilter, nextClose].filter(Boolean) as RegExpExecArray[];
    candidates.sort((a, b) => a.index - b.index);
    const winner = candidates[0];
    if (winner === nextLink) {
      // Skip past matching </link-entity>
      const linkClose = /<\/link-entity>/gi; linkClose.lastIndex = winner.index;
      const m = linkClose.exec(fetchXml);
      if (!m) return fetchXml;
      i = m.index + m[0].length;
      continue;
    }
    if (winner === nextFilter) {
      // Insert the condition immediately after the <filter ...> open tag.
      const insertAt = winner.index + winner[0].length;
      return fetchXml.slice(0, insertAt) + condition + fetchXml.slice(insertAt);
    }
    // winner === nextClose → no existing filter; create one.
    const insertAt = winner.index;
    return fetchXml.slice(0, insertAt) + `<filter type="and">${condition}</filter>` + fetchXml.slice(insertAt);
  }
  return fetchXml;
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
  const pageEntityId = useHarnessStore(s => s.pageEntityId);

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
    // Include host + parent-id digest so a subgrid/associated grid re-fetches
    // when the parent record changes. Subgrid uses the binding's lookupColumn
    // as the FK; associated uses the relationship's referencing attribute.
    const parentFkForDigest = binding?.host === 'associated'
      ? binding.relationshipReferencingAttribute
      : binding?.host === 'subgrid'
        ? binding.lookupColumn
        : undefined;
    const parentIdForDigest = binding?.parentRecordRef?.entityId ?? pageEntityId;
    const hostKey = parentFkForDigest
      ? `${binding?.host}:${parentFkForDigest}:${parentIdForDigest}`
      : binding?.host ?? '';
    return `${ds.name}|${view.entityType}|${view.viewId}|${(view.fetchXml ?? '').length}|${hostKey}`;
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
        args: { dataset: ds.name, entityType, viewId, reloadEpoch,
          host: binding?.host,
          relationship: binding?.relationshipName,
          parentId: (binding?.host === 'associated' || binding?.host === 'subgrid')
            ? (binding?.parentRecordRef?.entityId ?? pageEntityId)
            : undefined,
        },
      });

      // Compose the FetchXML: all-attributes for full column coverage, plus
      // a parent-FK filter for subgrid (binding.lookupColumn) or associated
      // (binding.relationshipReferencingAttribute). The filter is skipped
      // (with a logged warning) when the FK or parent id is missing — the
      // maker sees an unfiltered fetch instead of a silent empty result.
      let outgoingFetchXml = injectAllAttributes(view.fetchXml);
      if (binding?.host === 'subgrid' || binding?.host === 'associated') {
        const fk = binding.host === 'associated'
          ? binding.relationshipReferencingAttribute
          : binding.lookupColumn;
        const parentId = binding.parentRecordRef?.entityId ?? pageEntityId;
        if (fk && parentId) {
          outgoingFetchXml = injectParentFilter(outgoingFetchXml, fk, parentId);
        } else {
          addLogEntry({
            category: 'data', method: `live.datasetRecords.${binding.host}Skipped`,
            args: { dataset: ds.name,
              reason: !fk
                ? (binding.host === 'subgrid' ? 'no lookup column set' : 'no relationship picked')
                : 'no parent record',
            },
          });
        }
      }

      void liveRetrieveByFetchXml(orgUrl, entityType, outgoingFetchXml)
        .then(({ entities }) => {
          if (fetchId !== inflightRef.current[ds.name]) return; // stale
          const rowKeys = entities[0]
            ? Object.keys(entities[0]).filter(k => !k.startsWith('@'))
            : [];

          // CRITICAL ordering: re-derive bindings FIRST, then publish rows.
          // The system view's <attribute> list often omits lookup columns
          // (the view shows the display name via <link-entity>), so the
          // derive-on-adopt couldn't map them. If we land rows before
          // fixing bindings, the React store update fires updateView while
          // bindings still point at non-existent fields — record.getValue
          // returns null, and the control crashes on .id.guid before we
          // get a chance to fix the binding.
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

          // Now safe to publish the rows.
          addLiveFetches(entityType, entities as Record<string, any>[]);
          addLogEntry({
            category: 'data', method: 'live.datasetRecords.ok',
            args: { dataset: ds.name, entityType, viewId, count: entities.length, sampleKeys: rowKeys.slice(0, 40) },
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
