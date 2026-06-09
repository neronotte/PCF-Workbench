/** Parsed representation of a ControlManifest.Input.xml file. */
export interface ManifestConfig {
  namespace: string;
  constructor: string;
  version: string;
  controlType: 'standard' | 'virtual';
  displayNameKey: string;
  descriptionKey: string;
  properties: ManifestProperty[];
  dataSets: ManifestDataSet[];
  typeGroups: Record<string, string[]>;
  featureUsage: FeatureUsage[];
  resources: ManifestResources;
}

export interface ManifestDataSet {
  name: string;
  displayNameKey: string;
}

export interface ManifestProperty {
  name: string;
  displayNameKey: string;
  descriptionKey: string;
  ofType: string;
  ofTypeGroup?: string;
  usage: 'bound' | 'input' | 'output';
  required: boolean;
  defaultValue?: string;
  enumValues?: EnumValue[];
}

export interface EnumValue {
  name: string;
  displayNameKey: string;
  value: string;
}

export interface FeatureUsage {
  name: string;
  required: boolean;
}

export interface ManifestResources {
  code: { path: string; order: number }[];
  css: { path: string; order: number }[];
  /**
   * Image assets declared via <img path="..."/> in the manifest. Served by
   * the Vite plugin under `/pcf-resource/*` so controls can reference them
   * with the same paths they'd use at runtime in Dataverse.
   */
  images: { path: string }[];
  platformLibraries: { name: string; version: string }[];
  /**
   * Fluent UI majors actually referenced by the compiled bundle (detected by
   * scanning bundle.js for FluentUIReactv<N> globals). Populated by the Vite
   * plugin in `loadControl`, not by the manifest parser. Used by
   * `loadPlatformLibraries` to load the real Fluent UMDs that the bundle
   * actually imports — which can be a different set from what the manifest
   * declares (deployed-control "manifest drift").
   */
  fluentNeeds?: { v8?: string; v9?: string };
  /**
   * React major version the harness should actually inject as UMD, after
   * reconciling the manifest declaration with what Fluent v9 needs to run.
   * Fluent v9.40+ uses React 18's useSyncExternalStore dispatcher API, which
   * the React 16 polyfill cannot replicate (missing `.set` on the dispatcher
   * object). When the bundle scan detects Fluent v9 ≥ 9.40, this is bumped
   * to 18 to avoid the "Cannot read properties of undefined (reading 'set')"
   * commit-phase crash. Otherwise mirrors the manifest's declared React.
   * Populated alongside fluentNeeds by the Vite plugin's loadControl.
   */
  effectiveReactVersion?: string;
  /** Source of effectiveReactVersion for logging / diagnostics — 'manifest' | 'fluent-upgrade' | 'default'. */
  effectiveReactSource?: 'manifest' | 'fluent-upgrade' | 'default';
}
