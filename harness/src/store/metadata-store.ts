/**
 * Entity metadata store.
 *
 * Supports TWO formats:
 *
 * 1. Dataverse API format (raw response from EntityDefinitions endpoint):
 *    Save the response from:
 *    GET /api/data/v9.2/EntityDefinitions?$filter=LogicalName eq '{entity}'
 *        &$select=LogicalName,DisplayName
 *        &$expand=Attributes($select=LogicalName,DisplayName,AttributeType)
 *
 * 2. Simple format (hand-authored):
 *    { "entityName": { "displayName": "...", "columns": { "col": { "displayName": "...", "type": "..." } } } }
 *
 * The harness auto-detects the format and normalises to the simple format.
 */

export interface ColumnMetadata {
  displayName: string;
  type?: string;
  options?: Array<{ value: number; text: string }>;
  targets?: string[];
  defaultValue?: any;
}

export interface EntityMetadata {
  displayName: string;
  columns: Record<string, ColumnMetadata>;
}

let metadataStore: Record<string, EntityMetadata> = {};

/**
 * Load metadata, auto-detecting Dataverse API format vs simple format.
 */
export function loadMetadata(data: any): void {
  if (!data || typeof data !== 'object') return;

  // Detect Dataverse API format: has "value" array with Attributes
  if (Array.isArray(data.value) && data.value.length > 0 && data.value[0].Attributes) {
    parseDataverseFormat(data);
    return;
  }

  // Check if it's an array of Dataverse responses (multiple files merged)
  if (Array.isArray(data)) {
    for (const item of data) {
      if (item.value) {
        parseDataverseFormat(item);
      }
    }
    return;
  }

  // Simple format — use directly, but validate structure
  for (const [key, val] of Object.entries(data)) {
    const entity = val as any;
    if (entity.displayName && entity.columns) {
      metadataStore[key] = entity;
    } else if (entity.Attributes) {
      // Single entity in Dataverse format without the "value" wrapper
      parseDataverseEntity(entity);
    }
  }
}

function parseDataverseFormat(data: any): void {
  for (const entity of data.value) {
    parseDataverseEntity(entity);
  }
}

function parseDataverseEntity(entity: any): void {
  const logicalName = entity.LogicalName;
  if (!logicalName) return;

  const displayLabel = entity.DisplayName?.UserLocalizedLabel;
  const displayName = displayLabel?.Label ?? logicalName;

  const columns: Record<string, ColumnMetadata> = {};
  for (const attr of (entity.Attributes ?? [])) {
    const attrLogical = attr.LogicalName;
    const attrLabel = attr.DisplayName?.UserLocalizedLabel;
    // Fall back to logical name when no localized display label is present —
    // ensures hand-rolled metadata or columns missing a UserLocalizedLabel
    // still surface in form-store seeding.
    const col: ColumnMetadata = {
      displayName: attrLabel?.Label ?? attrLogical,
      type: attr.AttributeType,
    };
    // Picklist/State/Status options — works for inline OptionSet,
    // GlobalOptionSet, or simple { Options:[...] } shape.
    const os = attr.OptionSet ?? attr.GlobalOptionSet;
    if (os && Array.isArray(os.Options)) {
      const opts: Array<{ value: number; text: string }> = [];
      for (const o of os.Options) {
        if (o?.Value == null) continue;
        const lbl = o.Label?.UserLocalizedLabel?.Label
          ?? o.Label?.LocalizedLabels?.[0]?.Label
          ?? String(o.Value);
        opts.push({ value: Number(o.Value), text: lbl });
      }
      if (opts.length) col.options = opts;
    }
    // Lookup targets
    if (Array.isArray(attr.Targets) && attr.Targets.length) {
      col.targets = attr.Targets.slice();
    }
    // Default form value — picklists carry DefaultFormValue; other types
    // expose DefaultValue. Preserve so form-store can prefill Quick Create.
    if (attr.DefaultFormValue != null && attr.DefaultFormValue !== -1) {
      col.defaultValue = attr.DefaultFormValue;
    } else if (attr.DefaultValue != null) {
      col.defaultValue = attr.DefaultValue;
    }
    columns[attrLogical] = col;
  }

  metadataStore[logicalName] = { displayName, columns };
}

export function getEntityMetadata(entityType: string): EntityMetadata | null {
  return metadataStore[entityType] ?? null;
}

export function getColumnDisplayName(entityType: string, columnName: string): string | null {
  const entity = metadataStore[entityType];
  if (!entity) return null;
  return entity.columns[columnName]?.displayName ?? null;
}

export function getEntityDisplayName(entityType: string): string | null {
  return metadataStore[entityType]?.displayName ?? null;
}

/**
 * List every entity type currently loaded in the metadata store.
 * Used by form-store to pre-seed attributes/controls for all entities so
 * cross-entity getAttribute() lookups work (e.g. a child-grid PCF whose
 * page entity is the parent record but whose form targets a child entity).
 */
export function getAllEntityTypes(): string[] {
  return Object.keys(metadataStore);
}
