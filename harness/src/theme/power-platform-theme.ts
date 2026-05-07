/**
 * Power Platform brand theme for the harness shell.
 *
 * The harness deliberately uses *two* Fluent themes:
 *
 *  - **Power Platform purple** for harness chrome (top bar, side panels,
 *    coverage panel, gallery, dialogs). Signals "this is tooling" and aligns
 *    with the broader Power Platform / pac CLI / Maker Portal visual identity.
 *
 *  - **Standard Fluent blue / neutral** (`webLightTheme` / `webDarkTheme`) for
 *    the **form chrome** (FormChrome.tsx) so that what wraps the user's PCF
 *    matches real Unified Client Interface — UCI is neutral/blue, not purple.
 *    A dev's screenshot of their control rendered in the harness should be
 *    indistinguishable from the same control in production.
 *
 * The brand ramp below is a 16-step interpolation around Power Platform
 * primary purple (#742774). It mirrors the Maker Portal's accent ramp but is
 * an independent reconstruction — no Microsoft assets are embedded.
 */
import {
  createLightTheme, createDarkTheme,
  type BrandVariants, type Theme,
} from '@fluentui/react-components';

const powerPlatformBrand: BrandVariants = {
  10:  '#2D0A2D',
  20:  '#3D1340',
  30:  '#4D1850',
  40:  '#5D1C5E',
  50:  '#6B2069',
  60:  '#742774', // Power Platform primary
  70:  '#853985',
  80:  '#964D96',
  90:  '#A763A7',
  100: '#B87BB8',
  110: '#C794C7',
  120: '#D5ADD5',
  130: '#E2C6E2',
  140: '#EDDCED',
  150: '#F5EAF5',
  160: '#FCF5FC',
};

export const powerPlatformLightTheme: Theme = createLightTheme(powerPlatformBrand);
export const powerPlatformDarkTheme: Theme = createDarkTheme(powerPlatformBrand);
