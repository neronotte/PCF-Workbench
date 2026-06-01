/**
 * Live-mode block — single source of truth for "is live Dataverse access
 * allowed in this session?".
 *
 * Live access is blocked when ANY of these are true:
 *   - URL has `?live=block` (or `&live=block`)
 *   - `window.__PCF_WORKBENCH_BLOCK_LIVE__ === true` (set by the loop CLI
 *     before page navigation, so headless / CI / AI runs never touch a real
 *     org even if a scenario or localStorage carries `dataSource: 'live'`)
 *
 * Read this flag from `setDataSource`, scenario apply, and the data-source
 * radio so the guarantee holds at every entry point.
 */

declare global {
  interface Window {
    __PCF_WORKBENCH_BLOCK_LIVE__?: boolean;
  }
}

let cached: boolean | null = null;

export function isLiveBlocked(): boolean {
  if (cached !== null) return cached;
  if (typeof window === 'undefined') {
    cached = false;
    return cached;
  }
  let blocked = false;
  try {
    if (window.__PCF_WORKBENCH_BLOCK_LIVE__ === true) blocked = true;
  } catch { /* ignore */ }
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('live') === 'block') blocked = true;
  } catch { /* ignore */ }
  cached = blocked;
  return cached;
}

/** For tests — clears the cached value so the next read re-evaluates. */
export function __resetLiveBlockCache(): void {
  cached = null;
}

export function liveBlockReason(): string {
  if (typeof window === 'undefined') return '';
  try {
    if (window.__PCF_WORKBENCH_BLOCK_LIVE__ === true) {
      return 'Live mode is blocked by the harness CLI (headless / loop run).';
    }
  } catch { /* ignore */ }
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('live') === 'block') {
      return 'Live mode is blocked by ?live=block in the URL.';
    }
  } catch { /* ignore */ }
  return '';
}
