import type { HarnessStore } from '../store/harness-store';

/**
 * Theming surface observed in Dynamics 365 / Unified Client Interface.
 * Real UCI exposes a `getThemeKind()` returning 'light' | 'dark' | 'highContrast'
 * and `getCustomColors()` returning the current theme's brand colour palette.
 *
 * We derive the theme kind from the harness dark-mode toggle and surface the
 * Fluent v9 brand ramp from the harness store as the custom colour palette.
 */
export type ThemeKind = 'light' | 'dark' | 'highContrast';

export interface CustomColors {
  brandPrimary: string;
  brandPrimaryHover: string;
  brandPrimaryPressed: string;
  navBar: string;
  pageBackground: string;
  controlForeground: string;
  controlBackground: string;
}

const LIGHT_COLORS: CustomColors = {
  brandPrimary: '#0078d4',
  brandPrimaryHover: '#106ebe',
  brandPrimaryPressed: '#005a9e',
  navBar: '#ffffff',
  pageBackground: '#faf9f8',
  controlForeground: '#323130',
  controlBackground: '#ffffff',
};

const DARK_COLORS: CustomColors = {
  brandPrimary: '#2899f5',
  brandPrimaryHover: '#3aa0f3',
  brandPrimaryPressed: '#62b5f6',
  navBar: '#1f1f1f',
  pageBackground: '#0f0f0f',
  controlForeground: '#f3f2f1',
  controlBackground: '#1b1a19',
};

export function createThemingShim(getState: () => HarnessStore) {
  return {
    getThemeKind(): ThemeKind {
      return getState().isDarkMode ? 'dark' : 'light';
    },
    getCustomColors(): CustomColors {
      return getState().isDarkMode ? { ...DARK_COLORS } : { ...LIGHT_COLORS };
    },
  };
}
