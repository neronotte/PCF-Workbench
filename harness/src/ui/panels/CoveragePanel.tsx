/**
 * Coverage panel — surfaces shim fidelity (M1).
 *
 * Aggregates LogEntry rows by `coverage` field:
 *   - implemented: behaviour matches live UCI host
 *   - stub: wired but returns canned data / has no real side effects
 *   - unimplemented: no-op placeholder
 *
 * Helps PCF authors spot when their control is relying on a workbench
 * stub that won't behave the same way in production.
 */

import { useMemo } from 'react';
import { makeStyles, tokens, Badge, Button, MessageBar, MessageBarBody } from '@fluentui/react-components';
import { Delete24Regular } from '@fluentui/react-icons';
import { useHarnessStore, type CoverageStatus, type LogEntry } from '../../store/harness-store';

const useStyles = makeStyles({
  root: {
    padding: '12px',
    overflowY: 'auto',
    overflowX: 'hidden',
    height: '100%',
    boxSizing: 'border-box',
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
  },
  title: {
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
  },
  summary: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gap: '8px',
  },
  statBox: {
    padding: '10px',
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  statLabel: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    letterSpacing: '0.4px',
  },
  statValue: {
    fontSize: tokens.fontSizeBase600,
    fontWeight: tokens.fontWeightSemibold,
  },
  groupHeader: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
    marginTop: '4px',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 8px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    fontSize: tokens.fontSizeBase200,
  },
  method: {
    fontFamily: tokens.fontFamilyMonospace,
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  count: {
    color: tokens.colorNeutralForeground3,
    fontVariantNumeric: 'tabular-nums',
  },
  empty: {
    padding: '24px 12px',
    textAlign: 'center',
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
});

interface AggregatedCall {
  category: string;
  method: string;
  count: number;
  coverage: CoverageStatus;
}

function aggregate(log: readonly LogEntry[]): AggregatedCall[] {
  const map = new Map<string, AggregatedCall>();
  for (const e of log) {
    // Skip entries that don't represent shim calls:
    //  - 'warning' category = legacy Xrm.* deprecation notices (real call recorded under inner shim)
    //  - 'lifecycle' category = control init/updateView/destroy, not a shim
    //  - entries without an explicit coverage tag = harness-internal logging (e.g. host events)
    if (e.category === 'warning' || e.category === 'lifecycle') continue;
    if (!e.coverage) continue;
    const key = `${e.category}::${e.method}`;
    const existing = map.get(key);
    if (existing) {
      existing.count++;
    } else {
      map.set(key, {
        category: e.category,
        method: e.method,
        count: 1,
        coverage: e.coverage,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

const COVERAGE_LABELS: Record<CoverageStatus, string> = {
  implemented: 'Implemented',
  stub: 'Stubbed',
  unimplemented: 'Unimplemented',
};

const COVERAGE_INTENT: Record<CoverageStatus, 'success' | 'warning' | 'danger'> = {
  implemented: 'success',
  stub: 'warning',
  unimplemented: 'danger',
};

export function CoveragePanel() {
  const styles = useStyles();
  const log = useHarnessStore(s => s.logEntries);
  const clearLog = useHarnessStore(s => s.clearLog);

  const { implemented, stub, unimplemented, byCoverage } = useMemo(() => {
    const all = aggregate(log);
    const buckets: Record<CoverageStatus, AggregatedCall[]> = {
      implemented: [],
      stub: [],
      unimplemented: [],
    };
    for (const c of all) buckets[c.coverage].push(c);
    return {
      implemented: buckets.implemented.length,
      stub: buckets.stub.length,
      unimplemented: buckets.unimplemented.length,
      byCoverage: buckets,
    };
  }, [log]);

  return (
    <div className={styles.root} data-test-id="coverage-panel">
      <div
        className={styles.header}
        title="Coverage — tracks which platform APIs your control calls and rates their fidelity"
      >
        <span className={styles.title}>Shim coverage</span>
        <Button appearance="subtle" size="small" icon={<Delete24Regular />} onClick={clearLog} title="Clear log">
          Clear
        </Button>
      </div>

      <div className={styles.summary}>
        <div className={styles.statBox} data-test-id="coverage-stat-implemented" title="Implemented — shim behaves like the real UCI; safe to rely on">
          <span className={styles.statLabel}>Implemented</span>
          <span className={styles.statValue} style={{ color: tokens.colorPaletteGreenForeground2 }}>{implemented}</span>
        </div>
        <div className={styles.statBox} data-test-id="coverage-stat-stub" title="Stub — shim returns a placeholder; results may differ in production">
          <span className={styles.statLabel}>Stubs</span>
          <span className={styles.statValue} style={{ color: tokens.colorPaletteYellowForeground2 }}>{stub}</span>
        </div>
        <div className={styles.statBox} data-test-id="coverage-stat-unimplemented" title="Unimplemented — API not yet faked; check if your control depends on the result">
          <span className={styles.statLabel}>Unimplemented</span>
          <span className={styles.statValue} style={{ color: tokens.colorPaletteRedForeground1 }}>{unimplemented}</span>
        </div>
      </div>

      {(stub > 0 || unimplemented > 0) && (
        <MessageBar intent="warning">
          <MessageBarBody>
            Calls below are not behaviourally faithful to the live UCI host. Controls relying
            on real responses may misbehave when deployed.
          </MessageBarBody>
        </MessageBar>
      )}

      {(['unimplemented', 'stub', 'implemented'] as CoverageStatus[]).map(level => (
        byCoverage[level].length > 0 && (
          <div key={level}>
            <div className={styles.groupHeader}>
              <Badge appearance="filled" color={COVERAGE_INTENT[level] === 'success' ? 'success' : COVERAGE_INTENT[level] === 'warning' ? 'warning' : 'danger'}>
                {COVERAGE_LABELS[level]}
              </Badge>
              <span style={{ marginLeft: 8 }}>{byCoverage[level].length} unique call(s)</span>
            </div>
            <div data-test-id={`coverage-list-${level}`}>
              {byCoverage[level].map(c => (
                <div key={`${c.category}::${c.method}`} className={styles.row}>
                  <span className={styles.method}>{c.category}.{c.method}</span>
                  <span className={styles.count}>×{c.count}</span>
                </div>
              ))}
            </div>
          </div>
        )
      ))}

      {log.length === 0 && (
        <div className={styles.empty}>
          No shim calls logged yet. Interact with the control to populate the coverage report.
        </div>
      )}
    </div>
  );
}
