/**
 * Auto-fetch the live page record when in Live mode.
 *
 * Triggers whenever any of (orgUrl, pageEntityTypeName, pageEntityId,
 * reloadEpoch) change AND we're in Live mode AND a profile + entity type +
 * id are all set. Writes the fetched record into `liveRecordCache` so the
 * sync `getEntityData(entityType)` path returns it on the next render.
 *
 * Reload-driven freshness: every `ControlHost.reload()` bumps `reloadEpoch`,
 * which triggers a re-fetch — so user-driven Reload (top bar, FormChrome,
 * DataPanel, bundle hot reload, authoring toggle) all implicitly pull fresh
 * data from Dataverse with no extra UI.
 *
 * Errors:
 * - 401 / 404 from the proxy → DvProxyError → flagged into pacReauthRequired
 *   (existing dv-client behaviour) and an addLogEntry. The control still
 *   renders with empty bound props.
 */

import { useEffect, useRef } from 'react';
import { useHarnessStore } from '../store/harness-store';
import { liveRetrievePageRecord, DvProxyError } from '../api/dv-client';

function classifyError(err: unknown): string {
  if (err instanceof DvProxyError) {
    if (err.status === 404) return 'Record not found';
    if (err.status === 403) return 'Access denied';
    if (err.status === 401) return 'Reauthentication required';
    return `${err.body.error}: ${err.body.message}`;
  }
  return (err as Error).message;
}

// A real Dataverse GUID. Excludes the harness's mock `bulk-…` ids that
// would otherwise trigger a 400 against the live org.
const GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function useLivePageRecord() {
  const dataSource = useHarnessStore(s => s.dataSource);
  const connectionState = useHarnessStore(s => s.liveConnectionState);
  const orgUrl = useHarnessStore(s => s.liveProfile?.orgUrl ?? '');
  const entityType = useHarnessStore(s => s.pageEntityTypeName);
  const entityId = useHarnessStore(s => s.pageEntityId);
  const reloadEpoch = useHarnessStore(s => s.reloadEpoch);
  const cacheLiveRecord = useHarnessStore(s => s.cacheLiveRecord);
  const setPageEntityRecordName = useHarnessStore(s => s.setPageEntityRecordName);
  const setLivePageRecordError = useHarnessStore(s => s.setLivePageRecordError);
  const addLogEntry = useHarnessStore(s => s.addLogEntry);

  // Track the last in-flight fetch so a stale response (e.g. user changed
  // the page id mid-fetch) doesn't overwrite a newer one.
  const inflightRef = useRef(0);

  useEffect(() => {
    if (
      dataSource !== 'live'
      || connectionState !== 'connected'
      || !orgUrl
      || !entityType
      || !entityId
      || !GUID_RE.test(entityId.replace(/[{}]/g, ''))
    ) {
      // Clear any prior error when the live-fetch preconditions aren't met.
      setLivePageRecordError(null);
      return;
    }
    const fetchId = ++inflightRef.current;
    addLogEntry({
      category: 'data', method: 'live.pageRecord.fetch',
      args: { entityType, id: entityId, reloadEpoch },
    });
    void liveRetrievePageRecord(orgUrl, entityType, entityId)
      .then(({ record, primaryName }) => {
        if (fetchId !== inflightRef.current) return; // stale
        cacheLiveRecord(entityType, record);
        setLivePageRecordError(null);
        if (primaryName) setPageEntityRecordName(primaryName);
        addLogEntry({
          category: 'data', method: 'live.pageRecord.ok',
          args: {
            entityType, id: entityId, primaryName,
            columns: Object.keys(record).filter(k => !k.startsWith('@')).length,
          },
        });
      })
      .catch(err => {
        if (fetchId !== inflightRef.current) return; // stale
        const msg = classifyError(err);
        setLivePageRecordError(msg);
        addLogEntry({
          category: 'data', method: 'live.pageRecord.error',
          args: { entityType, id: entityId, message: msg },
        });
      });
  }, [
    dataSource, connectionState, orgUrl, entityType, entityId, reloadEpoch,
    cacheLiveRecord, setPageEntityRecordName, setLivePageRecordError, addLogEntry,
  ]);
}
