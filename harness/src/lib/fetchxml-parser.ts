/**
 * Pure FetchXML → ViewDefinition fragment parser.
 *
 * The Dataverse Web API returns system views (`savedquery`) and personal
 * views (`userquery`) with a `fetchxml` field containing an XML query like:
 *
 *   <fetch version="1.0" output-format="xml-platform" mapping="logical">
 *     <entity name="account">
 *       <attribute name="name" />
 *       <attribute name="telephone1" />
 *       <order attribute="name" descending="false" />
 *       <filter type="and">
 *         <condition attribute="statecode" operator="eq" value="0" />
 *       </filter>
 *     </entity>
 *   </fetch>
 *
 * We only consume the slice needed to drive the harness's `ViewDefinition`:
 *   - entity name → ViewDefinition.entityType
 *   - top-level <attribute name="..."> elements → ViewColumn[]
 *   - top-level <order attribute="..." descending="..."> → sortDirection
 *
 * Filters / link-entities / aggregates are parsed best-effort into a passthrough
 * shape so the live fetcher can still hand the raw XML to Web API for execution.
 *
 * The parser is deliberately tolerant: it never throws on malformed input —
 * a return of { entityName: '', attributes: [] } means "couldn't make sense
 * of this", and the caller falls back to synthesised columns.
 *
 * Uses `fast-xml-parser` (already a workbench dep via manifest-parser) so the
 * module works identically in browser and node — no DOMParser dependency, no
 * happy-dom test environment needed.
 */

import { XMLParser } from 'fast-xml-parser';

export interface ParsedFetchXml {
  /** Logical name of the primary `<entity>` in the fetch. Empty when missing. */
  entityName: string;

  /** Column names from top-level `<attribute name="...">` elements, in document order. */
  attributes: string[];

  /** Sort orders from top-level `<order>` elements, in document order. */
  orders: ParsedOrder[];

  /** Best-effort flat list of `<condition>` predicates from top-level `<filter>` elements. */
  conditions: ParsedCondition[];

  /** Whether the fetch contains `<link-entity>` joins. Pure flag — we don't
   *  attempt to flatten linked attributes into the column list. */
  hasLinks: boolean;

  /** Whether the fetch sets `aggregate="true"` on the root. Aggregated views
   *  are a UCI feature the harness mock branch can't replay; the picker can
   *  still surface them with a warning badge. */
  isAggregate: boolean;
}

export interface ParsedOrder {
  attribute: string;
  descending: boolean;
}

export interface ParsedCondition {
  attribute: string;
  operator: string;
  value?: string;
}

const EMPTY: ParsedFetchXml = Object.freeze({
  entityName: '',
  attributes: [],
  orders: [],
  conditions: [],
  hasLinks: false,
  isAggregate: false,
}) as ParsedFetchXml;

// `attribute`, `order`, `link-entity`, `filter`, `condition` are always
// treated as arrays so a single child still arrives as a one-element list.
// `entity` stays scalar — multiple <entity> roots aren't valid FetchXML.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) =>
    ['attribute', 'order', 'link-entity', 'filter', 'condition'].includes(name),
});

/**
 * Parse a FetchXML string into a `ParsedFetchXml`. Returns the EMPTY shape
 * when the input is not parseable. Never throws.
 */
export function parseFetchXml(xml: string | null | undefined): ParsedFetchXml {
  if (!xml || typeof xml !== 'string') return EMPTY;
  const trimmed = xml.trim();
  if (!trimmed.startsWith('<')) return EMPTY;

  let parsed: any;
  try {
    parsed = parser.parse(trimmed);
  } catch {
    return EMPTY;
  }

  const fetchEl = parsed?.fetch;
  if (!fetchEl || typeof fetchEl !== 'object') return EMPTY;

  const isAggregate = fetchEl['@_aggregate'] === 'true';

  const entityEl = fetchEl.entity;
  if (!entityEl || typeof entityEl !== 'object') {
    return { ...EMPTY, isAggregate };
  }

  const entityName = entityEl['@_name'] ?? '';

  const attributes: string[] = [];
  for (const a of (entityEl.attribute ?? [])) {
    const n = a?.['@_name'];
    if (n) attributes.push(String(n));
  }

  const orders: ParsedOrder[] = [];
  for (const o of (entityEl.order ?? [])) {
    const a = o?.['@_attribute'];
    if (a) {
      orders.push({
        attribute: String(a),
        descending: o['@_descending'] === 'true',
      });
    }
  }

  const conditions: ParsedCondition[] = [];
  for (const f of (entityEl.filter ?? [])) {
    for (const c of (f?.condition ?? [])) {
      const a = c?.['@_attribute'];
      const op = c?.['@_operator'];
      if (a && op) {
        const v = c['@_value'];
        conditions.push({
          attribute: String(a),
          operator: String(op),
          ...(v != null ? { value: String(v) } : {}),
        });
      }
    }
  }

  const hasLinks = Array.isArray(entityEl['link-entity']) && entityEl['link-entity'].length > 0;

  return { entityName: String(entityName), attributes, orders, conditions, hasLinks, isAggregate };
}

/**
 * Convenience: assemble a `ViewDefinition`-friendly fragment from parsed
 * FetchXML. The caller still owns viewId / displayName / viewType — those
 * come from the savedquery / userquery record fields, not from the XML.
 */
export function fetchXmlToViewFragment(xml: string | null | undefined): {
  entityType: string;
  columns: Array<{ name: string; sortDirection?: 'asc' | 'desc' }>;
  isAggregate: boolean;
  hasLinks: boolean;
} {
  const parsed = parseFetchXml(xml);
  // Map orders by attribute so a column carries its sort direction inline.
  const sortByCol = new Map<string, 'asc' | 'desc'>();
  for (const o of parsed.orders) {
    sortByCol.set(o.attribute, o.descending ? 'desc' : 'asc');
  }
  return {
    entityType: parsed.entityName,
    columns: parsed.attributes.map(name => {
      const dir = sortByCol.get(name);
      return dir ? { name, sortDirection: dir } : { name };
    }),
    isAggregate: parsed.isAggregate,
    hasLinks: parsed.hasLinks,
  };
}

