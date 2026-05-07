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
import { makeStyles, tokens, Button, Title3 } from '@fluentui/react-components';
import {
  Save24Regular, SaveCopy24Regular, ArrowClockwise24Regular,
  Delete24Regular, Dismiss16Regular,
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
    gap: '12px',
    padding: '8px 16px',
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    flexShrink: 0,
  },
  entityIcon: {
    width: '32px',
    height: '32px',
    borderRadius: '4px',
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
    fontWeight: 600,
    flexShrink: 0,
  },
  headerText: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  },
  entityType: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  recordName: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  dirtyDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: tokens.colorPaletteRedForeground1,
    flexShrink: 0,
  },
  commandBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '4px 12px',
    backgroundColor: tokens.colorNeutralBackground1,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    flexShrink: 0,
  },
  tabStrip: {
    display: 'flex',
    alignItems: 'stretch',
    padding: '0 12px',
    backgroundColor: tokens.colorNeutralBackground1,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    flexShrink: 0,
    overflowX: 'auto',
  },
  tabButton: {
    appearance: 'none',
    border: 'none',
    background: 'transparent',
    padding: '8px 16px',
    cursor: 'pointer',
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground2,
    borderBottom: '2px solid transparent',
    whiteSpace: 'nowrap',
    ':hover': {
      color: tokens.colorNeutralForeground1,
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  tabButtonActive: {
    color: tokens.colorBrandForeground1,
    borderBottomColor: tokens.colorBrandForeground1,
    fontWeight: tokens.fontWeightSemibold,
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
    padding: '4px 12px',
    backgroundColor: tokens.colorNeutralBackground2,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
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
  const recordName = primary
    ? (getAttributeState(primary)?.value ?? '(new record)')
    : '(no primary attribute)';

  const initials = (entityTypeName || 'rec').slice(0, 2).toUpperCase();

  const xrmPage = (window as any).Xrm?.Page;
  const handleSave = () => xrmPage?.data?.entity?.save?.();
  const handleSaveAndClose = () => {
    xrmPage?.data?.entity?.save?.();
    xrmPage?.ui?.close?.();
  };
  const handleRefresh = () => xrmPage?.ui?.refreshRibbon?.(true);
  const handleDelete = () => xrmPage?.ui?.setFormNotification?.('Delete is a no-op in the harness.', 'INFORMATION', 'harness-delete-info');

  const handleTabClick = (tabName: string) => {
    setTabFocus(tabName);
  };

  return (
    <div className={styles.root}>
      <div className={styles.header} data-test-id="form-chrome-header">
        <div className={styles.entityIcon} aria-hidden>{initials}</div>
        <div className={styles.headerText}>
          <span className={styles.entityType} data-test-id="form-chrome-entity-type">{entityTypeName || 'entity'}</span>
          <Title3 as="h2" className={styles.recordName}>
            <span data-test-id="form-chrome-record-name">{String(recordName ?? '')}</span>
            {dirty && <span className={styles.dirtyDot} data-test-id="form-chrome-dirty-indicator" title="Unsaved changes" />}
          </Title3>
        </div>
      </div>

      <div className={styles.commandBar} data-test-id="form-chrome-command-bar">
        <span data-test-id="form-chrome-cmd-save">
          <Button appearance="subtle" icon={<Save24Regular />} onClick={handleSave}>Save</Button>
        </span>
        <span data-test-id="form-chrome-cmd-save-close">
          <Button appearance="subtle" icon={<SaveCopy24Regular />} onClick={handleSaveAndClose}>Save &amp; Close</Button>
        </span>
        <span data-test-id="form-chrome-cmd-refresh">
          <Button appearance="subtle" icon={<ArrowClockwise24Regular />} onClick={handleRefresh}>Refresh</Button>
        </span>
        <span data-test-id="form-chrome-cmd-delete">
          <Button appearance="subtle" icon={<Delete24Regular />} onClick={handleDelete}>Delete</Button>
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

      <div className={styles.viewportArea}>{children}</div>

      {notifications.length > 0 && (
        <div className={styles.footer} data-test-id="form-chrome-footer">
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
    </div>
  );
}
