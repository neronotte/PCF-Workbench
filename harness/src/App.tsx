import { useEffect, useState } from 'react';
import { FluentProvider, webLightTheme, Spinner, MessageBar, MessageBarBody } from '@fluentui/react-components';
import { powerPlatformLightTheme, powerPlatformDarkTheme } from './theme/power-platform-theme';
import { HarnessShell } from './ui/HarnessShell';
import { Gallery } from './ui/gallery/Gallery';
import { DialogHost } from './ui/DialogHost';
import { PopupHost } from './ui/PopupHost';
import { useHarnessStore } from './store/harness-store';
import { loadEntityData, subscribeData, getEntityStoreKeys } from './store/data-store';
import { loadExecuteMocks } from './store/execute-mock-store';
import { loadMetadata } from './store/metadata-store';
import { rebaseDatesToToday } from './store/date-rebase';
import { setResxStrings } from './shim/resources';
import type { ManifestConfig } from './types/manifest';
import { findScenarioByName, applyScenarioToStore } from './lib/scenario-loader';

// Import from virtual module (provided by pcf-plugin).
import { manifest as manifestData, bundlePath, cssFiles, resxStrings, isGalleryMode, controlDir, launchedAsGallery } from 'virtual:pcf-manifest';

export function App() {
  const isDarkMode = useHarnessStore(s => s.isDarkMode);
  const setManifest = useHarnessStore(s => s.setManifest);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Gallery mode — no specific control, show the catalog
  if (isGalleryMode || !manifestData) {
    return (
      <FluentProvider theme={powerPlatformLightTheme}>
        <Gallery />
      </FluentProvider>
    );
  }

  useEffect(() => {
    setManifest(manifestData);

    // Honour ?chrome=minimal|none from the URL. Used by the loop CLI to
    // hide workbench chrome for clean automated screenshots, but also
    // available to anyone sharing a link to a "headless-ish" view.
    try {
      const chromeParam = new URLSearchParams(window.location.search).get('chrome');
      if (chromeParam === 'minimal' || chromeParam === 'none') {
        useHarnessStore.getState().setChromeMode(chromeParam);
      }
    } catch { /* ignore */ }

    // Bridge data-store mutations into the harness store so ControlViewport rebuilds.
    const unsubscribe = subscribeData(() => {
      useHarnessStore.getState().bumpDataVersion();
    });

    // Load RESX localized strings (bucketed by LCID)
    if (resxStrings && Object.keys(resxStrings).length > 0) {
      setResxStrings(resxStrings);
      const buckets = Object.keys(resxStrings).map(Number);
      const total = buckets.reduce((n, l) => n + Object.keys(resxStrings[l] ?? {}).length, 0);
      console.log(`[pcf-workbench] RESX: ${total} strings across locales [${buckets.sort((a, b) => a - b).join(', ')}]`);
    }

    // Load data.json, metadata.json, and execute-mocks.json from the PCF project directory
    Promise.all([
      fetch('/pcf-data/data.json').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/pcf-data/metadata.json').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/pcf-data/execute-mocks.json').then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(async ([data, metadata, executeMocks]) => {
      if (data && Object.keys(data).length > 0) {
        // If an active scenario has already populated the entity store (its
        // first-load effect runs synchronously inside ScenarioHeader before
        // this fetch resolves), don't clobber it with the project's
        // data.json — the scenario is the more specific source of truth.
        if (getEntityStoreKeys().length > 0) {
          console.log('[pcf-workbench] Skipping data.json load — active scenario has already populated the entity store.');
        } else {
          const shouldRebase = useHarnessStore.getState().rebaseDatesToToday;
          const finalData = shouldRebase ? rebaseDatesToToday(data) : data;
          loadEntityData(finalData);
          const tableCount = Object.keys(finalData).length;
          const recordCount = Object.values(finalData as Record<string, any[]>).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
          console.log(`[pcf-workbench] Loaded data.json: ${tableCount} tables, ${recordCount} records${shouldRebase ? ' (dates rebased to today)' : ''}`);
        }
      } else {
        console.log('[pcf-workbench] No data.json found. WebAPI calls will return empty results.');
      }
      if (metadata) {
        // metadata can be an array (multiple files merged) or a single object
        if (Array.isArray(metadata)) {
          for (const item of metadata) loadMetadata(item);
        } else {
          loadMetadata(metadata);
        }
        console.log(`[pcf-workbench] Loaded entity metadata`);
      }
      if (executeMocks && Object.keys(executeMocks).length > 0) {
        loadExecuteMocks(executeMocks);
      }

      // ?scenario=<name> — auto-apply a saved scenario before the control
      // mounts. Used by the loop CLI in CI so the harness boots in the
      // requested state instead of with default/empty property values.
      // Must run AFTER data loads so fieldBindings resolve correctly.
      try {
        const scenarioParam = new URLSearchParams(window.location.search).get('scenario');
        if (scenarioParam && manifestData) {
          const controlId = `${manifestData.namespace}.${manifestData.constructor}`;
          const scenario = await findScenarioByName(controlId, scenarioParam);
          if (scenario) {
            applyScenarioToStore(scenario);
            console.log(`[pcf-workbench] Auto-loaded scenario "${scenarioParam}" from ?scenario= URL param`);
          } else {
            console.warn(`[pcf-workbench] ?scenario=${scenarioParam} requested but no scenario with that name was found in test-scenarios.json or localStorage`);
          }
        }
      } catch (err) {
        console.warn('[pcf-workbench] scenario auto-load failed:', err);
      }

      setReady(true);
    });
    return unsubscribe;
  }, []);

  if (!ready) {
    return (
      <FluentProvider theme={powerPlatformLightTheme}>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
          <Spinner label="Loading PCF control manifest..." />
        </div>
      </FluentProvider>
    );
  }

  return (
    <FluentProvider theme={isDarkMode ? powerPlatformDarkTheme : powerPlatformLightTheme}>
      <HarnessShell manifest={manifestData} bundlePath={bundlePath} cssFiles={cssFiles} controlDir={controlDir} launchedAsGallery={launchedAsGallery} />
      <DialogHost />
      <PopupHost />
    </FluentProvider>
  );
}
