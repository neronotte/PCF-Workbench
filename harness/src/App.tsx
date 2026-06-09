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
import { findScenarioByName, applyScenarioAsActive } from './lib/scenario-loader';
import { bootstrapLegacyDataJson } from './lib/scenario-store';

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

    // Load metadata.json + execute-mocks.json from the PCF project directory.
    //
    // Note: legacy `data.json` is intentionally NOT loaded here anymore —
    // scenarios (test-scenarios.json) are the source of truth for mock
    // entity records. ScenarioHeader's first-load effect handles a one-shot
    // migration from data.json into the auto-created Default scenario when
    // no scenario carries dataRecords. See `bootstrapLegacyDataJson` in
    // `lib/scenario-store.ts`.
    Promise.all([
      fetch('/pcf-data/metadata.json').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/pcf-data/execute-mocks.json').then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(async ([metadata, executeMocks]) => {
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

      // H12 — Migrate legacy data.json into the mock entity store BEFORE the
      // control mounts. Without this the control fires its first webAPI
      // call(s) against an empty store and returns empty results — most
      // visibly: BookingStatusTransitionControl loads its from-state but
      // shows no transition buttons. ScenarioHeader does the same migration
      // in its own first-mount effect, but that races with the control's
      // first updateView; ScenarioHeader's bootstrap becomes the secondary
      // safety-net once we've already done it here.
      await bootstrapLegacyDataJson();

      // ?scenario=<name> — auto-apply a saved scenario before the control
      // mounts. Used by the loop CLI in CI so the harness boots in the
      // requested state instead of with default/empty property values.
      // Must run AFTER data loads so fieldBindings resolve correctly.
      //
      // H11 — use applyScenarioAsActive (not applyScenarioToStore) so the
      // ScenarioHeader's first-mount resume effect finds *this* scenario as
      // the persisted active one. With the lower-level apply the resume
      // effect would re-apply whatever scenario was active in the previous
      // session, silently stomping the URL-loaded data (transitions
      // disappearing on BookingStatusTransitionControl, etc.).
      try {
        const scenarioParam = new URLSearchParams(window.location.search).get('scenario');
        if (scenarioParam && manifestData) {
          const controlId = `${manifestData.namespace}.${manifestData.constructor}`;
          const scenario = await findScenarioByName(controlId, scenarioParam);
          if (scenario) {
            applyScenarioAsActive(controlId, scenario);
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
