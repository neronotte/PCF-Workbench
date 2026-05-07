/**
 * UCI-faithful form chrome (M1.P4).
 *
 * Wraps the PCF viewport with the four UI surfaces a real model-driven form
 * provides: entity header, command bar (ribbon), tab strip, and a footer
 * banner area for `Xrm.Page.ui.setFormNotification` messages.
 *
 * Driven entirely from the existing form-store (P1) + xrm-form notification
 * pub/sub. PCF code paths that mutate tab visibility, fire onSave, etc. are
 * reflected here so harness users see the same UI feedback they would on a
 * real form.
 *
 * Toggleable via harness-store's `formChromeEnabled` (persisted to
 * localStorage) — library-style controls that don't need a form host can
 * opt out from the top bar switch.
 */

import { useSyncExternalStore, useState, useEffect } from 'react';
import { makeStyles, tokens, Button, FluentProvider, webLightTheme, webDarkTheme } from '@fluentui/react-components';
import {
  Save20Regular, SaveCopy20Regular, ArrowClockwise20Regular,
  Delete20Regular, Dismiss16Regular,
} from '@fluentui/react-icons';
import { useHarnessStore } from '../../store/harness-store';
import {
  subscribeFormState, getFormStateVersion, listTabs, isFormDirty,
  getPrimaryAttributeName, getAttributeState, setTabFocus,
} from '../../store/form-store';
import {
  subscribeFormNotifications, dismissFormNotification,
  type FormNotification,
} from '../../shim/xrm-form';

/**
 * Convert a Dataverse logical name into a human-friendly display name:
 *   bookableresourcebooking -> Bookable Resource Booking
 *   pcf_my_field            -> My Field
 *   accountNumber           -> Account Number
 *
 * UCI uses the entity's metadata DisplayName, but the harness only knows the
 * logical name, so we apply the same heuristics Microsoft's pluralizer +
 * known noun list would produce. We strip a leading publisher prefix
 * ("pcf_", "new_", etc.), split on underscores + camelCase boundaries, and
 * Title-case each token. For all-lowercase tokens we additionally split on
 * known noun boundaries from a small dictionary so logical names like
 * "bookableresourcebooking" come out readable.
 */
const KNOWN_TOKENS = [
  'bookable', 'resource', 'booking', 'header', 'product', 'category',
  'service', 'account', 'contact', 'opportunity', 'invoice', 'quote',
  'order', 'incident', 'case', 'lead', 'campaign', 'activity', 'task',
  'appointment', 'email', 'phone', 'call', 'note', 'attachment',
  'territory', 'currency', 'price', 'list', 'unit', 'group', 'team',
  'user', 'role', 'profile', 'system', 'business', 'organization',
  'work', 'order', 'agreement', 'asset', 'customer', 'address',
  'configuration', 'characteristic', 'requirement', 'detail', 'plan',
  'schedule', 'route', 'time', 'entry', 'expense', 'project', 'company',
];
function humanizeLogicalName(raw: string): string {
  if (!raw) return '';
  // Strip publisher prefix (alphanumeric followed by underscore, max 8 chars).
  const stripped = raw.replace(/^[a-z0-9]{2,8}_/i, '');
  // Split on underscores + camelCase boundaries.
  const parts = stripped
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[_\s]+/)
    .filter(Boolean);
  // For each part, if it's lowercase and long, try to split on known nouns.
  const tokens: string[] = [];
  for (const part of parts) {
    if (/^[a-z]+$/.test(part) && part.length > 6) {
      tokens.push(...splitOnKnownNouns(part));
    } else {
      tokens.push(part);
    }
  }
  return tokens
    .map(t => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase())
    .join(' ');
}
function splitOnKnownNouns(s: string): string[] {
  const out: string[] = [];
  let rest = s;
  outer: while (rest.length > 0) {
    // Prefer the longest matching known token at the start.
    const candidates = KNOWN_TOKENS
      .filter(t => rest.startsWith(t))
      .sort((a, b) => b.length - a.length);
    if (candidates.length > 0) {
      out.push(candidates[0]);
      rest = rest.slice(candidates[0].length);
      continue outer;
    }
    // No match — emit the whole remaining string as one token.
    out.push(rest);
    break;
  }
  return out;
}

const useStyles = makeStyles({
  providerRoot: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
    overflow: 'hidden',
  },
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '6px 16px',
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    flexShrink: 0,
  },
  entityIcon: {
    width: '28px',
    height: '28px',
    borderRadius: '4px',
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.3px',
    flexShrink: 0,
  },
  headerText: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    lineHeight: 1.2,
  },
  entityType: {
    fontSize: '11px',
    color: tokens.colorNeutralForeground3,
    fontWeight: tokens.fontWeightRegular,
    letterSpacing: '0.2px',
  },
  recordName: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    overflow: 'hidden',
    fontSize: tokens.fontSizeBase500,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    margin: 0,
  },
  recordNameText: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  dirtyDot: {
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    backgroundColor: tokens.colorPaletteRedForeground1,
    flexShrink: 0,
  },
  commandBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    padding: '2px 12px',
    backgroundColor: tokens.colorNeutralBackground1,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    flexShrink: 0,
  },
  cmdButton: {
    fontWeight: tokens.fontWeightRegular,
    minHeight: '32px',
  },
  tabStrip: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: '4px',
    padding: '6px 12px 0 12px',
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    flexShrink: 0,
    overflowX: 'auto',
  },
  tabButton: {
    appearance: 'none',
    background: tokens.colorNeutralBackground3,
    padding: '8px 16px',
    cursor: 'pointer',
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground2,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderBottom: 'none',
    borderTopLeftRadius: tokens.borderRadiusMedium,
    borderTopRightRadius: tokens.borderRadiusMedium,
    whiteSpace: 'nowrap',
    position: 'relative',
    top: '1px',
    ':hover': {
      color: tokens.colorNeutralForeground1,
      backgroundColor: tokens.colorNeutralBackground3Hover,
    },
  },
  tabButtonActive: {
    color: tokens.colorBrandForeground1,
    backgroundColor: tokens.colorNeutralBackground1,
    borderTopColor: tokens.colorNeutralStroke1,
    borderLeftColor: tokens.colorNeutralStroke1,
    borderRightColor: tokens.colorNeutralStroke1,
    fontWeight: tokens.fontWeightSemibold,
    boxShadow: `inset 0 3px 0 0 ${tokens.colorBrandForeground1}`,
    paddingTop: '8px',
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground1,
    },
  },
  viewportArea: {
    flex: 1,
    overflow: 'hidden',
    minHeight: 0,
  },
  footer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '6px 12px',
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    flexShrink: 0,
  },
  notification: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 10px',
    borderRadius: '4px',
    fontSize: tokens.fontSizeBase300,
  },
  notificationError: {
    backgroundColor: tokens.colorPaletteRedBackground2,
    color: tokens.colorPaletteRedForeground1,
  },
  notificationWarning: {
    backgroundColor: tokens.colorPaletteYellowBackground2,
    color: tokens.colorPaletteYellowForeground2,
  },
  notificationInformation: {
    backgroundColor: tokens.colorPaletteBlueBackground2,
    color: tokens.colorPaletteBlueForeground2,
  },
  notificationMessage: { flex: 1 },
});

interface Props {
  entityTypeName: string;
  children: React.ReactNode;
}

export function FormChrome({ entityTypeName, children }: Props) {
  const styles = useStyles();
  const enabled = useHarnessStore(s => s.formChromeEnabled);
  const isDarkMode = useHarnessStore(s => s.isDarkMode);
  const reloadControl = useHarnessStore(s => s.reloadControl);

  // Subscribe to form-store version for entity header + tabs + dirty state.
  useSyncExternalStore(
    subscribeFormState,
    () => getFormStateVersion(),
    () => 0,
  );

  const [notifications, setNotifications] = useState<readonly FormNotification[]>([]);
  useEffect(() => subscribeFormNotifications(setNotifications), []);

  if (!enabled) return <>{children}</>;

  const tabs = listTabs();
  const activeTab = tabs.find(t => t.focused) ?? tabs[0];
  const dirty = isFormDirty();
  const primary = getPrimaryAttributeName();
  const primaryValue = primary ? getAttributeState(primary)?.value : null;
  const displayEntityName = humanizeLogicalName(entityTypeName);
  const recordName = primaryValue != null && primaryValue !== ''
    ? String(primaryValue)
    : displayEntityName
      ? `New ${displayEntityName}`
      : 'New record';

  // Initials = first letter of each word in the humanized name (max 2).
  const initials = displayEntityName
    ? displayEntityName.split(/\s+/).slice(0, 2).map(w => w.charAt(0).toUpperCase()).join('') || 'RE'
    : 'RE';

  const xrmPage = (window as any).Xrm?.Page;
  const handleSave = () => xrmPage?.data?.entity?.save?.();
  const handleSaveAndClose = () => {
    xrmPage?.data?.entity?.save?.();
    xrmPage?.ui?.close?.();
  };
  const handleRefresh = () => {
    xrmPage?.ui?.refreshRibbon?.(true);
    reloadControl?.();
  };
  const handleDelete = () => xrmPage?.ui?.setFormNotification?.('Delete is a no-op in the harness.', 'INFORMATION', 'harness-delete-info');

  const handleTabClick = (tabName: string) => {
    setTabFocus(tabName);
  };

  return (
    <FluentProvider theme={isDarkMode ? webDarkTheme : webLightTheme} className={styles.providerRoot}>
      <div className={styles.root}>
      <div className={styles.header} data-test-id="form-chrome-header">
        <div className={styles.entityIcon} aria-hidden>{initials}</div>
        <div className={styles.headerText}>
          <span className={styles.entityType} data-test-id="form-chrome-entity-type">{displayEntityName || 'Entity'}</span>
          <h2 className={styles.recordName}>
            <span className={styles.recordNameText} data-test-id="form-chrome-record-name">{String(recordName ?? '')}</span>
            {dirty && <span className={styles.dirtyDot} data-test-id="form-chrome-dirty-indicator" title="Unsaved changes" />}
          </h2>
        </div>
      </div>

      <div className={styles.commandBar} data-test-id="form-chrome-command-bar">
        <span data-test-id="form-chrome-cmd-save">
          <Button appearance="subtle" size="small" className={styles.cmdButton} icon={<Save20Regular />} onClick={handleSave}>Save</Button>
        </span>
        <span data-test-id="form-chrome-cmd-save-close">
          <Button appearance="subtle" size="small" className={styles.cmdButton} icon={<SaveCopy20Regular />} onClick={handleSaveAndClose}>Save &amp; Close</Button>
        </span>
        <span data-test-id="form-chrome-cmd-refresh">
          <Button appearance="subtle" size="small" className={styles.cmdButton} icon={<ArrowClockwise20Regular />} onClick={handleRefresh}>Refresh</Button>
        </span>
        <span data-test-id="form-chrome-cmd-delete">
          <Button appearance="subtle" size="small" className={styles.cmdButton} icon={<Delete20Regular />} onClick={handleDelete}>Delete</Button>
        </span>
      </div>

      {tabs.length > 0 && (
        <div className={styles.tabStrip} data-test-id="form-chrome-tab-strip" role="tablist">
          {tabs.filter(t => t.visible).map(t => {
            const isActive = activeTab?.name === t.name;
            const cls = `${styles.tabButton} ${isActive ? styles.tabButtonActive : ''}`.trim();
            return (
              <button
                key={t.name}
                className={cls}
                role="tab"
                aria-selected={isActive}
                data-test-id={`form-chrome-tab-${t.name}`}
                onClick={() => handleTabClick(t.name)}
              >
                {t.label ?? t.name}
              </button>
            );
          })}
        </div>
      )}

      {notifications.length > 0 && (
        <div className={styles.footer} data-test-id="form-chrome-notifications">
          {notifications.map(n => {
            const levelClass =
              n.level === 'WARNING' ? styles.notificationWarning :
              n.level === 'INFORMATION' ? styles.notificationInformation :
              styles.notificationError;
            return (
              <div
                key={n.id}
                className={`${styles.notification} ${levelClass}`}
                role="status"
                data-test-id={`form-chrome-notification-${n.id}`}
              >
                <span className={styles.notificationMessage}>{n.message}</span>
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<Dismiss16Regular />}
                  onClick={() => dismissFormNotification(n.id)}
                  aria-label="Dismiss notification"
                />
              </div>
            );
          })}
        </div>
      )}

      <div className={styles.viewportArea}>{children}</div>
    </div>
    </FluentProvider>
  );
}
