import { useState, useMemo } from 'react';
import {
  makeStyles,
  tokens,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  MessageBarActions,
  Button,
  Badge,
} from '@fluentui/react-components';
import {
  CopyRegular,
  ChevronDownRegular,
  ChevronRightRegular,
  ArrowClockwiseRegular,
} from '@fluentui/react-icons';
import { explainError, type ErrorExplanation } from '../loader/error-diagnostics';

const useStyles = makeStyles({
  root: {
    margin: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  diagBox: {
    border: `1px solid ${tokens.colorPaletteRedBorder1}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorPaletteRedBackground1,
    padding: '12px 14px',
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground1,
  },
  diagHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '6px',
  },
  diagLabel: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase300,
  },
  diagSection: {
    marginTop: '8px',
  },
  diagSectionLabel: {
    fontSize: '11px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
    marginBottom: '2px',
  },
  stackToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    cursor: 'pointer',
    color: tokens.colorBrandForeground1,
    fontSize: tokens.fontSizeBase200,
    userSelect: 'none' as const,
  },
  stackBlock: {
    marginTop: '6px',
    padding: '8px 10px',
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: tokens.borderRadiusSmall,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: '10px',
    color: tokens.colorNeutralForeground2,
    overflow: 'auto',
    maxHeight: '180px',
    whiteSpace: 'pre' as const,
  },
  rawHint: {
    fontSize: '10px',
    color: tokens.colorNeutralForeground3,
    marginTop: '4px',
  },
});

const SEVERITY_INTENT: Record<ErrorExplanation['severity'], 'error' | 'warning' | 'info'> = {
  fatal: 'error',
  warning: 'warning',
  info: 'info',
};

interface Props {
  message: string;
  stack?: string;
  onReload?: () => void;
}

/**
 * Surfaces a runtime / load error to the user with an actionable diagnosis
 * instead of just the raw exception. Pattern-matches the message+stack with
 * `explainError()` and renders the "Likely cause" + "Suggested fix" plus a
 * collapsed stack trace and a copy button for sharing the full details in
 * bug reports.
 *
 * Falls back to a plain error MessageBar when no diagnostic rule matches —
 * users still see the raw message, just without the friendly summary.
 */
export function ControlErrorBanner({ message, stack, onReload }: Props): JSX.Element {
  const styles = useStyles();
  const [stackOpen, setStackOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const diag = useMemo(() => explainError(message, stack), [message, stack]);

  const copyDetails = () => {
    const blob = [
      `Error: ${message}`,
      diag ? `Diagnostic: ${diag.ruleId} — ${diag.summary}` : '',
      diag ? `Likely cause: ${diag.likelyCause}` : '',
      diag ? `Suggested fix: ${diag.suggestedFix}` : '',
      stack ? `\nStack:\n${stack}` : '',
    ].filter(Boolean).join('\n');
    navigator.clipboard?.writeText(blob).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className={styles.root} data-test-id="control-error-banner">
      <MessageBar intent={diag ? SEVERITY_INTENT[diag.severity] : 'error'}>
        <MessageBarBody>
          <MessageBarTitle>
            {diag?.summary ?? 'Control failed to load'}
          </MessageBarTitle>
          <div style={{ marginTop: 4, fontFamily: tokens.fontFamilyMonospace, fontSize: 11 }}>
            {message}
          </div>
        </MessageBarBody>
        <MessageBarActions>
          {onReload && (
            <Button
              size="small"
              icon={<ArrowClockwiseRegular />}
              onClick={onReload}
              data-test-id="error-banner-reload"
            >
              Reload
            </Button>
          )}
          <Button
            size="small"
            icon={<CopyRegular />}
            onClick={copyDetails}
            data-test-id="error-banner-copy"
          >
            {copied ? 'Copied' : 'Copy details'}
          </Button>
        </MessageBarActions>
      </MessageBar>

      {diag && (
        <div className={styles.diagBox} data-test-id="error-banner-diagnostic">
          <div className={styles.diagHeader}>
            <Badge appearance="filled" color="danger" size="small">{diag.ruleId}</Badge>
            <span className={styles.diagLabel}>Likely cause</span>
          </div>
          <div>{diag.likelyCause}</div>
          <div className={styles.diagSection}>
            <div className={styles.diagSectionLabel}>Suggested fix</div>
            <div>{diag.suggestedFix}</div>
          </div>
        </div>
      )}

      {!diag && (
        <div className={styles.rawHint}>
          No matching diagnostic. Use the Copy details button to share the full stack with
          someone debugging — or open F12 / Console panel for the live trace.
        </div>
      )}

      {stack && (
        <div>
          <div
            className={styles.stackToggle}
            onClick={() => setStackOpen(o => !o)}
            data-test-id="error-banner-stack-toggle"
          >
            {stackOpen ? <ChevronDownRegular /> : <ChevronRightRegular />}
            <span>{stackOpen ? 'Hide' : 'Show'} stack trace</span>
          </div>
          {stackOpen && (
            <pre className={styles.stackBlock} data-test-id="error-banner-stack">
              {stack}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
