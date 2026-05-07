import { create } from 'zustand';
import type { ManifestConfig } from '../types/manifest';

export type CoverageStatus = 'implemented' | 'stub' | 'unimplemented';

/**
 * Versioned shim profile. Each profile gates which Xrm / formContext APIs are
 * available so that a PCF intended for Dataverse 9.0 can be tested against
 * the API surface of that release rather than the latest.
 *
 *   - '9.0'    — pre-Wave-2-2021 baseline. No Xrm.App.sidePanes,
 *                no formContext.data.refresh polling, lookupObjects returns
 *                the legacy single-record shape.
 *   - '9.2'    — Wave-2-2021 forward (current LTS-equivalent). Side panes,
 *                richer Xrm.Utility, executionContext on every handler.
 *   - 'latest' — current dev-channel; tracks the live CDS Web API.
 */
export type ShimProfile = '9.0' | '9.2' | 'latest';

export const SHIM_PROFILE_LABELS: Record<ShimProfile, string> = {
  '9.0': 'Dataverse 9.0',
  '9.2': 'Dataverse 9.2',
  'latest': 'Latest',
};

export interface LogEntry {
  id: number;
  timestamp: number;
  category: string;
  method: string;
  args?: any;
  result?: any;
  /**
   * Implementation fidelity:
   *  - 'implemented' (default): full behavioural parity with the live UCI host
   *  - 'stub': the call is wired but returns canned data / has no side effects
   *  - 'unimplemented': the call is a no-op placeholder; controls relying on
   *    real behaviour will misbehave
   */
  coverage?: CoverageStatus;
}

export interface WebApiCallRecord {
  id: number;
  timestamp: number;
  method: string;           // retrieveMultipleRecords, retrieveRecord, etc.
  entityType: string;
  durationMs: number;
  responseSize: number;     // approximate JSON size in bytes
  recordCount: number;      // number of entities returned
  options?: string;          // OData query string
  error?: string;
}

export interface HeapSnapshot {
  timestamp: number;
  heapUsedMB: number;
  label: string;            // what triggered the snapshot (e.g. "after updateView #3")
}

export type LifecycleMethod = 'init' | 'updateView' | 'getOutputs' | 'destroy' | 'notifyOutputChanged';

export interface LifecycleEvent {
  id: number;
  timestamp: number;
  method: LifecycleMethod;
  durationMs: number;
  error?: string;
}

export interface ResourceLeak {
  type: 'eventListener' | 'timer' | 'observer';
  detail: string;
}

export type NetworkMode = 'online' | 'offline' | 'slow3g' | 'fast3g' | 'custom';

export interface DatasetSortStatus {
  name: string;
  sortDirection: 0 | 1; // 0 = ascending, 1 = descending
}

export interface DatasetState {
  pageNumber: number;
  pageSize: number;
  sorting: DatasetSortStatus[];
  filtering: any;
  selectedIds: string[];
}

export function defaultDatasetState(): DatasetState {
  return { pageNumber: 1, pageSize: 250, sorting: [], filtering: null, selectedIds: [] };
}

export interface DevicePreset {
  name: string;
  width: number;
  height: number;
  formFactor: number; // 1=Desktop, 2=Tablet, 3=Phone
}

export const DEVICE_PRESETS: Record<string, DevicePreset> = {
  desktop: { name: 'Desktop', width: 1280, height: 720, formFactor: 1 },
  'iphone-14': { name: 'iPhone 14 Pro', width: 390, height: 844, formFactor: 3 },
  'pixel-7': { name: 'Pixel 7', width: 412, height: 915, formFactor: 3 },
  ipad: { name: 'iPad', width: 820, height: 1180, formFactor: 2 },
};

export interface HarnessStore {
  // Manifest
  manifest: ManifestConfig | null;
  setManifest: (manifest: ManifestConfig) => void;

  // Property values
  propertyValues: Record<string, any>;
  setPropertyValue: (name: string, value: any) => void;
  setPropertyValues: (values: Record<string, any>) => void;

  // Property types (for of-type-group properties — tracks the maker's Type dropdown selection)
  propertyTypes: Record<string, string>;
  setPropertyType: (name: string, type: string) => void;

  // Network conditioning
  networkMode: NetworkMode;
  customLatencyMs: number;
  setNetworkMode: (mode: NetworkMode) => void;
  setCustomLatencyMs: (ms: number) => void;

  // Device emulation
  devicePreset: string;
  viewportWidth: number;
  viewportHeight: number;
  formFactor: number;
  setDevicePreset: (preset: string) => void;

  // Component container size (null = fill viewport)
  containerWidth: number | null;
  containerHeight: number | null;
  setContainerWidth: (width: number | null) => void;
  setContainerHeight: (height: number | null) => void;

  // Control mode
  isControlDisabled: boolean;
  setControlDisabled: (disabled: boolean) => void;

  // Authoring mode (designer preview). When true, context.mode.isAuthoringMode
  // returns true so InfoCard-style controls render their designer preview UI.
  // Not part of the official PCF surface but several first-party controls key
  // off it via `context.mode.isAuthoringMode`.
  isAuthoringMode: boolean;
  setAuthoringMode: (value: boolean) => void;

  // Page context (for controls that read context.page.entityId / entityTypeName)
  pageEntityId: string;
  pageEntityTypeName: string;
  pageEntityRecordName: string;
  setPageEntityId: (id: string) => void;
  setPageEntityTypeName: (name: string) => void;
  setPageEntityRecordName: (name: string) => void;

  // Theme
  isDarkMode: boolean;
  toggleDarkMode: () => void;

  // Form chrome (UCI header / command bar / tab strip / footer)
  formChromeEnabled: boolean;
  toggleFormChrome: () => void;

  // Versioned shim profile (Dataverse 9.0 / 9.2 / latest)
  // Controls feature gating in shims so a control built for 9.x can be
  // tested with the same restrictions it would face on a real org.
  shimProfile: ShimProfile;
  setShimProfile: (profile: ShimProfile) => void;

  // Fullscreen state (toggled via context.mode.setFullScreen)
  isFullscreen: boolean;
  setFullscreen: (value: boolean) => void;

  // Host (drives context.client.getClient())
  host: 'Web' | 'Mobile' | 'Outlook' | 'Teams';
  setHost: (host: 'Web' | 'Mobile' | 'Outlook' | 'Teams') => void;

  // Reload callback registered by ControlViewport so other parts of the
  // harness UI (e.g. the top-bar Refresh button) can trigger a full
  // destroy → init → updateView cycle on the loaded control.
  reloadControl: (() => void) | null;
  setReloadControl: (fn: (() => void) | null) => void;

  // Dataset state (per dataset name) and a monotonically increasing data version
  // that ControlViewport observes to trigger updateView when data mutates.
  datasetState: Record<string, DatasetState>;
  dataVersion: number;
  setDatasetPage: (name: string, pageNumber: number, pageSize: number) => void;
  setDatasetSorting: (name: string, sorting: DatasetSortStatus[]) => void;
  setDatasetFiltering: (name: string, filtering: any) => void;
  setDatasetSelectedIds: (name: string, ids: string[]) => void;
  bumpDataVersion: () => void;

  // User settings (drives context.userSettings)
  userLanguageId: number;
  userIsRTL: boolean;
  userTimeZoneOffsetMinutes: number;
  userId: string;
  userName: string;
  userSecurityRoles: string[];
  setUserLanguageId: (lcid: number) => void;
  setUserIsRTL: (rtl: boolean) => void;
  setUserTimeZoneOffsetMinutes: (offset: number) => void;
  setUserId: (id: string) => void;
  setUserName: (name: string) => void;
  setUserSecurityRoles: (roles: string[]) => void;

  // Performance metrics
  renderCount: number;
  lastRenderTimeMs: number;
  renderTimings: number[];       // history of render durations (ms)
  webApiCallCount: number;
  domNodeCount: number;
  jsHeapUsedMB: number;
  webApiCalls: WebApiCallRecord[];
  heapSnapshots: HeapSnapshot[];
  incrementRenderCount: (timeMs: number) => void;
  incrementWebApiCallCount: () => void;
  addWebApiCall: (call: Omit<WebApiCallRecord, 'id' | 'timestamp'>) => void;
  updateDomNodeCount: (count: number) => void;
  updateJsHeap: (mb: number) => void;
  addHeapSnapshot: (label: string) => void;
  resetMetrics: () => void;

  // Lifecycle tracking
  lifecycleEvents: LifecycleEvent[];
  addLifecycleEvent: (event: Omit<LifecycleEvent, 'id' | 'timestamp'>) => void;
  clearLifecycle: () => void;

  // Resource leak detection
  resourceLeaks: ResourceLeak[];
  setResourceLeaks: (leaks: ResourceLeak[]) => void;

  // Console log
  logEntries: LogEntry[];
  addLogEntry: (entry: Omit<LogEntry, 'id' | 'timestamp'>) => void;
  clearLog: () => void;

  // Data loading options
  rebaseDatesToToday: boolean;
  setRebaseDatesToToday: (enabled: boolean) => void;
}

let nextLogId = 1;

export const useHarnessStore = create<HarnessStore>((set, get) => ({
  // Manifest
  manifest: null,
  setManifest: (manifest) => {
    // Initialize property values with defaults
    const propertyValues: Record<string, any> = {};
    for (const prop of manifest.properties) {
      if (prop.ofType === 'Lookup.Simple') {
        propertyValues[prop.name] = null;
      } else if (prop.ofType === 'TwoOptions') {
        propertyValues[prop.name] = false;
      } else if (['Whole.None', 'FP', 'Decimal', 'Currency'].includes(prop.ofType)) {
        propertyValues[prop.name] = null;
      } else {
        propertyValues[prop.name] = prop.defaultValue ?? null;
      }
    }
    // Initialize property types for of-type-group properties (default to SingleLine.Text)
    const propertyTypes: Record<string, string> = {};
    for (const prop of manifest.properties) {
      if (prop.ofTypeGroup && manifest.typeGroups[prop.ofTypeGroup]) {
        const groupTypes = manifest.typeGroups[prop.ofTypeGroup];
        propertyTypes[prop.name] = groupTypes.includes('SingleLine.Text') ? 'SingleLine.Text' : groupTypes[0];
      }
    }
    set({ manifest, propertyValues, propertyTypes });
  },

  // Property values
  propertyValues: {},
  setPropertyValue: (name, value) => set(s => ({
    propertyValues: { ...s.propertyValues, [name]: value },
  })),
  setPropertyValues: (values) => set(s => ({
    propertyValues: { ...s.propertyValues, ...values },
  })),

  // Property types
  propertyTypes: {},
  setPropertyType: (name, type) => set(s => ({
    propertyTypes: { ...s.propertyTypes, [name]: type },
  })),

  // Network
  networkMode: 'online',
  customLatencyMs: 1000,
  setNetworkMode: (mode) => set({ networkMode: mode }),
  setCustomLatencyMs: (ms) => set({ customLatencyMs: ms }),

  // Device
  devicePreset: 'desktop',
  viewportWidth: DEVICE_PRESETS.desktop.width,
  viewportHeight: DEVICE_PRESETS.desktop.height,
  formFactor: DEVICE_PRESETS.desktop.formFactor,
  setDevicePreset: (preset) => {
    const p = DEVICE_PRESETS[preset];
    if (p) {
      set({
        devicePreset: preset,
        viewportWidth: p.width,
        viewportHeight: p.height,
        formFactor: p.formFactor,
      });
    }
  },

  // Component container size (null = fill viewport)
  containerWidth: null,
  containerHeight: null,
  setContainerWidth: (width) => set({ containerWidth: width }),
  setContainerHeight: (height) => set({ containerHeight: height }),

  // Mode
  isControlDisabled: false,
  setControlDisabled: (disabled) => set({ isControlDisabled: disabled }),

  isAuthoringMode: (() => {
    try {
      const v = typeof localStorage !== 'undefined' ? localStorage.getItem('pcf.isAuthoringMode') : null;
      return v === 'true';
    } catch { return false; }
  })(),
  setAuthoringMode: (value) => {
    try { localStorage.setItem('pcf.isAuthoringMode', String(value)); } catch { /* ignore */ }
    set({ isAuthoringMode: value });
  },

  // Page context
  pageEntityId: '',
  pageEntityTypeName: '',
  pageEntityRecordName: '',
  setPageEntityId: (id) => set({ pageEntityId: id }),
  setPageEntityTypeName: (name) => set({ pageEntityTypeName: name }),
  setPageEntityRecordName: (name) => set({ pageEntityRecordName: name }),

  // Theme
  isDarkMode: false,
  toggleDarkMode: () => set(s => ({ isDarkMode: !s.isDarkMode })),

  // Form chrome — persisted to localStorage so the toggle survives reloads.
  formChromeEnabled: (() => {
    try {
      const v = typeof localStorage !== 'undefined' ? localStorage.getItem('pcf.formChromeEnabled') : null;
      return v === null ? true : v === 'true';
    } catch { return true; }
  })(),
  toggleFormChrome: () => set(s => {
    const next = !s.formChromeEnabled;
    try { localStorage.setItem('pcf.formChromeEnabled', String(next)); } catch { /* ignore */ }
    return { formChromeEnabled: next };
  }),

  // Shim profile — persisted so reloads keep the chosen Dataverse version.
  shimProfile: (() => {
    try {
      const v = typeof localStorage !== 'undefined' ? localStorage.getItem('pcf.shimProfile') : null;
      if (v === '9.0' || v === '9.2' || v === 'latest') return v;
    } catch { /* ignore */ }
    return 'latest' as ShimProfile;
  })(),
  setShimProfile: (profile) => set(() => {
    try { localStorage.setItem('pcf.shimProfile', profile); } catch { /* ignore */ }
    return { shimProfile: profile };
  }),

  // Fullscreen
  isFullscreen: false,
  setFullscreen: (value) => set({ isFullscreen: value }),

  // Host
  host: 'Web',
  setHost: (host) => set({ host }),

  reloadControl: null,
  setReloadControl: (fn) => set({ reloadControl: fn }),

  // Dataset state (per dataset name)
  datasetState: {},
  dataVersion: 0,
  setDatasetPage: (name, pageNumber, pageSize) => set(s => ({
    datasetState: {
      ...s.datasetState,
      [name]: { ...defaultDatasetState(), ...s.datasetState[name], pageNumber, pageSize },
    },
  })),
  setDatasetSorting: (name, sorting) => set(s => ({
    datasetState: {
      ...s.datasetState,
      [name]: { ...defaultDatasetState(), ...s.datasetState[name], sorting },
    },
  })),
  setDatasetFiltering: (name, filtering) => set(s => ({
    datasetState: {
      ...s.datasetState,
      [name]: { ...defaultDatasetState(), ...s.datasetState[name], filtering },
    },
  })),
  setDatasetSelectedIds: (name, ids) => set(s => ({
    datasetState: {
      ...s.datasetState,
      [name]: { ...defaultDatasetState(), ...s.datasetState[name], selectedIds: ids },
    },
  })),
  bumpDataVersion: () => set(s => ({ dataVersion: s.dataVersion + 1 })),

  // User settings (driven by Intl APIs at runtime via the userSettings shim)
  userLanguageId: 1033,
  userIsRTL: false,
  userTimeZoneOffsetMinutes: -new Date().getTimezoneOffset(),
  userId: '{00000000-0000-0000-0000-000000000001}',
  userName: 'Harness User',
  userSecurityRoles: ['system-administrator'],
  setUserLanguageId: (lcid) => set({ userLanguageId: lcid }),
  setUserIsRTL: (rtl) => set({ userIsRTL: rtl }),
  setUserTimeZoneOffsetMinutes: (offset) => set({ userTimeZoneOffsetMinutes: offset }),
  setUserId: (id) => set({ userId: id }),
  setUserName: (name) => set({ userName: name }),
  setUserSecurityRoles: (roles) => set({ userSecurityRoles: roles }),

  // Performance
  renderCount: 0,
  lastRenderTimeMs: 0,
  renderTimings: [],
  webApiCallCount: 0,
  domNodeCount: 0,
  jsHeapUsedMB: 0,
  webApiCalls: [],
  heapSnapshots: [],
  incrementRenderCount: (timeMs) => set(s => ({
    renderCount: s.renderCount + 1,
    lastRenderTimeMs: timeMs,
    renderTimings: [...s.renderTimings.slice(-49), timeMs], // keep last 50
  })),
  incrementWebApiCallCount: () => set(s => ({ webApiCallCount: s.webApiCallCount + 1 })),
  addWebApiCall: (call) => set(s => ({
    webApiCalls: [
      ...s.webApiCalls.slice(-99), // keep last 100
      { ...call, id: s.webApiCallCount, timestamp: Date.now() },
    ],
    webApiCallCount: s.webApiCallCount + 1,
  })),
  updateDomNodeCount: (count) => set({ domNodeCount: count }),
  updateJsHeap: (mb) => set({ jsHeapUsedMB: mb }),
  addHeapSnapshot: (label) => {
    const perf = performance as any;
    const mb = perf.memory ? perf.memory.usedJSHeapSize / (1024 * 1024) : 0;
    if (mb > 0) {
      set(s => ({
        jsHeapUsedMB: mb,
        heapSnapshots: [
          ...s.heapSnapshots.slice(-99), // keep last 100
          { timestamp: Date.now(), heapUsedMB: mb, label },
        ],
      }));
    }
  },
  resetMetrics: () => set({
    renderCount: 0, lastRenderTimeMs: 0, renderTimings: [],
    webApiCallCount: 0, domNodeCount: 0, jsHeapUsedMB: 0,
    webApiCalls: [], heapSnapshots: [], resourceLeaks: [],
    // Note: lifecycleEvents intentionally preserved across reloads
    // so the panel shows the full init/destroy history. Use clearLifecycle() to reset.
  }),

  // Lifecycle
  lifecycleEvents: [],
  addLifecycleEvent: (event) => set(s => ({
    lifecycleEvents: [
      ...s.lifecycleEvents.slice(-199), // keep last 200
      { ...event, id: s.lifecycleEvents.length + 1, timestamp: Date.now() },
    ],
  })),
  clearLifecycle: () => set({ lifecycleEvents: [], resourceLeaks: [] }),

  // Resource leaks
  resourceLeaks: [],
  setResourceLeaks: (leaks) => set({ resourceLeaks: leaks }),

  // Log
  logEntries: [],
  addLogEntry: (entry) => set(s => ({
    logEntries: [
      ...s.logEntries.slice(-499), // keep last 500
      { ...entry, id: nextLogId++, timestamp: Date.now() },
    ],
  })),
  clearLog: () => set({ logEntries: [] }),

  // Data loading options
  rebaseDatesToToday: true,
  setRebaseDatesToToday: (enabled) => set({ rebaseDatesToToday: enabled }),
}));
