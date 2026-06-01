import { useState, useCallback, useEffect } from 'react';
import {
  makeStyles, tokens, Button, Badge, Textarea, MessageBar, MessageBarBody, Checkbox,
  Radio, RadioGroup, Dropdown, Option, Spinner, Label, Input,
} from '@fluentui/react-components';
import { ArrowClockwise24Regular, Save24Regular, Globe16Regular, ArrowDownload24Regular } from '@fluentui/react-icons';
import { useHarnessStore, type DataSource, type PublicProfile } from '../../store/harness-store';
import { loadEntityData, getEntityStoreKeys, getEntityData } from '../../store/data-store';
import { rebaseDatesToToday } from '../../store/date-rebase';
import { listProfiles, DvProxyError, getLiveLoadedEntities } from '../../api/dv-client';
import { loadAllScenarios, applyScenarioAsActive, captureAndSaveAsNewScenario } from '../../lib/scenario-store';
import { isLiveBlocked, liveBlockReason } from '../../lib/live-block';

const useStyles = makeStyles({
  root: {
    padding: '12px',
    overflowX: 'hidden',
    overflowY: 'hidden',
    boxSizing: 'border-box',
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    gap: '8px',
  },
  header: {
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
  },
  tableList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  tableItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 8px',
    borderRadius: tokens.borderRadiusMedium,
    cursor: 'pointer',
    fontSize: tokens.fontSizeBase200,
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground3,
    },
  },
  tableItemActive: {
    backgroundColor: tokens.colorBrandBackground,
    color: 'white',
    '&:hover': {
      backgroundColor: tokens.colorBrandBackground,
    },
  },
  tableName: {
    flex: 1,
    fontFamily: "'Consolas', monospace",
  },
  editorArea: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    minHeight: 0,
  },
  editorHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: tokens.fontSizeBase200,
  },
  textarea: {
    flex: 1,
    fontFamily: "'Consolas', monospace",
    fontSize: '11px',
    width: '100%',
    maxWidth: '100%',
    '& textarea': {
      width: '100% !important',
      maxWidth: '100% !important',
      boxSizing: 'border-box',
    },
  },
  actions: {
    display: 'flex',
    gap: '4px',
  },
  info: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  modeBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '8px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  liveOnline: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorPaletteRedForeground1,
    fontWeight: tokens.fontWeightSemibold,
  },
  pageCtxBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '8px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  pageCtxField: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  pageCtxLabel: {
    fontSize: tokens.fontSizeBase200,
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: '8px',
  },
  pageCtxHint: {
    fontFamily: "'Consolas', monospace",
    fontSize: '10px',
    color: tokens.colorNeutralForeground4,
  },
});

interface DataSummary {
  tables: { name: string; count: number }[];
  totalRecords: number;
}

function getDataSummary(): DataSummary {
  // We need to inspect what's loaded — scan common table names
  // Since the data store doesn't expose all keys, we'll track them via a reload
  return { tables: [], totalRecords: 0 };
}

/* -------------------------------------------------------------------------- */
/* Page Context — identifies the record the harness is "sitting on".          */
/* Drives Mock lookup (via getEntityData) AND Live page-record auto-fetch.    */
/* Lives on the Data tab (not Properties) because conceptually it's part of   */
/* the data source, not control configuration.                                */
/* -------------------------------------------------------------------------- */

function PageContextBlock({ mockTableNames }: { mockTableNames: string[] }) {
  const styles = useStyles();
  const dataSource = useHarnessStore(s => s.dataSource);
  const pageEntityTypeName = useHarnessStore(s => s.pageEntityTypeName);
  const pageEntityId = useHarnessStore(s => s.pageEntityId);
  const pageEntityRecordName = useHarnessStore(s => s.pageEntityRecordName);
  const setPageEntityTypeName = useHarnessStore(s => s.setPageEntityTypeName);
  const setPageEntityId = useHarnessStore(s => s.setPageEntityId);
  const setPageEntityRecordName = useHarnessStore(s => s.setPageEntityRecordName);
  const livePageRecordError = useHarnessStore(s => s.livePageRecordError);

  // In Mock mode the entity-type list comes from data.json; in Live mode
  // it's free-text (any logical name resolvable via EntityDefinitions).
  const showDropdown = dataSource === 'mock' && mockTableNames.length > 0;
  const isLive = dataSource === 'live';

  return (
    <div className={styles.pageCtxBlock} data-test-id="page-context-block">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          className={styles.header}
          title="Page context — what the harness tells the control about the record/form it is hosted on. Drives context.page.entityTypeName / entityId and context.mode.contextInfo. Change these to test the control against different entity types and records."
        >
          Page context
        </span>
        <span className={styles.info} style={{ marginLeft: 'auto' }}>
          context.page / context.mode.contextInfo
        </span>
      </div>
      <div className={styles.pageCtxField}>
        <div className={styles.pageCtxLabel}>
          <span>Entity type name</span>
          <span className={styles.pageCtxHint}>page.entityTypeName</span>
        </div>
        {showDropdown ? (
          <Dropdown
            size="small"
            placeholder="Select entity type"
            selectedOptions={pageEntityTypeName ? [pageEntityTypeName] : []}
            value={pageEntityTypeName}
            onOptionSelect={(_, d) => setPageEntityTypeName(d.optionValue ?? '')}
          >
            <Option value="" text="">— None —</Option>
            {mockTableNames.map(t => (
              <Option key={t} value={t} text={t}>{t}</Option>
            ))}
          </Dropdown>
        ) : (
          <Input
            size="small"
            placeholder={isLive ? 'e.g. contact' : 'e.g. msdyn_workorderservicetask'}
            value={pageEntityTypeName}
            onChange={(_, d) => setPageEntityTypeName(d.value)}
          />
        )}
      </div>
      <div className={styles.pageCtxField}>
        <div className={styles.pageCtxLabel}>
          <span>Entity ID</span>
          <span className={styles.pageCtxHint}>page.entityId</span>
        </div>
        <Input
          size="small"
          placeholder="Record GUID"
          value={pageEntityId}
          onChange={(_, d) => setPageEntityId(d.value)}
          data-test-id="page-context-entity-id"
        />
        {isLive && livePageRecordError && pageEntityTypeName && pageEntityId && (
          <MessageBar intent="error" data-test-id="page-context-error" style={{ marginTop: 4 }}>
            <MessageBarBody>{livePageRecordError}</MessageBarBody>
          </MessageBar>
        )}
      </div>
      <div className={styles.pageCtxField}>
        <div className={styles.pageCtxLabel}>
          <span>Entity record name</span>
          <span className={styles.pageCtxHint}>
            {isLive ? 'auto-derived from PrimaryNameAttribute' : 'contextInfo.entityRecordName'}
          </span>
        </div>
        <Input
          size="small"
          placeholder={isLive ? 'Populates after successful fetch' : 'Record name'}
          value={pageEntityRecordName}
          onChange={(_, d) => setPageEntityRecordName(d.value)}
          readOnly={isLive}
          disabled={isLive}
        />
      </div>
      {isLive && pageEntityTypeName && pageEntityId && !livePageRecordError && (
        <div className={styles.info} style={{ marginTop: 4 }}>
          Auto-fetches from Dataverse on Reload.
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Live mode subpanel                                                          */
/* -------------------------------------------------------------------------- */

function SnapshotLiveToMockButton() {
  const liveFetchBuffer = useHarnessStore(s => s.liveFetchBuffer);
  const liveRecordCache = useHarnessStore(s => s.liveRecordCache);
  const snapshot = useHarnessStore(s => s.snapshotLiveToMock);
  const activeScenarioName = useHarnessStore(s => s.activeScenarioName);
  const manifest = useHarnessStore(s => s.manifest);
  const addLogEntry = useHarnessStore(s => s.addLogEntry);
  const [flash, setFlash] = useState<string | null>(null);

  // Count what's available without re-deriving on every render
  const bufferEntityCount = Object.keys(liveFetchBuffer).length;
  const bufferRecordCount = Object.values(liveFetchBuffer).reduce(
    (n, byId) => n + Object.keys(byId).length,
    0,
  );
  const cachedPageRecords = Object.keys(liveRecordCache).length;
  const total = bufferRecordCount + (cachedPageRecords > bufferEntityCount ? cachedPageRecords - bufferEntityCount : 0);
  const hasData = bufferRecordCount > 0 || cachedPageRecords > 0;

  const onSnapshot = useCallback(() => {
    const result = snapshot();
    addLogEntry({ category: 'data', method: 'snapshotLiveToMock', args: result });
    const written = result.addedCount + result.updatedCount;
    const detail = result.updatedCount > 0
      ? `${result.addedCount} added, ${result.updatedCount} updated`
      : `${result.addedCount} added`;
    const msg = activeScenarioName
      ? `Merged ${written} record(s) (${detail}) across ${result.entityCount} entity type(s). Existing mock entities preserved. Click Save to persist into "${activeScenarioName}".`
      : `Merged ${written} record(s) (${detail}) across ${result.entityCount} entity type(s). Existing mock entities preserved. Switched to Mock mode.`;
    setFlash(msg);
    window.setTimeout(() => setFlash(null), 6000);
  }, [snapshot, addLogEntry, activeScenarioName]);

  // P2: capture into a brand-new scenario without dirtying the current one.
  // Timestamped name lets the user kick off many captures in a row.
  const onCaptureAsNew = useCallback(async () => {
    if (!manifest) return;
    const result = snapshot();
    const controlId = `${manifest.namespace}.${manifest.constructor}`;
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const baseName = `Live capture ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const saved = await captureAndSaveAsNewScenario(controlId, baseName);
    const written = result.addedCount + result.updatedCount;
    addLogEntry({ category: 'data', method: 'captureAsNewScenario', args: { name: saved.name, ...result } });
    setFlash(`Captured ${written} record(s) across ${result.entityCount} entity type(s) into new scenario "${saved.name}". Saved to disk.`);
    window.setTimeout(() => setFlash(null), 6000);
  }, [manifest, snapshot, addLogEntry]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <Button
          appearance="primary"
          size="small"
          icon={<ArrowDownload24Regular />}
          onClick={onSnapshot}
          disabled={!hasData}
          title={hasData
            ? `Promote ${total} buffered live record(s) into the mock entity store, switch to Mock mode, and mark the active scenario dirty. Save the scenario afterwards to persist to disk.`
            : 'No live records buffered yet. Render the control or fetch records via context.webAPI to populate the buffer.'}
          data-test-id="snapshot-live-to-mock"
        >
          Snapshot live → mock ({total})
        </Button>
        <Button
          appearance="secondary"
          size="small"
          icon={<Save24Regular />}
          onClick={() => { void onCaptureAsNew(); }}
          disabled={!hasData || !manifest}
          title={hasData
            ? 'Capture buffered records into a brand-new scenario named "Live capture <timestamp>" and switch to it as active. Saves to disk immediately; does not dirty or overwrite the current scenario.'
            : 'No live records buffered yet.'}
          data-test-id="capture-as-new-scenario"
        >
          Capture as new scenario
        </Button>
      </div>
      {flash && (
        <MessageBar intent="success">
          <MessageBarBody>{flash}</MessageBarBody>
        </MessageBar>
      )}
      {hasData && (
        <div style={{ fontSize: 11, color: tokens.colorNeutralForeground3, lineHeight: 1.5 }} data-test-id="live-buffer-inspector">
          <div style={{ marginBottom: 2 }}><strong>Buffered live retrieves</strong> — captured by every <code>retrieveRecord</code> / <code>retrieveMultipleRecords</code> in live mode. Click Snapshot to merge into mock; existing entities are preserved.</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {Object.entries(liveFetchBuffer)
              .filter(([, byId]) => Object.keys(byId).length > 0)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([entityType, byId]) => (
                <Badge key={entityType} appearance="outline" size="small" data-test-id={`live-buffer-entry-${entityType}`}>
                  {entityType} · {Object.keys(byId).length}
                </Badge>
              ))}
          </div>
          {Object.keys(liveFetchBuffer).length === 0 && cachedPageRecords > 0 && (
            <div style={{ fontStyle: 'italic' }}>
              Page record only ({cachedPageRecords} entity type(s)). Trigger more fetches to capture related data.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LiveModeControls() {
  const liveProfile = useHarnessStore(s => s.liveProfile);
  const liveProfiles = useHarnessStore(s => s.liveProfiles);
  const setLiveProfile = useHarnessStore(s => s.setLiveProfile);
  const setLiveProfiles = useHarnessStore(s => s.setLiveProfiles);
  const setReauth = useHarnessStore(s => s.setPacReauthRequired);
  const reloadControl = useHarnessStore(s => s.reloadControl);
  const addLogEntry = useHarnessStore(s => s.addLogEntry);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { profiles, current } = await listProfiles();
      setLiveProfiles(profiles);
      addLogEntry({ category: 'data', method: 'listProfiles', args: { count: profiles.length } });
      // Restore last-used org from localStorage, else current PAC profile.
      let chosen: PublicProfile | null = null;
      try {
        const last = localStorage.getItem('pcf.liveOrgUrl');
        if (last) chosen = profiles.find(p => p.orgUrl === last) ?? null;
      } catch { /* ignore */ }
      if (!chosen && current) {
        chosen = profiles.find(p => p.orgUrl === current) ?? null;
      }
      if (!chosen && profiles.length > 0) chosen = profiles[0];
      // Only auto-select if nothing is currently selected.
      if (!liveProfile && chosen) setLiveProfile(chosen);
    } catch (e) {
      const msg = e instanceof DvProxyError
        ? `${e.body.error}: ${e.body.message}`
        : (e as Error).message;
      setError(msg);
      addLogEntry({ category: 'data', method: 'listProfiles.error', args: { message: msg } });
    } finally {
      setLoading(false);
    }
  }, [setLiveProfiles, setLiveProfile, addLogEntry, liveProfile]);

  // Lazy-load on first mount of Live controls.
  useEffect(() => {
    if (liveProfiles.length === 0 && !loading) {
      void refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSelect = useCallback((orgUrl: string) => {
    const profile = liveProfiles.find(p => p.orgUrl === orgUrl) ?? null;
    setLiveProfile(profile);
    setReauth(null);
    reloadControl?.();
  }, [liveProfiles, setLiveProfile, setReauth, reloadControl]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Dropdown
          size="small"
          placeholder="Select PAC profile…"
          value={liveProfile?.friendlyName ?? ''}
          selectedOptions={liveProfile ? [liveProfile.orgUrl] : []}
          onOptionSelect={(_, d) => onSelect(d.optionValue ?? '')}
          disabled={loading || liveProfiles.length === 0}
          style={{ flex: 1, minWidth: 0 }}
          data-test-id="live-profile-dropdown"
        >
          {liveProfiles.map(p => (
            <Option key={p.orgUrl} value={p.orgUrl} text={p.friendlyName}>
              {p.friendlyName}
              {p.isCurrent ? ' (current)' : ''}
            </Option>
          ))}
        </Dropdown>
        <Button
          appearance="subtle"
          size="small"
          icon={loading ? <Spinner size="tiny" /> : <ArrowClockwise24Regular />}
          onClick={() => void refresh()}
          disabled={loading}
          title="Re-list PAC profiles (pac auth list)"
          aria-label="Refresh profiles"
        />
      </div>

      {liveProfile && (
        <div style={{ fontSize: 11, color: tokens.colorNeutralForeground3, lineHeight: 1.4 }}>
          <div><strong>User:</strong> {liveProfile.user}</div>
          <div><strong>Org:</strong> <code style={{ fontSize: 10 }}>{liveProfile.orgUrl}</code></div>
          {liveProfile.environmentType && (
            <div><strong>Environment:</strong> {liveProfile.environmentType}{liveProfile.environmentGeo ? ` · ${liveProfile.environmentGeo}` : ''}</div>
          )}
        </div>
      )}

      <SnapshotLiveToMockButton />

      <LiveMetadataInspector />

      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}

      {liveProfiles.length === 0 && !loading && !error && (
        <MessageBar intent="warning">
          <MessageBarBody>
            No PAC profiles found. Run <code>pac auth create --url &lt;your-org&gt;</code> in a terminal, then click refresh.
          </MessageBarBody>
        </MessageBar>
      )}

      <div style={{ fontSize: 11, color: tokens.colorNeutralForeground3 }}>
        Live mode: reads via <code>context.webAPI</code> are direct; writes
        prompt a per-call confirm dialog (M2.P4). Metadata is fetched from{' '}
        <code>EntityDefinitions</code> on first access (M2.P5).
      </div>
    </div>
  );
}

/**
 * M2.P5 — Compact inspector listing every entity whose metadata has been
 * hydrated from the live org this session. Helps debug "why is the display
 * name wrong?" by making the cache observable.
 */
function LiveMetadataInspector() {
  const dataVersion = useHarnessStore(s => s.dataVersion);
  // Re-read from dv-client every render keyed off dataVersion (bumped after
  // each successful ensureLiveAttributeMetadata fetch).
  const entities = (() => {
    try {
      // Lazy require pattern via dynamic import would be cleaner but adds
      // async; the function is sync + cheap so a static import is fine.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return getLiveLoadedEntities();
    } catch {
      return [];
    }
  })();
  // dataVersion is referenced so the effect picks up cache-clear bumps too.
  void dataVersion;

  if (entities.length === 0) {
    return (
      <div style={{ fontSize: 11, color: tokens.colorNeutralForeground3 }} data-test-id="live-metadata-inspector-empty">
        Live metadata cache is empty. <code>context.utils.getEntityMetadata(...)</code>{' '}
        will populate it on first call.
      </div>
    );
  }
  return (
    <div style={{ fontSize: 11, color: tokens.colorNeutralForeground3 }} data-test-id="live-metadata-inspector">
      <div style={{ marginBottom: 2 }}><strong>Live metadata cache</strong> ({entities.length})</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {entities.map(e => (
          <Badge key={e} appearance="outline" size="small" data-test-id={`live-meta-entry-${e}`}>{e}</Badge>
        ))}
      </div>
    </div>
  );
}

export function DataPanel() {
  const styles = useStyles();
  const addLogEntry = useHarnessStore(s => s.addLogEntry);
  const rebaseEnabled = useHarnessStore(s => s.rebaseDatesToToday);
  const setRebaseEnabled = useHarnessStore(s => s.setRebaseDatesToToday);
  const dataSource = useHarnessStore(s => s.dataSource);
  const setDataSource = useHarnessStore(s => s.setDataSource);
  const reloadControl = useHarnessStore(s => s.reloadControl);
  const activeScenarioName = useHarnessStore(s => s.activeScenarioName);
  const manifest = useHarnessStore(s => s.manifest);
  const [tables, setTables] = useState<{ name: string; records: any[] }[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [editJson, setEditJson] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Hydrate the panel's local `tables` list from the in-memory entity store.
  // The store is populated by ScenarioHeader on first load (via the active
  // scenario's `dataRecords`, falling back to a one-shot legacy data.json
  // migration). DataPanel never fetches data.json itself.
  const hydrateFromStore = useCallback(() => {
    const keys = getEntityStoreKeys();
    const tableList = keys.map(name => ({ name, records: getEntityData(name) }));
    setTables(tableList);
    setLoaded(true);
  }, []);

  // Reset the entity store back to whatever the active scenario carries.
  // Replaces the previous "Reload data.json" affordance — scenarios are now
  // the source of truth, so reverting means re-applying the active scenario.
  const resetToActiveScenario = useCallback(async () => {
    if (!activeScenarioName || !manifest) {
      hydrateFromStore();
      return;
    }
    const controlId = `${manifest.namespace}.${manifest.constructor}`;
    const list = await loadAllScenarios(controlId);
    const active = list.find(s => s.name === activeScenarioName);
    if (active) {
      applyScenarioAsActive(controlId, active);
      addLogEntry({ category: 'data', method: 'reset-to-scenario', args: { scenario: active.name } });
    }
    hydrateFromStore();
  }, [activeScenarioName, manifest, hydrateFromStore, addLogEntry]);

  // Initial hydration + react to dataVersion bumps (scenario applied,
  // user edits, snapshot live → mock, etc.).
  const dataVersion = useHarnessStore(s => s.dataVersion);
  useEffect(() => {
    hydrateFromStore();
  }, [hydrateFromStore, dataVersion, activeScenarioName]);

  const handleSelectTable = useCallback((name: string) => {
    setSelectedTable(name);
    const table = tables.find(t => t.name === name);
    if (table) {
      setEditJson(JSON.stringify(table.records, null, 2));
      setEditError(null);
    }
  }, [tables]);

  const handleSaveTable = useCallback(() => {
    if (!selectedTable) return;
    try {
      const parsed = JSON.parse(editJson);
      if (!Array.isArray(parsed)) {
        setEditError('Data must be a JSON array of records');
        return;
      }
      // Update in-memory store
      const allData: Record<string, any[]> = {};
      for (const t of tables) {
        allData[t.name] = t.name === selectedTable ? parsed : t.records;
      }
      loadEntityData(allData);
      setTables(tables.map(t => t.name === selectedTable ? { ...t, records: parsed } : t));
      setEditError(null);
      addLogEntry({ category: 'data', method: 'updateTable', args: { table: selectedTable, records: parsed.length } });
    } catch (err: any) {
      setEditError(`Invalid JSON: ${err.message}`);
    }
  }, [selectedTable, editJson, tables, addLogEntry]);

  return (
    <div className={styles.root}>
      <div className={styles.modeBlock}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            className={styles.header}
            title="Data source — choose where context.webAPI gets its records. Mock = the active scenario's dataRecords (default; deterministic, offline-safe; persisted in test-scenarios.json). Live = a real Dataverse environment via PAC CLI auth (read-only by default, writes require confirmation)."
          >
            Data source
          </span>
          {dataSource === 'live' && (
            <span className={styles.liveOnline}>
              <Globe16Regular />
              LIVE
            </span>
          )}
          <span style={{ flex: 1 }} />
          <Button
            appearance="subtle"
            size="small"
            icon={<ArrowClockwise24Regular />}
            onClick={() => reloadControl?.()}
            disabled={!reloadControl}
            title="Reload control (full destroy + init + updateView)"
            data-test-id="data-panel-reload"
          >
            Reload
          </Button>
        </div>
        <RadioGroup
          value={dataSource}
          onChange={(_, d) => setDataSource(d.value as DataSource)}
          layout="horizontal"
          data-test-id="data-source-radio"
        >
          <Radio value="mock" label="Mock (scenario)" />
          <Radio
            value="live"
            label="Live (PAC)"
            disabled={isLiveBlocked()}
            title={isLiveBlocked() ? liveBlockReason() : undefined}
          />
        </RadioGroup>
        {isLiveBlocked() && (
          <MessageBar intent="warning" data-test-id="live-blocked-banner">
            <MessageBarBody>
              <strong>Live mode is blocked.</strong> {liveBlockReason()} Any scenario carrying <code>dataSource: 'live'</code> will fall back to mock.
            </MessageBarBody>
          </MessageBar>
        )}
        {dataSource === 'live' && <LiveModeControls />}
      </div>

      <PageContextBlock mockTableNames={tables.map(t => t.name)} />

      {dataSource === 'mock' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              className={styles.header}
              title="Mock Data — in-memory entity records sourced from the active scenario's dataRecords. Edit JSON below to add/modify records; changes flow into context.webAPI immediately and mark the scenario as dirty. Save the scenario to persist edits to disk. Use 'Rebase dates to today' so seeded timestamps stay relative to now."
            >
              Mock Data
            </span>
            <Button
              appearance="subtle"
              icon={<ArrowClockwise24Regular />}
              size="small"
              onClick={() => { void resetToActiveScenario(); }}
              disabled={!activeScenarioName}
              title={activeScenarioName
                ? `Reset mock data to "${activeScenarioName}" scenario's saved records (discards unsaved edits in this panel).`
                : 'No active scenario to reset to.'}
            />
          </div>

          <Checkbox
            checked={rebaseEnabled}
            onChange={(_, d) => setRebaseEnabled(!!d.checked)}
            label="Rebase dates to today"
            style={{ marginBottom: 4 }}
          />

          {tables.length === 0 && loaded && (
            <div className={styles.info}>
              No mock records yet. Add a table by editing JSON in any other entity, or
              create one in the active scenario by editing below:
              <pre style={{ fontSize: 10, marginTop: 4, whiteSpace: 'pre-wrap' }}>
{`{
  "tableName": [
    { "id": "...", "name": "..." }
  ]
}`}
              </pre>
            </div>
          )}

          <div className={styles.tableList}>
            {tables.map(t => (
              <div
                key={t.name}
                className={`${styles.tableItem} ${selectedTable === t.name ? styles.tableItemActive : ''}`}
                onClick={() => handleSelectTable(t.name)}
              >
                <span className={styles.tableName}>{t.name}</span>
                <Badge appearance="filled" color={selectedTable === t.name ? 'subtle' : 'informative'} size="small">
                  {t.records.length}
                </Badge>
              </div>
            ))}
          </div>

          {selectedTable && (
            <div className={styles.editorArea}>
              <div className={styles.editorHeader}>
                <span style={{ fontWeight: 600 }}>{selectedTable}</span>
                <span className={styles.info}>({tables.find(t => t.name === selectedTable)?.records.length} records)</span>
                <span style={{ flex: 1 }} />
                <Button
                  appearance="primary"
                  icon={<Save24Regular />}
                  size="small"
                  onClick={handleSaveTable}
                >
                  Apply
                </Button>
              </div>
              {editError && (
                <MessageBar intent="error">
                  <MessageBarBody>{editError}</MessageBarBody>
                </MessageBar>
              )}
              <Textarea
                className={styles.textarea}
                value={editJson}
                onChange={(_, d) => setEditJson(d.value)}
                resize="none"
                style={{ minHeight: 150, flex: 1 }}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
