import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  makeStyles, mergeClasses, tokens, Input, Label, Switch, SpinButton, Textarea,
  Divider, Badge, Dropdown, Option, Button, MessageBar, MessageBarBody,
} from '@fluentui/react-components';
import { Add16Regular } from '@fluentui/react-icons';
import type { ManifestConfig, ManifestProperty } from '../../types/manifest';
import { useHarnessStore } from '../../store/harness-store';
import { getEntityData, getEntityStoreKeys } from '../../store/data-store';
import { getColumnDisplayName, getEntityDisplayName, getEntityMetadata } from '../../store/metadata-store';
import { ControlInfoCard } from './ControlInfoCard';

const useStyles = makeStyles({
  root: {
    padding: '12px',
    overflowY: 'auto',
    height: '100%',
  },
  header: {
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
    marginBottom: '12px',
  },
  field: {
    marginBottom: '12px',
    width: '100%',
    // Force Fluent inputs/dropdowns/spin-buttons/textareas inside a field
    // to fill the available column width. Default Fluent sizing leaves
    // them around 180px which looks cramped in the side panel.
    '& .fui-Input, & .fui-Dropdown, & .fui-SpinButton, & .fui-Textarea': {
      width: '100%',
      maxWidth: '100%',
    },
  },
  fullWidth: {
    width: '100%',
  },
  label: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginBottom: '4px',
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
  },
  typeHint: {
    fontSize: '10px',
    opacity: 0.6,
    fontWeight: 'normal' as const,
  },
  lookupGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  columnLabel: {
    fontSize: '11px',
    color: tokens.colorNeutralForeground3,
    marginBottom: '2px',
  },
  boundValue: {
    fontSize: '11px',
    color: tokens.colorNeutralForeground3,
    fontFamily: "'Consolas', monospace",
    padding: '4px 8px',
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: tokens.borderRadiusSmall,
    marginTop: '2px',
    wordBreak: 'break-all' as const,
    outlineWidth: '1px',
    outlineStyle: 'solid',
    outlineColor: 'transparent',
    outlineOffset: '0',
    transition: 'box-shadow 220ms ease-out, background-color 220ms ease-out, outline-color 220ms ease-out, color 220ms ease-out',
  },
  // Applied for ~3s after the control writes back to a bound property so
  // the user can SEE the control mutated the value. Uses a hard
  // state-toggle (timer-driven) instead of a CSS keyframe so it works
  // reliably regardless of remount/HMR/key churn and is easy to verify
  // visually + via Playwright.
  boundValueChanged: {
    backgroundColor: '#fff4d6',
    color: '#7a4f01',
    outlineColor: '#f0a900',
    boxShadow: '0 0 0 3px rgba(240, 169, 0, 0.35)',
    fontWeight: tokens.fontWeightSemibold,
  },
  boundChipRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginTop: '2px',
  },
  boundChipFlex: { flex: 1, minWidth: 0, marginTop: 0 },
  updatedBadge: {
    fontSize: '10px',
    fontWeight: tokens.fontWeightSemibold,
    color: '#7a4f01',
    backgroundColor: '#ffd166',
    padding: '2px 6px',
    borderRadius: tokens.borderRadiusSmall,
    whiteSpace: 'nowrap' as const,
    opacity: 1,
    transition: 'opacity 300ms ease-out',
  },
  updatedBadgeHidden: { opacity: 0, pointerEvents: 'none' as const },
});

/**
 * Map PCF property types to compatible Dataverse attribute types.
 * Returns null if no filtering should be applied (accept all types).
 */
function getCompatibleTypes(ofType: string): string[] | null {
  switch (ofType) {
    case 'TwoOptions':
      return ['Boolean'];
    case 'Whole.None':
      return ['Integer', 'BigInt'];
    case 'FP':
    case 'Decimal':
      return ['Decimal', 'Double', 'Money'];
    case 'Currency':
      return ['Money', 'Decimal'];
    case 'DateAndTime.DateOnly':
    case 'DateAndTime.DateAndTime':
      return ['DateTime'];
    case 'OptionSet':
      return ['Picklist', 'State', 'Status'];
    case 'MultiSelectOptionSet':
      return ['Virtual']; // MultiSelect picklists are Virtual in Dataverse
    case 'Lookup.Simple':
      return ['Lookup', 'Owner', 'Customer'];
    case 'SingleLine.Text':
    case 'SingleLine.Email':
    case 'SingleLine.Phone':
    case 'SingleLine.URL':
    case 'SingleLine.TextArea':
      return ['String', 'Memo'];
    case 'Multiple':
      return ['String', 'Memo'];
    default:
      return null; // Accept all types (e.g. of-type-group)
  }
}

/** Filter entity columns by compatible types using metadata */
function filterColumnsByType(entityType: string, columns: string[], ofType: string): string[] {
  const compatibleTypes = getCompatibleTypes(ofType);
  if (!compatibleTypes) return columns; // No filtering

  const meta = getEntityMetadata(entityType);
  if (!meta) return columns; // No metadata — show all

  return columns.filter(col => {
    const colMeta = meta.columns[col];
    if (!colMeta?.type) return true; // No type info — include
    return compatibleTypes.includes(colMeta.type);
  });
}

/** Get available columns from the first record of an entity in data.json */
function getEntityColumns(entityType: string): string[] {
  if (!entityType) return [];
  const records = getEntityData(entityType);
  if (records.length === 0) {
    // Try all entity keys to find one with data
    for (const key of getEntityStoreKeys()) {
      const data = getEntityData(key);
      if (data.length > 0) {
        return Object.keys(data[0]).filter(k => !k.includes('@'));
      }
    }
    return [];
  }
  return Object.keys(records[0]).filter(k => !k.includes('@'));
}

/** Resolve a column value from entity data */
function resolveColumnValue(entityType: string, entityId: string, columnName: string): any {
  if (!entityType || !entityId || !columnName) return null;
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

  const val = record[columnName];
  // Check for OData lookup format
  const formatted = record[`${columnName}@OData.Community.Display.V1.FormattedValue`]
    ?? record[`_${columnName}_value@OData.Community.Display.V1.FormattedValue`];
  const lookupVal = record[`_${columnName}_value`];

  if (lookupVal && formatted) {
    return [{ id: lookupVal, name: formatted, entityType: columnName }];
  }
  return val ?? null;
}

/** Friendly label for PCF property types */
function formatTypeName(ofType: string): string {
  if (ofType.startsWith('SingleLine.')) return ofType.replace('SingleLine.', '');
  if (ofType.startsWith('DateAndTime.')) return ofType.replace('DateAndTime.', '');
  if (ofType === 'Whole.None') return 'Whole Number';
  if (ofType === 'FP') return 'Floating Point';
  if (ofType === 'Multiple') return 'Multi-Line Text';
  if (ofType === 'Lookup.Simple') return 'Lookup';
  return ofType;
}

/** Candidate record shape for the Lookup picker. */
interface LookupCandidate {
  id: string;
  name: string;
  entityType: string;
}

const LOOKUP_PER_ENTITY_CAP = 50;

function pickPrimaryNameKey(record: Record<string, any>): string | undefined {
  const candidates = ['name', 'fullname', 'displayname', 'title', 'subject', 'description'];
  for (const key of candidates) {
    if (typeof record[key] === 'string' && record[key].trim().length > 0) return key;
  }
  for (const [k, v] of Object.entries(record)) {
    if (k.includes('@') || k.toLowerCase().endsWith('id') || k === 'id') continue;
    if (typeof v === 'string' && v.trim().length > 0) return k;
  }
  return undefined;
}

function pickRecordId(record: Record<string, any>): string | undefined {
  for (const [k, v] of Object.entries(record)) {
    if ((k.toLowerCase().endsWith('id') || k === 'id') && (typeof v === 'string' || typeof v === 'number')) {
      return String(v);
    }
  }
  return undefined;
}

/**
 * Collect candidate lookup records from the in-memory entity table.
 * Strategy:
 *   1. If `preferredEntityType` resolves to a populated bucket, use only that.
 *   2. Otherwise pool the first N records from every entity bucket so the user
 *      can still pick something — most controls accept any entity type for
 *      Lookup.Simple props that don't declare a target.
 */
function getLookupCandidates(preferredEntityType?: string): LookupCandidate[] {
  const out: LookupCandidate[] = [];
  const pushFromBucket = (entityType: string, records: Record<string, any>[]) => {
    for (const r of records.slice(0, LOOKUP_PER_ENTITY_CAP)) {
      const id = pickRecordId(r);
      const nameKey = pickPrimaryNameKey(r);
      const name = nameKey ? String(r[nameKey]) : (id ? `${entityType} ${id.slice(0, 8)}…` : entityType);
      if (id) out.push({ id, name, entityType });
    }
  };

  if (preferredEntityType) {
    const records = getEntityData(preferredEntityType);
    if (records.length > 0) {
      pushFromBucket(preferredEntityType, records);
      return out;
    }
  }
  for (const key of getEntityStoreKeys()) {
    const records = getEntityData(key);
    if (records.length === 0) continue;
    pushFromBucket(key, records);
  }
  return out;
}

function lookupOptionKey(c: LookupCandidate): string {
  return `${c.entityType}::${c.id}`;
}

function parseLookupOptionKey(key: string): { entityType: string; id: string } | null {
  const idx = key.indexOf('::');
  if (idx < 0) return null;
  return { entityType: key.slice(0, idx), id: key.slice(idx + 2) };
}

function PropertyField({ prop, manifest, entityColumns, pageEntityTypeName, pageEntityId }: {
  prop: ManifestProperty;
  manifest: ManifestConfig;
  entityColumns: string[];
  pageEntityTypeName: string;
  pageEntityId: string;
}) {
  const styles = useStyles();
  const value = useHarnessStore(s => s.propertyValues[prop.name]);
  const setValue = useHarnessStore(s => s.setPropertyValue);
  const selectedType = useHarnessStore(s => s.propertyTypes[prop.name]);
  const setPropertyType = useHarnessStore(s => s.setPropertyType);
  // Re-render bound rows whenever the underlying data store changes so the
  // displayed resolved value reflects writes from the control via
  // notifyOutputChanged → getOutputs. App.tsx bridges subscribeData() into
  // dataVersion, so subscribing here is enough.
  useHarnessStore(s => s.dataVersion);
  const typeGroupTypes = prop.ofTypeGroup ? manifest.typeGroups[prop.ofTypeGroup] : undefined;

  // Track which column this property is bound to (stored as $columnName in the value)
  const boundColumn = typeof value === 'string' && value.startsWith('$') ? value.substring(1) : null;
  // Track related field reference (stored as @sourceSlot.fieldName)
  const isRelatedField = typeof value === 'string' && value.startsWith('@');
  const resolvedValue = boundColumn ? resolveColumnValue(pageEntityTypeName, pageEntityId, boundColumn) : value;
  const displayValue = resolvedValue !== null && resolvedValue !== undefined
    ? (Array.isArray(resolvedValue) ? resolvedValue[0]?.name ?? String(resolvedValue[0]?.id) : String(resolvedValue))
    : '';

  // Highlight the bound value chip whenever its resolved value changes
  // (typically because the control wrote it back via notifyOutputChanged).
  // Timer-driven on/off — robust against remounts, HMR, animation
  // optimisations, and easy to verify via Playwright (class is present,
  // not a transient keyframe state). The first render is skipped — we
  // only want to highlight *changes*, not the initial display.
  const prevDisplayRef = useRef<string | null>(null);
  const [isFresh, setIsFresh] = useState(false);
  const freshTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (prevDisplayRef.current === null) {
      prevDisplayRef.current = displayValue;
      return;
    }
    if (prevDisplayRef.current !== displayValue) {
      prevDisplayRef.current = displayValue;
      setIsFresh(true);
      if (freshTimerRef.current !== null) window.clearTimeout(freshTimerRef.current);
      freshTimerRef.current = window.setTimeout(() => {
        setIsFresh(false);
        freshTimerRef.current = null;
      }, 3000);
    }
  }, [displayValue]);
  useEffect(() => () => {
    if (freshTimerRef.current !== null) window.clearTimeout(freshTimerRef.current);
  }, []);
  const boundValueClass = isFresh
    ? mergeClasses(styles.boundValue, styles.boundValueChanged)
    : styles.boundValue;

  const handleColumnSelect = useCallback((_: any, data: { optionValue?: string }) => {
    const col = data.optionValue;
    if (!col || col === '__none__') {
      setValue(prop.name, null);
    } else {
      // Store as $columnName — the context factory resolves it
      setValue(prop.name, `$${col}`);
    }
  }, [prop.name, setValue]);

  const handleTextChange = useCallback((_: any, data: { value: string }) => {
    setValue(prop.name, data.value || null);
  }, [prop.name, setValue]);

  const handleNumberChange = useCallback((_: any, data: { value?: number | null }) => {
    setValue(prop.name, data.value ?? null);
  }, [prop.name, setValue]);

  const handleSwitchChange = useCallback((_: any, data: { checked: boolean }) => {
    setValue(prop.name, data.checked);
  }, [prop.name, setValue]);

  const usageBadge = prop.usage === 'bound'
    ? <Badge appearance="filled" color="brand" size="small">bound</Badge>
    : <Badge appearance="outline" size="small">input</Badge>;

  // BOUND properties: always show Table column dropdown (matches Power Apps maker)
  if (prop.usage === 'bound' && entityColumns.length > 0) {
    return (
      <div className={styles.field}>
        <div className={styles.label}>
          {prop.displayNameKey}
          {prop.required && <span style={{ color: '#d13438' }}>*</span>}
          <span className={styles.typeHint}>({prop.ofType})</span>
        </div>
        <div className={styles.columnLabel}>Table column</div>
        <Dropdown
          size="small"
          placeholder="Select an option"
          selectedOptions={boundColumn ? [boundColumn] : []}
          value={boundColumn ? (getColumnDisplayName(pageEntityTypeName, boundColumn) ?? boundColumn) : ''}
          onOptionSelect={handleColumnSelect}
        >
          <Option value="__none__" text="">— None —</Option>
          {filterColumnsByType(pageEntityTypeName, entityColumns, prop.ofType).map(col => {
            const dn = getColumnDisplayName(pageEntityTypeName, col);
            const label = dn ? `${dn} (${col})` : col;
            return <Option key={col} value={col} text={label}>{label}</Option>;
          })}
        </Dropdown>
        {boundColumn && displayValue && (
          <div className={styles.boundChipRow}>
            <div
              className={mergeClasses(boundValueClass, styles.boundChipFlex)}
              data-test-id={`pe-bound-chip-${prop.name}`}
              data-fresh={isFresh ? 'true' : 'false'}
            >
              {displayValue}
            </div>
            <span
              className={mergeClasses(styles.updatedBadge, !isFresh && styles.updatedBadgeHidden)}
              data-test-id={`pe-bound-updated-${prop.name}`}
              aria-hidden={!isFresh}
            >
              ↻ updated
            </span>
          </div>
        )}
      </div>
    );
  }

  // INPUT properties with entity data: show "Bind to table column" checkbox (matches Power Apps maker)
  if (prop.usage === 'input' && entityColumns.length > 0) {
    // Track bound state: $columnName means bound, anything else means static
    // Also treat $__pending__ as bound (user toggled on but hasn't selected a column yet)
    const isBoundToColumn = boundColumn !== null || value === '$';

    const renderStaticEditor = () => {
      const staticVal = typeof value === 'string' && !value.startsWith('$') ? value : '';
      switch (prop.ofType) {
        case 'TwoOptions':
          return <Switch checked={value === true || value === 'true'} onChange={handleSwitchChange} />;
        case 'Enum':
          if (prop.enumValues && prop.enumValues.length > 0) {
            return (
              <Dropdown
                size="small"
                placeholder="Select an option"
                selectedOptions={staticVal ? [staticVal] : []}
                value={prop.enumValues.find(v => v.value === staticVal)?.displayNameKey ?? staticVal}
                onOptionSelect={(_, d) => setValue(prop.name, d.optionValue ?? null)}
              >
                {prop.enumValues.map(v => (
                  <Option key={v.value} value={v.value} text={v.displayNameKey}>{v.displayNameKey}</Option>
                ))}
              </Dropdown>
            );
          }
          return (
            <Input size="small" value={staticVal} onChange={handleTextChange} placeholder={prop.descriptionKey || 'Static value'} />
          );
        case 'Multiple':
          return <Textarea size="small" value={staticVal} onChange={handleTextChange} resize="vertical" />;
        default:
          return <Input size="small" value={staticVal} onChange={handleTextChange} placeholder={prop.descriptionKey || 'Static value'} />;
      }
    };

    return (
      <div className={styles.field}>
        <div className={styles.label}>
          {prop.displayNameKey}
          <span className={styles.typeHint}>({selectedType ? formatTypeName(selectedType) : prop.ofType})</span>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', fontSize: '12px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={isBoundToColumn}
            onChange={(e) => {
              if (e.target.checked) {
                setValue(prop.name, '$'); // Pending column selection
              } else {
                setValue(prop.name, '');
              }
            }}
          />
          Bind to table column
        </label>
        {isBoundToColumn ? (
          <>
            <div className={styles.columnLabel}>Table column</div>
            <Dropdown
              size="small"
              placeholder="Select an option"
              selectedOptions={boundColumn ? [boundColumn] : []}
              value={boundColumn ? (getColumnDisplayName(pageEntityTypeName, boundColumn) ?? boundColumn) : ''}
              onOptionSelect={handleColumnSelect}
            >
              <Option value="__none__" text="">— None —</Option>
              {filterColumnsByType(pageEntityTypeName, entityColumns, prop.ofType).map(col => {
                const dn = getColumnDisplayName(pageEntityTypeName, col);
                const label = dn ? `${dn} (${col})` : col;
                return <Option key={col} value={col} text={label}>{label}</Option>;
              })}
            </Dropdown>
            {boundColumn && displayValue && (
              <div className={styles.boundChipRow}>
                <div
                  className={mergeClasses(boundValueClass, styles.boundChipFlex)}
                  data-test-id={`pe-bound-chip-${prop.name}`}
                  data-fresh={isFresh ? 'true' : 'false'}
                >
                  {displayValue}
                </div>
                <span
                  className={mergeClasses(styles.updatedBadge, !isFresh && styles.updatedBadgeHidden)}
                  data-test-id={`pe-bound-updated-${prop.name}`}
                  aria-hidden={!isFresh}
                >
                  ↻ updated
                </span>
              </div>
            )}
          </>
        ) : (
          <>
            {typeGroupTypes && typeGroupTypes.length > 0 && (
              <>
                <div className={styles.columnLabel}>Type</div>
                <Dropdown
                  size="small"
                  selectedOptions={selectedType ? [selectedType] : []}
                  value={selectedType ? formatTypeName(selectedType) : ''}
                  onOptionSelect={(_, d) => { if (d.optionValue) setPropertyType(prop.name, d.optionValue); }}
                >
                  {typeGroupTypes.map(t => (
                    <Option key={t} value={t} text={formatTypeName(t)}>{formatTypeName(t)}</Option>
                  ))}
                </Dropdown>
              </>
            )}
            <div className={styles.columnLabel}>Static value</div>
            {renderStaticEditor()}
          </>
        )}
      </div>
    );
  }

  // Fallback: input properties without entity data, or bound without entity data

  // For of-type-group properties without entity data: show Type picker + text input
  if (typeGroupTypes && typeGroupTypes.length > 0) {
    return (
      <div className={styles.field}>
        <div className={styles.label}>
          {prop.displayNameKey} {usageBadge}
          <span className={styles.typeHint}>{selectedType ? formatTypeName(selectedType) : prop.ofTypeGroup}</span>
        </div>
        <div className={styles.columnLabel}>Type</div>
        <Dropdown
          size="small"
          selectedOptions={selectedType ? [selectedType] : []}
          value={selectedType ? formatTypeName(selectedType) : ''}
          onOptionSelect={(_, d) => { if (d.optionValue) setPropertyType(prop.name, d.optionValue); }}
        >
          {typeGroupTypes.map(t => (
            <Option key={t} value={t} text={formatTypeName(t)}>{formatTypeName(t)}</Option>
          ))}
        </Dropdown>
        <div className={styles.columnLabel} style={{ marginTop: 6 }}>Value</div>
        <Input
          size="small"
          value={typeof value === 'string' ? value : (value != null ? String(value) : '')}
          onChange={handleTextChange}
          placeholder={prop.descriptionKey || prop.name}
        />
      </div>
    );
  }

  switch (prop.ofType) {
    case 'Lookup.Simple':
      return <LookupSimpleField value={value} onChange={(v) => setValue(prop.name, v)} prop={prop} usageBadge={usageBadge} styles={styles} />;
    case 'TwoOptions':
      return (
        <div className={styles.field}>
          <div className={styles.label}>
            {prop.displayNameKey} {usageBadge}
            <span className={styles.typeHint}>{prop.ofType}</span>
          </div>
          <Switch checked={value ?? false} onChange={handleSwitchChange} />
        </div>
      );

    case 'Whole.None':
    case 'FP':
    case 'Decimal':
    case 'Currency':
      return (
        <div className={styles.field}>
          <div className={styles.label}>
            {prop.displayNameKey} {usageBadge}
            <span className={styles.typeHint}>{prop.ofType}</span>
          </div>
          <SpinButton
            size="small"
            value={value ?? 0}
            onChange={handleNumberChange}
          />
        </div>
      );

    case 'Enum':
      if (prop.enumValues && prop.enumValues.length > 0) {
        const enumVal = typeof value === 'string' ? value : (value != null ? String(value) : '');
        return (
          <div className={styles.field}>
            <div className={styles.label}>
              {prop.displayNameKey} {usageBadge}
              <span className={styles.typeHint}>{prop.ofType}</span>
            </div>
            <Dropdown
              size="small"
              placeholder="Select an option"
              selectedOptions={enumVal ? [enumVal] : []}
              value={prop.enumValues.find(v => v.value === enumVal)?.displayNameKey ?? enumVal}
              onOptionSelect={(_, d) => setValue(prop.name, d.optionValue ?? null)}
            >
              {prop.enumValues.map(v => (
                <Option key={v.value} value={v.value} text={v.displayNameKey}>{v.displayNameKey}</Option>
              ))}
            </Dropdown>
          </div>
        );
      }
      // Fall through to default text input if no enum values defined
      return (
        <div className={styles.field}>
          <div className={styles.label}>
            {prop.displayNameKey} {usageBadge}
            <span className={styles.typeHint}>{prop.ofType}</span>
          </div>
          <Input
            size="small"
            value={typeof value === 'string' ? value : (value != null ? String(value) : '')}
            onChange={handleTextChange}
            placeholder={prop.descriptionKey || prop.name}
          />
        </div>
      );

    case 'Multiple':
      return (
        <div className={styles.field}>
          <div className={styles.label}>
            {prop.displayNameKey} {usageBadge}
            <span className={styles.typeHint}>{prop.ofType}</span>
          </div>
          <Textarea
            size="small"
            value={value ?? ''}
            onChange={handleTextChange}
            resize="vertical"
          />
        </div>
      );

    default:
      return (
        <div className={styles.field}>
          <div className={styles.label}>
            {prop.displayNameKey} {usageBadge}
            <span className={styles.typeHint}>{prop.ofType}</span>
          </div>
          <Input
            size="small"
            value={typeof value === 'string' ? value : (value != null ? String(value) : '')}
            onChange={handleTextChange}
            placeholder={prop.descriptionKey || prop.name}
          />
        </div>
      );
  }
}

/**
 * Lookup.Simple picker.
 *
 * Replaces the prior 3-stacked-text-input layout (raw GUID / Display Name /
 * Entity Type) with a single dropdown over the in-memory entity table. The
 * stored value shape is unchanged — `[{ id, name, entityType }]` — so the
 * context-factory shim and any scenarios persisted under the old shape keep
 * working.
 *
 * Falls back to the legacy manual inputs when the table is empty, with a
 * MessageBar hint so the user knows why the dropdown is missing.
 */
function LookupSimpleField({
  value, onChange, prop, usageBadge, styles,
}: {
  value: any;
  onChange: (v: any) => void;
  prop: ManifestProperty;
  usageBadge: React.ReactNode;
  styles: ReturnType<typeof useStyles>;
}) {
  // Re-fetch candidates whenever the data store changes — PropertyField
  // already subscribes to dataVersion so this re-runs reactively.
  const lookup = Array.isArray(value) && value[0] ? value[0] : null;
  // Best-effort entityType hint: if the current value carries one, prefer it.
  const preferredType = lookup?.entityType || undefined;
  const candidates = useMemo(() => getLookupCandidates(preferredType), [preferredType]);
  const [manualMode, setManualMode] = useState(false);

  const selectedKey = lookup
    ? (candidates.find(c => c.id === lookup.id && c.entityType === (lookup.entityType || c.entityType))
        ?? { id: lookup.id, name: lookup.name || lookup.id, entityType: lookup.entityType || '' })
    : null;
  const displayValue = selectedKey
    ? `${selectedKey.name}${selectedKey.entityType ? ` · ${selectedKey.entityType}` : ''}`
    : '';

  const handleSelect = useCallback((_: unknown, data: { optionValue?: string }) => {
    if (!data.optionValue || data.optionValue === '__none__') {
      onChange(null);
      return;
    }
    if (data.optionValue === '__manual__') {
      setManualMode(true);
      return;
    }
    const parsed = parseLookupOptionKey(data.optionValue);
    if (!parsed) return;
    const cand = candidates.find(c => c.id === parsed.id && c.entityType === parsed.entityType);
    if (cand) onChange([{ id: cand.id, name: cand.name, entityType: cand.entityType }]);
  }, [candidates, onChange]);

  // Manual entry (no candidates OR user toggled in) — keep the legacy 3-input
  // layout so partner controls that depend on bare-id semantics still work.
  if (manualMode || candidates.length === 0) {
    return (
      <div className={styles.field}>
        <div className={styles.label}>
          {prop.displayNameKey} {usageBadge}
          <span className={styles.typeHint}>{prop.ofType}</span>
        </div>
        {candidates.length === 0 && (
          <MessageBar intent="info" style={{ marginBottom: 6 }}>
            <MessageBarBody style={{ fontSize: 11 }}>
              No records in the in-memory data store — enter values manually or add records via the Data tab.
            </MessageBarBody>
          </MessageBar>
        )}
        <div className={styles.lookupGroup}>
          <Input
            size="small"
            placeholder="ID (GUID)"
            value={lookup?.id ?? ''}
            onChange={(_, d) => {
              if (!d.value) onChange(null);
              else onChange([{ id: d.value, name: lookup?.name ?? '', entityType: lookup?.entityType ?? '' }]);
            }}
          />
          <Input
            size="small"
            placeholder="Display Name"
            value={lookup?.name ?? ''}
            onChange={(_, d) => {
              if (lookup) onChange([{ ...lookup, name: d.value }]);
            }}
          />
          <Input
            size="small"
            placeholder="Entity Type"
            value={lookup?.entityType ?? ''}
            onChange={(_, d) => {
              if (lookup) onChange([{ ...lookup, entityType: d.value }]);
            }}
          />
          {candidates.length > 0 && (
            <Button size="small" appearance="subtle" onClick={() => setManualMode(false)}>
              Back to picker
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.field}>
      <div className={styles.label}>
        {prop.displayNameKey} {usageBadge}
        <span className={styles.typeHint}>{prop.ofType}</span>
      </div>
      <Dropdown
        size="small"
        placeholder="Pick a record…"
        selectedOptions={selectedKey ? [lookupOptionKey(selectedKey)] : []}
        value={displayValue}
        onOptionSelect={handleSelect}
      >
        <Option value="__none__" text="">— None —</Option>
        {candidates.map(c => {
          const key = lookupOptionKey(c);
          const label = `${c.name} · ${c.entityType}`;
          return <Option key={key} value={key} text={label}>{label}</Option>;
        })}
        <Option value="__manual__" text="Enter manually…">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Add16Regular /> Enter manually…
          </span>
        </Option>
      </Dropdown>
      {selectedKey && (
        <div className={styles.boundValue}>
          {selectedKey.id}
        </div>
      )}
    </div>
  );
}

interface Props {
  manifest: ManifestConfig;
}

export function PropertyEditor({ manifest }: Props) {
  const styles = useStyles();
  const pageEntityId = useHarnessStore(s => s.pageEntityId);
  const pageEntityTypeName = useHarnessStore(s => s.pageEntityTypeName);

  // Get columns for the selected entity type. The page context selectors
  // (entity type / id / record name) live on the Data tab — see PageContextBlock
  // in DataPanel.tsx. PropertyEditor still needs pageEntityTypeName so the
  // bound-property dropdowns can show the right column list.
  const entityColumns = useMemo(() => getEntityColumns(pageEntityTypeName), [pageEntityTypeName]);

  const boundProps = manifest.properties.filter(p => p.usage === 'bound');
  const inputProps = manifest.properties.filter(p => p.usage === 'input');

  return (
    <div className={styles.root}>
      <ControlInfoCard manifest={manifest} />

      <div
        className={styles.header}
        title="Properties — the manifest-declared inputs to the control. Bound properties read from a column on the host's record; input properties are static configuration the maker sets at design time. Edit values here to test how the control reacts to different inputs."
      >
        Properties
      </div>

      {boundProps.length > 0 && (
        <>
          <Label
            size="small"
            weight="semibold"
            style={{ opacity: 0.6 }}
            title="Bound properties — properties with usage='bound' in the manifest. Each binds to a column on the host record (e.g. a field PCF binds to the field it is attached to; a dataset PCF columns bind to view columns). Toggle 'Static value' to test with literal values without a record."
          >
            Bound Properties
          </Label>
          {boundProps.map(p => (
            <PropertyField
              key={p.name}
              prop={p}
              manifest={manifest}
              entityColumns={entityColumns}
              pageEntityTypeName={pageEntityTypeName}
              pageEntityId={pageEntityId}
            />
          ))}
        </>
      )}

      {inputProps.length > 0 && (
        <>
          <Divider style={{ margin: '8px 0' }} />
          <Label
            size="small"
            weight="semibold"
            style={{ opacity: 0.6 }}
            title="Input properties — properties with usage='input' in the manifest. These are read-only configuration values the maker sets at design time (labels, colours, behaviour flags). The control reads them via context.parameters.<name>.raw."
          >
            Input Properties
          </Label>
          {inputProps.map(p => (
            <PropertyField
              key={p.name}
              prop={p}
              manifest={manifest}
              entityColumns={entityColumns}
              pageEntityTypeName={pageEntityTypeName}
              pageEntityId={pageEntityId}
            />
          ))}
        </>
      )}
    </div>
  );
}
