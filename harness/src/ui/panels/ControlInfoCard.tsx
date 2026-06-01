import {
  makeStyles, tokens, Badge, Divider,
} from '@fluentui/react-components';
import type { ManifestConfig } from '../../types/manifest';

const useStyles = makeStyles({
  root: {
    padding: '12px',
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    marginBottom: '12px',
  },
  title: {
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightBold,
    color: tokens.colorBrandForeground1,
    wordBreak: 'break-all' as const,
  },
  subtitle: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    marginTop: '2px',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    gap: '4px 12px',
    marginTop: '8px',
    fontSize: tokens.fontSizeBase200,
  },
  label: {
    color: tokens.colorNeutralForeground3,
    fontWeight: tokens.fontWeightSemibold,
  },
  value: {
    fontFamily: "'Consolas', monospace",
    fontSize: '11px',
  },
  badgeRow: {
    display: 'flex',
    gap: '4px',
    flexWrap: 'wrap' as const,
    marginTop: '8px',
  },
  section: {
    marginTop: '8px',
  },
  sectionTitle: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    marginBottom: '4px',
  },
  libItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: tokens.fontSizeBase200,
    padding: '2px 0',
  },
});

interface Props {
  manifest: ManifestConfig;
}

export function ControlInfoCard({ manifest }: Props) {
  const styles = useStyles();

  const isVirtual = manifest.controlType === 'virtual';
  const hasWebAPI = manifest.featureUsage.some(f => f.name === 'WebAPI');
  const hasDevice = manifest.featureUsage.some(f => f.name.startsWith('Device'));
  const hasUtility = manifest.featureUsage.some(f => f.name === 'Utility');
  const platformLibs = manifest.resources.platformLibraries;
  const cssCount = manifest.resources.css.length;
  const boundProps = manifest.properties.filter(p => p.usage === 'bound');
  const inputProps = manifest.properties.filter(p => p.usage === 'input');

  return (
    <div className={styles.root}>
      <div
        className={styles.title}
        title={`Control class name — the <control constructor=...> attribute from ControlManifest.Input.xml. The harness loads bundle.js and reads this class off the window namespace.`}
      >
        {manifest.constructor}
      </div>
      <div
        className={styles.subtitle}
        title={`Namespace (publisher / solution prefix) and manifest version. Increment the version in ControlManifest.Input.xml each time you ship a behavioural change so the host invalidates its cache.`}
      >
        {manifest.namespace} &middot; v{manifest.version}
      </div>

      {/* Badges */}
      <div className={styles.badgeRow}>
        <span title={isVirtual
          ? 'Virtual control — returns React elements from updateView(). Needs platform-libraries React + Fluent declared in the manifest.'
          : 'Standard (DOM) control — manages its own root DOM element. The harness gives it a container and the control mutates it directly.'}>
          <Badge
            appearance="filled"
            color={isVirtual ? 'important' : 'informative'}
            size="small"
          >
            {isVirtual ? 'virtual' : 'standard'}
          </Badge>
        </span>
        {hasWebAPI && (
          <span title="Manifest declares the WebAPI feature — the control can call context.webAPI.retrieveRecord / retrieveMultipleRecords / createRecord / updateRecord / deleteRecord against the bound Dataverse environment.">
            <Badge appearance="outline" size="small" color="success">WebAPI</Badge>
          </span>
        )}
        {hasDevice && (
          <span title="Manifest declares the Device feature — the control can call context.device APIs like pickFile, captureImage, captureAudio, captureVideo, getBarcodeValue, or getCurrentPosition.">
            <Badge appearance="outline" size="small" color="warning">Device</Badge>
          </span>
        )}
        {hasUtility && (
          <span title="Manifest declares the Utility feature — the control can call context.utils helpers like getEntityMetadata, lookupObjects, and openLookupObjects.">
            <Badge appearance="outline" size="small" color="brand">Utility</Badge>
          </span>
        )}
        <span title={`Bound properties (${boundProps.length}) — properties that read/write a single column on the form's record. On a field PCF this is the field the control is attached to; on a dataset PCF these are columns inside the view.`}>
          <Badge appearance="outline" size="small">
            {boundProps.length} bound
          </Badge>
        </span>
        <span title={`Input properties (${inputProps.length}) — read-only configuration values the maker sets at design time (e.g. labels, colours, behaviour flags). The control sees them via context.parameters.<name>.raw.`}>
          <Badge appearance="outline" size="small">
            {inputProps.length} input
          </Badge>
        </span>
        {cssCount > 0 && (
          <span title={`${cssCount} stylesheet${cssCount === 1 ? '' : 's'} declared in the manifest. The harness injects these into a CSS @layer so the host's own Fluent styles win on conflict.`}>
            <Badge appearance="outline" size="small">{cssCount} CSS</Badge>
          </span>
        )}
      </div>

      {/* Platform Libraries */}
      {platformLibs.length > 0 && (
        <div className={styles.section}>
          <div
            className={styles.sectionTitle}
            title="Platform Libraries — declared in the manifest via <platform-library>. The harness loads the requested major version of React / Fluent on-demand from CDN and exposes it as a versioned global so the control's bundle can import it without shipping its own copy."
          >
            Platform Libraries
          </div>
          {platformLibs.map(lib => (
            <div key={lib.name} className={styles.libItem}>
              <span title={
                lib.name === 'React'
                  ? `React ${lib.version} requested via <platform-library>. The harness loads it from CDN and exposes it as a versioned global so the bundle can import React without bundling its own copy.`
                  : lib.name === 'Fluent'
                  ? `Fluent UI ${lib.version} requested via <platform-library>. The harness loads the real Fluent UMD on-demand. For unknown majors the harness falls back to a Proxy stub.`
                  : `${lib.name} ${lib.version} requested via <platform-library>.`
              }>
                <Badge
                  appearance="filled"
                  color={lib.name === 'React' ? 'brand' : lib.name === 'Fluent' ? 'important' : 'subtle'}
                  size="small"
                >
                  {lib.name}
                </Badge>
              </span>
              <span className={styles.value}>v{lib.version}</span>
              <span style={{ opacity: 0.5, fontSize: 10 }}>
                {lib.name === 'React' && `→ window.Reactv${lib.version.split('.')[0]}`}
                {lib.name === 'Fluent' && `→ window.FluentUIReact*`}
              </span>
            </div>
          ))}
        </div>
      )}

      {platformLibs.length === 0 && (
        <div className={styles.section}>
          <div
            className={styles.sectionTitle}
            title="Framework — the control declared no <platform-library> entries in its manifest, so it renders directly to its container with whatever framework (if any) it bundles itself. Common for legacy 'standard' (DOM) PCFs."
          >
            Framework
          </div>
          <div className={styles.libItem}>
            <Badge appearance="tint" size="small" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>Pure DOM</Badge>
            <span style={{ fontSize: 11, opacity: 0.6 }}>No platform libraries — renders directly to container</span>
          </div>
        </div>
      )}

      {/* Features */}
      {manifest.featureUsage.length > 0 && (
        <div className={styles.section}>
          <div
            className={styles.sectionTitle}
            title="Features — Power Platform capabilities the manifest requests via <feature-usage>. WebAPI, Utility, Navigation, and various Device features. 'required' means the control will not load if the capability is unavailable; 'optional' means it degrades gracefully."
          >
            Features
          </div>
          {manifest.featureUsage.map(f => (
            <div key={f.name} className={styles.libItem}>
              <span className={styles.value}>{f.name}</span>
              <Badge appearance="outline" size="small" color={f.required ? 'danger' : 'subtle'}>
                {f.required ? 'required' : 'optional'}
              </Badge>
            </div>
          ))}
        </div>
      )}

      {/* Property count summary */}
      <div className={styles.section}>
        <div
          className={styles.sectionTitle}
          title="Properties — manifest-declared inputs and outputs (bound to record columns or static input config). Datasets are collections of records the control iterates over (used by view/grid PCFs). Edit values in the Properties side-panel tab."
        >
          Properties ({manifest.properties.length})
          {manifest.dataSets.length > 0 && ` · ${manifest.dataSets.length} dataset${manifest.dataSets.length > 1 ? 's' : ''}`}
        </div>
      </div>
    </div>
  );
}
