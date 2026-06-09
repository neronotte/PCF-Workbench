import { XMLParser } from 'fast-xml-parser';
import type { ManifestConfig, ManifestProperty, EnumValue, FeatureUsage, ManifestResources } from '../types/manifest';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => ['property', 'data-set', 'uses-feature', 'code', 'css', 'img', 'platform-library', 'resx', 'value', 'type-group', 'type'].includes(name),
});

/** Parse a ControlManifest.Input.xml string into a ManifestConfig. */
export function parseManifest(xmlContent: string): ManifestConfig {
  const parsed = parser.parse(xmlContent);
  const control = parsed.manifest.control;

  const properties: ManifestProperty[] = (control.property ?? []).map((p: any) => {
    // Parse <value> children for Enum properties
    let enumValues: EnumValue[] | undefined;
    if (p.value && Array.isArray(p.value)) {
      enumValues = p.value.map((v: any) => ({
        name: v['@_name'],
        displayNameKey: v['@_display-name-key'] ?? v['@_name'],
        value: typeof v['#text'] !== 'undefined' ? String(v['#text']) : v['@_name'],
      }));
    }

    return {
      name: p['@_name'],
      displayNameKey: p['@_display-name-key'] ?? p['@_name'],
      descriptionKey: p['@_description-key'] ?? '',
      ofType: p['@_of-type'] ?? 'Property',
      ofTypeGroup: p['@_of-type-group'] ?? undefined,
      usage: p['@_usage'] ?? 'bound',
      required: p['@_required'] === 'true',
      defaultValue: p['@_default-value'] ?? undefined,
      enumValues,
    };
  });

  // Parse type-group definitions
  const typeGroups: Record<string, string[]> = {};
  for (const tg of (control['type-group'] ?? [])) {
    const name = tg['@_name'];
    const types = (tg['type'] ?? []).map((t: any) => typeof t === 'string' ? t : String(t));
    if (name && types.length > 0) typeGroups[name] = types;
  }

  const featureUsage: FeatureUsage[] = [];
  const featureBlock = control['feature-usage'];
  if (featureBlock) {
    const features = featureBlock['uses-feature'] ?? [];
    for (const f of features) {
      featureUsage.push({
        name: f['@_name'],
        required: f['@_required'] === 'true',
      });
    }
  }

  const res = control.resources ?? {};
  const resources: ManifestResources = {
    code: (res.code ?? []).map((c: any) => ({
      path: c['@_path'],
      order: parseInt(c['@_order'] ?? '1', 10),
    })),
    css: (res.css ?? []).map((c: any) => ({
      path: c['@_path'],
      order: parseInt(c['@_order'] ?? '1', 10),
    })),
    // H5 — <img> resource declarations. Many community PCFs (e.g. icon/avatar
    // controls) reference image assets relative to the control directory. The
    // pcf-plugin serves these via /pcf-resource/* — see also `images` getter
    // in ManifestResources.
    images: (res.img ?? []).map((c: any) => ({
      path: c['@_path'],
    })),
    platformLibraries: (res['platform-library'] ?? []).map((pl: any) => ({
      name: pl['@_name'],
      version: pl['@_version'],
    })),
  };

  const dataSets = (control['data-set'] ?? []).map((ds: any) => ({
    name: ds['@_name'],
    displayNameKey: ds['@_display-name-key'] ?? ds['@_name'],
  }));

  return {
    namespace: control['@_namespace'],
    constructor: control['@_constructor'],
    version: control['@_version'],
    controlType: (control['@_control-type'] ?? 'standard') as 'standard' | 'virtual',
    displayNameKey: control['@_display-name-key'] ?? control['@_constructor'],
    descriptionKey: control['@_description-key'] ?? '',
    properties,
    dataSets,
    typeGroups,
    featureUsage,
    resources,
  };
}
