import { useEffect, useState, useCallback } from 'react';
import {
  makeStyles, tokens, Spinner, Badge, Button, Input, MessageBar, MessageBarBody, Tooltip,
} from '@fluentui/react-components';
import {
  ArrowDownload24Regular, ArrowClockwise24Regular, Delete24Regular, Open24Regular,
} from '@fluentui/react-icons';

import {
  listExtractedControls,
  extractDeployedControl,
  deleteExtractedControl,
  DvProxyError,
  type CachedExtractDto,
} from '../../api/dv-client';

const LS_LAST_ORG = 'pcf-workbench:lastExtractOrg';
const LS_LAST_NAME = 'pcf-workbench:lastExtractName';

const useStyles = makeStyles({
  root: {
    padding: '24px 40px',
  },
  toolbar: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
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
    wordBreak: 'break-word' as const,
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

  const [orgUrl, setOrgUrl] = useState(() => localStorage.getItem(LS_LAST_ORG) ?? '');
  const [controlName, setControlName] = useState(() => localStorage.getItem(LS_LAST_NAME) ?? '');
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

  const runExtract = async (overrideName?: string) => {
    const org = orgUrl.trim();
    const name = (overrideName ?? controlName).trim();
    if (!org || !name) {
      setError('Org URL and control name are both required.');
      return;
    }
    setExtracting(true); setError(null); setInfo(null);
    try {
      const result = await extractDeployedControl({ orgUrl: org, controlName: name });
      localStorage.setItem(LS_LAST_ORG, org);
      localStorage.setItem(LS_LAST_NAME, name);
      setInfo(`Extracted ${result.meta.deployedName} v${result.meta.version}.`);
      refresh();
    } catch (e) {
      if (e instanceof DvProxyError) {
        setError(`${e.body.error}: ${e.body.message}`);
      } else {
        setError((e as Error).message);
      }
    } finally {
      setExtracting(false);
    }
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

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '2 1 320px', minWidth: 260 }}>
          <span className={styles.toolbarLabel}>Org URL</span>
          <Input
            size="small"
            value={orgUrl}
            onChange={(_, d) => setOrgUrl(d.value)}
            placeholder="https://contoso.crm.dynamics.com"
            disabled={extracting}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '3 1 360px', minWidth: 280 }}>
          <span className={styles.toolbarLabel}>Control name</span>
          <Input
            size="small"
            value={controlName}
            onChange={(_, d) => setControlName(d.value)}
            placeholder="MscrmControls.Slider.LinearSliderControl"
            onKeyDown={(e) => { if (e.key === 'Enter' && !extracting) runExtract(); }}
            disabled={extracting}
          />
        </div>
        <Button
          appearance="primary"
          icon={<ArrowDownload24Regular />}
          onClick={() => runExtract()}
          disabled={extracting || !orgUrl.trim() || !controlName.trim()}
        >
          {extracting ? 'Extracting…' : 'Extract'}
        </Button>
        <Tooltip content="Rescan extract caches" relationship="label">
          <Button appearance="subtle" icon={<ArrowClockwise24Regular />} onClick={refresh} disabled={loading} />
        </Tooltip>
        <span className={styles.hint}>
          Pulls the deployed control's manifest + bundle from Dataverse via the same PAC token your live-data session uses.
          Cached under <code>harness/.pcf-extracted/</code> (gitignored). Re-extracting overwrites in place.
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
            const title = m ? `${m.namespace}.${m.constructor}` : e.safe;
            const cacheLabel = e.cacheBase.includes('.pcf-extracted')
              ? '.pcf-extracted'
              : e.cacheBase.includes('_extracted') ? 'samples/_extracted' : e.cacheBase;
            return (
              <div key={`${e.cacheBase}/${e.safe}`} className={`${styles.card} ${!e.isComplete ? styles.cardIncomplete : ''}`}>
                <div className={styles.cardTitle}>{title}</div>
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
                          setControlName(m.deployedName);
                          runExtract(m.deployedName);
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
