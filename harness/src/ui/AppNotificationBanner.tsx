/**
 * App-level notification banner.
 *
 * Renders `Xrm.App.addGlobalNotification` calls as a stack of UCI-style
 * banners across the very top of the harness content area — above the form
 * chrome, above the control viewport. Mirrors real Dataverse app behaviour
 * where a global notification persists across forms until cleared.
 *
 * Form-level notifications (`formContext.ui.setFormNotification`) are a
 * different surface and are rendered by FormChrome instead, scoped to the
 * current record.
 */
import { useState, useEffect } from 'react';
import { makeStyles, tokens, Button } from '@fluentui/react-components';
import { Dismiss16Regular } from '@fluentui/react-icons';
import {
    subscribeAppNotifications, clearAppNotification,
    type AppNotification,
} from '../shim/xrm-app-notifications';

const useStyles = makeStyles({
    root: {
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        padding: '6px 12px',
        flexShrink: 0,
    },
    notification: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 10px',
        borderRadius: tokens.borderRadiusMedium,
        fontSize: tokens.fontSizeBase300,
        borderLeftWidth: '3px',
        borderLeftStyle: 'solid',
    },
    levelSuccess: {
        backgroundColor: tokens.colorPaletteGreenBackground2,
        color: tokens.colorPaletteGreenForeground2,
        borderLeftColor: tokens.colorPaletteGreenBorderActive,
    },
    levelError: {
        backgroundColor: tokens.colorPaletteRedBackground2,
        color: tokens.colorPaletteRedForeground1,
        borderLeftColor: tokens.colorPaletteRedBorderActive,
    },
    levelWarning: {
        backgroundColor: tokens.colorPaletteYellowBackground2,
        color: tokens.colorPaletteYellowForeground2,
        borderLeftColor: tokens.colorPaletteYellowBorderActive,
    },
    levelInformation: {
        backgroundColor: tokens.colorPaletteBlueBackground2,
        color: tokens.colorPaletteBlueForeground2,
        borderLeftColor: tokens.colorPaletteBlueBorderActive,
    },
    message: { flex: 1 },
    actionLink: {
        textDecoration: 'underline',
        cursor: 'pointer',
    },
});

export function AppNotificationBanner() {
    const styles = useStyles();
    const [items, setItems] = useState<readonly AppNotification[]>([]);
    useEffect(() => subscribeAppNotifications(setItems), []);

    if (items.length === 0) return null;

    return (
        <div className={styles.root} data-test-id="app-notification-banner">
            {items.map((n) => {
                const levelClass =
                    n.level === 1 ? styles.levelSuccess :
                    n.level === 2 ? styles.levelError :
                    n.level === 3 ? styles.levelWarning :
                    styles.levelInformation;
                return (
                    <div
                        key={n.id}
                        className={`${styles.notification} ${levelClass}`}
                        role="status"
                        data-test-id={`app-notification-${n.id}`}
                    >
                        <span className={styles.message}>{n.message}</span>
                        {n.action?.actionLabel && (
                            <a
                                className={styles.actionLink}
                                onClick={() => n.action?.eventHandler?.()}
                                data-test-id={`app-notification-action-${n.id}`}
                            >
                                {n.action.actionLabel}
                            </a>
                        )}
                        {n.showCloseButton && (
                            <Button
                                appearance="subtle"
                                size="small"
                                icon={<Dismiss16Regular />}
                                onClick={() => clearAppNotification(n.id)}
                                aria-label="Dismiss notification"
                            />
                        )}
                    </div>
                );
            })}
        </div>
    );
}
