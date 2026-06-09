import { useRef, useEffect, useState, useMemo } from 'react';
import { makeStyles, tokens, Button, Badge } from '@fluentui/react-components';
import { Delete24Regular } from '@fluentui/react-icons';
import { useHarnessStore } from '../../store/harness-store';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 12px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    flexShrink: 0,
  },
  title: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    whiteSpace: 'nowrap' as const,
  },
  logContainer: {
    flex: 1,
    overflowY: 'auto',
    fontFamily: "'Consolas', 'Courier New', monospace",
    fontSize: '11px',
    lineHeight: '18px',
    padding: '4px 0',
  },
  entry: {
    padding: '2px 12px',
    borderBottom: '1px solid #f0f0f0',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-all' as const,
    '&:hover': {
      backgroundColor: '#f5f5f5',
    },
  },
  timestamp: {
    color: '#999',
    marginRight: '8px',
  },
  category: {
    fontWeight: 'bold',
    marginRight: '4px',
  },
  method: {
    color: tokens.colorBrandForeground1,
  },
  args: {
    color: '#666',
    marginLeft: '8px',
  },
  result: {
    color: '#107c10',
    marginLeft: '8px',
  },
});

const CATEGORY_COLORS: Record<string, string> = {
  lifecycle: '#0078d4',
  webAPI: '#ff8c00',
  navigation: '#881c98',
  device: '#d13438',
  mode: '#107c10',
  utils: '#666',
  utility: '#5c2d91',
  factory: '#999',
  data: '#107c10',
  scenario: '#881c98',
  formContext: '#0b6a0b',
  app: '#005a9e',
  panel: '#005a9e',
  copilot: '#8378de',
  events: '#bf7900',
  warning: '#a4262c',
};

const ALL_CATEGORIES = Object.keys(CATEGORY_COLORS);

const CATEGORY_TOOLTIPS: Record<string, string> = {
  lifecycle: 'PCF lifecycle: init, updateView, getOutputs, destroy, notifyOutputChanged.',
  webAPI: 'context.webAPI calls — createRecord / retrieveRecord / retrieveMultipleRecords / updateRecord / deleteRecord (online + offline routing).',
  navigation: 'context.navigation / Xrm.Navigation — openForm, openUrl, openAlertDialog, openConfirmDialog, openFile, openWebResource.',
  device: 'context.device — getBarcodeValue, getCurrentPosition, pickFile, captureAudio/Video/Image.',
  mode: 'context.mode — setFullScreen, setControlState, trackContainerResize, isVisible/isControlDisabled reads.',
  utils: 'context.utils — getEntityMetadata, lookupObjects, formatting helpers.',
  utility: 'Xrm.Utility — getEntityMetadata, getResourceString, lookupObjects, progress indicators, refreshParentGrid.',
  factory: 'context.factory + Fluent design — popups (create/open/close/update), requestRender, fireEvent.',
  data: 'Dataset + data.json mutations — refresh, paging, save/delete/newRecord, live page-record fetches.',
  scenario: 'Scenarios panel events — save/load/delete/generate.',
  formContext: 'formContext / Xrm.Page — getAttribute, getControl, setValue, setVisible, setDisabled, addOnChange, ui.tabs.*, data.refresh, etc.',
  app: 'Xrm.App — global notifications, sidePanes create/get/etc.',
  panel: 'Xrm.Panel — loadPanel side-pane API (legacy).',
  copilot: 'Copilot (M365) context shim calls.',
  events: 'Event manifest pub-sub (addEventListener / fireEvent through context.events Proxy).',
  warning: 'Best-practice warnings from shims (e.g. using Xrm.* legacy globals instead of context.*).',
};

export function ConsolePanel() {
  const styles = useStyles();
  const logRef = useRef<HTMLDivElement>(null);
  const logEntries = useHarnessStore(s => s.logEntries);
  const clearLog = useHarnessStore(s => s.clearLog);
  const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(new Set());

  const toggleCategory = (cat: string) => {
    setHiddenCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const filteredEntries = useMemo(
    () => hiddenCategories.size === 0
      ? logEntries
      : logEntries.filter(e => !hiddenCategories.has(e.category)),
    [logEntries, hiddenCategories],
  );

  // Auto-scroll to bottom
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logEntries.length]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`;
  };

  const formatArgs = (args: any): string => {
    if (args === undefined) return '';
    try {
      return JSON.stringify(args, null, 0);
    } catch {
      return String(args);
    }
  };

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span
          className={styles.title}
          title="Console — log of every API call the control made, grouped by category"
        >
          Console ({filteredEntries.length})
        </span>
        <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          {ALL_CATEGORIES.map(cat => (
            <span key={cat} title={CATEGORY_TOOLTIPS[cat] ?? cat} data-test-id={`console-filter-${cat}`}>
              <Badge
                appearance={hiddenCategories.has(cat) ? 'outline' : 'filled'}
                size="small"
                color="informative"
                style={{
                  cursor: 'pointer',
                  opacity: hiddenCategories.has(cat) ? 0.4 : 1,
                  fontSize: 9,
                }}
                onClick={() => toggleCategory(cat)}
              >
                {cat}
              </Badge>
            </span>
          ))}
        </div>
        <Button
          appearance="subtle"
          icon={<Delete24Regular />}
          size="small"
          onClick={clearLog}
          title="Clear log"
        />
      </div>
      <div ref={logRef} className={styles.logContainer}>
        {filteredEntries.map(entry => (
          <div key={entry.id} className={styles.entry}>
            <span className={styles.timestamp}>{formatTime(entry.timestamp)}</span>
            <span
              className={styles.category}
              style={{ color: CATEGORY_COLORS[entry.category] ?? '#666' }}
            >
              [{entry.category}]
            </span>
            <span className={styles.method}>{entry.method}</span>
            {entry.args !== undefined && (
              <span className={styles.args}>{formatArgs(entry.args)}</span>
            )}
            {entry.result !== undefined && (
              <span className={styles.result}> → {formatArgs(entry.result)}</span>
            )}
          </div>
        ))}
        {filteredEntries.length === 0 && (
          <div style={{ padding: '12px', color: '#999', textAlign: 'center' }}>
            No events yet. Load a control to see lifecycle events.
          </div>
        )}
      </div>
    </div>
  );
}
