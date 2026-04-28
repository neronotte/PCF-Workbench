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
        return Promise.resolve({ LogicalName: entityName, EntitySetName: entityName + 's' });
      },
      getResourceString(webResourceName: string, key: string): string {
        return key;
      },
      lookupObjects(options: any): Promise<any[]> {
        return Promise.resolve([]);
      },
    };
    w.Xrm.Utility = wrapWithWarnings(rawUtility, 'Utility', getState);
    console.log('[pcf-workbench] Xrm.Utility global shim installed');
  }
}
