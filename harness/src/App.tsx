import { useEffect, useState } from 'react';
import { FluentProvider, webLightTheme, Spinner, MessageBar, MessageBarBody } from '@fluentui/react-components';
import { powerPlatformLightTheme, powerPlatformDarkTheme } from './theme/power-platform-theme';
import { HarnessShell } from './ui/HarnessShell';
import { Gallery } from './ui/gallery/Gallery';
import { DialogHost } from './ui/DialogHost';
import { PopupHost } from './ui/PopupHost';
import { useHarnessStore } from './store/harness-store';
import { loadEntityData, subscribeData } from './store/data-store';
import { loadExecuteMocks } from './store/execute-mock-store';
import { loadMetadata } from './store/metadata-store';
import { rebaseDatesToToday } from './store/date-rebase';
import { setResxStrings } from './shim/resources';
import type { ManifestConfig } from './types/manifest';

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

    // Bridge data-store mutations into the harness store so ControlViewport rebuilds.
    const unsubscribe = subscribeData(() => {
      useHarnessStore.getState().bumpDataVersion();
    });

    // Load RESX localized strings
    if (resxStrings && Object.keys(resxStrings).length > 0) {
      setResxStrings(resxStrings);
      console.log(`[pcf-workbench] RESX: ${Object.keys(resxStrings).length} strings loaded`);
    }

    // Load data.json, metadata.json, and execute-mocks.json from the PCF project directory
    Promise.all([
      fetch('/pcf-data/data.json').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/pcf-data/metadata.json').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/pcf-data/execute-mocks.json').then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([data, metadata, executeMocks]) => {
      if (data && Object.keys(data).length > 0) {
        const shouldRebase = useHarnessStore.getState().rebaseDatesToToday;
        const finalData = shouldRebase ? rebaseDatesToToday(data) : data;
        loadEntityData(finalData);
        const tableCount = Object.keys(finalData).length;
        const recordCount = Object.values(finalData as Record<string, any[]>).reduce((sum, arr) => sum + arr.length, 0);
        console.log(`[pcf-workbench] Loaded data.json: ${tableCount} tables, ${recordCount} records${shouldRebase ? ' (dates rebased to today)' : ''}`);
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
