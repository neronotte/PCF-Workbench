import { useState, useEffect, useRef } from 'react';
import {
  makeStyles, tokens, Tab, TabList, Switch, Label, Button, Divider, Dropdown, Option,
} from '@fluentui/react-components';
import {
  PlugConnected24Regular, Phone24Regular, TopSpeed24Regular,
  Settings24Regular, WeatherMoon24Regular, WeatherSunny24Regular,
  Database24Regular, Beaker24Regular, Play24Regular, Person24Regular,
  Form24Regular, Shield24Regular, ArrowClockwise20Regular, Globe16Regular,
} from '@fluentui/react-icons';
import { useHarnessStore, DEVICE_PRESETS, SHIM_PROFILE_LABELS, type ShimProfile } from '../store/harness-store';
import { ControlViewport } from './panels/ControlViewport';
import { PropertyEditor } from './panels/PropertyEditor';
import { ConsolePanel } from './panels/ConsolePanel';
import { NetworkPanel } from './panels/NetworkPanel';
import { DevicePanel } from './panels/DevicePanel';
import { PerformancePanel } from './panels/PerformancePanel';
import { DataPanel } from './panels/DataPanel';
import { ScenariosPanel } from './panels/ScenariosPanel';
import { LifecyclePanel } from './panels/LifecyclePanel';
import { UserSettingsPanel } from './panels/UserSettingsPanel';
import { FormPanel } from './panels/FormPanel';
import { FormChrome } from './panels/FormChrome';
import { AppNotificationBanner } from './AppNotificationBanner';
import { LiveReauthBanner } from './LiveReauthBanner';
import { CoveragePanel } from './panels/CoveragePanel';
import { useLivePageRecord } from '../loader/use-live-page-record';
import type { ManifestConfig } from '../types/manifest';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    overflow: 'hidden',
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    padding: '0 16px',
    height: '44px',
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
    flexShrink: 0,
    gap: '12px',
  },
  logo: {
    fontWeight: 600,
    fontSize: '14px',
    letterSpacing: '0.5px',
  },
  topBarSpacer: {
    flex: 1,
  },
  topBarControl: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '12px',
  },
  body: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  mainPanel: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  viewportArea: {
    flex: 1,
    overflow: 'hidden',
  },
  consoleArea: {
    height: '220px',
    borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
    flexShrink: 0,
    overflow: 'hidden',
  },
  sidePanel: {
    width: '360px',
    borderLeft: `1px solid ${tokens.colorNeutralStroke1}`,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    flexShrink: 0,
  },
  sidePanelTabs: {
    flexShrink: 0,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    overflowX: 'auto',
  },
  sidePanelContent: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
    minWidth: 0,
  },
  modeControls: {
    padding: '12px',
  },
  modeHeader: {
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    marginBottom: '8px',
  },
});

interface Props {
  manifest: ManifestConfig;
  bundlePath: string;
  cssFiles: string[];
  controlDir: string;
  launchedAsGallery: boolean;
}

type SidePanelTab = 'properties' | 'form' | 'data' | 'scenarios' | 'network' | 'device' | 'user' | 'lifecycle' | 'performance' | 'coverage';

export function HarnessShell({ manifest, bundlePath, cssFiles, controlDir, launchedAsGallery }: Props) {
  const styles = useStyles();
  const [activeTab, setActiveTab] = useState<SidePanelTab>('properties');
  const isDarkMode = useHarnessStore(s => s.isDarkMode);
  const toggleDarkMode = useHarnessStore(s => s.toggleDarkMode);
  const isControlDisabled = useHarnessStore(s => s.isControlDisabled);
  const setControlDisabled = useHarnessStore(s => s.setControlDisabled);
  const networkMode = useHarnessStore(s => s.networkMode);
  const formChromeEnabled = useHarnessStore(s => s.formChromeEnabled);
  const toggleFormChrome = useHarnessStore(s => s.toggleFormChrome);
  const isAuthoringMode = useHarnessStore(s => s.isAuthoringMode);
  const setAuthoringMode = useHarnessStore(s => s.setAuthoringMode);
  const pageEntityTypeName = useHarnessStore(s => s.pageEntityTypeName);
  const shimProfile = useHarnessStore(s => s.shimProfile);
  const setShimProfile = useHarnessStore(s => s.setShimProfile);
  const reloadControl = useHarnessStore(s => s.reloadControl);
  const dataSource = useHarnessStore(s => s.dataSource);
  const liveProfile = useHarnessStore(s => s.liveProfile);

  // Auto-fetch the live page record when in Live mode. Re-runs on profile,
  // page id, or reloadEpoch change. See use-live-page-record for details.
  useLivePageRecord();

  // When the user toggles Mock <-> Live, treat it as a profile switch and
  // re-init the control. Skip the very first render so we don't double-load
  // on mount, and skip if the reload callback isn't wired yet (the control
  // host registers it after init completes).
  const lastDataSourceRef = useRef(dataSource);
  useEffect(() => {
    if (lastDataSourceRef.current !== dataSource) {
      lastDataSourceRef.current = dataSource;
      reloadControl?.();
    }
  }, [dataSource, reloadControl]);

  const devicePreset = useHarnessStore(s => s.devicePreset);
  const renderCount = useHarnessStore(s => s.renderCount);
  const lastRenderTimeMs = useHarnessStore(s => s.lastRenderTimeMs);

  const deviceLabel = DEVICE_PRESETS[devicePreset]?.name ?? 'Desktop';

  const networkBadge = networkMode === 'offline'
    ? { label: 'OFFLINE', color: '#ff6b6b', bg: 'rgba(255,107,107,0.2)' }
    : networkMode === 'slow3g'
    ? { label: 'SLOW 3G', color: '#ffd93d', bg: 'rgba(255,217,61,0.2)' }
    : networkMode === 'fast3g'
    ? { label: 'FAST 3G', color: '#ffd93d', bg: 'rgba(255,217,61,0.2)' }
    : networkMode === 'custom'
    ? { label: 'THROTTLED', color: '#ffd93d', bg: 'rgba(255,217,61,0.2)' }
    : null;

  return (
    <div className={styles.root}>
      {/* Top Bar */}
      <div className={styles.topBar}>
        {launchedAsGallery && (
          <Button
            appearance="subtle"
            size="small"
            onClick={() => {
              fetch('/api/switch-control', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ controlDir: '' }),
              }).catch(() => {});
            }}
            style={{ color: 'white', fontWeight: 600, fontSize: 14, minWidth: 0, padding: '2px 8px' }}
            title="Back to Gallery"
          >
            &larr; Gallery
          </Button>
        )}
        <span style={{ fontWeight: 600, fontSize: 13, letterSpacing: 0.2 }}>
          {manifest.namespace}.{manifest.constructor}
        </span>

        {/* Live mode pill — visible only when dataSource === 'live' so users
            never lose sight of the fact that fetches hit a real org. */}
        {dataSource === 'live' && (
          <span
            data-test-id="live-pill"
            title={liveProfile ? `Live: ${liveProfile.user} @ ${liveProfile.orgUrl}` : 'Live mode (no profile selected)'}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
              padding: '2px 8px', borderRadius: 10,
              color: '#ff9aa2',
              backgroundColor: 'rgba(255, 80, 80, 0.25)',
              border: '1px solid rgba(255, 80, 80, 0.5)',
            }}
          >
            <Globe16Regular style={{ width: 12, height: 12 }} />
            LIVE{liveProfile ? `: ${liveProfile.friendlyName}` : ''}
          </span>
        )}

        {/* Status badges */}
        {networkBadge && (
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
            padding: '2px 8px', borderRadius: 10,
            color: networkBadge.color, backgroundColor: networkBadge.bg,
          }}>
            {networkBadge.label}
          </span>
        )}
        <span style={{ fontSize: 11, opacity: 0.6 }}>
          {deviceLabel}
        </span>
        <span style={{ fontSize: 11, opacity: 0.6 }}>
          {renderCount > 0 && `${lastRenderTimeMs.toFixed(1)}ms`}
        </span>

        <span className={styles.topBarSpacer} />
        <div className={styles.topBarControl}>
          <Button
            size="small"
            appearance="subtle"
            icon={<ArrowClockwise20Regular />}
            onClick={() => reloadControl?.()}
            disabled={!reloadControl}
            title="Reload the control (full destroy + init + updateView cycle)"
            style={{ color: 'white' }}
            data-test-id="harness-top-reload"
          >
            Reload
          </Button>
        </div>
        <div className={styles.topBarControl} data-test-id="shim-profile-control">
          <Label size="small" style={{ color: 'white' }} title="Which Dataverse API surface the harness emulates. Newer profiles expose APIs (e.g. Xrm.App.sidePanes) that older orgs don't have.">API</Label>
          <Dropdown
            size="small"
            value={SHIM_PROFILE_LABELS[shimProfile]}
            selectedOptions={[shimProfile]}
            onOptionSelect={(_, d) => setShimProfile((d.optionValue as ShimProfile) ?? 'latest')}
            style={{ minWidth: 120 }}
          >
            <Option value="9.0">{SHIM_PROFILE_LABELS['9.0']}</Option>
            <Option value="9.2">{SHIM_PROFILE_LABELS['9.2']}</Option>
            <Option value="latest">{SHIM_PROFILE_LABELS['latest']}</Option>
          </Dropdown>
        </div>
        <div className={styles.topBarControl}>
          <Label size="small" style={{ color: 'white' }}>Form chrome</Label>
          <Switch
            checked={formChromeEnabled}
            onChange={() => toggleFormChrome()}
            style={{ '--colorCompoundBrandBackground': 'white' } as any}
          />
        </div>
        <div className={styles.topBarControl}>
          <Label size="small" style={{ color: 'white' }} title="context.mode.isAuthoringMode — designer preview for InfoCard-style controls">
            Authoring
          </Label>
          <Switch
            checked={isAuthoringMode}
            onChange={(_, d) => setAuthoringMode(d.checked)}
            data-test-id="authoring-mode-toggle"
            style={{ '--colorCompoundBrandBackground': 'white' } as any}
          />
        </div>
        <div className={styles.topBarControl}>
          <Label size="small" style={{ color: 'white' }}>Disabled</Label>
          <Switch
            checked={isControlDisabled}
            onChange={(_, d) => setControlDisabled(d.checked)}
            style={{ '--colorCompoundBrandBackground': 'white' } as any}
          />
        </div>
        <Button
          appearance="subtle"
          icon={isDarkMode ? <WeatherSunny24Regular /> : <WeatherMoon24Regular />}
          onClick={toggleDarkMode}
          style={{ color: 'white' }}
          title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        />
      </div>

      {/* Body */}
      <div className={styles.body}>
        {/* Main panel: viewport + console */}
        <div className={styles.mainPanel}>
          <div className={styles.viewportArea}>
            <AppNotificationBanner />
            <LiveReauthBanner />
            <FormChrome entityTypeName={pageEntityTypeName}>
              <ControlViewport manifest={manifest} bundlePath={bundlePath} cssFiles={cssFiles} controlDir={controlDir} />
            </FormChrome>
          </div>
          <div className={styles.consoleArea}>
            <ConsolePanel />
          </div>
        </div>

        {/* Side panel: tabs */}
        <div className={styles.sidePanel}>
          <div className={styles.sidePanelTabs}>
            <TabList
              selectedValue={activeTab}
              onTabSelect={(_, d) => setActiveTab(d.value as SidePanelTab)}
              size="small"
            >
              <Tab value="properties" icon={<Settings24Regular />} title="Properties" />
              <Tab value="form" icon={<Form24Regular />} title="Form (formContext)" />
              <Tab value="data" icon={<Database24Regular />} title="Data (WebAPI Mock)" />
              <Tab value="scenarios" icon={<Beaker24Regular />} title="Test Scenarios" />
              <Tab value="network" icon={<PlugConnected24Regular />} title="Network Conditioning" />
              <Tab value="device" icon={<Phone24Regular />} title="Device Emulation" />
              <Tab value="user" icon={<Person24Regular />} title="User Settings" />
              <Tab value="lifecycle" icon={<Play24Regular />} title="Lifecycle Monitor" />
              <Tab value="performance" icon={<TopSpeed24Regular />} title="Performance" />
              <Tab value="coverage" icon={<Shield24Regular />} title="Shim Coverage" />
            </TabList>
          </div>
          <div className={styles.sidePanelContent}>
            <div style={{ display: activeTab === 'properties' ? 'contents' : 'none' }}><PropertyEditor manifest={manifest} /></div>
            {activeTab === 'form' && <FormPanel />}
            <div style={{ display: activeTab === 'data' ? 'contents' : 'none' }}><DataPanel /></div>
            <div style={{ display: activeTab === 'scenarios' ? 'contents' : 'none' }}><ScenariosPanel controlId={`${manifest.namespace}.${manifest.constructor}`} onScenarioLoaded={() => setActiveTab('properties')} /></div>
            {activeTab === 'network' && <NetworkPanel />}
            {activeTab === 'device' && <DevicePanel />}
            {activeTab === 'user' && <UserSettingsPanel />}
            {activeTab === 'lifecycle' && <LifecyclePanel />}
            {activeTab === 'performance' && <PerformancePanel />}
            {activeTab === 'coverage' && <CoveragePanel />}
          </div>
        </div>
      </div>
    </div>
  );
}
