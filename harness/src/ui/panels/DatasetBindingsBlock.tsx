import { useState, useMemo, useCallback } from 'react';
import {
  makeStyles, tokens, Button, Badge,
  Radio, RadioGroup, Dropdown, Option, Input, Label, Switch,
  Tooltip,
} from '@fluentui/react-components';
import {
  Add16Regular, Delete16Regular, ChevronUp16Regular, ChevronDown16Regular,
  Edit16Regular,
} from '@fluentui/react-icons';
import { useHarnessStore } from '../../store/harness-store';
import type { ManifestDataSet, ManifestProperty } from '../../types/manifest';
import type {
  DatasetBinding, DatasetHostType, ViewDefinition, ViewColumn,
} from '../../types/dataset-binding';
import { isResolvedView, synthesizeDefaultView } from '../../types/dataset-binding';
import { lookupResxString } from '../../shim/resources';

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
  columnGrid: {
    display: 'grid',
    gridTemplateColumns: '24px 1fr 60px 60px 28px 28px',
    alignItems: 'center',
    gap: '4px',
    fontSize: tokens.fontSizeBase200,
  },
  columnHeader: {
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
});

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
  const binding = useHarnessStore(s => s.datasetBindings[ds.name]);
  const setDatasetBinding = useHarnessStore(s => s.setDatasetBinding);

  const [editingColumns, setEditingColumns] = useState(false);

  // Effective binding — fall back to a synthesised homegrid + all-columns
  // default so the UI never has to deal with `undefined`. P0's apply path
  // also synthesises this, but the harness can render before the first
  // scenario apply (gallery mode, fresh control), so we guard here too.
  const effective: DatasetBinding = binding ?? {
    host: 'homegrid',
    view: synthesizeDefaultView(ds.name, ds.name, ds.columns.map(c => c.name)),
  };

  const resolvedView: ViewDefinition = isResolvedView(effective.view)
    ? effective.view
    : synthesizeDefaultView(ds.name, ds.name, ds.columns.map(c => c.name));

  const candidateLookups = useMemo(() => lookupCandidates(ds, typeGroups), [ds, typeGroups]);

  const update = useCallback((next: Partial<DatasetBinding>) => {
    setDatasetBinding(ds.name, { ...effective, ...next });
  }, [setDatasetBinding, ds.name, effective]);

  const updateView = useCallback((nextView: Partial<ViewDefinition>) => {
    setDatasetBinding(ds.name, {
      ...effective,
      view: { ...resolvedView, ...nextView },
    });
  }, [setDatasetBinding, ds.name, effective, resolvedView]);

  const onHostChange = useCallback((host: DatasetHostType) => {
    const next: DatasetBinding = { ...effective, host };
    // Clear host-specific fields when switching away so a stale FK doesn't
    // silently filter on a homegrid.
    if (host !== 'subgrid') { next.lookupColumn = undefined; }
    if (host !== 'associated') { next.relationshipName = undefined; }
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

  const moveColumn = useCallback((idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= resolvedView.columns.length) return;
    const next = [...resolvedView.columns];
    [next[idx], next[target]] = [next[target], next[idx]];
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
    updateView(synthesizeDefaultView(ds.name, resolvedView.entityType, ds.columns.map(c => c.name)));
  }, [ds.columns, ds.name, resolvedView.entityType, updateView]);

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
          <Input
            value={effective.relationshipName ?? ''}
            onChange={(_, d) => update({ relationshipName: d.value || undefined })}
            placeholder="e.g. account_contact_n_n"
            data-test-id={`dataset-binding-relationship-${ds.name}`}
          />
          <span className={styles.hint}>P6 wires N:N intersect fetch. Field captured here for forward-compat.</span>
        </div>
      )}

      <div className={styles.row}>
        <div className={styles.inlineRow}>
          <Label size="small" style={{ flex: 1 }}>View</Label>
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
          onOptionSelect={() => {/* single view today; M2 will list named views */}}
          data-test-id={`dataset-binding-view-${ds.name}`}
        >
          <Option value={resolvedView.viewId}>{resolvedView.displayName}</Option>
        </Dropdown>
        <span className={styles.hint}>
          {resolvedView.columns.length} of {ds.columns.length} columns visible.
        </span>
      </div>

      {editingColumns && (
        <div className={styles.row} data-test-id={`dataset-binding-column-editor-${ds.name}`}>
          <div className={styles.inlineRow} style={{ justifyContent: 'space-between' }}>
            <span className={styles.hint}>Drag-free order: ▲ ▼. Sort: click ASC / DESC. Width: px.</span>
            <Button appearance="subtle" size="small" onClick={resetView}>Reset</Button>
          </div>
          <div className={styles.columnGrid}>
            <span className={styles.columnHeader}></span>
            <span className={styles.columnHeader}>Name</span>
            <span className={styles.columnHeader}>Width</span>
            <span className={styles.columnHeader}>Sort</span>
            <span className={styles.columnHeader}></span>
            <span className={styles.columnHeader}></span>
          </div>
          {resolvedView.columns.map((col, idx) => {
            const manifestCol = ds.columns.find(c => c.name === col.name);
            const label = manifestCol ? manifestColumnLabel(manifestCol, lcid) : col.name;
            const sort = col.sortDirection ?? null;
            return (
              <div key={col.name} className={styles.columnGrid}>
                <span style={{ width: 16, height: 16, display: 'inline-block', backgroundColor: tokens.colorBrandBackground, borderRadius: 4 }} />
                <span title={col.name}>{label}</span>
                <Input
                  size="small"
                  value={col.width != null ? String(col.width) : ''}
                  onChange={(_, d) => setColumnWidth(col.name, d.value)}
                  placeholder="auto"
                />
                <Dropdown
                  size="small"
                  value={sort ?? '—'}
                  selectedOptions={[sort ?? 'none']}
                  onOptionSelect={(_, d) => setColumnSort(col.name, d.optionValue === 'none' ? null : (d.optionValue as 'asc' | 'desc'))}
                >
                  <Option value="none">—</Option>
                  <Option value="asc">ASC</Option>
                  <Option value="desc">DESC</Option>
                </Dropdown>
                <Button appearance="subtle" size="small" icon={<ChevronUp16Regular />} onClick={() => moveColumn(idx, -1)} disabled={idx === 0} aria-label={`Move ${col.name} up`} />
                <Button appearance="subtle" size="small" icon={<ChevronDown16Regular />} onClick={() => moveColumn(idx, 1)} disabled={idx === resolvedView.columns.length - 1} aria-label={`Move ${col.name} down`} />
              </div>
            );
          })}
          {hiddenManifestColumns.length > 0 && (
            <>
              <div className={styles.hint} style={{ marginTop: 6 }}>Hidden columns ({hiddenManifestColumns.length})</div>
              {hiddenManifestColumns.map(col => (
                <div key={col.name} className={styles.inlineRow}>
                  <Button
                    appearance="subtle"
                    size="small"
                    icon={<Add16Regular />}
                    onClick={() => toggleColumn(col.name, true)}
                    data-test-id={`dataset-binding-add-col-${ds.name}-${col.name}`}
                  >
                    {manifestColumnLabel(col, lcid)}
                  </Button>
                </div>
              ))}
            </>
          )}
          {resolvedView.columns.length > 0 && (
            <div className={styles.hint} style={{ marginTop: 6 }}>
              Remove a visible column:
              {resolvedView.columns.map(col => (
                <Button
                  key={col.name}
                  appearance="subtle"
                  size="small"
                  icon={<Delete16Regular />}
                  onClick={() => toggleColumn(col.name, false)}
                  data-test-id={`dataset-binding-remove-col-${ds.name}-${col.name}`}
                  style={{ marginLeft: 4 }}
                >
                  {col.name}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Top-level Datasets section for the Data panel. Renders one card per manifest
 * dataset, or nothing when the control has no datasets (field controls). Lives
 * directly above the Mock Data block so users see the binding context first.
 */
export function DatasetBindingsBlock() {
  const styles = useStyles();
  const datasets = useHarnessStore(s => s.manifest?.dataSets ?? []);
  if (datasets.length === 0) return null;
  return (
    <div className={styles.block} data-test-id="dataset-bindings-block">
      <span className={styles.header} title="Per-dataset host + view configuration (mirrors how a maker configures the control on a form)">
        Datasets
      </span>
      {datasets.map(ds => <DatasetBindingCard key={ds.name} ds={ds} />)}
    </div>
  );
}
