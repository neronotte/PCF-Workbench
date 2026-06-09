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
        title={`Control class — the constructor name declared in ControlManifest.Input.xml`}
      >
        {manifest.constructor}
      </div>
      <div
        className={styles.subtitle}
        title={`Namespace and version — bump the version in the manifest each time you ship a change`}
      >
        {manifest.namespace} &middot; v{manifest.version}
      </div>

      {/* Badges */}
      <div className={styles.badgeRow}>
        <span title={isVirtual
          ? 'Virtual — returns React elements; needs React + Fluent in the manifest'
          : 'Standard (DOM) — manages its own DOM element directly'}>
          <Badge
            appearance="filled"
            color={isVirtual ? 'important' : 'informative'}
            size="small"
          >
            {isVirtual ? 'virtual' : 'standard'}
          </Badge>
        </span>
        {hasWebAPI && (
          <span title="WebAPI — the control can read and write Dataverse records">
            <Badge appearance="outline" size="small" color="success">WebAPI</Badge>
          </span>
        )}
        {hasDevice && (
          <span title="Device — the control can access the camera, microphone, location, and file picker">
            <Badge appearance="outline" size="small" color="warning">Device</Badge>
          </span>
        )}
        {hasUtility && (
          <span title="Utility — the control can open lookup dialogs and fetch entity metadata">
            <Badge appearance="outline" size="small" color="brand">Utility</Badge>
          </span>
        )}
        <span title={`Bound (${boundProps.length}) — properties that read and write a column on the host record`}>
          <Badge appearance="outline" size="small">
            {boundProps.length} bound
          </Badge>
        </span>
        <span title={`Input (${inputProps.length}) — read-only settings the maker configures at design time`}>
          <Badge appearance="outline" size="small">
            {inputProps.length} input
          </Badge>
        </span>
        {cssCount > 0 && (
          <span title={`${cssCount} stylesheet${cssCount === 1 ? '' : 's'} — injected into an isolated CSS layer so harness styles win on conflict`}>
            <Badge appearance="outline" size="small">{cssCount} CSS</Badge>
          </span>
        )}
      </div>

      {/* Platform Libraries */}
      {platformLibs.length > 0 && (
        <div className={styles.section}>
          <div
            className={styles.sectionTitle}
            title="Platform libraries — React and Fluent UI versions the control shares with the host instead of bundling"
          >
            Platform Libraries
          </div>
          {platformLibs.map(lib => (
            <div key={lib.name} className={styles.libItem}>
              <span title={
                lib.name === 'React'
                  ? `React ${lib.version} — shared with the host; the control doesn't need to bundle its own copy`
                  : lib.name === 'Fluent'
                  ? `Fluent UI ${lib.version} — shared with the host; unknown majors fall back to a stub`
                  : `${lib.name} ${lib.version} — shared platform library`
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
            title="Standard (DOM) — no shared platform libraries; the control bundles its own framework"
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
            title="Features — capabilities the manifest requests; required ones must be available for the control to load"
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
          title="Properties — manifest inputs, outputs, and datasets; edit values in the Properties panel tab"
        >
          Properties ({manifest.properties.length})
          {manifest.dataSets.length > 0 && ` · ${manifest.dataSets.length} dataset${manifest.dataSets.length > 1 ? 's' : ''}`}
        </div>
      </div>
    </div>
  );
}
