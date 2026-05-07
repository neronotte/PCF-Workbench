/**
 * Install global Xrm.WebApi, Xrm.Navigation, and Xrm.Utility shims.
 *
 * Many 3rd-party PCF controls access the global `Xrm.WebApi.online` or
 * `Xrm.Utility` instead of using the PCF context APIs. This shim ensures
 * those globals exist and respect the workbench network-mode setting.
 *
 * Every call through the global Xrm shims logs a best-practice warning
 * to the harness console: controls should use context.webAPI /
 * context.navigation instead.
 *
 * Must be called after the harness store and data store are available
 * (i.e. from control-host, not from main.tsx).
 */

import type { HarnessStore } from '../store/harness-store';
import { createWebApiShim } from './web-api';
import { createNavigationShim } from './navigation';
import { createDeviceShim } from './device';
import { pushDialog, type AlertDialogRequest, type ConfirmDialogRequest } from './dialog-bus';
import { isFeatureAvailable } from './profile';
import { addAppNotification, clearAppNotification } from './xrm-app-notifications';

let installed = false;

const WARNING_PREFIX = '⚠️ Global Xrm';
const GUIDANCE = 'Use context.webAPI / context.navigation instead. See https://learn.microsoft.com/power-apps/developer/component-framework/reference/webapi';

/**
 * Wrap an API object so every method call logs a best-practice warning
 * to the harness console panel. Sub-objects (e.g. .online, .offline)
 * are wrapped recursively.
 */
function wrapWithWarnings(
  obj: Record<string, any>,
  namespace: string,
  getState: () => HarnessStore,
): Record<string, any> {
  const warned = new Set<string>();
  const wrapped: Record<string, any> = {};

  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (typeof val === 'function') {
      wrapped[key] = (...args: any[]) => {
        const qualifiedName = `Xrm.${namespace}.${key}`;
        getState().addLogEntry({
          category: 'warning',
          method: qualifiedName,
          args: { message: `${WARNING_PREFIX}: ${qualifiedName}() called. ${GUIDANCE}` },
        });
        if (!warned.has(qualifiedName)) {
          warned.add(qualifiedName);
          console.warn(`[pcf-workbench] ${WARNING_PREFIX}: ${qualifiedName}() called. ${GUIDANCE}`);
        }
        return val.apply(obj, args);
      };
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      // Recurse into sub-objects like .online / .offline
      wrapped[key] = wrapWithWarnings(val, `${namespace}.${key}`, getState);
    } else {
      wrapped[key] = val;
    }
  }
  return wrapped;
}

export function installXrmGlobalShims(
  getState: () => HarnessStore,
  getEntityData: (entityType: string) => Record<string, any>[],
): void {
  if (installed) return;
  installed = true;

  const w = window as unknown as { Xrm?: any };
  if (!w.Xrm) w.Xrm = {};

  // Xrm.WebApi — mirrors context.webAPI with .online and .offline sub-APIs
  if (!w.Xrm.WebApi) {
    const rawApi = createWebApiShim(getState, getEntityData);
    w.Xrm.WebApi = wrapWithWarnings(rawApi, 'WebApi', getState);
    console.log('[pcf-workbench] Xrm.WebApi global shim installed');
  }

  // Xrm.Navigation — openConfirmDialog, openAlertDialog, openForm, etc.
  if (!w.Xrm.Navigation) {
    const rawNav = createNavigationShim(getState);
    w.Xrm.Navigation = wrapWithWarnings(rawNav, 'Navigation', getState);
    console.log('[pcf-workbench] Xrm.Navigation global shim installed');
  }

  // Xrm.Utility — getGlobalContext and other common helpers
  if (!w.Xrm.Utility) {
    const rawUtility = {
      getGlobalContext() {
        const state = getState();
        return {
          client: {
            getClient(): string {
              const { host, formFactor } = state;
              if (host && host !== 'Web') return host;
              return formFactor === 3 ? 'Mobile' : 'Web';
            },
            getClientState(): string {
              return state.networkMode === 'offline' ? 'Offline' : 'Online';
            },
            getFormFactor(): number {
              return state.formFactor;
            },
            isOffline(): boolean {
              return state.networkMode === 'offline';
            },
            isNetworkAvailable(): boolean {
              return state.networkMode !== 'offline';
            },
          },
          organizationSettings: {
            uniqueName: 'harness-org',
            organizationId: '00000000-0000-0000-0000-000000000000',
            languageId: 1033,
            isAutoSaveEnabled: true,
          },
          userSettings: {
            userId: '{00000000-0000-0000-0000-000000000001}',
            userName: 'Harness User',
            languageId: 1033,
            securityRoles: ['System Administrator'],
            isGuidedHelpEnabled: false,
            isHighContrastEnabled: false,
            isRTL: false,
          },
          getClientUrl(): string {
            return window.location.origin;
          },
          getCurrentAppUrl(): string {
            return window.location.href;
          },
          getVersion(): string {
            return '9.2.0.0';
          },
          isOnPremises(): boolean {
            return false;
          },
        };
      },
      getEntityMetadata(entityName: string): Promise<any> {
        getState().addLogEntry({ category: 'utility', method: 'getEntityMetadata', args: { entityName }, coverage: 'stub' });
        return Promise.resolve({ LogicalName: entityName, EntitySetName: entityName + 's' });
      },
      getResourceString(webResourceName: string, key: string): string {
        getState().addLogEntry({ category: 'utility', method: 'getResourceString', args: { webResourceName, key }, coverage: 'stub' });
        return key;
      },
      lookupObjects(options: any): Promise<any[]> {
        getState().addLogEntry({ category: 'utility', method: 'lookupObjects', args: options, coverage: 'stub' });
        return Promise.resolve([]);
      },
      alertDialog(alertStrings: { confirmButtonLabel?: string; text?: string; title?: string }, options?: any): Promise<void> {
        return new Promise<void>(resolve => {
          pushDialog<AlertDialogRequest>({
            kind: 'alert',
            alertStrings: alertStrings ?? {},
            options,
            resolve,
          });
        });
      },
      confirmDialog(
        confirmStrings: { cancelButtonLabel?: string; confirmButtonLabel?: string; subtitle?: string; text?: string; title?: string },
        options?: any,
      ): Promise<{ confirmed: boolean }> {
        return new Promise(resolve => {
          pushDialog<ConfirmDialogRequest>({
            kind: 'confirm',
            confirmStrings: confirmStrings ?? {},
            options,
            resolve,
          });
        });
      },
      showProgressIndicator(message?: string): void {
        getState().addLogEntry({ category: 'utility', method: 'showProgressIndicator', args: { message }, coverage: 'stub' });
      },
      closeProgressIndicator(): void {
        getState().addLogEntry({ category: 'utility', method: 'closeProgressIndicator', coverage: 'stub' });
      },
      invokeProcessAction(name: string, parameters: any): Promise<any> {
        getState().addLogEntry({ category: 'utility', method: 'invokeProcessAction', args: { name, parameters }, coverage: 'stub' });
        return Promise.resolve({});
      },
      refreshParentGrid(_lookupOptions?: any): void {
        getState().addLogEntry({ category: 'utility', method: 'refreshParentGrid', coverage: 'stub' });
      },
      getAllowedStatusTransitions(entityName: string, stateCode: number): Promise<number[]> {
        getState().addLogEntry({ category: 'utility', method: 'getAllowedStatusTransitions', args: { entityName, stateCode }, coverage: 'stub' });
        return Promise.resolve([]);
      },
      getPageContext(): { input: { pageType: string; entityName?: string; entityId?: string; formType?: number } } {
        getState().addLogEntry({ category: 'utility', method: 'getPageContext', coverage: 'stub' });
        return { input: { pageType: 'entityrecord', entityName: 'pcf_harness', entityId: '00000000-0000-0000-0000-000000000000', formType: 2 } };
      },
      openQuickCreate(entityLogicalName: string, createFromEntity?: any, customParameters?: Record<string, any>): Promise<{ savedEntityReference: any[] }> {
        getState().addLogEntry({
          category: 'utility',
          method: 'openQuickCreate',
          args: { entityLogicalName, createFromEntity, customParameters },
          coverage: 'stub',
        });
        return Promise.resolve({ savedEntityReference: [] });
      },
    };
    w.Xrm.Utility = wrapWithWarnings(rawUtility, 'Utility', getState);
    console.log('[pcf-workbench] Xrm.Utility global shim installed');
  }

  // Xrm.Encoding — pure-function string helpers
  if (!w.Xrm.Encoding) {
    const escapeMap: Record<string, string> = {
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    };
    const xmlMap: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
    w.Xrm.Encoding = {
      htmlEncode(s: string): string {
        return String(s ?? '').replace(/[&<>"']/g, c => escapeMap[c] ?? c);
      },
      htmlDecode(s: string): string {
        const e = document.createElement('textarea');
        e.innerHTML = String(s ?? '');
        return e.value;
      },
      htmlAttributeEncode(s: string): string {
        return String(s ?? '').replace(/[&<>"']/g, c => escapeMap[c] ?? c);
      },
      xmlAttributeEncode(s: string): string {
        return String(s ?? '').replace(/[&<>"]/g, c => (c === '"' ? '&quot;' : (xmlMap[c] ?? c)));
      },
      xmlEncode(s: string): string {
        return String(s ?? '').replace(/[&<>]/g, c => xmlMap[c] ?? c);
      },
    };
    console.log('[pcf-workbench] Xrm.Encoding global shim installed');
  }

  // Xrm.Device — wraps the existing device shim used for context.device
  if (!w.Xrm.Device) {
    w.Xrm.Device = createDeviceShim(getState);
    console.log('[pcf-workbench] Xrm.Device global shim installed');
  }

  // Xrm.App — global notifications + side panes
  if (!w.Xrm.App) {
    const sidePanes = new Map<string, any>();
    let nextSidePaneId = 1;
    w.Xrm.App = {
      addGlobalNotification(notification: { type: number; level: number; message: string; showCloseButton?: boolean; action?: any }): Promise<string> {
        const id = addAppNotification(notification);
        getState().addLogEntry({ category: 'app', method: 'addGlobalNotification', args: { id, ...notification }, coverage: 'implemented' });
        return Promise.resolve(id);
      },
      clearGlobalNotification(id: string): Promise<void> {
        clearAppNotification(id);
        getState().addLogEntry({ category: 'app', method: 'clearGlobalNotification', args: { id }, coverage: 'implemented' });
        return Promise.resolve();
      },
      sidePanes: {
        state: 0,
        selected: null as any,
        getAllPanes(): any[] {
          if (!isFeatureAvailable(getState, 'xrm.app.sidePanes')) return [];
          return Array.from(sidePanes.values());
        },
        getPane(paneId: string): any {
          if (!isFeatureAvailable(getState, 'xrm.app.sidePanes')) return undefined;
          return sidePanes.get(paneId);
        },
        createPane(input: { title?: string; paneId?: string; canClose?: boolean; imageSrc?: string; hideHeader?: boolean; isSelected?: boolean; width?: number }): Promise<any> {
          if (!isFeatureAvailable(getState, 'xrm.app.sidePanes')) {
            const err = new Error(`Xrm.App.sidePanes is not available on Dataverse ${getState().shimProfile}. Switch shim profile to 9.2 or latest.`);
            getState().addLogEntry({ category: 'app', method: 'sidePanes.createPane', args: input, result: { error: err.message }, coverage: 'unimplemented' });
            return Promise.reject(err);
          }
          const paneId = input.paneId ?? `pane-${nextSidePaneId++}`;
          const pane = {
            paneId,
            title: input.title ?? '',
            isSelected: !!input.isSelected,
            canClose: input.canClose !== false,
            imageSrc: input.imageSrc,
            hideHeader: !!input.hideHeader,
            width: input.width ?? 320,
            close: () => Promise.resolve(sidePanes.delete(paneId)),
            navigate: (_pageInput: any) => Promise.resolve(),
          };
          sidePanes.set(paneId, pane);
          getState().addLogEntry({ category: 'app', method: 'sidePanes.createPane', args: input, coverage: 'stub' });
          return Promise.resolve(pane);
        },
      },
    };
    console.log('[pcf-workbench] Xrm.App global shim installed');
  }

  // Xrm.Panel — legacy single-pane API
  if (!w.Xrm.Panel) {
    w.Xrm.Panel = {
      loadPanel(url: string, title?: string): void {
        getState().addLogEntry({ category: 'panel', method: 'loadPanel', args: { url, title }, coverage: 'stub' });
        console.log('[pcf-workbench] Xrm.Panel.loadPanel', { url, title });
      },
    };
    console.log('[pcf-workbench] Xrm.Panel global shim installed');
  }
}
