/**
 * No-AI scenario heuristic — shared by the harness UI ("Generate starter scenarios"
 * dialog + empty-state card) and the gallery validation scripts.
 *
 * Hard rules:
 *   - Caller chooses scenario count (clamped to [1, 20]; default 5). Never pad —
 *     if fewer interesting props exist than slots, emit fewer scenarios.
 *   - One axis of variation: PROPERTY VALUES across scenarios.
 *     Device / network / disabled flags are not a scenario — the harness toolbar
 *     already covers those.
 *
 * Slot assignment:
 *   1. Populated — name+type-smart defaults across every prop (the baseline)
 *   2..N. One single-prop toggle each — picks the top (N-1) most-interesting input props,
 *         in priority order: visual-impact enums (theme/mode/variant/layout/view/density/size)
 *         > booleans (flipped) > numeric "knobs" (set high) > other enums (alternate value).
 *         Each toggle modifies ONE prop relative to Populated, so the diff is obvious.
 *
 * The module is dependency-free (no React, no Zustand, no harness store) so the
 * Node build scripts can import it directly.
 */

import type { ManifestProperty, ManifestDataSet } from '../types/manifest';

/**
 * Shape emitted by `generateScenarios`. Aligned to the scenario-store v2
 * schema (`pageContext` / `network` / `device` rather than flat fields) so
 * callers can stamp `schemaVersion: 2` without losing data — rubber-duck
 * caught this: previously we emitted v1-shaped fields and the v2 normaliser
 * silently dropped them on the next reload, defeating per-record scenarios.
 *
 * `schemaVersion` is intentionally omitted — callers stamp it when promoting
 * to a `TestScenario` so this module stays free of the scenario-store import
 * cycle.
 */
export interface GeneratedScenario {
  name: string;
  description: string;
  savedAt: string;
  propertyValues: Record<string, any>;
  pageContext?: {
    entityId?: string;
    typeName?: string;
    recordName?: string;
  };
  network?: { mode?: 'online' | 'offline' | 'slow3g' | 'fast3g' | 'custom' };
  device?: { preset?: string };
  isControlDisabled?: boolean;
}

/**
 * Options for `generateScenarios`. `dataRecords` + `pageEntityHint` enable
 * per-record variation (Todo: heuristic-bound-prop-variation): if the control
 * has bound properties and the harness has mock data for the target entity,
 * we emit "Record: <primaryName>" scenarios that switch pageContext.entityId
 * AND set `propertyValues[boundProp] = "$column"` so the bound prop actually
 * resolves to the record's column value.
 */
export interface GenerateOptions {
  count?: number;
  now?: string;
  /** Map of entityType → records, typically from `getMockEntityDataSnapshot()`. */
  dataRecords?: Record<string, Record<string, any>[]>;
  /** Hint for which entity type the host record belongs to. */
  pageEntityHint?: { typeName?: string };
}

// ---------------------------------------------------------------------------
// Smart defaults — name-based hints win over generic type defaults
// ---------------------------------------------------------------------------

interface NameHint {
  match: RegExp;
  build: (propName: string) => any;
}

/** Hints applied to any string-flavoured prop (SingleLine.*, Multiple). */
const STRING_HINTS: NameHint[] = [
  // Color wins early and matches concatenated names too (no \b — catches `prioritycolor`, `bgcolor`, `fontColor`).
  // No `#` prefix — many PCF color inputs (e.g. MscrmControls.ColorPickerControl) expect the bare hex.
  { match: /colou?r/i,                                       build: () => '0078d4' },
  { match: /email/i,                                         build: () => 'jane.doe@example.com' },
  { match: /\b(phone|tel|mobile|fax)\b/i,                    build: () => '+1-555-0142' },
  { match: /\b(url|link|href|website|uri)\b/i,               build: () => 'https://example.com' },
  { match: /\b(firstname|first\s+name|givenname|given\s+name)\b/i,   build: () => 'Jane' },
  { match: /\b(lastname|last\s+name|surname|familyname|family\s+name)\b/i, build: () => 'Doe' },
  { match: /\b(fullname|full\s+name|displayname|display\s+name|username|user\s+name)\b/i, build: () => 'Jane Doe' },
  { match: /\b(company|organization|org|account)\b/i,        build: () => 'Contoso Ltd.' },
  { match: /\b(address|street)\b/i,                          build: () => '1 Microsoft Way' },
  { match: /\bcity\b/i,                                      build: () => 'Redmond' },
  { match: /\b(state|province|region)\b/i,                   build: () => 'WA' },
  { match: /\b(country|nation)\b/i,                          build: () => 'United States' },
  { match: /\b(zip|postal|postcode|post\s+code)\b/i,         build: () => '98052' },
  { match: /\b(desc|description|notes?|comment|message|body|summary|content)\b/i,
    build: n => `Sample ${humanize(n)} content for harness testing — multi-line text to exercise wrapping and overflow.` },
  { match: /\b(title|label|heading|caption|subject)\b/i,     build: n => `Sample ${humanize(n)}` },
  { match: /\b(icon|emoji|symbol)\b/i,                       build: () => '⭐' },
  { match: /background|foreground|accent|fill|stroke/i,      build: () => '0078d4' },
  { match: /\b(guid|uuid)\b/i,                               build: () => '11111111-1111-1111-1111-111111111111' },
  { match: /\b(lang|language|locale|culture)\b/i,            build: () => 'en-US' },
  { match: /\b(currency|cur)\b/i,                            build: () => 'USD' },
  { match: /\b(timezone|tz)\b/i,                             build: () => 'America/Los_Angeles' },
  { match: /\bjson\b/i,                                      build: () => '{"sample":"data","count":3}' },
  { match: /\b(html|markup|template)\b/i,                    build: () => '<p>Sample <strong>content</strong></p>' },
  { match: /\b(placeholder|prompt|hint)\b/i,                 build: () => 'Enter a value…' },
  { match: /\b(tag|tags|keyword|keywords)\b/i,               build: () => 'sample, demo, test' },
];

/** Hints applied to any numeric-flavoured prop (Whole.None, FP, Decimal, Currency). */
const NUMERIC_HINTS: NameHint[] = [
  { match: /\b(percent|progress|completion|ratio|opacity)\b/i, build: () => 50 },
  { match: /\b(lat|latitude)\b/i,                              build: () => 47.6062 },
  { match: /\b(lon|lng|longitude)\b/i,                         build: () => -122.3321 },
  { match: /\bzoom\b/i,                                        build: () => 12 },
  { match: /\b(width|w)\b/i,                                   build: () => 400 },
  { match: /\b(height|h)\b/i,                                  build: () => 300 },
  { match: /\b(fontsize|textsize)\b/i,                         build: () => 14 },
  { match: /\b(min|minimum)\b/i,                               build: () => 0 },
  { match: /\b(max|maximum|limit|cap)\b/i,                     build: () => 100 },
  { match: /\b(count|qty|quantity|rows|items|num|number|total|pagesize|per[_-]?page)\b/i, build: () => 10 },
  { match: /\b(page|pageindex|pagenumber)\b/i,                 build: () => 1 },
  { match: /\b(price|amount|cost|sum|fee|salary|revenue|budget)\b/i, build: () => 99.99 },
  { match: /\b(rating|stars|score|rank)\b/i,                   build: () => 4 },
  { match: /\byear\b/i,                                        build: () => new Date().getFullYear() },
  { match: /\bage\b/i,                                         build: () => 30 },
  { match: /\b(duration|seconds|ms|milliseconds|delay|timeout)\b/i, build: () => 1000 },
  { match: /\b(size|capacity)\b/i,                             build: () => 50 },
];

/** Visual-impact prop names — when these exist as enums we prefer them for scenario #5. */
const VISUAL_IMPACT_NAME = /\b(theme|mode|variant|layout|view|orientation|density|compact|appearance|style|kind|shape|skin|preset|size)\b/i;

/** Numeric "knob" names — prop where varying value is meaningful (vs. e.g. an opaque ID). */
const NUMERIC_KNOB_NAME = /\b(max|count|size|limit|page|rows|items|per[_-]?page|threshold|zoom|width|height|opacity|percent|fontsize|delay|timeout|capacity|min|num|total)\b/i;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate up to N well-chosen scenarios for a control given its manifest.
 *
 * @param options.count  Max scenarios to emit. Clamped to [1, 20]. Default 5.
 * @param options.now    ISO timestamp for `savedAt` (test override).
 *
 * Returns an empty array only if `properties` is empty AND `dataSets` is empty —
 * in that case there's literally nothing to vary.
 */
export function generateScenarios(
  properties: ManifestProperty[],
  dataSets: ManifestDataSet[],
  options: GenerateOptions = {},
): GeneratedScenario[] {
  const count = Math.max(1, Math.min(20, options.count ?? 5));
  const now = options.now ?? new Date().toISOString();

  if (properties.length === 0 && dataSets.length === 0) return [];

  const populated = buildPopulatedValues(properties);

  const boundProps = properties.filter(p => p.usage === 'bound');
  const hasBound = boundProps.length > 0;
  const hasDataSet = dataSets.length > 0;

  // Resolve the bound entity type — first explicit dataset, else the page
  // hint, else a generic placeholder so dataset-less bound controls still
  // get a non-empty pageContext.
  const entityTypeForBound =
    options.pageEntityHint?.typeName
    ?? (hasDataSet ? dataSets[0].name : undefined)
    ?? (hasBound ? 'entity' : undefined);

  const defaultEntityId = '11111111-1111-1111-1111-111111111111';
  const basePageContext = (hasBound || hasDataSet) && entityTypeForBound
    ? { entityId: defaultEntityId, typeName: entityTypeForBound }
    : undefined;

  const scenarios: GeneratedScenario[] = [];

  // ---- 1. Populated baseline ----
  scenarios.push({
    name: 'Populated',
    description: 'Sensible defaults across every property — the baseline you see on first load.',
    savedAt: now,
    propertyValues: populated,
    pageContext: basePageContext,
    network: { mode: 'online' },
    device: { preset: 'desktop' },
    isControlDisabled: false,
  });

  // ---- 2. Per-record variations (bound entity has real data) ----
  // Only when we have bound props AND mock records for the target entity. We
  // cap per-record scenarios to half the remaining slots so input toggles
  // still get a chance — interleaving keeps variety high.
  const remainingAfterPopulated = count - 1;
  const recordScenarios = buildPerRecordScenarios({
    properties,
    boundProps,
    entityType: entityTypeForBound,
    dataRecords: options.dataRecords,
    populated,
    limit: Math.ceil(remainingAfterPopulated / 2),
    now,
  });
  scenarios.push(...recordScenarios);

  // ---- 3..count. Single-prop toggles in priority order ----
  const togglesLimit = count - scenarios.length;
  const toggles = pickTopToggles(properties, populated, togglesLimit);
  for (const toggle of toggles) {
    scenarios.push({
      name: toggle.scenarioName,
      description: toggle.description,
      savedAt: now,
      propertyValues: { ...populated, [toggle.propName]: toggle.toggledValue },
      pageContext: basePageContext,
      network: { mode: 'online' },
      device: { preset: 'desktop' },
      isControlDisabled: false,
    });
  }

  return scenarios.slice(0, count);
}

// ---------------------------------------------------------------------------
// Per-record scenario builder
// ---------------------------------------------------------------------------

/** Pick the primary-name column from a record (best-effort, no metadata). */
function pickPrimaryName(record: Record<string, any>): string | undefined {
  const candidates = ['name', 'fullname', 'displayname', 'title', 'subject', 'description'];
  for (const key of candidates) {
    const v = record[key];
    if (typeof v === 'string' && v.trim().length > 0) return v;
  }
  // Fallback: first string-valued non-annotation, non-id field
  for (const [k, v] of Object.entries(record)) {
    if (k.includes('@') || k.toLowerCase().endsWith('id') || k === 'id') continue;
    if (typeof v === 'string' && v.trim().length > 0) return v;
  }
  return undefined;
}

function pickIdField(record: Record<string, any>): string | undefined {
  return Object.keys(record).find(k => k.toLowerCase().endsWith('id') || k === 'id');
}

interface BuildPerRecordArgs {
  properties: ManifestProperty[];
  boundProps: ManifestProperty[];
  entityType: string | undefined;
  dataRecords: Record<string, Record<string, any>[]> | undefined;
  populated: Record<string, any>;
  limit: number;
  now: string;
}

function buildPerRecordScenarios(args: BuildPerRecordArgs): GeneratedScenario[] {
  const { boundProps, entityType, dataRecords, populated, limit, now } = args;
  if (limit <= 0 || !entityType || !dataRecords || boundProps.length === 0) return [];

  const records = dataRecords[entityType];
  if (!records || records.length === 0) return [];

  const out: GeneratedScenario[] = [];
  const used = new Set<string>();
  const takenNames = new Set<string>();

  for (const record of records) {
    if (out.length >= limit) break;
    const idField = pickIdField(record);
    if (!idField) continue;
    const id = String(record[idField]);
    if (!id || used.has(id)) continue;
    used.add(id);

    const primary = pickPrimaryName(record) ?? `record ${out.length + 1}`;
    let name = `Record: ${primary}`;
    // Ensure uniqueness within the batch.
    let suffix = 2;
    while (takenNames.has(name)) {
      name = `Record: ${primary} (${suffix++})`;
    }
    takenNames.add(name);

    // For each bound prop, set propertyValues[prop] = "$column" so the
    // bound-resolution path in context-factory picks the value off this
    // record. We use the prop name as the column hint (matches the common
    // Dataverse convention where the field PCF is attached to a column of
    // the same logical name); fall back to leaving the literal default.
    const propertyValues: Record<string, any> = { ...populated };
    for (const bp of boundProps) {
      // Prefer an exact column match; else try lower-cased; else leave the
      // populated literal so the prop still has a value.
      if (Object.prototype.hasOwnProperty.call(record, bp.name)) {
        propertyValues[bp.name] = `$${bp.name}`;
      } else {
        const lower = bp.name.toLowerCase();
        const col = Object.keys(record).find(k => k.toLowerCase() === lower);
        if (col) propertyValues[bp.name] = `$${col}`;
      }
    }

    out.push({
      name,
      description: `Bound to record "${primary}" (id ${id.slice(0, 8)}…). Bound properties resolve from the record's columns.`,
      savedAt: now,
      propertyValues,
      pageContext: { entityId: id, typeName: entityType, recordName: primary },
      network: { mode: 'online' },
      device: { preset: 'desktop' },
      isControlDisabled: false,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Value builders
// ---------------------------------------------------------------------------

function buildPopulatedValues(properties: ManifestProperty[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const prop of properties) out[prop.name] = defaultValueFor(prop);
  return out;
}

/**
 * Smart default-value picker for a single property.
 * Priority: declared `defaultValue` > first `enumValue` > name-hint > generic type default.
 */
export function defaultValueFor(prop: ManifestProperty): any {
  if (prop.defaultValue != null && prop.defaultValue !== '') {
    return coerceToType(prop.defaultValue, prop.ofType);
  }

  if (prop.enumValues && prop.enumValues.length > 0) {
    return coerceToType(prop.enumValues[0].value, prop.ofType);
  }

  const name = prop.name;

  switch (prop.ofType) {
    case 'Lookup.Simple':
      return [{
        id: '11111111-1111-1111-1111-000000000001',
        name: `Sample ${humanize(name)}`,
        entityType: name.toLowerCase(),
      }];

    case 'TwoOptions':
      return false;

    case 'Whole.None':
      return matchHint(NUMERIC_HINTS, name) ?? 0;

    case 'FP':
    case 'Decimal':
      return matchHint(NUMERIC_HINTS, name) ?? 0;

    case 'Currency':
      return matchHint(NUMERIC_HINTS, name) ?? 100.0;

    case 'DateAndTime.DateOnly':
      return new Date().toISOString().split('T')[0];
    case 'DateAndTime.DateAndTime':
      return new Date().toISOString();

    case 'OptionSet':
    case 'MultiSelectOptionSet':
      // No enumValues declared; pick a benign 1 (most option sets start at 1)
      return 1;

    case 'Multiple':
      return matchHint(STRING_HINTS, name) ?? `Sample ${humanize(name)} content\nLine 2\nLine 3`;

    // SingleLine.Text, SingleLine.Email, SingleLine.URL, SingleLine.Phone, SingleLine.Ticker, etc.
    default:
      if (prop.ofType.startsWith('SingleLine.Email')) return 'jane.doe@example.com';
      if (prop.ofType.startsWith('SingleLine.URL'))   return 'https://example.com';
      if (prop.ofType.startsWith('SingleLine.Phone')) return '+1-555-0142';
      return matchHint(STRING_HINTS, name) ?? `Sample ${humanize(name)}`;
  }
}

// ---------------------------------------------------------------------------
// Toggle picker — emits up to N distinct single-prop variations from Populated.
// Priority across ALL properties:
//   1. Visual-impact enums (theme/mode/variant/layout/view/density/size) — each gets a slot
//   2. Booleans — each gets a slot (flipped)
//   3. Numeric knobs (max/count/size/limit/page/etc.) — each gets a slot (high value)
//   4. Any other enum with ≥2 values — each gets a slot (alternate value)
// Each prop appears at most once. If fewer than `limit` interesting props exist,
// fewer scenarios are returned (no padding).
// ---------------------------------------------------------------------------

interface ToggleChoice {
  propName: string;
  toggledValue: any;
  scenarioName: string;
  description: string;
}

export function pickTopToggles(
  properties: ManifestProperty[],
  populated: Record<string, any>,
  limit: number,
): ToggleChoice[] {
  const inputs = properties.filter(p => p.usage === 'input');
  const used = new Set<string>();
  const out: ToggleChoice[] = [];

  const push = (choice: ToggleChoice | null) => {
    if (!choice || used.has(choice.propName) || out.length >= limit) return;
    used.add(choice.propName);
    out.push(choice);
  };

  // Tier 1: visual-impact enums (theme/mode/variant/layout/view/density/size)
  for (const p of inputs) {
    if (out.length >= limit) break;
    if (used.has(p.name)) continue;
    if (VISUAL_IMPACT_NAME.test(normalizeName(p.name)) && p.enumValues && p.enumValues.length >= 2) {
      const alt = alternateEnumValue(p.enumValues, populated[p.name]);
      push({
        propName: p.name,
        toggledValue: coerceToType(alt.value, p.ofType),
        scenarioName: `${humanize(p.name)}: ${alt.name}`,
        description: `Varies the ${p.name} prop to "${alt.name}" — high-impact toggle because this controls visual mode.`,
      });
    }
  }

  // Tier 2: booleans (flip)
  for (const p of inputs) {
    if (out.length >= limit) break;
    if (used.has(p.name)) continue;
    if (p.ofType === 'TwoOptions') {
      const current = !!populated[p.name];
      push({
        propName: p.name,
        toggledValue: !current,
        scenarioName: `${humanize(p.name)}: ${!current}`,
        description: `Flips the ${p.name} boolean. Tests both branches of any conditional rendering keyed on it.`,
      });
    }
  }

  // Tier 3: numeric "knobs" by name
  for (const p of inputs) {
    if (out.length >= limit) break;
    if (used.has(p.name)) continue;
    if (
      NUMERIC_KNOB_NAME.test(normalizeName(p.name)) &&
      (p.ofType === 'Whole.None' || p.ofType === 'FP' || p.ofType === 'Decimal' || p.ofType === 'Currency')
    ) {
      let high = pickHighValue(p);
      const current = populated[p.name];
      // Ensure the toggle actually differs from Populated (e.g. when "max"-named
      // props already default to 100, bump the stress value higher).
      if (typeof current === 'number' && current === high) high = high * 5;
      push({
        propName: p.name,
        toggledValue: high,
        scenarioName: `${humanize(p.name)}: ${high}`,
        description: `Sets ${p.name} to a high value (${high}) to exercise scale/overflow handling.`,
      });
    }
  }

  // Tier 4: any other enum (≥2 values)
  for (const p of inputs) {
    if (out.length >= limit) break;
    if (used.has(p.name)) continue;
    if (p.enumValues && p.enumValues.length >= 2) {
      const alt = alternateEnumValue(p.enumValues, populated[p.name]);
      push({
        propName: p.name,
        toggledValue: coerceToType(alt.value, p.ofType),
        scenarioName: `${humanize(p.name)}: ${alt.name}`,
        description: `Switches ${p.name} to its alternate value "${alt.name}".`,
      });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function matchHint(hints: NameHint[], propName: string): any {
  // Normalize so word-boundary regexes match camelCase + snake_case + kebab-case + prefixed Dataverse names.
  // "priorityColor" → "priority color"; "msdyn_priority_color" → "msdyn priority color"; "BG-Color" → "bg color".
  const normalized = normalizeName(propName);
  for (const h of hints) {
    if (h.match.test(normalized)) return h.build(propName);
  }
  return undefined;
}

/** Split camelCase / snake_case / kebab-case into space-separated lowercase tokens. */
function normalizeName(name: string): string {
  return name
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')   // camelCase → camel Case
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // XMLParser → XML Parser
    .replace(/[_\-]+/g, ' ')                  // snake_case / kebab-case → spaces
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function alternateEnumValue(values: { name: string; value: string }[], current: any): { name: string; value: string } {
  const currentStr = String(current);
  return values.find(v => String(v.value) !== currentStr) ?? values[values.length - 1];
}

function pickHighValue(prop: ManifestProperty): number {
  // Use 100 as a sensible "stress" value for most knobs, except width/height which want pixels.
  const n = normalizeName(prop.name);
  if (/width|height/.test(n)) return 800;
  if (/zoom/.test(n)) return 18;
  if (/\bpage\b/.test(n) && !/size/.test(n)) return 5;
  return 100;
}

function coerceToType(rawValue: string, ofType: string): any {
  if (ofType === 'TwoOptions') {
    return rawValue === 'true' || rawValue === '1';
  }
  if (
    ofType === 'Whole.None' ||
    ofType === 'OptionSet' ||
    ofType === 'MultiSelectOptionSet'
  ) {
    const n = parseInt(rawValue, 10);
    return Number.isNaN(n) ? rawValue : n;
  }
  if (ofType === 'FP' || ofType === 'Decimal' || ofType === 'Currency') {
    const n = parseFloat(rawValue);
    return Number.isNaN(n) ? rawValue : n;
  }
  return rawValue;
}

/** "firstName" → "First Name"; "place_holder" → "Place Holder"; "URL" → "URL". */
function humanize(name: string): string {
  return name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b([a-z])/g, m => m.toUpperCase())
    .trim();
}
