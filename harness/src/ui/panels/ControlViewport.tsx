import { useEffect, useRef, useCallback, useState } from 'react';
import { makeStyles, mergeClasses, tokens, Spinner } from '@fluentui/react-components';
import { useHarnessStore } from '../../store/harness-store';
import { ControlHost, type ControlHostState } from '../../loader/control-host';
import type { ManifestConfig } from '../../types/manifest';
import { FormNotificationBanner } from '../FormNotificationBanner';
import { ControlErrorBanner } from '../ControlErrorBanner';
import { registerHarnessHost } from '../../test-bridge';
import { useBuildStatus } from '../../store/build-watch-client';

/**
 * H2 — Spinner that escalates its label after 15s. Large bundles (PDF, canvas,
 * unmodified Tailwind builds) routinely take 20-40s to evaluate; the bare
 * "Loading control..." spinner left users assuming the harness had hung.
 */
function SlowLoadSpinner() {
  const [phase, setPhase] = useState<'normal' | 'slow' | 'very-slow'>('normal');
  useEffect(() => {
    const slow = setTimeout(() => setPhase('slow'), 15_000);
    const verySlow = setTimeout(() => setPhase('very-slow'), 45_000);
    return () => { clearTimeout(slow); clearTimeout(verySlow); };
  }, []);
  const label = phase === 'normal'
    ? 'Loading control...'
    : phase === 'slow'
      ? 'Still loading… large bundles may take 30s+'
      : 'Loading is taking unusually long — check the browser console for errors';
  return <Spinner label={label} />;
}

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
  },
  viewportWrapper: {
    flex: 1,
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    backgroundColor: '#f0f0f0',
    overflow: 'auto',
    padding: '16px',
  },
  // M2/h10 — Reactive Desktop: when desktop preset is active and the user has
  // not pinned an explicit container width, let the viewport fill the
  // available space so @container pcf-viewport queries fire reactively as the
  // browser narrows (matching real UCI behaviour).
  viewportWrapperFluid: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'stretch',
    backgroundColor: '#f0f0f0',
    overflow: 'auto',
    padding: '16px',
  },
  viewportWrapperFullBleed: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    // Match the visual margin UCI form regions get around their content
    // — the user explicitly asked for breathing room even in full-bleed mode.
    backgroundColor: '#ffffff',
    overflow: 'auto',
    padding: '16px 24px',
  },
  viewportFrame: {
    position: 'relative' as const,
    border: '2px solid #1a1a1a',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: '#fafafa',
    boxShadow: tokens.shadow8,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    flexShrink: 0,
    overflow: 'hidden',
  },
  viewportFrameFullBleed: {
    position: 'relative' as const,
    // No border / shadow / radius — UCI form regions are flush.
    backgroundColor: '#ffffff',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    flex: 1,
    minHeight: 0,
    width: '100%',
  },
  viewportNotifications: {
    flexShrink: 0,
    width: '100%',
  },
  viewport: {
    backgroundColor: '#ffffff',
    overflow: 'hidden',
    position: 'relative' as const,
    containerType: 'inline-size',
    containerName: 'pcf-viewport',
    boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.08)',
  } as any,
  controlContainer: {
    width: '100%',
    minHeight: '48px',
    overflow: 'auto',
    height: '100%',
  },
  staleControlContainer: {
    opacity: 0.45,
    filter: 'grayscale(0.4)',
    pointerEvents: 'none' as const,
    cursor: 'progress' as const,
    transition: 'opacity 120ms ease-out, filter 120ms ease-out',
  },
  staleOverlay: {
    position: 'absolute' as const,
    top: '8px', right: '8px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 10px',
    borderRadius: '12px',
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.3px',
    color: '#0b3a4a',
    backgroundColor: 'rgba(50, 212, 255, 0.92)',
    boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
    zIndex: 20,
    pointerEvents: 'none' as const,
  },
  center: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    padding: '24px',
  },
  error: {
    margin: '16px',
  },
  statusBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    padding: '4px 12px',
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
    flexShrink: 0,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
  },
  statusItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  statusLabel: {
    fontSize: '10px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    opacity: 0.7,
    fontFamily: tokens.fontFamilyBase,
    fontWeight: tokens.fontWeightSemibold,
  },
});

interface Props {
  manifest: ManifestConfig;
  bundlePath: string;
  cssFiles: string[];
  controlDir: string;
}

export function ControlViewport({ manifest, bundlePath, cssFiles }: Props) {
  const styles = useStyles();
  const containerRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<ControlHost | null>(null);
  const [hostState, setHostState] = useState<ControlHostState>({ isLoaded: false, error: null });

  const viewportWidth = useHarnessStore(s => s.viewportWidth);
  const viewportHeight = useHarnessStore(s => s.viewportHeight);
  const containerWidth = useHarnessStore(s => s.containerWidth);
  const containerHeight = useHarnessStore(s => s.containerHeight);
  const devicePreset = useHarnessStore(s => s.devicePreset);
  const propertyValues = useHarnessStore(s => s.propertyValues);
  const networkMode = useHarnessStore(s => s.networkMode);
  const isControlDisabled = useHarnessStore(s => s.isControlDisabled);
  const formFactor = useHarnessStore(s => s.formFactor);
  const isDarkMode = useHarnessStore(s => s.isDarkMode);
  const pageEntityId = useHarnessStore(s => s.pageEntityId);
  const pageEntityTypeName = useHarnessStore(s => s.pageEntityTypeName);
  const pageEntityRecordName = useHarnessStore(s => s.pageEntityRecordName);
  const isFullscreen = useHarnessStore(s => s.isFullscreen);
  const userLanguageId = useHarnessStore(s => s.userLanguageId);
  const userIsRTL = useHarnessStore(s => s.userIsRTL);
  const userTimeZoneOffsetMinutes = useHarnessStore(s => s.userTimeZoneOffsetMinutes);
  const host = useHarnessStore(s => s.host);
  const datasetState = useHarnessStore(s => s.datasetState);
  const dataVersion = useHarnessStore(s => s.dataVersion);
  const isAuthoringMode = useHarnessStore(s => s.isAuthoringMode);
  const buildStatus = useBuildStatus();
  const isStale = buildStatus.phase === 'compiling';
  const isFullBleed = useHarnessStore(s => s.isFullBleed);

  // Authoring mode is read on init() in real Dataverse and doesn't change at
  // runtime — but for harness UX we want toggling the switch to take effect
  // immediately. Force a full re-init when it flips.
  useEffect(() => {
    if (!hostRef.current?.isLoaded()) return;
    hostRef.current.reload();
  }, [isAuthoringMode]);

  // Initialize control host
  useEffect(() => {
    if (!containerRef.current) return;

    // Load control CSS into a scoped @layer to prevent Bootstrap from overriding harness styles.
    // Harness styles (unlayered) always win over layered styles per CSS cascade rules.
    // The control CSS applies inside the control container via specificity.
    const loadControlCss = async () => {
      // Remove any previously injected control CSS
      document.querySelectorAll('[data-pcf-css]').forEach(el => el.remove());

      // Establish layer order: control CSS goes in pcf-control layer (lowest priority).
      // Harness Fluent UI styles are unlayered (highest priority) and won't be affected
      // by Bootstrap resets. Control CSS applies normally to control elements since
      // harness atomic classes don't match control selectors.
      const layerOrder = document.createElement('style');
      layerOrder.setAttribute('data-pcf-css', 'layer-order');
      layerOrder.textContent = '@layer pcf-control;';
      document.head.insertBefore(layerOrder, document.head.firstChild);

      // Fetch all CSS files, wrap in @layer, and convert @media width queries
      // to @container queries so they respond to the viewport container size
      // (not the browser window) for device emulation.
      for (const cssFile of cssFiles) {
        try {
          const resp = await fetch(cssFile);
          if (!resp.ok) continue;
          let cssText = await resp.text();
          // Convert @media width queries to @container queries
          // @media (max-width: 768px) → @container pcf-viewport (max-width: 768px)
          // @media (min-width: 768px) → @container pcf-viewport (min-width: 768px)
          cssText = cssText.replace(
            /@media\s+only\s+screen\s+and\s*\(((?:max|min)-width:\s*\d+px)\)/g,
            '@container pcf-viewport ($1)'
          );
          cssText = cssText.replace(
            /@media\s*\(((?:max|min)-width:\s*\d+px)\)/g,
            '@container pcf-viewport ($1)'
          );
          const style = document.createElement('style');
          style.setAttribute('data-pcf-css', 'true');
          style.textContent = `@layer pcf-control {\n${cssText}\n}`;
          document.head.appendChild(style);
        } catch {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = cssFile;
          link.setAttribute('data-pcf-css', 'true');
          document.head.appendChild(link);
        }
      }
    };
    loadControlCss();

    const host = new ControlHost(
      manifest,
      useHarnessStore.getState,
      bundlePath,
      setHostState,
    );
    hostRef.current = host;
    registerHarnessHost(host);
    host.load(containerRef.current);

    return () => {
      // Clean up control CSS on unmount
      document.querySelectorAll('link[data-pcf-css]').forEach(el => el.remove());
      host.destroy();
      registerHarnessHost(null);
      hostRef.current = null;
    };
  }, [manifest, bundlePath]); // Only reload on manifest/bundle change

  // Listen for bundle changes (hot reload from Vite plugin file watcher)
  useEffect(() => {
    if (import.meta.hot) {
      import.meta.hot.on('pcf-bundle-changed', () => {
        console.log('[pcf-workbench] Bundle changed — reloading control');
        hostRef.current?.reload();
      });
    }
  }, []);


  // Trigger updateView when properties, network, device, or mode change.
  // Debounce to prevent cascading re-renders (especially for virtual controls
  // where ReactDOM.render can trigger synchronous state updates).
  const updateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!hostRef.current?.isLoaded()) return;
    // Debounce: wait 50ms for rapid changes to settle
    if (updateTimerRef.current) clearTimeout(updateTimerRef.current);
    updateTimerRef.current = setTimeout(() => {
      hostRef.current?.callUpdateView();
    }, 50);
    return () => {
      if (updateTimerRef.current) clearTimeout(updateTimerRef.current);
    };
  }, [propertyValues, networkMode, isControlDisabled, formFactor, isDarkMode, pageEntityId, pageEntityTypeName, pageEntityRecordName, containerWidth, containerHeight, viewportWidth, viewportHeight, isFullscreen, userLanguageId, userIsRTL, userTimeZoneOffsetMinutes, host, datasetState, dataVersion]);

  // Capture runtime errors thrown outside control-host's try/catch blocks
  // (async callbacks, event handlers, promise rejections inside the bundle).
  // We only forward errors whose stack mentions the bundle path or known
  // PCF/Fluent frames so harness-internal errors don't get attributed to
  // the user's control.
  useEffect(() => {
    const bundleHint = bundlePath.split('/').pop()?.replace(/\?.*$/, '') ?? '';
    const looksLikeControlError = (stack: string | undefined): boolean => {
      if (!stack) return false;
      if (bundleHint && stack.includes(bundleHint)) return true;
      // Common PCF / Fluent / React frames that almost always indicate the
      // control crashed rather than the harness shell.
      return /bundle\.js|fluentui|react-dom|useSyncExternalStore|commitHookEffectListMount/i.test(stack);
    };

    const onError = (ev: ErrorEvent) => {
      const stack = ev.error?.stack ? String(ev.error.stack) : undefined;
      if (!looksLikeControlError(stack)) return;
      hostRef.current?.reportRuntimeError(ev.message || String(ev.error), stack);
    };
    const onRejection = (ev: PromiseRejectionEvent) => {
      const reason: any = ev.reason;
      const stack = reason?.stack ? String(reason.stack) : undefined;
      if (!looksLikeControlError(stack)) return;
      const message = reason?.message || String(reason);
      hostRef.current?.reportRuntimeError(message, stack);
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, [bundlePath]);

  const handleReload = useCallback(() => {
    hostRef.current?.reload();
  }, []);

  // Register the reload callback in the store so the harness top bar's
  // Refresh button (and the form command bar's Refresh) can trigger it.
  const setReloadControl = useHarnessStore(s => s.setReloadControl);
  useEffect(() => {
    setReloadControl(handleReload);
    return () => setReloadControl(null);
  }, [handleReload, setReloadControl]);

  // h10 — Reactive Desktop mode. Active when devicePreset is 'desktop' and
  // the user hasn't pinned an explicit container width. The viewport frame
  // fills its wrapper, so narrowing the browser narrows the @container
  // pcf-viewport size and the control's responsive breakpoints fire — same
  // as a real UCI form. Tablet/Mobile presets remain pinned to their preset
  // pixel dimensions, and full-bleed continues to use its own path.
  const isFluidDesktop = devicePreset === 'desktop' && !isFullBleed && containerWidth == null && containerHeight == null;
  const setViewportSize = useHarnessStore(s => s.setViewportSize);
  const frameRef = useRef<HTMLDivElement>(null);
  const [measuredSize, setMeasuredSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    if (!isFluidDesktop) { setMeasuredSize(null); return; }
    const el = frameRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let pending: { w: number; h: number } | null = null;
    let raf = 0;
    const flush = () => {
      raf = 0;
      if (!pending) return;
      const { w, h } = pending;
      pending = null;
      setMeasuredSize({ w, h });
      // Push into the store so context.mode.allocatedWidth/Height reports
      // the real rendered size and updateView fires — PCFs that read
      // allocated size in JS (rather than via CSS @media) will re-render.
      setViewportSize(w, h);
    };
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const r = e.contentRect;
        pending = { w: Math.round(r.width), h: Math.round(r.height) };
      }
      if (!raf) raf = requestAnimationFrame(flush);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [isFluidDesktop, setViewportSize]);

  return (
    <div className={styles.root}>
      <div className={isFullBleed ? styles.viewportWrapperFullBleed : isFluidDesktop ? styles.viewportWrapperFluid : styles.viewportWrapper}>
        <div
          ref={frameRef}
          className={isFullBleed ? styles.viewportFrameFullBleed : styles.viewportFrame}
          style={isFullBleed ? undefined : isFluidDesktop ? {
            width: '100%',
            flex: 1,
            minHeight: 0,
          } : {
            width: viewportWidth,
            height: viewportHeight,
          }}
        >
          <div className={styles.viewportNotifications}>
            <FormNotificationBanner />
          </div>
          <div
            className={styles.viewport}
            style={isFullBleed ? { flex: 1, minHeight: 0, width: '100%' } : {
              width: containerWidth ?? viewportWidth,
              height: containerHeight ?? viewportHeight,
            }}
          >
            {hostState.error && (
              <ControlErrorBanner
                message={hostState.error}
                stack={hostState.errorStack ?? undefined}
                onReload={handleReload}
              />
            )}
            {!hostState.isLoaded && !hostState.error && (
              <div className={styles.center}>
                <SlowLoadSpinner />
              </div>
            )}
            <div ref={containerRef} className={mergeClasses(styles.controlContainer, isStale ? styles.staleControlContainer : undefined)} data-test-id="pcf-control-container" data-stale={isStale ? 'true' : undefined} style={isFullBleed ? {
              width: '100%',
              height: '100%',
              display: hostState.error ? 'none' : undefined,
            } : {
              width: containerWidth != null ? `${containerWidth}px` : '100%',
              height: containerHeight != null ? `${containerHeight}px` : '100%',
              display: hostState.error ? 'none' : undefined,
            }} />
            {isStale && (
              <div className={styles.staleOverlay} role="status" aria-live="polite" data-test-id="viewport-stale-overlay">
                <Spinner size="extra-tiny" />
                <span>Rebuilding…</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={styles.statusBar} aria-label="Viewport size">
        <div className={styles.statusItem}>
          <span className={styles.statusLabel}>Viewport</span>
          {isFluidDesktop && measuredSize ? (
            <>
              <span data-test-id="viewport-size-fluid">{measuredSize.w} × {measuredSize.h}</span>
              <span style={{ opacity: 0.6, fontFamily: tokens.fontFamilyBase, fontSize: '10px' }}               title="Desktop preset is fluid — set Tablet or Mobile to lock the viewport size">(fluid)</span>
            </>
          ) : (
            <span>{viewportWidth} × {viewportHeight}</span>
          )}
        </div>
        <div className={styles.statusItem}>
          <span className={styles.statusLabel}>Container</span>
          <span>{containerWidth ?? (isFluidDesktop && measuredSize ? measuredSize.w : viewportWidth)} × {containerHeight ?? (isFluidDesktop && measuredSize ? measuredSize.h : viewportHeight)}</span>
          {(containerWidth == null && containerHeight == null) && (
            <span style={{ opacity: 0.5, fontFamily: tokens.fontFamilyBase, fontSize: '10px' }}>(full)</span>
          )}
        </div>
      </div>
    </div>
  );
}
