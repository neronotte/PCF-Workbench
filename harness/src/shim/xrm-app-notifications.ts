/**
 * Xrm.App global notification simulator.
 *
 * Real Unified Client Interface renders `Xrm.App.addGlobalNotification` as a
 * banner across the *top* of the app shell — above any open form, above the
 * command bar, persistent until cleared. We reproduce that with a tiny
 * pub/sub store that the harness's `<AppNotificationBanner />` subscribes
 * to and renders in HarnessShell, above the side panels and form chrome.
 *
 * Mirrors `xrm-form.ts` for form-level notifications. The two are
 * intentionally separate: form notifications are scoped to the current
 * record, app notifications are scoped to the whole shell.
 *
 * UCI semantics for `addGlobalNotification(notification)`:
 *   - notification.type    : 2 = informational (only supported value today)
 *   - notification.level   : 1=Success, 2=Error, 3=Warning, 4=Information
 *   - notification.message : the text shown
 *   - notification.action  : optional { actionLabel, eventHandler }
 *   - notification.showCloseButton : default true
 * Returns Promise<string> — an ID the caller passes to clearGlobalNotification.
 */

export type AppNotificationLevel = 1 | 2 | 3 | 4;

export interface AppNotification {
    id: string;
    type: number;
    level: AppNotificationLevel;
    message: string;
    showCloseButton: boolean;
    action?: { actionLabel?: string; eventHandler?: () => void };
}

type Listener = (items: readonly AppNotification[]) => void;

const notifications = new Map<string, AppNotification>();
const listeners = new Set<Listener>();
let nextId = 1;

function emit(): void {
    const snapshot: readonly AppNotification[] = Array.from(notifications.values());
    listeners.forEach((l) => {
        try {
            l(snapshot);
        } catch (e) {
            console.error('[pcf-workbench] app-notification listener error', e);
        }
    });
}

export function subscribeAppNotifications(listener: Listener): () => void {
    listeners.add(listener);
    listener(Array.from(notifications.values()));
    return () => {
        listeners.delete(listener);
    };
}

export function getAppNotifications(): readonly AppNotification[] {
    return Array.from(notifications.values());
}

export function addAppNotification(input: {
    type?: number;
    level: number;
    message: string;
    showCloseButton?: boolean;
    action?: { actionLabel?: string; eventHandler?: () => void };
}): string {
    const id = `app-notif-${nextId++}`;
    const level = clampLevel(input.level);
    notifications.set(id, {
        id,
        type: input.type ?? 2,
        level,
        message: input.message,
        showCloseButton: input.showCloseButton ?? true,
        action: input.action,
    });
    emit();
    return id;
}

export function clearAppNotification(id: string): boolean {
    const existed = notifications.delete(id);
    if (existed) emit();
    return existed;
}

function clampLevel(level: number): AppNotificationLevel {
    if (level === 1 || level === 2 || level === 3 || level === 4) return level;
    return 4;
}
