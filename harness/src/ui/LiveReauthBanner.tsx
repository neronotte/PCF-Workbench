/**
 * Re-auth banner shown when the Vite plugin proxy reports
 * `pac-reauth-required` or `pac-profile-missing` for the current org.
 *
 * The harness has no way to drive `pac auth create` itself (PAC owns the
 * interactive sign-in flow), so the banner is a click-to-copy instruction
 * + a "retry" button that simply clears the flag — the next live call will
 * trigger the proxy again. Rendered above the form chrome so it's visible
 * regardless of which side panel tab is active.
 */
import { useState } from 'react';
import { makeStyles, tokens, Button } from '@fluentui/react-components';
import { Copy16Regular, ArrowClockwise16Regular, Dismiss16Regular } from '@fluentui/react-icons';
import { useHarnessStore } from '../store/harness-store';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 12px',
    margin: '6px 12px',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorPaletteRedBackground2,
    color: tokens.colorPaletteRedForeground1,
    borderLeftWidth: '3px',
    borderLeftStyle: 'solid',
    borderLeftColor: tokens.colorPaletteRedBorderActive,
    fontSize: tokens.fontSizeBase300,
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 6px',
    borderRadius: tokens.borderRadiusSmall,
    backgroundColor: tokens.colorNeutralBackground1,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    textTransform: 'uppercase',
    letterSpacing: '0.4px',
    flexShrink: 0,
  },
  message: { flex: 1 },
  command: {
    fontFamily: "'Consolas', monospace",
    fontSize: '12px',
    padding: '2px 6px',
    borderRadius: tokens.borderRadiusSmall,
    backgroundColor: tokens.colorNeutralBackground1,
    cursor: 'pointer',
  },
  copied: {
    fontSize: tokens.fontSizeBase200,
    opacity: 0.8,
  },
});

export function LiveReauthBanner() {
  const styles = useStyles();
  const reauth = useHarnessStore(s => s.pacReauthRequired);
  const setReauth = useHarnessStore(s => s.setPacReauthRequired);
  const [copied, setCopied] = useState(false);

  if (!reauth) return null;

  const command = `pac auth create --url ${reauth.org}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore — older browsers */
    }
  };

  return (
    <div className={styles.root} role="alert" data-test-id="live-reauth-banner">
      <span className={styles.badge}>PAC</span>
      <span className={styles.message}>
        Re-authentication required for <strong>{reauth.org}</strong>. Run:
      </span>
      <code
        className={styles.command}
        onClick={copy}
        title="Copy to clipboard"
        data-test-id="live-reauth-command"
      >
        {command}
      </code>
      <Button
        appearance="subtle"
        size="small"
        icon={<Copy16Regular />}
        onClick={copy}
        title="Copy command"
        aria-label="Copy command"
      />
      {copied && <span className={styles.copied}>Copied!</span>}
      <Button
        appearance="subtle"
        size="small"
        icon={<ArrowClockwise16Regular />}
        onClick={() => setReauth(null)}
        title="Retry — reconnect to the live org with a fresh token"
      >
        Retry
      </Button>
      <Button
        appearance="subtle"
        size="small"
        icon={<Dismiss16Regular />}
        onClick={() => setReauth(null)}
        aria-label="Dismiss"
      />
    </div>
  );
}
