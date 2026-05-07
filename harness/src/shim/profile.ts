/**
 * Versioned shim profile feature flags (M1).
 *
 * Each flag answers: "is this API surface available on the chosen Dataverse
 * version?". Shims read these via `isFeatureAvailable(getState, 'flag')` and
 * either expose / omit a member or throw the same error the real platform
 * would.
 *
 * Keep flags small and intention-revealing — one per behavioural change,
 * not per method. New gates should land here with a comment citing the
 * Microsoft Learn doc that introduced or removed the surface.
 */

import type { HarnessStore, ShimProfile } from '../store/harness-store';

export type FeatureFlag =
  // Xrm.App.sidePanes — shipped with Wave 2 2021 (9.2 minimum).
  // https://learn.microsoft.com/power-apps/developer/model-driven-apps/clientapi/reference/xrm-app/sidepanes
  | 'xrm.app.sidePanes'
  // Xrm.Utility.lookupObjects with multi-table support — added in 9.2.
  | 'xrm.utility.lookupObjects.multiTable'
  // formContext.data.refresh polling — only on latest dev channel.
  | 'formContext.data.refresh.polling'
  // executionContext on every registered handler — guaranteed since 9.2.
  | 'executionContext.alwaysProvided';

const MATRIX: Record<FeatureFlag, ShimProfile[]> = {
  'xrm.app.sidePanes':                ['9.2', 'latest'],
  'xrm.utility.lookupObjects.multiTable': ['9.2', 'latest'],
  'formContext.data.refresh.polling': ['latest'],
  'executionContext.alwaysProvided':  ['9.2', 'latest'],
};

export function isFeatureAvailable(
  getState: () => HarnessStore,
  flag: FeatureFlag,
): boolean {
  const profile = getState().shimProfile;
  return MATRIX[flag].includes(profile);
}

export function getProfile(getState: () => HarnessStore): ShimProfile {
  return getState().shimProfile;
}
