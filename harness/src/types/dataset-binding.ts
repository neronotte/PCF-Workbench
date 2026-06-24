/**
 * First-class dataset binding model — the harness equivalent of how a maker
 * configures a PCF dataset control in the form designer.
 *
 * A dataset control declared in the manifest with `<data-set>` lives inside
 * ONE of three host contexts at runtime; the binding here pins which one,
 * plus the view that drives column/sort/filter and (subgrid only) the parent
 * record that adds the FK filter.
 *
 * Per-scenario persistence: each scenario can pin a different binding for
 * the same dataset, so one scenario tests "subgrid on a Work Order with 20
 * products" and another tests "homepage Active Work Order Products view".
 */

/**
 * The three real-world host contexts a PCF dataset control can live in.
 * - subgrid    — child grid on a form (filtered by parent FK + view)
 * - homegrid   — main entity view (view only, no parent)
 * - associated — N:N grid on a form (parent + relationship + view)
 *
 * Out of scope for now (acknowledged but not modelled): quick-find views,
 * advanced-find result grids, lookup picker views.
 */
export type DatasetHostType = 'subgrid' | 'homegrid' | 'associated';

/**
 * A view selection — either by id (resolved against the harness's view
 * registry, mock or live) or by inline FetchXML (when the maker / test
 * author wants to pin an exact query without registering a view first).
 *
 * Exactly one of `viewId` / `viewFetchXml` should be set. The runtime
 * normalises to `ViewDefinition` before use.
 */
export interface ViewSelector {
  viewId?: string;
  viewFetchXml?: string;
}

/**
 * A normalised view definition the runtime consumes.
 * - `columns`     — column name + width (px or fr) + optional sort. Order
 *                   in the array IS the display order. Subset of manifest
 *                   property-set bindings; columns not in the array hide.
 * - `fetchXml`    — the FetchXML used in live mode. Ignored in mock; mock
 *                   uses `columns` + scenario filter for selection.
 * - `entityType`  — logical name of the records this view returns. Used
 *                   for live `returnedtypecode` filter and mock table lookup.
 * - `displayName` — friendly label for the view pill / picker dropdown.
 * - `viewType`    — 'system' | 'personal' (savedquery vs userquery). Mock
 *                   views are always 'system' for simplicity.
 */
export interface ViewDefinition {
  viewId: string;
  displayName: string;
  entityType: string;
  viewType: 'system' | 'personal';
  columns: ViewColumn[];
  fetchXml?: string;
  /** True for the system default view of the entity (savedquery.isdefault).
   *  Used by the view picker to render a "Default" badge UCI-style. */
  isDefault?: boolean;
}

export interface ViewColumn {
  name: string;
  /** Column width as px ('120') or fraction ('1fr'); plain number = px. */
  width?: number | string;
  /** Sort direction (asc/desc). null/undefined = unsorted. */
  sortDirection?: 'asc' | 'desc' | null;
  /** Optional display-name override; falls back to manifest property-set's displayNameKey. */
  displayName?: string;
}

/**
 * Per-dataset binding. Keyed by manifest dataSet name in the scenario.
 *
 * Subgrid case:
 *   - host = 'subgrid'
 *   - lookupColumn is the FK column on the child entity pointing at the parent
 *   - parentRecordRef is OPTIONAL — when omitted, the runtime derives the
 *     parent from the scenario's pageContext (the form record the control
 *     would be hosted on in real UCI).
 *
 * Associated case:
 *   - host = 'associated'
 *   - relationshipName is the N:N intersect table name
 *   - parentRecordRef same derivation rules as subgrid
 *
 * Homegrid case:
 *   - host = 'homegrid'
 *   - lookupColumn / parentRecordRef / relationshipName all unused
 *
 * `view` is REQUIRED — the harness always needs to know what view drives
 * the columns. Migration default for legacy scenarios is `host: 'homegrid'`
 * + a synthesised view from manifest columns (every column visible, no sort).
 */
export interface DatasetBinding {
  host: DatasetHostType;

  /** Subgrid only: FK column name on the child entity pointing at the parent. */
  lookupColumn?: string;

  /** Associated only: N:N intersect / relationship schema name. */
  relationshipName?: string;

  /** Associated only: the FK attribute on the child entity that the parent
   *  filter is applied to (e.g. `msdyn_workorder` on msdyn_workorderproduct).
   *  Captured at picker time so we don't have to re-fetch relationship
   *  metadata to inject the FetchXML filter. */
  relationshipReferencingAttribute?: string;

  /** Associated only: the child entity logical name of the picked relationship
   *  (e.g. `msdyn_workorderproduct` for a relationship from `msdyn_workorder`).
   *  Drives the views row and live fetch — in Associated mode the dataset
   *  shows rows of this entity filtered by the parent record. */
  relationshipReferencingEntity?: string;

  /** Subgrid + associated: pin a specific parent. Omit to derive from pageContext. */
  parentRecordRef?: {
    entityType: string;
    entityId: string;
    /** Optional friendly name for display. */
    recordName?: string;
  };

  /** The active view that drives columns / sort / live fetch. When ``views``
   *  is set, this MUST be one of the entries in ``views`` (matched by viewId).
   *  Kept as a top-level field for back-compat with bindings authored before
   *  the multi-view library existed. */
  view: ViewSelector | ViewDefinition;

  /** Optional view library — additional views the user can switch between.
   *  Migration default for legacy bindings is ``[view]`` so the picker always
   *  has at least one entry. */
  views?: ViewDefinition[];

  /** Per-property-set bindings: maker-style mapping from a manifest
   *  ``<property-set>`` entry to the actual field on the dataset entity it
   *  reads from. Only needed when:
   *    - the property-set uses ``of-type-group`` (the maker MUST pick a
   *      concrete type AND a backing field), OR
   *    - the dataset records don't carry a key matching the property-set
   *      name and need explicit re-mapping (e.g. real Dataverse data).
   *
   *  When absent for a property-set, the runtime falls back to the legacy
   *  behaviour: read ``row[propertySetName]`` directly and pick the first
   *  type from the type-group for ``ofType``. Authored in the Data panel's
   *  binding card; surfaced from Properties via a deep-link.
   */
  columnBindings?: Record<string, {
    /** Actual field name on the dataset row to read from. */
    field: string;
    /** Concrete type from the type-group (e.g. 'Currency', 'OptionSet').
     *  Required for ``of-type-group`` property-sets; ignored when the
     *  manifest already declares ``of-type``. */
    ofType?: string;
  }>;
}

/**
 * Per-scenario map: dataset name (from manifest) → binding.
 * Stored on TestScenario.datasetBindings.
 */
export type DatasetBindingMap = Record<string, DatasetBinding>;

/**
 * Type guard — has the binding been resolved to a concrete view definition,
 * or is it still a selector pointer (viewId / viewFetchXml) that needs to be
 * looked up against the view registry?
 */
export function isResolvedView(v: ViewSelector | ViewDefinition): v is ViewDefinition {
  return typeof (v as ViewDefinition).columns !== 'undefined'
    && typeof (v as ViewDefinition).entityType === 'string';
}

/**
 * Synthesise a default view from manifest property-set columns. Used as the
 * migration fallback for scenarios authored before bindings existed AND as
 * the bootstrap view when a control loads with no scenario applied.
 *
 * Every declared column is visible, in manifest order, unsorted, default width.
 */
export function synthesizeDefaultView(
  datasetName: string,
  entityType: string,
  columnNames: string[],
): ViewDefinition {
  return {
    viewId: `synthesized-${datasetName}`,
    displayName: 'All columns (default)',
    entityType,
    viewType: 'system',
    columns: columnNames.map(name => ({ name })),
  };
}

/**
 * Synthesise a default binding for a dataset. Migration helper for legacy
 * scenarios — homegrid host (no parent filter), all columns visible.
 */
export function synthesizeDefaultBinding(
  datasetName: string,
  entityType: string,
  columnNames: string[],
): DatasetBinding {
  const view = synthesizeDefaultView(datasetName, entityType, columnNames);
  return {
    host: 'homegrid',
    view,
    views: [view],
  };
}

/**
 * Migration helper — ensure ``binding.views`` is populated for older bindings
 * that pre-date the multi-view library. When ``view`` is a resolved view,
 * it becomes the sole entry of ``views``. Selector-only bindings (viewId
 * pointer with no resolved columns yet) are left alone — they'll resolve at
 * runtime via ``resolveViewForBinding`` and the picker can populate ``views``
 * lazily once the live fetcher (P5) hydrates them.
 */
export function ensureViewsLibrary(binding: DatasetBinding): DatasetBinding {
  if (binding.views && binding.views.length > 0) return binding;
  if (!isResolvedView(binding.view)) return binding;
  return { ...binding, views: [binding.view] };
}

/**
 * Generate a stable-ish viewId for a freshly-cloned/added view. Uses the
 * dataset name + a millisecond timestamp + a short random tail so two
 * additions in the same tick don't collide. Not cryptographically unique —
 * just unique enough for an in-memory library.
 */
export function generateViewId(datasetName: string): string {
  const tail = Math.random().toString(36).slice(2, 7);
  return `view-${datasetName}-${Date.now()}-${tail}`;
}
