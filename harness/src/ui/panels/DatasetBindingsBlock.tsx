import { useState, useMemo, useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import {
  makeStyles, mergeClasses, tokens, Button, Badge,
  Radio, RadioGroup, Dropdown, Option, OptionGroup, Combobox, Input, Label, Switch,
  Tooltip, Spinner,
} from '@fluentui/react-components';
import {
  Add16Regular, Delete16Regular, ReOrderDotsVertical16Regular,
  Edit16Regular, ChevronDown16Regular, ChevronRight16Regular,
  Globe16Regular, ArrowClockwise16Regular,
} from '@fluentui/react-icons';
import { useHarnessStore } from '../../store/harness-store';
import { getEntityData, getEntityStoreKeys, subscribeData } from '../../store/data-store';
import { getEntityMetadata } from '../../store/metadata-store';
import { liveListViews, liveListRelationships, type LiveRelationship, DvProxyError, __clearLiveViewsCache } from '../../api/dv-client';
import { SearchPicker, type SearchPickerItem } from '../common/SearchPicker';
import type { ManifestDataSet, ManifestProperty } from '../../types/manifest';
import type {
  DatasetBinding, DatasetHostType, ViewDefinition, ViewColumn,
} from '../../types/dataset-binding';
import {
  isResolvedView, synthesizeDefaultView, ensureViewsLibrary, generateViewId,
} from '../../types/dataset-binding';
import { lookupResxString } from '../../shim/resources';
import { deriveColumnBindings } from '../../lib/auto-column-bindings';

const useStyles = makeStyles({
  block: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  header: {
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    padding: '12px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
  },
  cardTitle: {
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  hint: {
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground3,
  },
  row: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  inlineRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  columnEditor: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  columnHeaderRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    paddingLeft: '24px',  // align with grip column
  },
  columnRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    borderRadius: tokens.borderRadiusSmall,
    padding: '2px 0',
  },
  colName: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  colWidth: {
    width: '56px',
    flex: '0 0 56px',
  },
  colSort: {
    width: '56px',
    flex: '0 0 56px',
  },
  colHeaderName: { flex: 1 },
  colHeaderWidth: { width: '56px', flex: '0 0 56px' },
  colHeaderSort: { width: '56px', flex: '0 0 56px' },
  colHeaderDel: { width: '24px', flex: '0 0 24px' },
  dragGrip: {
    cursor: 'grab',
    color: tokens.colorNeutralForeground3,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '24px',
    flex: '0 0 20px',
    borderRadius: tokens.borderRadiusSmall,
    ':hover': { color: tokens.colorNeutralForeground1, backgroundColor: tokens.colorNeutralBackground3 },
    ':active': { cursor: 'grabbing' },
  },
  dragOverTop: {
    boxShadow: `inset 0 2px 0 0 ${tokens.colorBrandStroke1}`,
  },
  dragOverBottom: {
    boxShadow: `inset 0 -2px 0 0 ${tokens.colorBrandStroke1}`,
  },
  dragging: {
    opacity: 0.4,
  },
  sortBtn: {
    minWidth: '48px',
    paddingLeft: '4px',
    paddingRight: '4px',
    fontSize: tokens.fontSizeBase100,
    fontWeight: tokens.fontWeightSemibold,
  },
  columnHeader: {
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  psBindings: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '8px',
    border: `1px dashed ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusSmall,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  psHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    cursor: 'pointer',
    userSelect: 'none',
  },
  psRow: {
    display: 'grid',
    // 2-col grid: property-set name (with inferred type suffix) + bound-field
    // picker. The third "type" column was dropped because it's purely derived
    // — for hard-coded property-sets the manifest dictates the type, and for
    // of-type-group property-sets the type follows the bound field's metadata.
    // Letting the maker pick a type that doesn't match the field was a footgun.
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)',
    alignItems: 'center',
    gap: '6px',
    '& > *': { minWidth: 0 },
    '& .fui-Combobox, & .fui-Dropdown, & .fui-Input': { width: '100%', minWidth: 0 },
  },
  psName: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground1,
    fontWeight: tokens.fontWeightSemibold,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  psType: {
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground3,
    fontWeight: tokens.fontWeightRegular,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

/**
 * Friendly display label for PCF `of-type` strings. The manifest uses
 * cryptic short names (FP, SingleLine.Text, DateAndTime.DateOnly…); the
 * editor surfaces them with maker-readable names so the type picker is
 * actually scannable. Underlying `ofType` strings are unchanged — this is
 * a UI-only mapping.
 */
function friendlyOfType(t: string | undefined): string {
  if (!t) return '';
  const map: Record<string, string> = {
    'FP': 'Float',
    'Decimal': 'Decimal',
    'Whole.None': 'Whole number',
    'Currency': 'Currency',
    'SingleLine.Text': 'Text',
    'SingleLine.Email': 'Email',
    'SingleLine.Phone': 'Phone',
    'SingleLine.URL': 'URL',
    'SingleLine.TextArea': 'Text area',
    'SingleLine.Ticker': 'Ticker',
    'Multiple': 'Multi-line text',
    'OptionSet': 'Choice',
    'MultiSelectOptionSet': 'Choices',
    'TwoOptions': 'Yes/No',
    'DateAndTime.DateOnly': 'Date',
    'DateAndTime.DateAndTime': 'Date & time',
    'Lookup.Simple': 'Lookup',
    'Lookup.Customer': 'Customer lookup',
    'Lookup.Owner': 'Owner lookup',
    'Lookup.PartyList': 'Party list',
    'Lookup.Regarding': 'Regarding lookup',
    'Image': 'Image',
    'File': 'File',
    'Object': 'Object',
  };
  return map[t] ?? t;
}

/**
 * Map a metadata column type (Dataverse-style, e.g. "String", "Money",
 * "Picklist") to the PCF `of-type` string the runtime expects (e.g.
 * "SingleLine.Text", "Currency", "OptionSet"). Used to infer the concrete
 * type for `of-type-group` property-set bindings from the bound field's
 * metadata so the maker doesn't have to (and can't) pick a mismatched type.
 *
 * Returns `undefined` when the metadata type is unknown — caller should fall
 * back to the group's first declared type.
 */
function inferOfTypeFromMetadata(metaType: string | undefined): string | undefined {
  if (!metaType) return undefined;
  const map: Record<string, string> = {
    'String':                'SingleLine.Text',
    'Memo':                  'Multiple',
    'Integer':               'Whole.None',
    'BigInt':                'Whole.None',
    'Double':                'FP',
    'Decimal':               'Decimal',
    'Money':                 'Currency',
    'Picklist':              'OptionSet',
    'State':                 'OptionSet',
    'Status':                'OptionSet',
    'MultiSelectPicklist':   'MultiSelectOptionSet',
    'Boolean':               'TwoOptions',
    'TwoOptions':            'TwoOptions',
    'DateTime':              'DateAndTime.DateAndTime',
    'DateOnly':              'DateAndTime.DateOnly',
    'Lookup':                'Lookup.Simple',
    'Customer':              'Lookup.Customer',
    'Owner':                 'Lookup.Owner',
    'Uniqueidentifier':      'SingleLine.Text',
  };
  return map[metaType];
}

/**
 * Friendly label for a manifest column: RESX-resolved displayNameKey when
 * available, falling back to the column's logical name. Mirrors what
 * buildDatasetColumns does for the runtime shim, so the editor shows the
 * same labels the maker will see in the control.
 */
function manifestColumnLabel(col: ManifestProperty, lcid: number): string {
  if (col.displayNameKey) {
    const resolved = lookupResxString(col.displayNameKey, lcid);
    if (resolved && resolved !== col.displayNameKey) return resolved;
  }
  return col.name;
}

/**
 * Lookup-type column names from a dataset's manifest property-set. Used to
 * populate the subgrid lookupColumn dropdown — the typical case is the FK
 * pointing back at the parent record (e.g. `msdyn_workorder` on a
 * Work Order Product subgrid).
 */
function lookupCandidates(ds: ManifestDataSet, typeGroups: Record<string, string[]>): string[] {
  return ds.columns
    .filter(c => {
      if (c.ofType?.startsWith('Lookup.')) return true;
      if (c.ofTypeGroup) {
        const types = typeGroups[c.ofTypeGroup] ?? [];
        return types.some(t => t.startsWith('Lookup.'));
      }
      return false;
    })
    .map(c => c.name);
}

/**
 * Per-dataset binding card. Authored UX intentionally mirrors UCI:
 *   - Host radio (subgrid / homegrid / associated)
 *   - View dropdown (single "Default view" for now; M2 wires named views)
 *   - Edit columns disclosure (visibility + reorder + sort + display override)
 *   - Subgrid: lookupColumn dropdown + Use page record / explicit parent toggle
 */
function DatasetBindingCard({ ds }: { ds: ManifestDataSet }) {
  const styles = useStyles();
  const lcid = useHarnessStore(s => s.userLanguageId);
  const typeGroups = useHarnessStore(s => s.manifest?.typeGroups ?? {});
  const pageEntityId = useHarnessStore(s => s.pageEntityId);
  const pageEntityTypeName = useHarnessStore(s => s.pageEntityTypeName);
  const dataSource = useHarnessStore(s => s.dataSource);
  const binding = useHarnessStore(s => s.datasetBindings[ds.name]);
  const setDatasetBinding = useHarnessStore(s => s.setDatasetBinding);

  const [editingColumns, setEditingColumns] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // Cross-panel deep-link from form-chrome edit affordances. When the focus
  // event names THIS dataset and asks for autoEdit, open the column editor
  // so the user lands on the configured surface in one click.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<FocusBindingDetail>).detail;
      if (detail?.datasetName !== ds.name) return;
      if (detail.autoEdit) setEditingColumns(true);
    };
    window.addEventListener(FOCUS_BINDING_EVENT, handler);
    return () => window.removeEventListener(FOCUS_BINDING_EVENT, handler);
  }, [ds.name]);

  // Effective binding — fall back to a synthesised homegrid + all-columns
  // default so the UI never has to deal with `undefined`. P0's apply path
  // also synthesises this, but the harness can render before the first
  // scenario apply (gallery mode, fresh control), so we guard here too.
  // `ensureViewsLibrary` upgrades legacy bindings (pre multi-view) so the
  // picker always has at least one entry.
  const effective: DatasetBinding = ensureViewsLibrary(binding ?? {
    host: 'homegrid',
    view: synthesizeDefaultView(ds.name, ds.name, ds.columns.map(c => c.name)),
  });

  const resolvedView: ViewDefinition = isResolvedView(effective.view)
    ? effective.view
    : synthesizeDefaultView(ds.name, ds.name, ds.columns.map(c => c.name));

  // View library — always non-empty after ensureViewsLibrary. Selector-only
  // bindings (no resolved view yet) fall back to a single-entry list with
  // the resolved fallback so the dropdown still renders something selectable.
  const viewLibrary: ViewDefinition[] = effective.views && effective.views.length > 0
    ? effective.views
    : [resolvedView];

  const candidateLookups = useMemo(() => lookupCandidates(ds, typeGroups), [ds, typeGroups]);

  const update = useCallback((next: Partial<DatasetBinding>) => {
    setDatasetBinding(ds.name, { ...effective, ...next });
  }, [setDatasetBinding, ds.name, effective]);

  const updateView = useCallback((nextView: Partial<ViewDefinition>) => {
    const merged: ViewDefinition = { ...resolvedView, ...nextView };
    // Keep `views` in sync: if the active view is in the library, update its
    // entry; otherwise append (covers the migration case where library was
    // bootstrapped from a different reference). Match by viewId.
    const libSource = effective.views && effective.views.length > 0
      ? effective.views
      : [resolvedView];
    const idx = libSource.findIndex(v => v.viewId === merged.viewId);
    const nextViews = idx >= 0
      ? libSource.map((v, i) => i === idx ? merged : v)
      : [...libSource, merged];
    setDatasetBinding(ds.name, {
      ...effective,
      view: merged,
      views: nextViews,
    });
  }, [setDatasetBinding, ds.name, effective, resolvedView]);

  const selectView = useCallback((viewId: string) => {
    const next = viewLibrary.find(v => v.viewId === viewId);
    if (!next) return;
    setDatasetBinding(ds.name, { ...effective, view: next });
  }, [setDatasetBinding, ds.name, effective, viewLibrary]);

  const addView = useCallback(() => {
    const n = viewLibrary.length + 1;
    const cloned: ViewDefinition = {
      ...resolvedView,
      viewId: generateViewId(ds.name),
      displayName: `View ${n}`,
      // Clone column array so edits don't leak into the source view.
      columns: resolvedView.columns.map(c => ({ ...c })),
    };
    setDatasetBinding(ds.name, {
      ...effective,
      view: cloned,
      views: [...viewLibrary, cloned],
    });
    // Auto-open the column editor so the user can immediately customise.
    setEditingColumns(true);
  }, [viewLibrary, resolvedView, setDatasetBinding, ds.name, effective]);

  const deleteView = useCallback(() => {
    if (viewLibrary.length <= 1) return; // never strand the binding without a view
    const remaining = viewLibrary.filter(v => v.viewId !== resolvedView.viewId);
    const nextActive = remaining[0];
    setDatasetBinding(ds.name, {
      ...effective,
      view: nextActive,
      views: remaining,
    });
  }, [viewLibrary, resolvedView, setDatasetBinding, ds.name, effective]);

  const renameView = useCallback((displayName: string) => {
    updateView({ displayName });
  }, [updateView]);

  const onHostChange = useCallback((host: DatasetHostType) => {
    const next: DatasetBinding = { ...effective, host };
    // Clear host-specific fields when switching away so a stale FK doesn't
    // silently filter on a homegrid.
    if (host !== 'subgrid') { next.lookupColumn = undefined; }
    if (host !== 'associated') {
      next.relationshipName = undefined;
      next.relationshipReferencingAttribute = undefined;
    }
    if (host === 'homegrid') { next.parentRecordRef = undefined; }
    setDatasetBinding(ds.name, next);
  }, [effective, setDatasetBinding, ds.name]);

  // Effective parent for subgrid display.
  const usingPageRecord = !effective.parentRecordRef;
  const effectiveParentId = effective.parentRecordRef?.entityId ?? pageEntityId;

  // Visible column set + ordering. The view's columns array IS the
  // ordering — hidden columns are stripped (they'd just be re-added on
  // toggle). For unticked columns, we still need them in the dropdown,
  // which is why we union with manifest columns.
  const viewColumnNames = new Set(resolvedView.columns.map(c => c.name));
  const hiddenManifestColumns = ds.columns.filter(c => !viewColumnNames.has(c.name));

  const toggleColumn = useCallback((name: string, visible: boolean) => {
    if (visible) {
      const manifestCol = ds.columns.find(c => c.name === name);
      if (!manifestCol) return;
      const nextCols = [...resolvedView.columns, { name }];
      updateView({ columns: nextCols });
    } else {
      updateView({ columns: resolvedView.columns.filter(c => c.name !== name) });
    }
  }, [ds.columns, resolvedView.columns, updateView]);

  const moveColumnTo = useCallback((fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0) return;
    if (fromIdx >= resolvedView.columns.length || toIdx > resolvedView.columns.length) return;
    const next = [...resolvedView.columns];
    const [moved] = next.splice(fromIdx, 1);
    // Adjust insertion index: removing from earlier position shifts indices.
    const insertAt = fromIdx < toIdx ? toIdx - 1 : toIdx;
    next.splice(insertAt, 0, moved);
    updateView({ columns: next });
  }, [resolvedView.columns, updateView]);

  const setColumnSort = useCallback((name: string, dir: 'asc' | 'desc' | null) => {
    const next = resolvedView.columns.map(c =>
      c.name === name ? { ...c, sortDirection: dir } : { ...c, sortDirection: null });
    updateView({ columns: next });
  }, [resolvedView.columns, updateView]);

  const setColumnWidth = useCallback((name: string, raw: string) => {
    const n = parseInt(raw, 10);
    const width = Number.isFinite(n) && n > 0 ? n : undefined;
    const next = resolvedView.columns.map(c =>
      c.name === name ? { ...c, width } : c);
    updateView({ columns: next });
  }, [resolvedView.columns, updateView]);

  const resetView = useCallback(() => {
    // Preserve viewId + displayName so the library entry is updated in place
    // (updateView matches by viewId). Only columns are reset to "all visible,
    // unsorted, default widths" — the user explicitly asked for "Reset columns".
    updateView({
      columns: ds.columns.map(c => ({ name: c.name })),
    });
  }, [ds.columns, updateView]);

  // --- Property-set bindings (maker-style field re-map) -----------------------
  // A property-set in the manifest is a slot the maker binds to a real column on
  // the dataset entity. For `<property-set of-type-group="...">` the maker also
  // picks a concrete type. The harness defaults: read `row[propertySetName]`
  // and pick the first type from the group — fine for synthetic data shaped
  // around the manifest, but real Dataverse rows have native column names that
  // don't match the property-set name, and of-type-group columns have no way
  // to pick a non-default type. This editor surfaces both.
  const [psOpen, setPsOpen] = useState(false);
  const dataVersion = useSyncExternalStore(subscribeData, () => useHarnessStore.getState().dataVersion);

  // Effective entity name the runtime reads from when building this dataset.
  // Mirrors the resolution chain in context-factory.buildDataSet:
  //   Homegrid     → view.entityType (if pinned) → ds.name → page entity
  //   Subgrid      → derived from lookupColumn / parent
  //   Associated   → derived from relationship (P6+)
  // Exposed read-only on the binding card as a "Data comes from" hint so the
  // maker can see exactly where the field-candidates list is sourced and fix
  // page context (the most common cause of empty lists) without guesswork.
  const resolvedDataEntity = useMemo(() => {
    const viewEntity = isResolvedView(effective.view) ? effective.view.entityType : '';
    const tries = [viewEntity, ds.name, pageEntityTypeName].filter(Boolean) as string[];
    for (const e of tries) if (getEntityData(e).length > 0) return e;
    for (const k of getEntityStoreKeys()) if (getEntityData(k).length > 0) return k;
    return viewEntity || ds.name || pageEntityTypeName || '';
  }, [effective.view, ds.name, pageEntityTypeName, dataVersion]);

  const fieldCandidates = useMemo(() => {
    // Source: union of column names across all rows of the resolved entity.
    // Strip OData annotation suffixes so the picker shows clean field names only.
    const seen = new Set<string>();
    if (resolvedDataEntity) {
      for (const r of getEntityData(resolvedDataEntity)) {
        for (const k of Object.keys(r)) {
          if (k.includes('@')) continue; // skip OData annotations (@OData.Community...)
          seen.add(k);
        }
      }
    }
    return Array.from(seen).sort();
  }, [resolvedDataEntity, dataVersion]);

  const setColumnBinding = useCallback((psName: string, next: { field?: string; ofType?: string } | null) => {
    const current = { ...(effective.columnBindings ?? {}) };
    if (!next || (!next.field && !next.ofType)) {
      delete current[psName];
    } else {
      const prev = current[psName] ?? { field: '' };
      current[psName] = {
        field: next.field ?? prev.field ?? '',
        ofType: next.ofType ?? prev.ofType,
      };
    }
    update({ columnBindings: Object.keys(current).length > 0 ? current : undefined });
  }, [effective.columnBindings, update]);

  return (
    <div className={styles.card} data-test-id={`dataset-binding-card-${ds.name}`}>
      <div className={styles.cardHeader}>
        <span className={styles.cardTitle}>
          {ds.displayNameKey ? lookupResxString(ds.displayNameKey, lcid) || ds.name : ds.name}
        </span>
        <span data-test-id={`dataset-binding-host-badge-${ds.name}`}>
          <Badge appearance="tint" color={effective.host === 'subgrid' ? 'brand' : 'informative'}>
            {effective.host}
          </Badge>
        </span>
      </div>

      <div className={styles.row}>
        <Label size="small">Host</Label>
        <RadioGroup
          layout="horizontal"
          value={effective.host}
          onChange={(_, d) => onHostChange(d.value as DatasetHostType)}
          data-test-id={`dataset-binding-host-${ds.name}`}
        >
          <Radio value="subgrid" label="Subgrid" />
          <Radio value="homegrid" label="Homegrid" />
          <Radio value="associated" label="Associated" />
        </RadioGroup>
        <span className={styles.hint}>
          {effective.host === 'subgrid' && 'Child grid on a form — narrowed by parent FK + view.'}
          {effective.host === 'homegrid' && 'Main entity view — no parent filter.'}
          {effective.host === 'associated' && 'N:N relationship grid (P6+; skeleton only).'}
        </span>
      </div>

      {effective.host === 'subgrid' && (
        <>
          <div className={styles.row}>
            <Label size="small">Lookup column</Label>
            {candidateLookups.length > 0 ? (
              <Dropdown
                value={effective.lookupColumn ?? ''}
                selectedOptions={effective.lookupColumn ? [effective.lookupColumn] : []}
                onOptionSelect={(_, d) => update({ lookupColumn: d.optionValue || undefined })}
                data-test-id={`dataset-binding-lookup-${ds.name}`}
              >
                {candidateLookups.map(name => (
                  <Option key={name} value={name}>{name}</Option>
                ))}
              </Dropdown>
            ) : (
              <Input
                value={effective.lookupColumn ?? ''}
                onChange={(_, d) => update({ lookupColumn: d.value || undefined })}
                placeholder="e.g. msdyn_workorder"
                data-test-id={`dataset-binding-lookup-${ds.name}`}
              />
            )}
            <span className={styles.hint}>
              FK column on the child entity pointing at the parent record.
            </span>
          </div>

          <div className={styles.row}>
            <div className={styles.inlineRow}>
              <Switch
                checked={usingPageRecord}
                onChange={(_, d) => {
                  if (d.checked) {
                    update({ parentRecordRef: undefined });
                  } else {
                    update({
                      parentRecordRef: {
                        entityType: pageEntityTypeName || '',
                        entityId: pageEntityId || '',
                      },
                    });
                  }
                }}
                label="Use page record as parent"
                data-test-id={`dataset-binding-useparent-${ds.name}`}
              />
            </div>
            {usingPageRecord ? (
              <span className={styles.hint} data-test-id={`dataset-binding-parent-effective-${ds.name}`}>
                Effective parent: <code>{pageEntityTypeName || '?'}</code> / <code>{effectiveParentId || '(none)'}</code>
              </span>
            ) : (
              <div style={{ display: 'flex', gap: 4 }}>
                <Input
                  value={effective.parentRecordRef?.entityType ?? ''}
                  onChange={(_, d) => update({
                    parentRecordRef: { ...(effective.parentRecordRef ?? { entityId: '' }), entityType: d.value },
                  })}
                  placeholder="entityType"
                  style={{ flex: 1 }}
                  data-test-id={`dataset-binding-parent-entitytype-${ds.name}`}
                />
                <Input
                  value={effective.parentRecordRef?.entityId ?? ''}
                  onChange={(_, d) => update({
                    parentRecordRef: { ...(effective.parentRecordRef ?? { entityType: '' }), entityId: d.value },
                  })}
                  placeholder="entityId (GUID)"
                  style={{ flex: 2 }}
                  data-test-id={`dataset-binding-parent-entityid-${ds.name}`}
                />
              </div>
            )}
          </div>
        </>
      )}

      {effective.host === 'associated' && (
        <div className={styles.row}>
          <Label size="small">Relationship</Label>
          {dataSource === 'live' ? (
            <LiveRelationshipPicker
              dsName={ds.name}
              parentEntity={pageEntityTypeName}
              activeSchemaName={effective.relationshipName}
              onPick={(rel) => update({
                relationshipName: rel?.schemaName,
                relationshipReferencingAttribute: rel?.referencingAttribute,
              })}
            />
          ) : (
            <Input
              value={effective.relationshipName ?? ''}
              onChange={(_, d) => update({ relationshipName: d.value || undefined })}
              placeholder="e.g. msdyn_msdyn_workorder_msdyn_workorderproduct_WorkOrder"
              data-test-id={`dataset-binding-relationship-${ds.name}`}
            />
          )}
          <span className={styles.hint}>
            Filters the child dataset to records whose lookup points at the
            Page Context record. Pick from the 1:N relationships between
            <code> {pageEntityTypeName || '<parent>'} </code> and the dataset entity.
          </span>
        </div>
      )}

      {/* Property-set bindings — collapsible. Hidden when the dataset has no
          property-sets; common for fully-synthetic datasets but still rendered
          as a no-op header for discoverability. */}
      <div className={styles.row}>
        <div
          className={styles.psHeader}
          onClick={() => setPsOpen(o => !o)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPsOpen(o => !o); } }}
          data-test-id={`dataset-binding-ps-toggle-${ds.name}`}
        >
          {psOpen ? <ChevronDown16Regular /> : <ChevronRight16Regular />}
          <Label size="small" style={{ cursor: 'pointer' }}>
            Property-set bindings
          </Label>
          <Badge appearance="tint" size="small" color={effective.columnBindings && Object.keys(effective.columnBindings).length > 0 ? 'brand' : 'informative'}>
            {Object.keys(effective.columnBindings ?? {}).length} / {ds.columns.length}
          </Badge>
        </div>
        {psOpen && (
          <div className={styles.psBindings} data-test-id={`dataset-binding-ps-editor-${ds.name}`}>
            <span className={styles.hint}>
              Pick which row field each property-set reads from. Leave as <code>&lt;not set&gt;</code> to read the property-set's own name as the field. For <code>of-type-group</code> entries (e.g. ConfigColumn1/2) the concrete type is inferred from the bound field's metadata.
              <br />
              Data comes from: <code>{resolvedDataEntity || '(none)'}</code>
              {fieldCandidates.length === 0 && (
                <> — <strong>no records loaded</strong>. Set the page-context entity on the Data tab to the entity this {effective.host} is on, and load some data for it.</>
              )}
              {fieldCandidates.length > 0 && (
                <> ({fieldCandidates.length} field{fieldCandidates.length === 1 ? '' : 's'} available).</>
              )}
            </span>
            <div className={styles.psRow}>
              <span className={mergeClasses(styles.columnHeader)}>Property-set</span>
              <span className={mergeClasses(styles.columnHeader)}>Bound field</span>
            </div>
            {ds.columns.map(col => {
              const cb = effective.columnBindings?.[col.name];
              const isTypeGroup = !!col.ofTypeGroup && (typeGroups[col.ofTypeGroup]?.length ?? 0) > 0;
              const groupTypes = isTypeGroup ? typeGroups[col.ofTypeGroup!] : [];
              // For of-type-group: effective type follows the bound field's
              // metadata (when known + in the group), otherwise whatever was
              // previously persisted, otherwise the group's first type.
              // For hard-coded property-sets the manifest dictates the type.
              const boundField = cb?.field;
              const fieldMetaType = boundField
                ? getEntityMetadata(resolvedDataEntity)?.columns?.[boundField]?.type
                : undefined;
              const inferred = isTypeGroup ? inferOfTypeFromMetadata(fieldMetaType) : undefined;
              const inferredInGroup = inferred && groupTypes.includes(inferred) ? inferred : undefined;
              const typeLabel = isTypeGroup
                ? (inferredInGroup
                    ? `${friendlyOfType(inferredInGroup)} (inferred from ${boundField})`
                    : `group: ${col.ofTypeGroup} — pick a field to infer type`)
                : friendlyOfType(col.ofType);
              return (
                <div key={col.name} className={styles.psRow} data-test-id={`dataset-binding-ps-row-${ds.name}-${col.name}`}>
                  <span className={styles.psName} title={`${col.name}${typeLabel ? ` · ${typeLabel}` : ''}`}>
                    {manifestColumnLabel(col, lcid)}
                  </span>
                  <Dropdown
                    size="small"
                    value={cb?.field ?? ''}
                    selectedOptions={cb?.field ? [cb.field] : []}
                    placeholder="<not set>"
                    disabled={fieldCandidates.length === 0}
                    onOptionSelect={(_, d) => {
                      // Sentinel `__default__` clears the binding so the runtime
                      // falls back to row[propertySetName]. Anything else pins
                      // the row field this property-set reads from.
                      if (d.optionValue === '__default__') {
                        setColumnBinding(col.name, { field: '' });
                        return;
                      }
                      const nextField = d.optionValue ?? '';
                      // For of-type-group property-sets, infer the concrete
                      // type from the newly-bound field's metadata so the
                      // runtime gets a valid type without the maker having to
                      // pick (or being able to pick a mismatched one).
                      if (isTypeGroup && nextField) {
                        const metaType = getEntityMetadata(resolvedDataEntity)?.columns?.[nextField]?.type;
                        const next = inferOfTypeFromMetadata(metaType);
                        const validNext = next && groupTypes.includes(next) ? next : groupTypes[0];
                        setColumnBinding(col.name, { field: nextField, ofType: validNext });
                      } else {
                        setColumnBinding(col.name, { field: nextField });
                      }
                    }}
                    data-test-id={`dataset-binding-ps-field-${ds.name}-${col.name}`}
                  >
                    <Option value="__default__" text="<not set>">
                      <em>&lt;not set&gt;</em>
                    </Option>
                    {fieldCandidates.map(f => (
                      <Option key={f} value={f}>{f}</Option>
                    ))}
                  </Dropdown>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {dataSource !== 'live' && (
        <div className={styles.row}>
          <div className={styles.inlineRow}>
            <Label size="small" style={{ flex: 1 }}>View</Label>
            <Tooltip content="Add a new view (clones the active one)" relationship="label">
              <Button
                appearance="subtle"
                size="small"
                icon={<Add16Regular />}
                onClick={addView}
                data-test-id={`dataset-binding-add-view-${ds.name}`}
              >
                Add view
              </Button>
            </Tooltip>
            <Tooltip content={editingColumns ? 'Done editing columns' : 'Edit columns'} relationship="label">
              <Button
                appearance="subtle"
                size="small"
                icon={<Edit16Regular />}
                onClick={() => setEditingColumns(v => !v)}
                data-test-id={`dataset-binding-toggle-edit-${ds.name}`}
              />
            </Tooltip>
          </div>
          <Dropdown
            value={resolvedView.displayName}
            selectedOptions={[resolvedView.viewId]}
            onOptionSelect={(_, d) => { if (d.optionValue) selectView(d.optionValue); }}
            data-test-id={`dataset-binding-view-${ds.name}`}
          >
            {viewLibrary.map(v => (
              <Option key={v.viewId} value={v.viewId}>{v.displayName}</Option>
            ))}
          </Dropdown>
          <span className={styles.hint}>
            {resolvedView.columns.length} of {ds.columns.length} columns visible
            {viewLibrary.length > 1 ? ` • ${viewLibrary.length} views in library` : ''}.
          </span>
        </div>
      )}

      <LiveViewsRow
        dsName={ds.name}
        entityType={pageEntityTypeName}
        activeViewId={resolvedView.viewId}
        onAdoptView={(view) => {
          // Merge into the binding's view library and activate. The library
          // entry is what makes the live view survive a scenario save/reload
          // (the dv-client cache is session-scoped).
          const existing = viewLibrary.findIndex(v => v.viewId === view.viewId);
          const nextLib = existing >= 0
            ? viewLibrary.map((v, i) => i === existing ? view : v)
            : [...viewLibrary, view];

          // Auto-derive columnBindings from the view's columns when the maker
          // hasn't explicitly mapped them yet. In live mode the row keys are
          // Dataverse schema names (`msdyn_product`) and OData lookup values
          // (`_msdyn_product_value`) — without a mapping, `getValue("Product")`
          // returns null and controls that don't null-check (most of them)
          // crash on `.id.guid`. Existing user-set bindings are preserved.
          const { bindings: derived } = deriveColumnBindings(
            ds.columns,
            view.columns,
            effective.columnBindings,
          );

          setDatasetBinding(ds.name, {
            ...effective,
            view,
            views: nextLib,
            columnBindings: derived,
          });
        }}
      />

      {editingColumns && (
        <div className={styles.row} data-test-id={`dataset-binding-column-editor-${ds.name}`}>
          <div className={styles.inlineRow}>
            <Label size="small" style={{ width: 80 }}>View name</Label>
            <Input
              size="small"
              value={resolvedView.displayName}
              onChange={(_, d) => renameView(d.value)}
              style={{ flex: 1 }}
              data-test-id={`dataset-binding-view-name-${ds.name}`}
            />
            <Tooltip
              content={viewLibrary.length <= 1 ? 'At least one view is required' : 'Delete this view'}
              relationship="label"
            >
              <Button
                appearance="subtle"
                size="small"
                icon={<Delete16Regular />}
                onClick={deleteView}
                disabled={viewLibrary.length <= 1}
                data-test-id={`dataset-binding-delete-view-${ds.name}`}
              />
            </Tooltip>
          </div>
          <div className={styles.inlineRow} style={{ justifyContent: 'space-between' }}>
            <span className={styles.hint}>Drag rows by the grip to reorder. Click Sort to cycle ASC → DESC → off. Width in px.</span>
            <Button appearance="subtle" size="small" onClick={resetView}>Reset columns</Button>
          </div>
          <div className={styles.columnEditor}>
            <div className={styles.columnHeaderRow}>
              <span className={mergeClasses(styles.columnHeader, styles.colHeaderName)}>Name</span>
              <span className={mergeClasses(styles.columnHeader, styles.colHeaderWidth)}>Width</span>
              <span className={mergeClasses(styles.columnHeader, styles.colHeaderSort)}>Sort</span>
              <span className={mergeClasses(styles.columnHeader, styles.colHeaderDel)}></span>
            </div>
            {resolvedView.columns.map((col, idx) => {
              const manifestCol = ds.columns.find(c => c.name === col.name);
              const label = manifestCol ? manifestColumnLabel(manifestCol, lcid) : col.name;
              const sort = col.sortDirection ?? null;
              const nextSort: 'asc' | 'desc' | null = sort == null ? 'asc' : sort === 'asc' ? 'desc' : null;
              const sortLabel = sort == null ? '—' : sort === 'asc' ? 'ASC ▲' : 'DESC ▼';
              const isDragging = dragIdx === idx;
              const isDragOver = dragOverIdx === idx && dragIdx !== null && dragIdx !== idx;
              const dropClass = !isDragOver ? '' : (dragIdx! < idx ? styles.dragOverBottom : styles.dragOverTop);
              return (
                <div
                  key={col.name}
                  className={mergeClasses(styles.columnRow, isDragging && styles.dragging, dropClass)}
                  draggable
                  onDragStart={(e) => {
                    setDragIdx(idx);
                    e.dataTransfer.effectAllowed = 'move';
                    // Firefox requires data to be set for drag to fire.
                    try { e.dataTransfer.setData('text/plain', col.name); } catch { /* ignore */ }
                  }}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    if (dragIdx !== null) setDragOverIdx(idx);
                  }}
                  onDragOver={(e) => {
                    if (dragIdx !== null) {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                    }
                  }}
                  onDragLeave={() => {
                    // Don't clear here — onDragEnter on the next row resets it.
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIdx !== null && dragIdx !== idx) {
                      // Insert AT idx position: drop on row N means "place dragged before N".
                      // When dragging from above (fromIdx < idx) we want to land AFTER idx → idx+1.
                      const toIdx = dragIdx < idx ? idx + 1 : idx;
                      moveColumnTo(dragIdx, toIdx);
                    }
                    setDragIdx(null);
                    setDragOverIdx(null);
                  }}
                  onDragEnd={() => {
                    setDragIdx(null);
                    setDragOverIdx(null);
                  }}
                  data-test-id={`dataset-binding-col-row-${ds.name}-${col.name}`}
                >
                  <span
                    className={styles.dragGrip}
                    aria-label={`Drag to reorder ${col.name}`}
                    title="Drag to reorder"
                  >
                    <ReOrderDotsVertical16Regular />
                  </span>
                  <span className={styles.colName} title={col.name}>{label}</span>
                  <Input
                    className={styles.colWidth}
                    size="small"
                    value={col.width != null ? String(col.width) : ''}
                    onChange={(_, d) => setColumnWidth(col.name, d.value)}
                    placeholder="auto"
                  />
                  <Button
                    className={mergeClasses(styles.colSort, styles.sortBtn)}
                    appearance={sort ? 'primary' : 'subtle'}
                    size="small"
                    onClick={() => setColumnSort(col.name, nextSort)}
                    title="Click to cycle sort: none → ASC → DESC → none"
                    data-test-id={`dataset-binding-sort-${ds.name}-${col.name}`}
                  >
                    {sortLabel}
                  </Button>
                  <Button
                    appearance="subtle"
                    size="small"
                    icon={<Delete16Regular />}
                    onClick={() => toggleColumn(col.name, false)}
                    aria-label={`Hide ${col.name}`}
                    data-test-id={`dataset-binding-remove-col-${ds.name}-${col.name}`}
                  />
                </div>
              );
            })}
          </div>
          {hiddenManifestColumns.length > 0 && (
            <>
              <div className={styles.hint} style={{ marginTop: 6 }}>Hidden columns ({hiddenManifestColumns.length})</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {hiddenManifestColumns.map(col => (
                  <Button
                    key={col.name}
                    appearance="subtle"
                    size="small"
                    icon={<Add16Regular />}
                    onClick={() => toggleColumn(col.name, true)}
                    data-test-id={`dataset-binding-add-col-${ds.name}-${col.name}`}
                  >
                    {manifestColumnLabel(col, lcid)}
                  </Button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * P5.3 — Live savedquery / userquery view loader.
 *
 * Renders inline under the View dropdown on each binding card when
 * `dataSource === 'live'`. Auto-fetches once on mount (entity flips trigger
 * a re-fetch) and presents results in a UCI-style searchable Combobox via
 * the shared SearchPicker. Picking a view immediately adopts it into the
 * binding's library and activates it (no two-step "Use" button).
 *
 * `entityType` is always the page context entity — no manual override.
 * Subgrids + homegrids both surface views of the page entity in real UCI,
 * so the picker mirrors that.
 *
 * `activeViewId` lets the picker show the currently-active view as the
 * selected option (and as the display value) so the maker sees at a glance
 * which org view the binding is currently using.
 */
interface LiveViewsRowProps {
  dsName: string;
  /** Page context entity — what UCI would scope views to. Empty disables. */
  entityType: string;
  /** viewId of the currently-active view (selected in the binding). */
  activeViewId?: string;
  onAdoptView: (view: ViewDefinition) => void;
}

function LiveViewsRow({ dsName, entityType, activeViewId, onAdoptView }: LiveViewsRowProps) {
  const dataSource = useHarnessStore(s => s.dataSource);
  const liveProfile = useHarnessStore(s => s.liveProfile);
  const styles = useStyles();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetched, setFetched] = useState<ViewDefinition[] | null>(null);

  const isLive = dataSource === 'live';
  const canFetch = isLive && !!liveProfile?.orgUrl && !!entityType;

  const fetchViews = useCallback(async (force = false) => {
    if (!canFetch || !liveProfile?.orgUrl) return;
    if (force) __clearLiveViewsCache();
    setLoading(true);
    setError(null);
    try {
      const views = await liveListViews(liveProfile.orgUrl, entityType);
      setFetched(views);
    } catch (e: any) {
      setError(e?.message || 'Failed to load views from org');
    } finally {
      setLoading(false);
    }
  }, [canFetch, liveProfile?.orgUrl, entityType]);

  // Auto-fetch on mount + entity / org change. Mirrors UCI's view picker
  // which always shows the org's view list without a click.
  useEffect(() => {
    setFetched(null);
    setError(null);
    if (canFetch) void fetchViews(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, liveProfile?.orgUrl, canFetch]);

  if (!isLive) return null;

  if (!liveProfile?.orgUrl) {
    return (
      <div className={styles.row}>
        <Label size="small">
          <Globe16Regular style={{ verticalAlign: 'middle', marginRight: 4 }} />
          Org views
        </Label>
        <span className={styles.hint}>Pick a live profile to load org views.</span>
      </div>
    );
  }

  if (!entityType) {
    return (
      <div className={styles.row}>
        <Label size="small">
          <Globe16Regular style={{ verticalAlign: 'middle', marginRight: 4 }} />
          Org views
        </Label>
        <span className={styles.hint}>Set the Page Context entity to load org views.</span>
      </div>
    );
  }

  const items: SearchPickerItem<ViewDefinition>[] = (fetched ?? []).map(v => ({
    value: v.viewId,
    text: v.displayName,
    group: v.viewType === 'system' ? 'System views' : 'Personal views',
    badge: v.isDefault ? 'Default' : undefined,
    raw: v,
  }));

  return (
    <div className={styles.row} data-test-id={`dataset-binding-live-views-${dsName}`}>
      <div className={styles.inlineRow}>
        <Label size="small" style={{ flex: 1 }}>
          <Globe16Regular style={{ verticalAlign: 'middle', marginRight: 4 }} />
          Org views{fetched && ` — ${fetched.length}`}
        </Label>
      </div>
      <SearchPicker<ViewDefinition>
        items={items}
        activeValue={activeViewId}
        placeholder={loading ? 'Loading views…' : `Search views for ${entityType}…`}
        loading={loading}
        error={error}
        emptyMessage="No matches"
        unfetchedMessage={fetched && fetched.length === 0
          ? `No org views found for ${entityType}.`
          : undefined}
        onSelect={(item) => onAdoptView(item.raw)}
        onRefresh={() => { void fetchViews(true); }}
        testIdPrefix={`dataset-binding-live-views-${dsName}`}
      />
    </div>
  );
}

/**
 * UCI-style searchable picker for 1:N relationships from a parent entity
 * (typically Page Context). Lists EVERY 1:N from the parent so the maker
 * can see which child entity each goes to — useful when the dataset isn't
 * yet bound to a concrete entity (the relationship itself defines the
 * child). Auto-picks when there's exactly one candidate. Shows a clear
 * "pick the parent first" state when the prerequisites aren't met.
 */
interface LiveRelationshipPickerProps {
  dsName: string;
  parentEntity: string;
  activeSchemaName?: string;
  onPick: (rel: LiveRelationship | null) => void;
}

function LiveRelationshipPicker({
  dsName, parentEntity, activeSchemaName, onPick,
}: LiveRelationshipPickerProps) {
  const orgUrl = useHarnessStore(s => s.liveProfile?.orgUrl ?? '');
  const connectionState = useHarnessStore(s => s.liveConnectionState);
  const [fetched, setFetched] = useState<LiveRelationship[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canFetch = orgUrl && connectionState === 'connected' && parentEntity;

  const fetchRels = useCallback(async (force = false) => {
    if (!canFetch) return;
    setLoading(true);
    setError(null);
    try {
      // Pass `undefined` for childEntity so the API returns ALL 1:N from
      // the parent — the maker picks the relationship, which in turn tells
      // us which child entity to fetch from.
      const rels = await liveListRelationships(orgUrl, parentEntity, undefined, force);
      // Sort by child entity name → relationship schema, for a stable display.
      rels.sort((a, b) =>
        a.referencingEntity.localeCompare(b.referencingEntity)
        || a.schemaName.localeCompare(b.schemaName),
      );
      setFetched(rels);
    } catch (e: any) {
      const msg = e instanceof DvProxyError ? `${e.body.error}: ${e.body.message}` : (e?.message ?? 'Failed');
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [canFetch, orgUrl, parentEntity]);

  useEffect(() => {
    if (canFetch && !fetched && !loading) {
      void fetchRels(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canFetch, parentEntity]);

  const items: Array<SearchPickerItem<LiveRelationship>> = useMemo(
    () => (fetched ?? []).map(r => ({
      value: r.schemaName,
      // Show: <child entity> · <fk attr> · <schema>
      text: `${r.referencingEntity}  ·  ${r.referencingAttribute}  ·  ${r.schemaName}`,
      raw: r,
    })),
    [fetched],
  );

  return (
    <SearchPicker<LiveRelationship>
      items={items}
      activeValue={activeSchemaName}
      placeholder={
        !parentEntity ? 'Set Page Context entity first' :
        loading ? 'Loading relationships…' :
        `Search 1:N from ${parentEntity}…`
      }
      loading={loading}
      error={error}
      emptyMessage="No matches"
      unfetchedMessage={
        !parentEntity ? 'Pick a Page Context entity to load relationships.' :
        connectionState !== 'connected' ? 'Connect to the org first.' :
        fetched && fetched.length === 0
          ? `No 1:N relationships from ${parentEntity}.`
          : undefined
      }
      onSelect={(item) => onPick(item.raw)}
      onRefresh={() => { void fetchRels(true); }}
      testIdPrefix={`dataset-binding-relationship-${dsName}`}
    />
  );
}

/**
 * Cross-panel focus event. The form-chrome view pill (P4) dispatches this to
 * jump to the binding card in DataPanel. The card listens via window event
 * and scrolls itself into view + flashes a brand-coloured outline.
 *
 * Custom DOM event is the simplest tool for one-off cross-panel signalling
 * without coupling form-chrome to DataPanel's mount state — the listener
 * mounts/unmounts with DataPanel and the event is a no-op when the panel
 * is collapsed.
 */
export const FOCUS_BINDING_EVENT = 'pcfwb:focus-dataset-binding';
export interface FocusBindingDetail { datasetName: string; autoEdit?: boolean }
export function emitFocusDatasetBinding(datasetName: string, opts?: { autoEdit?: boolean }): void {
  window.dispatchEvent(new CustomEvent<FocusBindingDetail>(FOCUS_BINDING_EVENT, {
    detail: { datasetName, autoEdit: opts?.autoEdit },
  }));
}

/**
 * Form-chrome view pills. One entry per manifest dataset. The pill itself is
 * a Fluent v9 Menu trigger that lists every view in the binding's library —
 * picking one swaps `binding.view`. An adjacent edit icon does the deep-link
 * jump to the Data panel binding card (the same focus event the pill used to
 * fire when clicked).
 *
 * Splitting "switch view" (cheap, common) from "edit columns" (rare, panel-
 * level) mirrors how UCI's subgrid command bar separates the view selector
 * dropdown from the "Edit columns" menu item.
 */
export function DatasetViewPills() {
  const datasets = useHarnessStore(s => s.manifest?.dataSets ?? []);
  const bindings = useHarnessStore(s => s.datasetBindings);
  const setDatasetBinding = useHarnessStore(s => s.setDatasetBinding);
  if (datasets.length === 0) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8 }} data-test-id="form-chrome-view-pills">
      {datasets.map(ds => {
        const binding = bindings[ds.name];
        const activeView = binding && isResolvedView(binding.view) ? binding.view : null;
        const library: ViewDefinition[] = binding?.views && binding.views.length > 0
          ? binding.views
          : (activeView ? [activeView] : []);
        const label = activeView?.displayName ?? 'Default view';
        const host = binding?.host ?? 'homegrid';
        const activeViewId = activeView?.viewId ?? '';
        return (
          <span
            key={ds.name}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            data-test-id={`form-chrome-view-pill-${ds.name}`}
            title={`${ds.name} • host: ${host}`}
          >
            <span style={{
              color: tokens.colorNeutralForeground3,
              fontSize: tokens.fontSizeBase200,
            }}>View:</span>
            {/*
              Native <select> on purpose. We tried Fluent v9 Menu and Dropdown
              here first; both caused the whole page to render white while the
              popover was open, likely because FormChrome's providerRoot is
              `overflow: hidden` and the popover's portal positioning gets
              clipped/blanks the FluentProvider scope. Native <select> uses
              OS-level popup chrome and dodges the whole problem.
            */}
            <select
              value={activeViewId}
              onChange={(e) => {
                const nextView = library.find(v => v.viewId === e.target.value);
                if (!binding || !nextView) return;
                setDatasetBinding(ds.name, { ...binding, view: nextView });
              }}
              data-test-id={`form-chrome-view-pill-trigger-${ds.name}`}
              aria-label={`Select view for ${ds.name}`}
              style={{
                fontFamily: 'inherit',
                fontSize: tokens.fontSizeBase200,
                fontWeight: tokens.fontWeightSemibold,
                color: tokens.colorNeutralForeground1,
                backgroundColor: tokens.colorNeutralBackground3,
                border: `1px solid ${tokens.colorNeutralStroke2}`,
                borderRadius: tokens.borderRadiusMedium,
                padding: '2px 6px',
                cursor: 'pointer',
                maxWidth: 200,
              }}
            >
              {library.map(v => (
                <option key={v.viewId} value={v.viewId}>
                  {v.displayName}
                </option>
              ))}
            </select>
            <Button
              appearance="subtle"
              size="small"
              icon={<Edit16Regular />}
              onClick={() => emitFocusDatasetBinding(ds.name, { autoEdit: true })}
              aria-label={`Edit columns for ${ds.name}`}
              title="Edit columns in Data panel"
              data-test-id={`form-chrome-view-edit-${ds.name}`}
            />
          </span>
        );
      })}
    </div>
  );
}

/**
 * Top-level Datasets section for the Data panel. Renders one card per manifest
 * dataset, or nothing when the control has no datasets (field controls). Lives
 * directly above the Mock Data block so users see the binding context first.
 *
 * Subscribes to the cross-panel focus event so the form-chrome view pill can
 * scroll a card into view + flash it. The handler matches by data-test-id on
 * the card root so we don't need to thread refs through child components.
 */
export function DatasetBindingsBlock() {
  const styles = useStyles();
  const datasets = useHarnessStore(s => s.manifest?.dataSets ?? []);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<FocusBindingDetail>).detail;
      if (!detail?.datasetName || !rootRef.current) return;
      // Defer to the next animation frame so the HarnessShell tab switch +
      // the card's own autoEdit re-render have committed before we try to
      // scroll. Calling scrollIntoView synchronously on a still-hidden
      // (display:none) DataPanel causes a visible layout-thrash flash.
      requestAnimationFrame(() => {
        if (!rootRef.current) return;
        const card = rootRef.current.querySelector<HTMLDivElement>(
          `[data-test-id="dataset-binding-card-${detail.datasetName}"]`,
        );
        if (!card) return;
        // 'auto' (instant) avoids the smooth-scroll animation that, combined
        // with the tab content swap, was reading as a full-screen flash.
        card.scrollIntoView({ behavior: 'auto', block: 'center' });
      });
    };
    window.addEventListener(FOCUS_BINDING_EVENT, handler);
    return () => window.removeEventListener(FOCUS_BINDING_EVENT, handler);
  }, []);

  if (datasets.length === 0) return null;
  return (
    <div className={styles.block} ref={rootRef} data-test-id="dataset-bindings-block">
      {datasets.map(ds => <DatasetBindingCard key={ds.name} ds={ds} />)}
    </div>
  );
}
