import type { ManifestConfig, ManifestProperty, ManifestDataSet } from '../types/manifest';
import type { HarnessStore } from '../store/harness-store';
import { createClientShim } from './client';
import { createDeviceShim } from './device';
import { createModeShim } from './mode';
import { createNavigationShim } from './navigation';
import { createFormattingShim } from './formatting';
import { createUserSettingsShim } from './user-settings';
import { createOrgSettingsShim } from './org-settings';
import { createUtilsShim } from './utils';
import { createResourcesShim } from './resources';
import { createWebApiShim } from './web-api';
import { pushDialog, type OpenFormDialogRequest } from './dialog-bus';
import { createFluentDesignShim } from './fluent-design';
import { createCopilotShim } from './copilot';
import { createAccessibilityShim } from './accessibility';
import { createThemingShim } from './theming';
import { addEntityRecord, deleteEntityRecord, getEntityStoreKeys } from '../store/data-store';
import { getColumnDisplayName, getEntityMetadata } from '../store/metadata-store';
import { defaultDatasetState } from '../store/harness-store';
import {
  closePopupEntry,
  createPopupEntry,
  deletePopupEntry,
  getPopupsIdValue,
  openPopupEntry,
  setPopupsIdValue,
  updatePopupEntry,
} from './popup-bus';

/**
 * Build a typed parameter property based on manifest of-type.
 */
/**
 * Convert a Dataverse logical name to a human-readable display name.
 * e.g. msdyn_latitude → Latitude, starttime → Start Time, _msdyn_workorder_value → Work Order
 */
function formatDisplayName(logicalName: string): string {
  let name = logicalName;
  // Strip common prefixes
  name = name.replace(/^_/, '').replace(/_value$/, '');
  name = name.replace(/^msdyn_/, '').replace(/^cr_/, '');
  // Split on underscores and camelCase boundaries
  name = name.replace(/([a-z])([A-Z])/g, '$1 $2');
  name = name.replace(/_/g, ' ');
  // Capitalise each word
  return name.replace(/\b\w/g, c => c.toUpperCase()).trim();
}

function buildProperty(prop: ManifestProperty, rawValue: any, boundColumn?: string, entityType?: string) {
  const displayName = boundColumn
    ? (entityType ? getColumnDisplayName(entityType, boundColumn) : null) ?? formatDisplayName(boundColumn)
    : prop.displayNameKey;

  // Look up column metadata for additional attributes (Format, etc.)
  let columnType: string | undefined;
  if (boundColumn && entityType) {
    const meta = getEntityMetadata(entityType);
    columnType = meta?.columns[boundColumn]?.type;
  }

  // Detect duration fields from metadata type: Integer fields named "duration" or "*duration"
  // In Dataverse, duration fields are Integer with Format="Duration"
  const isDuration = columnType === 'Integer' && boundColumn &&
    (boundColumn === 'duration' || boundColumn.endsWith('duration'));

  // Format duration minutes as "Nd Nh Nm" (matches UCI Duration display).
  // 0 → "0 minutes", 90 → "1 hour 30 minutes", 1500 → "1 day 1 hour".
  function formatDurationMinutes(mins: number): string {
    if (!Number.isFinite(mins) || mins < 0) return String(mins);
    if (mins === 0) return '0 minutes';
    const d = Math.floor(mins / 1440);
    const h = Math.floor((mins % 1440) / 60);
    const m = mins % 60;
    const parts: string[] = [];
    if (d) parts.push(`${d} day${d === 1 ? '' : 's'}`);
    if (h) parts.push(`${h} hour${h === 1 ? '' : 's'}`);
    if (m) parts.push(`${m} minute${m === 1 ? '' : 's'}`);
    return parts.join(' ');
  }

  // Default formatted: best-effort sync stringify. Special-cased per-type below.
  let baseFormatted = '';
  if (rawValue != null) {
    if (isDuration && typeof rawValue === 'number') {
      baseFormatted = formatDurationMinutes(rawValue);
    } else if (Array.isArray(rawValue) && rawValue[0]?.name) {
      // LookupValue[] — use the lookup name
      baseFormatted = String(rawValue[0].name);
    } else if (typeof rawValue === 'object') {
      // Avoid raw "[object Object]" when something slips through as an object.
      baseFormatted = '';
    } else {
      baseFormatted = String(rawValue);
    }
  }

  const base = {
    error: false,
    errorMessage: '',
    formatted: baseFormatted,
    type: prop.ofType,
    attributes: {
      LogicalName: boundColumn || prop.name,
      DisplayName: displayName,
      Type: columnType ?? prop.ofType,
      Format: isDuration ? 'Duration' : undefined,
    },
  };

  switch (prop.ofType) {
    case 'Lookup.Simple':
      return {
        ...base,
        raw: rawValue ?? null,
        getTargetEntityType: () => rawValue?.[0]?.entityType ?? '',
        getViewId: () => '',
      };

    case 'TwoOptions':
      return { ...base, raw: rawValue ?? false };

    case 'Whole.None':
    case 'FP':
    case 'Decimal':
    case 'Currency':
      return { ...base, raw: rawValue != null ? Number(rawValue) : null };

    case 'DateAndTime.DateOnly':
    case 'DateAndTime.DateAndTime':
      return { ...base, raw: rawValue ? new Date(rawValue) : null };

    case 'OptionSet':
      return { ...base, raw: rawValue != null ? Number(rawValue) : null };

    case 'SingleLine.Text':
    case 'SingleLine.Email':
    case 'SingleLine.Phone':
    case 'SingleLine.URL':
    case 'SingleLine.TextArea':
    case 'Multiple':
    default:
      // Auto-detect lookup arrays (from test scenarios or of-type-group fields)
      if (Array.isArray(rawValue) && rawValue.length > 0 && rawValue[0]?.id) {
        return {
          ...base,
          raw: rawValue,
          formatted: rawValue[0].name ?? String(rawValue[0].id),
          getTargetEntityType: () => rawValue[0].entityType ?? '',
          getViewId: () => '',
        };
      }
      return { ...base, raw: rawValue ?? null, formatted: rawValue != null ? String(rawValue) : '' };
  }
}

/**
 * Build a dataset shim that mimics ComponentFramework.PropertyTypes.DataSet.
 * Reads records from the entity data store using the dataset name as the entity type.
 */
function buildDataSet(
  ds: ManifestDataSet,
  getEntityData: (entityType: string) => Record<string, any>[],
  getState: () => HarnessStore,
) {
  const refreshCallbacks: Array<() => void> = [];

  function getRecords() {
    // Try dataset name first (e.g. "bookingRecords")
    let rawData = getEntityData(ds.name);
    let resolvedEntity = ds.name;
    if (rawData.length === 0) {
      // Fallback: try pageEntityTypeName from store
      const pageEntity = getState().pageEntityTypeName;
      if (pageEntity) {
        rawData = getEntityData(pageEntity);
        if (rawData.length > 0) resolvedEntity = pageEntity;
      }
    }
    if (rawData.length === 0) {
      // Fallback: use the first entity in the data store that has array records
      // This handles data.json keyed by entity logical name (e.g. "bookableresourcebooking")
      // when the dataset name is different (e.g. "bookingRecords")
      for (const key of getEntityStoreKeys()) {
        const data = getEntityData(key);
        if (data.length > 0) { rawData = data; resolvedEntity = key; break; }
      }
    }

    // Apply sorting from current dataset state
    const dsState = getState().datasetState[ds.name] ?? defaultDatasetState();
    let working = [...rawData];
    if (dsState.sorting.length > 0) {
      working.sort((a, b) => {
        for (const sort of dsState.sorting) {
          const av = a[sort.name];
          const bv = b[sort.name];
          if (av === bv) continue;
          if (av == null) return 1;
          if (bv == null) return -1;
          const cmp = av < bv ? -1 : 1;
          return sort.sortDirection === 1 ? -cmp : cmp;
        }
        return 0;
      });
    }
    const totalAfterFilter = working.length;
    // Slice to current page (cumulative pages)
    const limit = dsState.pageNumber * dsState.pageSize;
    working = working.slice(0, limit);

    const records: Record<string, any> = {};
    const sortedIds: string[] = [];

    for (const row of working) {
      // Find the ID field
      const idField = Object.keys(row).find(k => k.toLowerCase().endsWith('id') || k === 'id');
      const id = idField ? String(row[idField]) : String(Math.random());
      sortedIds.push(id);
      records[id] = {
        getRecordId: () => id,
        getValue: (field: string) => {
          let val = row[field];
          let actualKey = field;
          // Fallback: if field not found, try OData lookup format (_field_value, _field)
          if (val === undefined) {
            for (const candidate of [`_${field}_value`, `_${field}id`, `_${field}`]) {
              if (row[candidate] !== undefined) { val = row[candidate]; actualKey = candidate; break; }
            }
          }
          if (val == null) return null;
          // If the raw value looks like a GUID, return as a lookup object
          // Check for annotation on both the original field and the resolved key
          if (typeof val === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)) {
            const annotation = row[`${field}@OData.Community.Display.V1.FormattedValue`]
              ?? row[`${actualKey}@OData.Community.Display.V1.FormattedValue`];
            return { id: { guid: val }, name: annotation != null ? String(annotation) : '', entityType: field };
          }
          return val;
        },
        getFormattedValue: (field: string) => {
          // Check for OData formatted value annotation — try direct field and OData fallback keys
          const annotation = row[`${field}@OData.Community.Display.V1.FormattedValue`]
            ?? row[`_${field}_value@OData.Community.Display.V1.FormattedValue`]
            ?? row[`_${field}@OData.Community.Display.V1.FormattedValue`];
          if (annotation != null) return String(annotation);
          // Fallback: try direct field, then OData lookup format
          const val = row[field] ?? row[`_${field}_value`] ?? row[`_${field}`];
          return val != null ? String(val) : '';
        },
        getNamedReference: () => ({ id: { guid: id }, name: '', etn: ds.name }),
      };
    }
    return { records, sortedIds, totalAfterFilter, resolvedEntity };
  }

  const { records, sortedIds, totalAfterFilter, resolvedEntity } = getRecords();
  const dsState = getState().datasetState[ds.name] ?? defaultDatasetState();
  // Mutable sorting array — controls may push/splice into it; refresh() captures back into store.
  const liveSorting: any[] = dsState.sorting.map(s => ({ ...s }));
  let liveFilter: any = dsState.filtering;
  const totalResultCount = totalAfterFilter;
  const limit = dsState.pageNumber * dsState.pageSize;
  const hasNextPage = limit < totalResultCount;
  const hasPreviousPage = dsState.pageNumber > 1;

  return {
    loading: false,
    error: false,
    errorMessage: '',
    paging: {
      totalResultCount,
      pageSize: dsState.pageSize,
      hasNextPage,
      hasPreviousPage,
      loadNextPage: () => {
        getState().addLogEntry({ category: 'data', method: 'paging.loadNextPage', args: { dataSet: ds.name }, coverage: 'implemented' });
        getState().setDatasetPage(ds.name, dsState.pageNumber + 1, dsState.pageSize);
      },
      loadPreviousPage: () => {
        getState().addLogEntry({ category: 'data', method: 'paging.loadPreviousPage', args: { dataSet: ds.name }, coverage: 'implemented' });
        getState().setDatasetPage(ds.name, Math.max(1, dsState.pageNumber - 1), dsState.pageSize);
      },
      setPageSize: (size: number) => {
        getState().addLogEntry({ category: 'data', method: 'paging.setPageSize', args: { dataSet: ds.name, size }, coverage: 'implemented' });
        getState().setDatasetPage(ds.name, 1, size);
      },
      firstPageNumber: 1,
      lastPageNumber: Math.max(1, Math.ceil(totalResultCount / dsState.pageSize)),
      reset: () => {
        getState().addLogEntry({ category: 'data', method: 'paging.reset', args: { dataSet: ds.name }, coverage: 'implemented' });
        getState().setDatasetPage(ds.name, 1, dsState.pageSize);
      },
    },
    sorting: liveSorting,
    filtering: {
      getFilter: () => liveFilter,
      setFilter: (f: any) => {
        liveFilter = f;
        getState().setDatasetFiltering(ds.name, f);
      },
    },
    linking: {
      getLinkedEntities: () => {
        // Build linked entity list from all entity types in the data store.
        // In real Dynamics, these come from the view definition's linked entities.
        const knownEntities: Array<{name: string; alias: string}> = [];
        for (const name of getEntityStoreKeys()) {
          const data = getEntityData(name);
          if (data.length > 0) {
            knownEntities.push({ name, alias: name });
          }
        }
        return knownEntities;
      },
      addLinkedEntity: () => {},
    },
    records,
    sortedRecordIds: sortedIds,
    columns: Object.keys(sortedIds.length > 0 ? getEntityData(resolvedEntity)[0] ?? {} : {}).map(name => ({
      name,
      displayName: name,
      dataType: 'string',
      alias: name,
      order: -1,
      visualSizeFactor: 1,
      isHidden: false,
      isPrimary: name.toLowerCase().endsWith('id'),
      disableSorting: false,
    })),
    refresh: () => {
      // Capture any control-side mutations to sorting back into store, then trigger updateView.
      getState().setDatasetSorting(ds.name, liveSorting.map(s => ({ name: s.name, sortDirection: s.sortDirection })));
      getState().addLogEntry({ category: 'data', method: 'dataset.refresh', args: { dataSet: ds.name }, coverage: 'implemented' });
      for (const cb of refreshCallbacks) cb();
    },
    openDatasetItem: (ref: any) => {
      // Wire to the same dialog-bus channel as navigation.openForm so a row
      // click actually opens the record in a modal. ref is an EntityReference
      // ({ etn, id, name }) — translate to the openForm options shape.
      getState().addLogEntry({ category: 'navigation', method: 'openDatasetItem', args: ref, coverage: 'implemented' });
      const entityName = ref?.etn ?? ref?.entityType ?? ref?.LogicalName ?? resolvedEntity;
      const entityId = ref?.id ?? ref?.Id ?? ref?.entityId;
      return new Promise(resolve => {
        pushDialog<OpenFormDialogRequest>({
          kind: 'openForm',
          options: { entityName, entityId, openInNewWindow: false },
          parameters: undefined,
          resolve: () => resolve(undefined as any),
        });
      });
    },
    getTitle: () => ds.displayNameKey,
    getViewId: () => '',
    getTargetEntityType: () => resolvedEntity,
    addOnDatasetItemOpened: () => {},
    removeOnDatasetItemOpened: () => {},
    addColumn: () => {},
    delete: () => {
      const ids = getState().datasetState[ds.name]?.selectedIds ?? [];
      getState().addLogEntry({ category: 'data', method: 'dataset.delete', args: { dataSet: ds.name, ids }, coverage: 'implemented' });
      let removed = 0;
      for (const id of ids) {
        if (deleteEntityRecord(resolvedEntity, id)) removed++;
      }
      if (removed > 0) {
        getState().setDatasetSelectedIds(ds.name, []);
        getState().bumpDataVersion();
      }
      return Promise.resolve(ids);
    },
    newRecord: () => {
      const created = addEntityRecord(resolvedEntity, {});
      getState().addLogEntry({ category: 'data', method: 'dataset.newRecord', args: { dataSet: ds.name, record: created }, coverage: 'implemented' });
      getState().bumpDataVersion();
      return Promise.resolve(created);
    },
    save: () => {
      // In mock mode, every dataset mutation (newRecord / delete / column
      // setValue) is persisted to the in-memory data-store synchronously, so
      // there is nothing dirty to flush here. Real Dataverse persistence is
      // M2 (Live Dataverse Bridge) territory. Tagged 'implemented' because
      // the mock-mode contract — "save returns resolved when state is on
      // disk" — is already satisfied at every mutation point.
      getState().addLogEntry({ category: 'data', method: 'dataset.save', args: { dataSet: ds.name }, coverage: 'implemented' });
      return Promise.resolve();
    },
    getSelectedRecordIds: () => getState().datasetState[ds.name]?.selectedIds ?? [],
    setSelectedRecordIds: (ids: string[]) => {
      getState().setDatasetSelectedIds(ds.name, ids);
    },
    clearSelectedRecordIds: () => {
      getState().setDatasetSelectedIds(ds.name, []);
    },
  };
}

/**
 * Build the parameters object from manifest + current property values.
 */
/**
 * Resolve $columnName field bindings from entity data.
 * Returns the resolved value, or the original if not a binding.
 */
function resolveFieldBinding(
  rawValue: any,
  getEntityData: (entityType: string) => Record<string, any>[],
  getState: () => HarnessStore,
): any {
  if (typeof rawValue !== 'string' || !rawValue.startsWith('$')) return rawValue;

  const columnName = rawValue.substring(1);
  const state = getState();
  const entityType = state.pageEntityTypeName;
  const entityId = state.pageEntityId;
  if (!entityType || !entityId) return null;

  const records = getEntityData(entityType);
  const normalId = entityId.replace(/[{}]/g, '').toLowerCase();
  const record = records.find(r => {
    for (const key of Object.keys(r)) {
      if ((key.toLowerCase().endsWith('id') || key === 'id') &&
          String(r[key]).replace(/[{}]/g, '').toLowerCase() === normalId) {
        return true;
      }
    }
    return false;
  });
  if (!record) return null;

  // Check for OData lookup format
  const lookupVal = record[`_${columnName}_value`];
  const formatted = record[`_${columnName}_value@OData.Community.Display.V1.FormattedValue`]
    ?? record[`${columnName}@OData.Community.Display.V1.FormattedValue`];
  if (lookupVal && formatted) {
    return [{ id: lookupVal, name: formatted, entityType: columnName }];
  }
  return record[columnName] ?? null;
}

function buildParameters(
  manifest: ManifestConfig,
  propertyValues: Record<string, any>,
  getEntityData: (entityType: string) => Record<string, any>[],
  getState: () => HarnessStore,
) {
  const params: Record<string, any> = {};
  const selectedTypes = getState().propertyTypes;
  for (const prop of manifest.properties) {
    const rawVal = propertyValues[prop.name];
    const boundColumn = typeof rawVal === 'string' && rawVal.startsWith('$') ? rawVal.substring(1) : undefined;
    const resolved = resolveFieldBinding(rawVal, getEntityData, getState);
    // For of-type-group properties, use the maker's selected type instead of the generic "Property"
    const effectiveProp = prop.ofTypeGroup && selectedTypes[prop.name]
      ? { ...prop, ofType: selectedTypes[prop.name] }
      : prop;
    params[prop.name] = buildProperty(effectiveProp, resolved, boundColumn, getState().pageEntityTypeName);
  }
  for (const ds of manifest.dataSets) {
    params[ds.name] = buildDataSet(ds, getEntityData, getState);
  }
  return params;
}

export interface CreateContextHooks {
  /** Called when the control invokes context.factory.requestRender(). */
  requestRender?: () => void;
}

/**
 * Build a Proxy for context.events so any manifest-declared event the control
 * invokes (e.g. context.events.OnSelected(payload)) is logged to the harness
 * console with its arguments. Returns a real function for any accessed key.
 */
function createEventsProxy(getState: () => HarnessStore): Record<string, (...args: any[]) => void> {
  const handlers: Record<string, (...args: any[]) => void> = {};
  return new Proxy(handlers, {
    get(target, prop: string | symbol) {
      if (typeof prop !== 'string') return (target as any)[prop];
      if (!target[prop]) {
        target[prop] = (...args: any[]) => {
          getState().addLogEntry({
            category: 'events',
            method: prop,
            args: args.length === 1 ? args[0] : args,
            coverage: 'stub',
          });
        };
      }
      return target[prop];
    },
    has() {
      // Make `'OnSelected' in context.events` always return true so feature-detection works.
      return true;
    },
  });
}

/**
 * Create a full ComponentFramework.Context object.
 */
export function createContext(
  manifest: ManifestConfig,
  getState: () => HarnessStore,
  getEntityData: (entityType: string) => Record<string, any>[],
  hooks: CreateContextHooks = {},
) {
  const state = getState();
  const events = createEventsProxy(getState);

  return {
    parameters: buildParameters(manifest, state.propertyValues, getEntityData, getState),
    client: createClientShim(getState),
    device: createDeviceShim(getState),
    factory: {
      getPopupService: () => ({
        createPopup: (popup: any) => {
          getState().addLogEntry({ category: 'factory', method: 'popup.create', args: { name: popup?.name }, coverage: 'implemented' });
          if (popup?.name) createPopupEntry(popup);
        },
        deletePopup: (name: string) => {
          getState().addLogEntry({ category: 'factory', method: 'popup.delete', args: { name }, coverage: 'implemented' });
          deletePopupEntry(name);
        },
        openPopup: (name: string) => {
          getState().addLogEntry({ category: 'factory', method: 'popup.open', args: { name }, coverage: 'implemented' });
          openPopupEntry(name);
        },
        closePopup: (name: string) => {
          getState().addLogEntry({ category: 'factory', method: 'popup.close', args: { name }, coverage: 'implemented' });
          closePopupEntry(name);
        },
        updatePopup: (popup: any) => {
          getState().addLogEntry({ category: 'factory', method: 'popup.update', args: { name: popup?.name }, coverage: 'implemented' });
          if (popup?.name) updatePopupEntry(popup);
        },
        setPopupsId: (id: string) => {
          getState().addLogEntry({ category: 'factory', method: 'popup.setPopupsId', args: { id }, coverage: 'implemented' });
          setPopupsIdValue(id);
        },
        getPopupsId: () => getPopupsIdValue(),
      }),
      requestRender: () => {
        getState().addLogEntry({ category: 'factory', method: 'requestRender', coverage: 'implemented' });
        hooks.requestRender?.();
      },
      fireEvent: (name: string, payload?: any) => {
        getState().addLogEntry({ category: 'factory', method: 'fireEvent', args: { name, payload }, coverage: 'implemented' });
        // Dispatch through the events Proxy so any registered listener fires.
        // The Proxy auto-creates a logging handler for any unknown event name.
        if (typeof (events as any)[name] === 'function') {
          (events as any)[name](payload);
        }
      },
    },
    formatting: createFormattingShim(),
    mode: createModeShim(getState),
    navigation: createNavigationShim(getState),
    resources: createResourcesShim(getState),
    userSettings: createUserSettingsShim(getState),
    orgSettings: createOrgSettingsShim(getState),
    utils: createUtilsShim(getState),
    webAPI: createWebApiShim(getState, getEntityData),
    updatedProperties: ['all'],
    events,
    fluentDesignLanguage: createFluentDesignShim(getState),
    copilot: createCopilotShim(getState),
    accessibility: createAccessibilityShim(getState),
    theming: createThemingShim(getState),

    // Non-standard context extensions used by some controls (e.g. InspectionControl)
    page: {
      get entityId() { return getState().pageEntityId; },
      get entityTypeName() { return getState().pageEntityTypeName; },
      get entityRecordName() { return getState().pageEntityRecordName; },
      appId: '',
      isPageReadOnly: false,
      getClientUrl(): string {
        return typeof window !== 'undefined' ? window.location.origin : '';
      },
    },
  };
}

/**
 * Rebuild just the parameters portion of the context (for updateView calls).
 */
export function rebuildParameters(
  context: any,
  manifest: ManifestConfig,
  propertyValues: Record<string, any>,
  updatedProperties?: string[],
  getEntityData?: (entityType: string) => Record<string, any>[],
  getState?: () => HarnessStore,
): void {
  // Rebuild scalar properties, resolving $columnName bindings
  for (const prop of manifest.properties) {
    const rawVal = propertyValues[prop.name];
    const boundColumn = typeof rawVal === 'string' && rawVal.startsWith('$') ? rawVal.substring(1) : undefined;
    const resolved = (getEntityData && getState)
      ? resolveFieldBinding(rawVal, getEntityData, getState)
      : rawVal;
    context.parameters[prop.name] = buildProperty(prop, resolved, boundColumn, getState?.().pageEntityTypeName);
  }
  // Rebuild datasets if data functions provided
  if (getEntityData && getState) {
    for (const ds of manifest.dataSets) {
      context.parameters[ds.name] = buildDataSet(ds, getEntityData, getState);
    }
  }
  context.updatedProperties = updatedProperties ?? ['all'];
}
