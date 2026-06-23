import type { HarnessStore } from '../store/harness-store';

/** RESX strings bucketed by LCID. Bucket 0 holds strings from RESX files
 *  whose filename had no recognizable LCID stem (treated as "default"). */
let resxByLcid: Record<number, Record<string, string>> = {};

/** Load RESX strings parsed at build time, bucketed by LCID. */
export function setResxStrings(strings: Record<number, Record<string, string>>): void {
  resxByLcid = strings;
}

/** Module-level lookup helper — same fallback chain as the shim's getString
 *  (active LCID → 1033 → bucket 0 → any bucket → bare key). Exposed so other
 *  shims (dataset columns, formContext) can resolve display-name-keys without
 *  pulling in the full resources shim factory. */
export function lookupResxString(id: string, lcid: number): string {
  const tryBucket = (l: number) => resxByLcid[l]?.[id];
  const hit = tryBucket(lcid)
    ?? tryBucket(1033)
    ?? tryBucket(0)
    ?? (() => {
      for (const l of Object.keys(resxByLcid).map(Number)) {
        const v = resxByLcid[l]?.[id];
        if (v !== undefined) return v;
      }
      return undefined;
    })();
  return hit ?? id;
}

/** List of LCIDs that have at least one string loaded. Used by the harness UI
 *  to indicate which locales are actually localized for the current control. */
export function getLoadedResxLcids(): number[] {
  return Object.keys(resxByLcid).map(Number).filter(l => Object.keys(resxByLcid[l] ?? {}).length > 0);
}

/** Cache of preloaded resource base64 data */
const resourceCache: Record<string, string> = {};
let preloadDone = false;

/**
 * Preload all image/font resources from the bundle directory.
 * Fetches a resource list from the server and caches them as base64.
 * Call this before the control loads so getResource returns from cache instantly.
 */
export async function preloadBundleResources(): Promise<void> {
  if (preloadDone) return;
  preloadDone = true;

  try {
    const resp = await fetch('/api/bundle-resources');
    if (!resp.ok) return;
    const files: string[] = await resp.json();

    // Fetch all resources in parallel
    await Promise.all(files.map(file => fetchAndCache(file)));
    console.log(`[pcf-workbench] Preloaded ${Object.keys(resourceCache).length} resources`);
  } catch {
    // Non-fatal — resources will be fetched on demand
  }
}

/** Fetch a resource and cache it */
async function fetchAndCache(id: string): Promise<string | null> {
  const candidates = [
    `/pcf-bundle/${id}`,
    `/pcf-bundle/images/${id}`,
    `/pcf-bundle/strings/${id}`,
    `/pcf-bundle/fonts/${id}`,
  ];

  for (const url of candidates) {
    try {
      const r = await fetch(url);
      const ct = r.headers.get('content-type') || '';
      if (!r.ok || ct.includes('text/html')) continue;
      const blob = await r.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      resourceCache[id] = base64;
      return base64;
    } catch {
      continue;
    }
  }
  return null;
}

export function createResourcesShim(getState: () => HarnessStore) {
  // Snapshot the strings bucket for the active locale (with the same fallback
  // chain as getString). Recomputed on each access so a future setResxStrings()
  // call surfaces immediately.
  const buildStringsBag = (): Record<string, string> => {
    const lcid = getState().userLanguageId;
    return {
      ...(resxByLcid[0] ?? {}),
      ...(resxByLcid[1033] ?? {}),
      ...(resxByLcid[lcid] ?? {}),
    };
  };

  return {
    /**
     * UNDOCUMENTED — internal field exposed by UCI's resources bag, NOT in
     * @types/powerapps-component-framework. Several internal MscrmControls
     * (e.g. Field Service InspectionControls.SurveyControl) read
     * `context.resources._bagPropsResource.strings` directly to seed the
     * SurveyJS localization dictionary. Exposing it here so those bundles
     * can load in the harness; do NOT rely on this in partner/ISV controls.
     */
    get _bagPropsResource() {
      return { strings: buildStringsBag() };
    },
    getResource(id: string, success: (data: string) => void, failure: (err?: any) => void): void {
      // Return from cache SYNCHRONOUSLY — the callback fires immediately
      // so setState happens during componentDidMount before any re-render
      if (resourceCache[id]) {
        console.log(`[pcf-workbench] getResource('${id}') CACHE HIT (${resourceCache[id].length} chars) — calling success synchronously`);
        try {
          success(resourceCache[id]);
          console.log(`[pcf-workbench] getResource('${id}') success callback returned`);
        } catch (e) {
          console.error(`[pcf-workbench] getResource('${id}') success callback THREW:`, e);
        }
        return;
      }
      console.warn(`[pcf-workbench] getResource('${id}') CACHE MISS — fetching async`);

      // Fallback: fetch async (unlikely if preloadBundleResources ran)
      fetchAndCache(id).then(base64 => {
        if (base64) {
          success(base64);
        } else {
          console.warn(`[pcf-workbench] getResource('${id}') — not found`);
          failure();
        }
      });
    },
    getString(id: string): string {
      // Lookup priority: current userLanguageId → 1033 (en-US) → bucket 0
      // (default / no LCID detected) → first available bucket → bare key.
      return lookupResxString(id, getState().userLanguageId);
    },
  };
}
