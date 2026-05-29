import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  makeStyles, tokens, Spinner, Badge, Button, MessageBar, MessageBarBody, Tooltip,
  Dropdown, Option, Combobox, Tag,
} from '@fluentui/react-components';
import {
  ArrowDownload24Regular, ArrowClockwise24Regular, Delete24Regular, Open24Regular,
} from '@fluentui/react-icons';

import {
  listExtractedControls,
  extractDeployedControl,
  deleteExtractedControl,
  listProfiles,
  listDeployedControls,
  DvProxyError,
  type CachedExtractDto,
  type DeployedControlSummary,
} from '../../api/dv-client';
import { useHarnessStore, type PublicProfile } from '../../store/harness-store';

const LS_LAST_ORG = 'pcf-workbench:lastExtractOrg';
const LS_LAST_NAMES = 'pcf-workbench:lastExtractNames';
const SELECT_ALL_KEY = '__select_all__';

const useStyles = makeStyles({
  root: {
    padding: '24px 40px',
  },
  toolbar: {
    display: 'flex',
    gap: '8px',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    marginBottom: '20px',
    padding: '16px',
    backgroundColor: 'white',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '8px',
  },
  toolbarLabel: {
    fontSize: '12px',
    color: tokens.colorNeutralForeground3,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  hint: {
    fontSize: '12px',
    color: tokens.colorNeutralForeground3,
    marginTop: '4px',
    width: '100%',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
    gap: '16px',
  },
  card: {
    backgroundColor: 'white',
    borderRadius: '8px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  cardIncomplete: {
    borderTopColor: tokens.colorPaletteRedBorder1,
    borderRightColor: tokens.colorPaletteRedBorder1,
    borderBottomColor: tokens.colorPaletteRedBorder1,
    borderLeftColor: tokens.colorPaletteRedBorder1,
    backgroundColor: tokens.colorPaletteRedBackground1,
  },
  cardTitle: {
    fontSize: '15px',
    fontWeight: 600,
    color: tokens.colorNeutralForeground1,
    overflowWrap: 'anywhere' as const,
    lineHeight: '1.3',
  },
  cardDeployedName: {
    fontSize: '11px',
    color: tokens.colorNeutralForeground3,
    fontFamily: "'Consolas', monospace",
    wordBreak: 'break-all' as const,
  },
  cardMeta: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap' as const,
    fontSize: '11px',
    color: tokens.colorNeutralForeground3,
  },
  cardActions: {
    display: 'flex',
    gap: '6px',
    marginTop: 'auto',
    paddingTop: '8px',
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  empty: {
    padding: '48px 24px',
    textAlign: 'center' as const,
    color: tokens.colorNeutralForeground3,
    fontSize: '14px',
    backgroundColor: 'white',
    borderRadius: '8px',
    border: `1px dashed ${tokens.colorNeutralStroke2}`,
  },
});

function formatDate(iso: string | undefined | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return d.toLocaleDateString();
  } catch { return '—'; }
}

function formatBytes(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function DeployedTab() {
  const styles = useStyles();
  const [extracts, setExtracts] = useState<CachedExtractDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Profiles (org picker) — reuse cached profiles from the store if already
  // loaded by the Live data panel; otherwise fetch on mount.
  const liveProfiles = useHarnessStore(s => s.liveProfiles);
  const setLiveProfiles = useHarnessStore(s => s.setLiveProfiles);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [orgUrl, setOrgUrl] = useState(() => localStorage.getItem(LS_LAST_ORG) ?? '');

  // Catalog (control picker) — refetched whenever orgUrl changes.
  const [catalog, setCatalog] = useState<DeployedControlSummary[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [comboQuery, setComboQuery] = useState('');
  const [selectedNames, setSelectedNames] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(LS_LAST_NAMES);
      return raw ? JSON.parse(raw) as string[] : [];
    } catch { return []; }
  });

  const [extracting, setExtracting] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    listExtractedControls()
      .then(r => { setExtracts(r.extracts); setError(null); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Load PAC profiles once.
  useEffect(() => {
    if (liveProfiles.length > 0 || profilesLoading) return;
    setProfilesLoading(true);
    listProfiles()
      .then(r => {
        setLiveProfiles(r.profiles);
        if (!orgUrl) {
          const pick = (r.current && r.profiles.find(p => p.orgUrl === r.current))
            ?? r.profiles[0]
            ?? null;
          if (pick) setOrgUrl(pick.orgUrl);
        }
      })
      .catch((e: Error) => setError(`Could not list PAC profiles: ${e.message}`))
      .finally(() => setProfilesLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load catalog whenever orgUrl changes.
  useEffect(() => {
    if (!orgUrl) { setCatalog([]); return; }
    setCatalogLoading(true);
    setError(null);
    listDeployedControls(orgUrl)
      .then(r => setCatalog(r.controls))
      .catch(e => {
        const msg = e instanceof DvProxyError ? `${e.body.error}: ${e.body.message}` : (e as Error).message;
        setError(`Could not list controls in ${orgUrl}: ${msg}`);
        setCatalog([]);
      })
      .finally(() => setCatalogLoading(false));
  }, [orgUrl]);

  // Filtered catalog based on combobox search text.
  const filteredCatalog = useMemo(() => {
    const q = comboQuery.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter(c =>
      c.name.toLowerCase().includes(q)
      || (c.namespace?.toLowerCase().includes(q) ?? false)
      || (c.constructor?.toLowerCase().includes(q) ?? false),
    );
  }, [catalog, comboQuery]);

  const allFilteredSelected = filteredCatalog.length > 0
    && filteredCatalog.every(c => selectedNames.includes(c.name));

  const onComboSelect = useCallback((optionValue: string) => {
    if (optionValue === SELECT_ALL_KEY) {
      // Toggle: if every filtered row is selected, deselect them; otherwise add them all.
      const filteredNames = filteredCatalog.map(c => c.name);
      setSelectedNames(prev => {
        if (allFilteredSelected) {
          return prev.filter(n => !filteredNames.includes(n));
        }
        const set = new Set(prev);
        for (const n of filteredNames) set.add(n);
        return [...set];
      });
      return;
    }
    setSelectedNames(prev => prev.includes(optionValue)
      ? prev.filter(n => n !== optionValue)
      : [...prev, optionValue]);
  }, [filteredCatalog, allFilteredSelected]);

  const runExtract = async (overrideNames?: string[]) => {
    const org = orgUrl.trim();
    const names = (overrideNames ?? selectedNames).map(n => n.trim()).filter(Boolean);
    if (!org || names.length === 0) {
      setError('Select an org and at least one control.');
      return;
    }
    setExtracting(true); setError(null); setInfo(null);

    const successes: string[] = [];
    const failures: Array<{ name: string; message: string }> = [];
    for (const name of names) {
      try {
        const result = await extractDeployedControl({ orgUrl: org, controlName: name });
        successes.push(`${result.meta.deployedName} v${result.meta.version}`);
      } catch (e) {
        const msg = e instanceof DvProxyError ? `${e.body.error}: ${e.body.message}` : (e as Error).message;
        failures.push({ name, message: msg });
      }
    }

    try {
      localStorage.setItem(LS_LAST_ORG, org);
      localStorage.setItem(LS_LAST_NAMES, JSON.stringify(names));
    } catch { /* ignore */ }

    if (successes.length > 0) {
      setInfo(`Extracted ${successes.length}/${names.length}: ${successes.slice(0, 3).join(', ')}${successes.length > 3 ? ` (+${successes.length - 3} more)` : ''}.`);
    }
    if (failures.length > 0) {
      setError(`Failed ${failures.length}/${names.length}:\n` + failures.map(f => `• ${f.name}: ${f.message}`).join('\n'));
    }
    setExtracting(false);
    refresh();
  };

  const open = (e: CachedExtractDto) => {
    if (!e.isComplete || opening) return;
    setOpening(e.safe);
    fetch('/api/switch-control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ controlDir: e.controlDir }),
    })
      .then(r => r.json())
      .then(result => {
        if (result.error) { setError(result.error); setOpening(null); }
        // Server triggers full reload — UI will replace itself.
      })
      .catch(err => { setError(`Failed to open: ${err.message}`); setOpening(null); });
  };

  const remove = async (e: CachedExtractDto) => {
    if (deleting) return;
    if (!confirm(`Delete extracted control "${e.safe}" from ${e.cacheBase}?`)) return;
    setDeleting(e.safe); setError(null);
    try {
      await deleteExtractedControl(e.safe, e.cacheBase);
      setInfo(`Deleted ${e.safe}.`);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeleting(null);
    }
  };

  const selectedProfile: PublicProfile | undefined = liveProfiles.find(p => p.orgUrl === orgUrl);

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '2 1 320px', minWidth: 260 }}>
          <span className={styles.toolbarLabel}>Org (from PAC auth)</span>
          <Dropdown
            size="small"
            placeholder={profilesLoading ? 'Loading PAC profiles…' : 'Select an org…'}
            value={selectedProfile?.friendlyName ?? orgUrl}
            selectedOptions={orgUrl ? [orgUrl] : []}
            onOptionSelect={(_, d) => {
              const next = d.optionValue ?? '';
              setOrgUrl(next);
              setSelectedNames([]); // org changed → reset control selection
              setComboQuery('');
            }}
            disabled={extracting || profilesLoading || liveProfiles.length === 0}
            data-test-id="deployed-org-dropdown"
          >
            {liveProfiles.map(p => (
              <Option key={p.orgUrl} value={p.orgUrl} text={p.friendlyName}>
                {p.friendlyName}
                <span style={{ display: 'block', fontSize: 11, color: tokens.colorNeutralForeground3 }}>{p.orgUrl}</span>
              </Option>
            ))}
          </Dropdown>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '3 1 360px', minWidth: 280 }}>
          <span className={styles.toolbarLabel}>
            Controls {selectedNames.length > 0 && <Badge appearance="tint" size="small">{selectedNames.length} selected</Badge>}
            {catalogLoading && <span style={{ marginLeft: 8, fontSize: 11, color: tokens.colorNeutralForeground3 }}>Loading catalog…</span>}
            {!catalogLoading && catalog.length > 0 && (
              <span style={{ marginLeft: 8, fontSize: 11, color: tokens.colorNeutralForeground3 }}>
                {catalog.length} available
              </span>
            )}
          </span>
          <Combobox
            multiselect
            size="small"
            placeholder={
              catalogLoading ? 'Loading…'
                : !orgUrl ? 'Pick an org first'
                : catalog.length === 0 ? 'No controls found in this org'
                : 'Search by name, namespace, or constructor…'
            }
            value={comboQuery}
            selectedOptions={selectedNames}
            onChange={(e) => setComboQuery((e.target as HTMLInputElement).value)}
            onOptionSelect={(_, d) => {
              if (d.optionValue) onComboSelect(d.optionValue);
            }}
            disabled={extracting || catalogLoading || !orgUrl}
            data-test-id="deployed-controls-combobox"
          >
            {filteredCatalog.length > 0 && (
              <Option key={SELECT_ALL_KEY} value={SELECT_ALL_KEY} text="Select all (filtered)">
                <strong>{allFilteredSelected ? '✓ Deselect all' : 'Select all'} ({filteredCatalog.length})</strong>
              </Option>
            )}
            {filteredCatalog.map(c => (
              <Option key={c.customcontrolid} value={c.name} text={c.name}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: 13 }}>{c.constructor ?? c.name.split('.').pop()}</span>
                  <span style={{ fontSize: 11, color: tokens.colorNeutralForeground3, fontFamily: "'Consolas', monospace" }}>
                    {c.name}{c.version ? ` · v${c.version}` : ''}
                  </span>
                </div>
              </Option>
            ))}
          </Combobox>
          {selectedNames.length > 0 && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
              {selectedNames.slice(0, 6).map(n => (
                <Tag
                  key={n}
                  size="small"
                  dismissible
                  onClick={() => setSelectedNames(prev => prev.filter(x => x !== n))}
                  value={n}
                >
                  {n.includes('.') ? n.split('.').pop() : n}
                </Tag>
              ))}
              {selectedNames.length > 6 && (
                <Tag size="small" appearance="outline">+{selectedNames.length - 6} more</Tag>
              )}
              <Button size="small" appearance="subtle" onClick={() => setSelectedNames([])} disabled={extracting}>
                Clear all
              </Button>
            </div>
          )}
        </div>

        <Button
          appearance="primary"
          icon={<ArrowDownload24Regular />}
          onClick={() => runExtract()}
          disabled={extracting || !orgUrl.trim() || selectedNames.length === 0}
        >
          {extracting ? 'Extracting…' : selectedNames.length > 1 ? `Extract ${selectedNames.length}` : 'Extract'}
        </Button>
        <Tooltip content="Rescan extract caches" relationship="label">
          <Button appearance="subtle" icon={<ArrowClockwise24Regular />} onClick={refresh} disabled={loading} />
        </Tooltip>
        <span className={styles.hint}>
          Picks orgs from your local <code>pac auth list</code>. Catalog is read from the org's
          <code> customcontrols</code> table. Cached under <code>harness/.pcf-extracted/</code> (gitignored).
          Re-extracting overwrites in place.
        </span>
      </div>

      {info && (
        <div style={{ marginBottom: 16 }}>
          <MessageBar intent="success"><MessageBarBody>{info}</MessageBarBody></MessageBar>
        </div>
      )}
      {error && (
        <div style={{ marginBottom: 16 }}>
          <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '48px' }}>
          <Spinner label="Scanning extract caches…" />
        </div>
      ) : extracts.length === 0 ? (
        <div className={styles.empty}>
          No extracted controls yet. Use the form above to pull one from a Dataverse org.
        </div>
      ) : (
        <div className={styles.grid}>
          {extracts.map(e => {
            const m = e.meta;
            const fqn = m ? `${m.namespace}.${m.constructor}` : e.safe;
            // Insert <wbr> after each dot so long FQNs wrap at namespace boundaries
            // instead of mid-word (e.g. "ColorPickerContr ol" at 360px columns).
            const titleParts = fqn.split('.');
            const cacheLabel = e.cacheBase.includes('.pcf-extracted')
              ? '.pcf-extracted'
              : e.cacheBase.includes('_extracted') ? 'samples/_extracted' : e.cacheBase;
            return (
              <div key={`${e.cacheBase}/${e.safe}`} className={`${styles.card} ${!e.isComplete ? styles.cardIncomplete : ''}`}>
                <div className={styles.cardTitle} title={fqn}>
                  {titleParts.map((part, i) => (
                    <React.Fragment key={i}>
                      {i > 0 && <>.<wbr /></>}
                      {part}
                    </React.Fragment>
                  ))}
                </div>
                {m?.deployedName && <div className={styles.cardDeployedName}>{m.deployedName}</div>}
                <div className={styles.cardMeta}>
                  {m?.version && <Badge appearance="outline" size="small">v{m.version}</Badge>}
                  {(m?.requiredFluentMajors ?? []).map(maj => (
                    <Badge key={maj} appearance="tint" color="brand" size="small">Fluent {maj}</Badge>
                  ))}
                  {!e.isComplete && <Badge appearance="filled" color="danger" size="small">Incomplete</Badge>}
                  <Badge appearance="ghost" size="small">{cacheLabel}</Badge>
                </div>
                <div className={styles.cardMeta}>
                  <span>Extracted: {formatDate(m?.extractedAt)}</span>
                  <span>Bundle: {formatBytes(m?.bundleBytes)}</span>
                </div>
                {m?.orgUrl && (
                  <div style={{ fontSize: '11px', color: tokens.colorNeutralForeground3, wordBreak: 'break-all' }}>
                    {m.orgUrl}
                  </div>
                )}
                <div className={styles.cardActions}>
                  <Button
                    size="small"
                    appearance="primary"
                    icon={<Open24Regular />}
                    onClick={() => open(e)}
                    disabled={!e.isComplete || opening === e.safe}
                  >
                    {opening === e.safe ? 'Opening…' : 'Open'}
                  </Button>
                  {m && (
                    <Tooltip content="Re-fetch from Dataverse, overwriting on disk" relationship="label">
                      <Button
                        size="small"
                        appearance="subtle"
                        icon={<ArrowDownload24Regular />}
                        onClick={() => {
                          setOrgUrl(m.orgUrl);
                          runExtract([m.deployedName]);
                        }}
                        disabled={extracting}
                      >
                        Re-extract
                      </Button>
                    </Tooltip>
                  )}
                  <Button
                    size="small"
                    appearance="subtle"
                    icon={<Delete24Regular />}
                    onClick={() => remove(e)}
                    disabled={deleting === e.safe}
                  >
                    {deleting === e.safe ? 'Deleting…' : 'Delete'}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
