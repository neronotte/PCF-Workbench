/**
 * Rebase dates in data.json records so they appear as "today".
 *
 * Walks every value in the data object looking for ISO-8601 date strings.
 * Calculates the offset between the most common date in the data and today,
 * then shifts all dates by that offset (preserving time-of-day).
 *
 * Returns a new object — the original is not mutated.
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const US_DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s/;

/** Extract just the date portion (YYYY-MM-DD) from an ISO string */
function isoDatePart(val: string): string | null {
  const m = val.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/**
 * Scan all string values in the data and find the most frequently occurring date.
 * This is the "anchor" date we'll rebase from.
 */
function findAnchorDate(data: Record<string, any[]>): string | null {
  const freq: Record<string, number> = {};

  function scan(val: any) {
    if (typeof val === 'string') {
      const dp = isoDatePart(val);
      if (dp) freq[dp] = (freq[dp] || 0) + 1;
      // Also check US-format dates like "4/28/2026 8:00"
      const usm = val.match(US_DATE_RE);
      if (usm) {
        const y = usm[3];
        const m = usm[1].padStart(2, '0');
        const d = usm[2].padStart(2, '0');
        const key = `${y}-${m}-${d}`;
        freq[key] = (freq[key] || 0) + 1;
      }
    } else if (Array.isArray(val)) {
      val.forEach(scan);
    } else if (val && typeof val === 'object') {
      Object.values(val).forEach(scan);
    }
  }

  Object.values(data).forEach(scan);

  let best: string | null = null;
  let bestCount = 0;
  for (const [date, count] of Object.entries(freq)) {
    if (count > bestCount) { best = date; bestCount = count; }
  }
  return best;
}

/**
 * Rebase all dates in the data so the anchor date becomes today.
 */
export function rebaseDatesToToday(data: Record<string, any[]>): Record<string, any[]> {
  const anchor = findAnchorDate(data);
  if (!anchor) return data; // no dates found

  const anchorMs = new Date(anchor + 'T00:00:00Z').getTime();
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayMs = new Date(todayStr + 'T00:00:00Z').getTime();
  const offsetMs = todayMs - anchorMs;

  if (offsetMs === 0) return data; // already today

  console.log(`[pcf-workbench] Rebasing dates: ${anchor} → ${todayStr} (offset: ${Math.round(offsetMs / 86400000)} days)`);

  function shiftValue(val: any): any {
    if (typeof val === 'string') {
      // ISO dates
      if (ISO_DATE_RE.test(val)) {
        const d = new Date(val);
        if (!isNaN(d.getTime())) {
          d.setTime(d.getTime() + offsetMs);
          return d.toISOString().replace('.000Z', 'Z');
        }
      }
      // US-format dates like "4/28/2026 8:00"
      const usm = val.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s(.+)$/);
      if (usm) {
        const d = new Date(`${usm[3]}-${usm[1].padStart(2, '0')}-${usm[2].padStart(2, '0')}T00:00:00Z`);
        if (!isNaN(d.getTime())) {
          d.setTime(d.getTime() + offsetMs);
          return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()} ${usm[4]}`;
        }
      }
      return val;
    }
    if (Array.isArray(val)) return val.map(shiftValue);
    if (val && typeof val === 'object') {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(val)) {
        out[k] = shiftValue(v);
      }
      return out;
    }
    return val;
  }

  const result: Record<string, any[]> = {};
  for (const [table, records] of Object.entries(data)) {
    result[table] = shiftValue(records);
  }
  return result;
}
