/**
 * Heuristic auto-derivation of `columnBindings` when adopting a live view.
 *
 * Real UCI makers configure property-set bindings at form-binding time —
 * each manifest property-set (e.g. "Product") maps to a real Dataverse
 * field (e.g. `msdyn_product` / `_msdyn_product_value`). The workbench's
 * BindingCard surfaces the same control via `binding.columnBindings`.
 *
 * When the maker adopts a live system/personal view, the view's FetchXML
 * lists the Dataverse field names. We try to match each manifest
 * property-set to a view column by:
 *
 *   1. Exact case-insensitive name match
 *   2. Prefix-stripped match (drop `msdyn_`, `new_`, `<orgpfx>_`)
 *   3. Suffix-stripped match (drop trailing `id` / `_value`)
 *   4. Substring match — view column contains the property-set name
 *      (lowercased, prefix-stripped on both sides)
 *
 * For `Lookup.*` property-sets, the actual row key in OData responses
 * is `_<field>_value` — so the bound `field` is written in that shape.
 * For everything else the raw view column name is used.
 *
 * Returns ONLY the keys we inferred — existing entries on the binding
 * win, and unmapped property-sets are left unbound (BindingCard surfaces
 * them as "unbound" for the maker to fix).
 */

import type { ManifestProperty } from '../types/manifest';
import type { ViewDefinition } from '../types/dataset-binding';

const KNOWN_PREFIXES = ['msdyn_', 'msft_', 'msdy_', 'mscrm_', 'mspp_'];

function stripPrefix(s: string): string {
  const lower = s.toLowerCase();
  for (const pfx of KNOWN_PREFIXES) {
    if (lower.startsWith(pfx)) return lower.slice(pfx.length);
  }
  // Strip any generic publisher prefix `<word>_` only if it's 2-8 chars
  // followed by `_` (e.g. `new_`, `cr123_`). Avoid stripping legit field
  // names that happen to contain `_`.
  const m = /^([a-z][a-z0-9]{1,7})_(.+)$/.exec(lower);
  if (m) return m[2];
  return lower;
}

function stripSuffix(s: string): string {
  if (s.endsWith('_value')) return s.slice(0, -'_value'.length);
  if (s.endsWith('id')) return s.slice(0, -2);
  return s;
}

function normaliseToken(s: string): string {
  return stripSuffix(stripPrefix(s)).replace(/[_\s]+/g, '');
}

function isLookupType(ofType?: string): boolean {
  if (!ofType) return false;
  return ofType.toLowerCase().startsWith('lookup');
}

export interface AutoDerivedBindings {
  bindings: Record<string, { field: string; ofType?: string }>;
  matched: string[]; // property-set names that got a mapping
  unmatched: string[]; // property-set names with no view-column match
}

/**
 * Build a best-effort `columnBindings` map from the manifest's property-sets
 * and the resolved view's column list.
 */
export function deriveColumnBindings(
  columns: ManifestProperty[],
  viewColumns: Array<{ name: string }>,
  existing?: Record<string, { field: string; ofType?: string }>,
): AutoDerivedBindings {
  const out: Record<string, { field: string; ofType?: string }> = { ...(existing ?? {}) };
  const matched: string[] = [];
  const unmatched: string[] = [];

  // Pre-compute view-column lookup tables.
  const byExact = new Map<string, string>();        // lowercase → original
  const byNormalised = new Map<string, string>();   // normalised → original
  const bySubstring: Array<{ token: string; original: string }> = [];
  for (const vc of viewColumns) {
    byExact.set(vc.name.toLowerCase(), vc.name);
    const tok = normaliseToken(vc.name);
    if (tok && !byNormalised.has(tok)) byNormalised.set(tok, vc.name);
    bySubstring.push({ token: tok, original: vc.name });
  }

  for (const col of columns) {
    // Don't override an existing user-set binding.
    if (existing && existing[col.name]?.field) {
      matched.push(col.name);
      continue;
    }

    const psName = col.name;
    const psLower = psName.toLowerCase();
    const psNorm = normaliseToken(psName);

    let viewField: string | undefined;

    // 1. Exact case-insensitive match.
    viewField = byExact.get(psLower);

    // 2. Normalised (prefix+suffix stripped) match.
    if (!viewField && psNorm) viewField = byNormalised.get(psNorm);

    // 3. Substring match (one side contains the other).
    if (!viewField && psNorm) {
      const candidate = bySubstring.find(s =>
        s.token && (s.token === psNorm || s.token.includes(psNorm) || psNorm.includes(s.token)),
      );
      if (candidate) viewField = candidate.original;
    }

    if (!viewField) {
      unmatched.push(psName);
      continue;
    }

    // For lookup property-sets, OData rows expose the FK as `_<field>_value`.
    // Write that shape into the binding so getValue() reads the right key
    // first (the shim already falls back to underscore-value variants, but
    // making it explicit avoids surprises and shows in the UI).
    const bindField = isLookupType(col.ofType) && !viewField.startsWith('_')
      ? `_${viewField}_value`
      : viewField;

    out[psName] = { field: bindField };
    matched.push(psName);
  }

  return { bindings: out, matched, unmatched };
}
