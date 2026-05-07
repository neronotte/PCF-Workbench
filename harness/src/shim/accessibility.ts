import type { HarnessStore } from '../store/harness-store';

/**
 * Accessibility surface observed in Dynamics 365 / Unified Client Interface.
 * Real UCI exposes a `getAccessibilityState()` so controls can adapt to the
 * user's OS-level accessibility preferences.
 *
 * We honour the harness dark-mode toggle for `isHighContrastEnabled` and read
 * the OS-level `prefers-reduced-motion` / `prefers-contrast` media queries
 * when available so genuine assistive-tech configurations flow through to
 * the control under test.
 */
export interface AccessibilityState {
  isHighContrastEnabled: boolean;
  isReducedMotionEnabled: boolean;
  isScreenReaderEnabled: boolean;
}

function safeMatchMedia(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

export function createAccessibilityShim(getState: () => HarnessStore) {
  return {
    getAccessibilityState(): AccessibilityState {
      const s = getState();
      const prefersHighContrast = safeMatchMedia('(prefers-contrast: more)') || safeMatchMedia('(forced-colors: active)');
      const prefersReducedMotion = safeMatchMedia('(prefers-reduced-motion: reduce)');
      return {
        // Honour OS preference; fall back to the harness dark-mode toggle so
        // makers can flip the bit from the UI without fiddling with OS settings.
        isHighContrastEnabled: prefersHighContrast || s.isDarkMode,
        isReducedMotionEnabled: prefersReducedMotion,
        isScreenReaderEnabled: false,
      };
    },
  };
}
