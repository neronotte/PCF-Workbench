/**
 * Sets up versioned global aliases for platform libraries.
 *
 * React UMD scripts are injected into HTML by the Vite plugin (transformIndexHtml)
 * so window.React and window.ReactDOM are already available.
 * This module aliases them to the versioned names the PCF bundle expects:
 *   React 16  → window.Reactv16 / window.ReactDOMv16
 *   React 18  → window.Reactv18 / window.ReactDOMv18
 *
 * For Fluent UI, a Proxy stub is provided since the UMD bundle is too large (~4MB).
 */

import type { ManifestResources } from '../types/manifest';
import {
  tokens as v9Tokens,
  webLightTheme as v9WebLightTheme,
  webDarkTheme as v9WebDarkTheme,
  teamsLightTheme as v9TeamsLightTheme,
  teamsDarkTheme as v9TeamsDarkTheme,
  teamsHighContrastTheme as v9TeamsHighContrastTheme,
  shorthands as v9Shorthands,
  makeStyles as v9MakeStyles,
  mergeClasses as v9MergeClasses,
  makeFluentProvider as v9MakeFluentProvider,
  useFluent as v9UseFluent,
  useThemeClassName as v9UseThemeClassName,
} from './fluent-v9-shim';

/**
 * Set up versioned global aliases and Fluent UI stubs.
 * Must be called BEFORE the PCF bundle script is loaded.
 */
export async function loadPlatformLibraries(resources: ManifestResources): Promise<void> {
  const libs = resources.platformLibraries;
  if (!libs || libs.length === 0) return;

  const w = window as any;

  // Alias React/ReactDOM globals to versioned names
  const reactLib = libs.find(l => l.name === 'React');
  if (reactLib && w.React) {
    const major = reactLib.version.split('.')[0];
    const reactGlobal = `Reactv${major}`;
    const reactDomGlobal = `ReactDOMv${major}`;

    w[reactGlobal] = w.React;
    w[reactDomGlobal] = w.ReactDOM;
    console.log(`[pcf-workbench] React ${major} aliased: window.${reactGlobal}, window.${reactDomGlobal}`);

    // Deployed bundles compiled against Fluent v8/v9 reference React via versioned
    // globals like Reactv940 / Reactv8290 (the React instance bundled with that
    // Fluent version), not window.React. Alias the loaded React under all known
    // versioned globals so bundles find what they expect regardless of manifest drift.
    const versionedReactGlobals = ['Reactv16', 'Reactv17', 'Reactv18', 'Reactv940', 'Reactv8290', 'Reactv81211'];
    const versionedReactDomGlobals = ['ReactDOMv16', 'ReactDOMv17', 'ReactDOMv18', 'ReactDOMv940', 'ReactDOMv8290', 'ReactDOMv81211'];
    for (const name of versionedReactGlobals) if (!w[name]) w[name] = w.React;
    for (const name of versionedReactDomGlobals) if (!w[name]) w[name] = w.ReactDOM;

    // Polyfill React 18-only APIs that Fluent v9 controls expect even on React 16/17.
    // The platform (UCI) provides similar polyfills implicitly; deployed bundles assume
    // they exist. Without these, controls crash on first render with cryptic errors.
    if (typeof w.React.useId !== 'function') {
      let _idCounter = 0;
      w.React.useId = () => w.React.useMemo(() => `:pcfwb-${(_idCounter++).toString(36)}:`, []);
      console.log(`[pcf-workbench] Polyfilled React.useId for compatibility with Fluent v9`);
    }
    if (typeof w.React.useSyncExternalStore !== 'function') {
      // Minimal polyfill — sufficient for Fluent v9's internal use
      w.React.useSyncExternalStore = (subscribe: any, getSnapshot: any) => {
        const [value, setValue] = w.React.useState(getSnapshot());
        w.React.useEffect(() => {
          const handler = () => setValue(getSnapshot());
          handler();
          return subscribe(handler);
        }, [subscribe, getSnapshot]);
        return value;
      };
      console.log(`[pcf-workbench] Polyfilled React.useSyncExternalStore`);
    }
    if (typeof w.React.useInsertionEffect !== 'function') {
      w.React.useInsertionEffect = w.React.useLayoutEffect ?? w.React.useEffect;
      console.log(`[pcf-workbench] Polyfilled React.useInsertionEffect → useLayoutEffect`);
    }
  }

  // Set up Fluent UI — load every major actually referenced by the bundle.
  //
  // M9 fix: previously we loaded a single Fluent version (from the manifest)
  // and aliased it under every versioned global name. That worked for controls
  // that used only one Fluent line but BROKE deployed controls that mix v8 + v9
  // (e.g. ColorPicker uses v8 color utils + v9 UI). Calling v9-style APIs like
  // `FluentUIReactv940.shorthands.gap()` against an aliased v8 namespace blew
  // up with "Cannot read properties of undefined (reading 'gap')".
  //
  // The Vite plugin pre-scans the bundle for FluentUIReactv<N> references and
  // populates `resources.fluentNeeds` with the majors and versions to load.
  // We honour that here. If the manifest declares Fluent but the scan didn't
  // run (older code path / older extracted control) we fall back to a
  // single-version load.
  const fluentLib = libs.find(l => l.name === 'Fluent');
  const needs = resources.fluentNeeds;
  const targets: { major: 'v8' | 'v9'; version: string }[] = [];
  if (needs?.v8) targets.push({ major: 'v8', version: needs.v8 });
  if (needs?.v9) targets.push({ major: 'v9', version: needs.v9 });
  if (targets.length === 0 && fluentLib) {
    const major: 'v8' | 'v9' = fluentLib.version.split('.')[0] === '9' ? 'v9' : 'v8';
    targets.push({ major, version: fluentLib.version });
  }

  if (targets.length > 0) {
    const results = await Promise.all(
      targets.map(async t => ({ ...t, ok: await tryLoadRealFluent(t.major, t.version) })),
    );
    for (const r of results) {
      if (r.ok) {
        console.log(`[pcf-workbench] Fluent ${r.major} ${r.version} loaded from /__pcf/fluent-cdn`);
      } else {
        // CDN unavailable for this major (offline, npm install failed, etc.) —
        // fall back to the lightweight stub for ONLY this major's globals.
        // Don't touch the other major's globals (they may have loaded fine).
        const stub = createFluentStub(w);
        const stubGlobals = r.major === 'v9'
          ? ['FluentUIReactv940', 'FluentUIReactv946']
          : ['FluentUIReact', 'FluentUIReactv8290', 'FluentUIReactv81211'];
        console.warn(`[pcf-workbench] Fluent ${r.major} setup: real UMD unavailable, falling back to stub — exposing ${stubGlobals.join(', ')}`);
        for (const name of stubGlobals) {
          if (!w[name]) w[name] = stub;
          else console.warn(`[pcf-workbench] Fluent UI global window.${name} already exists — keeping existing.`);
        }
      }
    }
  }
}

/**
 * Try to load a real Fluent UMD via the /__pcf/fluent-cdn middleware. Returns
 * true if a script with `__pcfwbReal` marker becomes available on window, false
 * otherwise (network failure, build failure, marker missing). Safe to call from
 * any browser context — never throws.
 *
 * `major` is supplied by the caller because v8/v9 detection happens at the
 * scan stage, not from the version string (e.g. a v9 reference may pair with
 * a manifest-declared v8 version when the bundle mixes both lines).
 */
async function tryLoadRealFluent(major: 'v8' | 'v9', version: string): Promise<boolean> {
  const w = window as any;
  const canonical = major === 'v9' ? 'FluentUIReactv940' : 'FluentUIReact';

  // Already loaded by a previous control switch?
  if (w.__pcfwbFluentReal?.[major] && w[canonical]) return true;

  const url = `/__pcf/fluent-cdn/${major}/${version}/bundle.js`;
  console.log(`[pcf-workbench] Fluent: requesting real UMD ${url} (first request may take 10-60s for npm install + esbuild)`);

  return new Promise<boolean>(resolve => {
    const existing = document.querySelector(`script[data-pcf-fluent-cdn="${major}-${version}"]`);
    if (existing) {
      // Another loader is already in flight — re-check after a tick.
      setTimeout(() => resolve(!!(w.__pcfwbFluentReal?.[major] && w[canonical])), 100);
      return;
    }
    const s = document.createElement('script');
    s.src = url;
    s.setAttribute('data-pcf-fluent-cdn', `${major}-${version}`);
    s.onload = () => {
      if (w.__pcfwbFluentReal?.[major] && w[canonical]) resolve(true);
      else {
        console.warn(`[pcf-workbench] Fluent CDN script loaded but window.${canonical} or marker missing.`);
        resolve(false);
      }
    };
    s.onerror = () => {
      console.warn(`[pcf-workbench] Fluent CDN load failed for ${url}. Falling back to stub.`);
      resolve(false);
    };
    document.head.appendChild(s);
  });
}

function createFluentStub(w: any) {
  const getReact = () => w.Reactv16 ?? w.Reactv18 ?? w.React;

  // Helper to create a stub component that renders as an HTML element
  const comp = (tag: string, displayName: string) => {
    const c = (props: any) => {
      const R = getReact();
      if (!R) return null;
      const { children, text, label, placeholder, style, className, onClick, onChange, onBlur, checked, value, disabled, ...rest } = props;
      const htmlProps: any = { 'data-fluent': displayName, style, className, onClick };
      if (disabled) htmlProps['data-disabled'] = 'true';
      const content = children ?? text ?? label ?? null;
      return R.createElement(tag, htmlProps, content);
    };
    c.displayName = `FluentStub(${displayName})`;
    return c;
  };

  // Enum/constant stubs
  const enums: Record<string, any> = {
    MessageBarType: { info: 0, error: 1, blocked: 2, severeWarning: 3, success: 4, warning: 5 },
    SpinnerSize: { xSmall: 0, small: 1, medium: 2, large: 3 },
    DropdownMenuItemType: { normal: 0, divider: 1, header: 2 },
    SelectableOptionMenuItemType: { normal: 0, divider: 1, header: 2 },
    DatePickerDayOfWeek: { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 },
    IconType: { default: 0, image: 1 },
    ResponsiveMode: { small: 0, medium: 1, large: 2, xLarge: 3, xxLarge: 4, xxxLarge: 5 },
  };

  // Explicit component stubs with appropriate HTML tags
  const components: Record<string, any> = {
    Stack: Object.assign(comp('div', 'Stack'), {
      Item: comp('div', 'Stack.Item'),
    }),
    StackItem: comp('div', 'StackItem'),
    Text: comp('span', 'Text'),
    Label: comp('label', 'Label'),
    TextField: (props: any) => {
      const R = getReact();
      if (!R) return null;
      return R.createElement('div', { 'data-fluent': 'TextField', style: props.style },
        props.label && R.createElement('label', null, props.label),
        R.createElement('input', {
          type: props.type ?? 'text', value: props.value ?? '', placeholder: props.placeholder,
          disabled: props.disabled, onChange: (e: any) => props.onChange?.(e, e.target.value),
          onBlur: props.onBlur, style: { width: '100%', padding: '6px 8px', border: '1px solid #ccc', borderRadius: 2 },
        }),
      );
    },
    Dropdown: (props: any) => {
      const R = getReact();
      if (!R) return null;
      return R.createElement('div', { 'data-fluent': 'Dropdown', style: props.style },
        props.label && R.createElement('label', null, props.label),
        R.createElement('select', {
          value: props.selectedKey ?? '', disabled: props.disabled,
          onChange: (e: any) => props.onChange?.(e, { key: e.target.value, text: e.target.options[e.target.selectedIndex]?.text }),
          style: { width: '100%', padding: '6px 8px', border: '1px solid #ccc', borderRadius: 2 },
        }, (props.options ?? []).map((o: any) => R.createElement('option', { key: o.key, value: o.key }, o.text))),
      );
    },
    ComboBox: (props: any) => {
      const R = getReact();
      if (!R) return null;
      return R.createElement('div', { 'data-fluent': 'ComboBox' },
        props.label && R.createElement('label', null, props.label),
        R.createElement('input', {
          value: props.text ?? '', placeholder: props.placeholder, disabled: props.disabled,
          style: { width: '100%', padding: '6px 8px', border: '1px solid #ccc', borderRadius: 2 },
        }),
      );
    },
    Checkbox: (props: any) => {
      const R = getReact();
      if (!R) return null;
      return R.createElement('label', { 'data-fluent': 'Checkbox', style: { display: 'flex', alignItems: 'center', gap: 6, ...props.style } },
        R.createElement('input', {
          type: 'checkbox', checked: props.checked ?? false, disabled: props.disabled,
          onChange: (e: any) => props.onChange?.(e, e.target.checked),
        }),
        R.createElement('span', null, props.label),
      );
    },
    ChoiceGroup: (props: any) => {
      const R = getReact();
      if (!R) return null;
      return R.createElement('div', { 'data-fluent': 'ChoiceGroup', style: props.style },
        props.label && R.createElement('label', { style: { fontWeight: 600 } }, props.label),
        ...(props.options ?? []).map((o: any) =>
          R.createElement('label', { key: o.key, style: { display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' } },
            R.createElement('input', {
              type: 'radio', name: props.name ?? 'choice', value: o.key,
              checked: props.selectedKey === o.key, disabled: props.disabled || o.disabled,
              onChange: () => props.onChange?.(null, o),
            }),
            R.createElement('span', null, o.text),
          ),
        ),
      );
    },
    Toggle: (props: any) => {
      const R = getReact();
      if (!R) return null;
      return R.createElement('label', { 'data-fluent': 'Toggle', style: { display: 'flex', alignItems: 'center', gap: 6, ...props.style } },
        R.createElement('input', {
          type: 'checkbox', checked: props.checked ?? false, disabled: props.disabled,
          onChange: (e: any) => props.onChange?.(e, e.target.checked),
        }),
        R.createElement('span', null, props.label ?? props.onText ?? ''),
      );
    },
    SpinButton: (props: any) => {
      const R = getReact();
      if (!R) return null;
      return R.createElement('div', { 'data-fluent': 'SpinButton', style: props.style },
        props.label && R.createElement('label', null, props.label),
        R.createElement('input', {
          type: 'number', defaultValue: props.value ?? '', disabled: props.disabled, min: props.min, max: props.max,
          onChange: (e: any) => props.onChange?.(e, e.target.value),
          onBlur: props.onBlur,
          style: { width: '100%', padding: '6px 8px', border: '1px solid #ccc', borderRadius: 2 },
        }),
      );
    },
    DatePicker: (props: any) => {
      const R = getReact();
      if (!R) return null;
      return R.createElement('div', { 'data-fluent': 'DatePicker', style: props.style },
        props.label && R.createElement('label', null, props.label),
        R.createElement('input', {
          type: 'date', disabled: props.disabled, placeholder: props.placeholder,
          style: { width: '100%', padding: '6px 8px', border: '1px solid #ccc', borderRadius: 2 },
        }),
      );
    },
    DefaultButton: (props: any) => {
      const R = getReact();
      if (!R) return null;
      const isPrimary = props.primary === true;
      return R.createElement('button', {
        'data-fluent': 'DefaultButton', onClick: props.onClick, disabled: props.disabled,
        className: props.className || '',
        style: {
          padding: '6px 16px',
          backgroundColor: isPrimary ? '#0078d4' : '#fff',
          color: isPrimary ? '#fff' : '#323130',
          border: isPrimary ? 'none' : '1px solid #8a8886',
          borderRadius: 2, cursor: 'pointer', fontSize: '14px', fontWeight: 600, lineHeight: '20px',
          minWidth: '80px', textAlign: 'center' as const, ...props.style,
        },
      }, props.text, props.children);
    },
    PrimaryButton: (props: any) => {
      const R = getReact();
      if (!R) return null;
      return R.createElement('button', {
        'data-fluent': 'PrimaryButton', onClick: props.onClick, disabled: props.disabled,
        className: props.className || '',
        style: {
          padding: '6px 20px', backgroundColor: '#0078d4', color: 'white', border: 'none',
          borderRadius: 2, cursor: 'pointer', fontSize: '14px', fontWeight: 600, lineHeight: '20px',
          minWidth: '80px', textAlign: 'center', ...props.style,
        },
      }, props.text, props.children);
    },
    IconButton: (props: any) => {
      const R = getReact();
      if (!R) return null;
      return R.createElement('button', {
        'data-fluent': 'IconButton', onClick: props.onClick, disabled: props.disabled,
        className: props.className || '',
        title: props.title,
        style: {
          padding: '4px 8px', backgroundColor: 'transparent', border: '1px solid #8a8886',
          borderRadius: 2, cursor: 'pointer', display: 'inline-flex', alignItems: 'center',
          justifyContent: 'center', minWidth: '32px', minHeight: '32px', ...props.style,
        },
      }, props.children);
    },
    MessageBar: (props: any) => {
      const R = getReact();
      if (!R) return null;
      const bgColors: Record<number, string> = { 0: '#f3f2f1', 1: '#fde7e9', 4: '#dff6dd', 5: '#fff4ce' };
      return R.createElement('div', {
        'data-fluent': 'MessageBar',
        style: { padding: '8px 12px', backgroundColor: bgColors[props.messageBarType ?? 0] ?? '#f3f2f1', borderRadius: 2, ...props.style },
      }, props.children);
    },
    Spinner: (props: any) => {
      const R = getReact();
      if (!R || props.hidden) return null;
      return R.createElement('div', {
        'data-fluent': 'Spinner', style: { textAlign: 'center', padding: 16, ...props.style },
      }, props.label ?? 'Loading...');
    },
    Icon: (props: any) => {
      const R = getReact();
      if (!R) return null;
      const iconName = props.iconName ?? '';

      // Check icon registry first (for icons registered via registerIcons)
      const registered = iconRegistry[iconName.toLowerCase()];
      if (registered) {
        // Registered icons are typically React elements (JSX/SVG)
        if (typeof registered === 'object' && registered !== null) {
          return R.createElement('span', {
            'data-fluent': 'Icon', 'data-icon': iconName,
            style: { display: 'inline-flex', ...props.style },
            dangerouslySetInnerHTML: typeof registered === 'string' ? { __html: registered } : undefined,
          }, typeof registered !== 'string' ? registered : undefined);
        }
      }

      // Fallback: common Fluent icon names → Unicode symbols
      const iconMap: Record<string, string> = {
        FavoriteStar: '\u2605', FavoriteStarFill: '\u2605', FavoriteStarEmpty: '\u2606',
        Cancel: '\u2715', CheckMark: '\u2713', Add: '\u002B', Delete: '\u2716',
        Edit: '\u270E', Search: '\u2315', ChevronRight: '\u203A', ChevronLeft: '\u2039',
        ChevronDown: '\u2304', ChevronUp: '\u2303', Info: '\u2139', Warning: '\u26A0',
        Error: '\u2716', Camera: '\u{1F4F7}', Attach: '\u{1F4CE}', Save: '\u{1F4BE}', PDF: '\u{1F4C4}',
      };
      const symbol = iconMap[iconName] ?? iconName ?? '';
      return R.createElement('span', {
        'data-fluent': 'Icon', 'data-icon': iconName,
        style: { ...props.style, fontStyle: 'normal' },
      }, symbol);
    },
    ProgressIndicator: (props: any) => {
      const R = getReact();
      if (!R || props.hidden) return null;
      return R.createElement('div', {
        'data-fluent': 'ProgressIndicator',
        style: { padding: '8px 0', ...props.style },
      },
        props.label && R.createElement('div', { style: { fontSize: 12, marginBottom: 4 } }, props.label),
        R.createElement('div', {
          style: { height: 4, backgroundColor: '#edebe9', borderRadius: 2, overflow: 'hidden' },
        }, R.createElement('div', {
          style: {
            height: '100%', width: props.percentComplete != null ? `${props.percentComplete * 100}%` : '40%',
            backgroundColor: '#0078d4', borderRadius: 2,
            animation: props.percentComplete == null ? 'none' : undefined,
          },
        })),
        props.description && R.createElement('div', { style: { fontSize: 11, color: '#605e5c', marginTop: 4 } }, props.description),
      );
    },
    Modal: (props: any) => {
      const R = getReact();
      if (!R || !props.isOpen) return null;
      return R.createElement('div', {
        'data-fluent': 'Modal',
        className: props.containerClassName || '',
        style: {
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backgroundColor: 'rgba(0,0,0,0.4)',
        },
      }, R.createElement('div', {
        style: { backgroundColor: '#fff', borderRadius: 4, padding: '24px', minWidth: 340, maxWidth: 600, maxHeight: '80vh', overflow: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' },
      }, props.children));
    },
    DialogFooter: (props: any) => {
      const R = getReact();
      if (!R) return null;
      return R.createElement('div', {
        'data-fluent': 'DialogFooter',
        style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
      }, props.children);
    },
    ThemeProvider: (props: any) => {
      const R = getReact();
      return R ? R.createElement(R.Fragment, null, props.children) : null;
    },
  };

  // Icon registry — stores icons registered via registerIcons()
  const iconRegistry: Record<string, any> = {};

  // Utility function stubs
  const utilities: Record<string, any> = {
    mergeStyles: (..._args: any[]) => '',
    mergeStyleSets: (...args: any[]) => args.reduce((a: any, b: any) => ({ ...a, ...b }), {}),
    concatStyleSets: (...args: any[]) => args.reduce((a: any, b: any) => ({ ...a, ...b }), {}),
    concatStyleSetsWithProps: (...args: any[]) => args.reduce((a: any, b: any) => ({ ...a, ...b }), {}),
    createTheme: (t: any) => t ?? {},
    loadTheme: () => {},
    getTheme: () => ({ palette: {}, fonts: {}, semanticColors: {} }),
    useTheme: () => ({ palette: {}, fonts: {}, semanticColors: {} }),
    styled: (component: any) => component,
    classNamesFunction: () => () => ({}),
    getNativeProps: (props: any) => props ?? {},
    getId: (prefix?: string) => `${prefix ?? 'id'}-${Math.random().toString(36).slice(2, 8)}`,
    css: (...args: any[]) => args.filter(Boolean).join(' '),
    initializeIcons: () => {},
    registerIcons: (iconSet: any) => {
      // Store registered icons so Icon component can render them
      if (iconSet?.icons) {
        for (const [name, value] of Object.entries(iconSet.icons)) {
          iconRegistry[name.toLowerCase()] = value;
        }
      }
    },
    FontWeights: { regular: 400, semibold: 600, bold: 700 },
    FontSizes: { mini: '10px', xSmall: '10px', small: '12px', smallPlus: '13px', medium: '14px', mediumPlus: '15px', large: '16px', xLarge: '20px', xxLarge: '28px' },
    AnimationStyles: {},
    DefaultPalette: {},
  };

  // Build the combined lookup
  const allExports: Record<string, any> = { ...enums, ...components, ...utilities };

  // Fluent v9 named exports — only inject when the Fluent UI version is v9+.
  // For v8 these names don't exist on the real package; leaving them out
  // matches reality and avoids surprises when authors target v8.
  // (Detection happens in the caller; this stub is only mounted under the
  // FluentUIReactv940 global, so we always add v9 exports here.)
  const fluentProviderStub = v9MakeFluentProvider(getReact);

  // Only add v9 component overrides if they won't conflict with v8 components
  // already in allExports. The v8 Dialog uses `hidden` prop; v9 uses `open`.
  const v9Components: Record<string, any> = {
    tokens: v9Tokens,
    webLightTheme: v9WebLightTheme,
    webDarkTheme: v9WebDarkTheme,
    teamsLightTheme: v9TeamsLightTheme,
    teamsDarkTheme: v9TeamsDarkTheme,
    teamsHighContrastTheme: v9TeamsHighContrastTheme,
    shorthands: v9Shorthands,
    makeStyles: v9MakeStyles,
    mergeClasses: v9MergeClasses,
    FluentProvider: fluentProviderStub,
    useFluent: v9UseFluent,
    useThemeClassName: v9UseThemeClassName,
  };

  // Only add v9 dialog sub-components if they don't already exist from v8
  const v9DialogComponents: Record<string, any> = {
    // Common dialog sub-components used in v9 — pass-through wrappers
    Dialog: (props: any) => {
      const R = getReact();
      if (!R) return null;
      // Support BOTH v8 (hidden prop) and v9 (open prop)
      if (props.hidden === true || props.open === false) return null;
      const title = props.dialogContentProps?.title ?? '(untitled)';
      console.log(`[pcf-workbench] Dialog "${title}" rendering (hidden=${props.hidden}, open=${props.open})`);
      return R.createElement('div', {
        'data-fluent': 'Dialog',
        style: {
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backgroundColor: 'rgba(0,0,0,0.4)',
        },
        onClick: (e: any) => {
          if (e.target === e.currentTarget) {
            // v8: onDismiss callback
            if (props.onDismiss) props.onDismiss(e);
            // v9: onOpenChange callback
            if (props.onOpenChange) props.onOpenChange(e, { open: false, type: 'backdropClick' });
          }
        },
      },
        // v8 style: render inner panel with dialogContentProps
        props.dialogContentProps ? R.createElement('div', {
          style: {
            backgroundColor: '#fff', borderRadius: 4, padding: '24px', minWidth: 340, maxWidth: 500,
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          },
        },
          props.dialogContentProps?.title && R.createElement('div', { style: { fontSize: 20, fontWeight: 600, marginBottom: 12 } }, props.dialogContentProps.title),
          props.dialogContentProps?.subText && R.createElement('div', { style: { fontSize: 14, color: '#605e5c', marginBottom: 16 } }, props.dialogContentProps.subText),
          props.children,
        ) : props.children,
      );
    },
    DialogSurface: (props: any) => {
      const R = getReact();
      if (!R) return null;
      return R.createElement('div', {
        'data-fluent': 'DialogSurface',
        style: {
          backgroundColor: '#FFFFFF', borderRadius: 8, minWidth: 340, maxWidth: 480,
          width: '100%', maxHeight: '80vh', boxShadow: v9Tokens.shadow16, overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        },
      }, props.children);
    },
    DialogBody: (props: any) => {
      const R = getReact();
      if (!R) return null;
      return R.createElement('div', {
        'data-fluent': 'DialogBody', style: { display: 'flex', flexDirection: 'column' },
      }, props.children);
    },
    DialogTitle: (props: any) => {
      const R = getReact();
      if (!R) return null;
      return R.createElement('div', {
        'data-fluent': 'DialogTitle',
        style: { padding: '24px 24px 8px 24px', fontSize: 20, fontWeight: 600, color: v9Tokens.colorNeutralForeground1 },
      }, props.children);
    },
    DialogContent: (props: any) => {
      const R = getReact();
      if (!R) return null;
      return R.createElement('div', {
        'data-fluent': 'DialogContent',
        style: { padding: '0 24px 16px 24px', color: v9Tokens.colorNeutralForeground2, overflow: 'auto' },
      }, props.children);
    },
    DialogActions: (props: any) => {
      const R = getReact();
      if (!R) return null;
      return R.createElement('div', {
        'data-fluent': 'DialogActions',
        style: { padding: '8px 24px 24px 24px', display: 'flex', gap: 8, justifyContent: 'flex-end' },
      }, props.children);
    },
    DialogTrigger: (props: any) => {
      const R = getReact();
      if (!R) return null;
      return typeof props.children === 'function' ? props.children({}) : props.children;
    },
    // v9 Button — render proper HTML button respecting appearance prop
    Button: (props: any) => {
      const R = getReact();
      if (!R) return null;
      const { appearance = 'secondary', icon, children, disabled, onClick, className, style: extraStyle } = props;
      const palette: Record<string, any> = {
        primary: {
          background: v9Tokens.colorBrandBackground, color: v9Tokens.colorNeutralForegroundOnBrand,
          border: `1px solid ${v9Tokens.colorBrandBackground}`,
        },
        secondary: {
          background: v9Tokens.colorNeutralBackground1, color: v9Tokens.colorNeutralForeground1,
          border: `1px solid ${v9Tokens.colorNeutralStroke1}`,
        },
        subtle: {
          background: 'transparent', color: v9Tokens.colorNeutralForeground2,
          border: '1px solid transparent',
        },
        outline: {
          background: 'transparent', color: v9Tokens.colorNeutralForeground1,
          border: `1px solid ${v9Tokens.colorNeutralStroke1}`,
        },
        transparent: {
          background: 'transparent', color: v9Tokens.colorNeutralForeground2,
          border: '1px solid transparent',
        },
      };
      const p = palette[appearance] ?? palette.secondary;
      return R.createElement('button', {
        type: 'button', 'data-fluent': 'Button', 'data-appearance': appearance,
        onClick, disabled, className,
        style: {
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '5px 12px', minHeight: 32,
          borderRadius: 4, fontFamily: v9Tokens.fontFamilyBase, fontSize: 14, fontWeight: 600,
          cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
          ...p,
          ...extraStyle,
        },
      }, icon, children);
    },
    MessageBarBody: (props: any) => {
      const R = getReact();
      if (!R) return null;
      return R.createElement('div', { 'data-fluent': 'MessageBarBody', style: { padding: '4px 0' } }, props.children);
    },
  };

  // Fluent v9 DataGrid family — render-prop based, needs context to share state
  // between DataGrid → DataGridHeader/Body → DataGridRow → DataGridHeaderCell/Cell.
  // createTableColumn is an identity helper — Fluent's real implementation just
  // returns its config (it exists for type inference, no runtime work).
  const dataGridContext = (() => {
    const R = getReact();
    return R ? R.createContext({ columns: [] as any[], items: [] as any[], section: 'body' as 'header' | 'body', currentItem: null as any, currentRowId: null as any }) : null;
  })();

  const v9DataGridComponents: Record<string, any> = {
    createTableColumn: (config: any) => config,
    TableColumnDefinition: undefined,
    DataGrid: (props: any) => {
      const R = getReact();
      if (!R || !dataGridContext) return null;
      const { columns = [], items = [], children, style: extraStyle, className } = props;
      return R.createElement(dataGridContext.Provider, {
        value: { columns, items, section: 'body', currentItem: null, currentRowId: null },
      }, R.createElement('div', {
        'data-fluent': 'DataGrid', role: 'grid', className,
        style: {
          display: 'flex', flexDirection: 'column', width: '100%',
          fontFamily: v9Tokens.fontFamilyBase, fontSize: 14,
          ...extraStyle,
        },
      }, children));
    },
    DataGridHeader: (props: any) => {
      const R = getReact();
      if (!R || !dataGridContext) return null;
      const ctx = R.useContext(dataGridContext);
      return R.createElement(dataGridContext.Provider, {
        value: { ...ctx, section: 'header' },
      }, R.createElement('div', {
        'data-fluent': 'DataGridHeader', role: 'rowgroup',
        style: {
          display: 'flex', flexDirection: 'column',
          backgroundColor: v9Tokens.colorNeutralBackground2,
          borderBottom: `2px solid ${v9Tokens.colorNeutralStroke1}`,
          fontWeight: 600,
        },
      }, props.children));
    },
    DataGridBody: (props: any) => {
      const R = getReact();
      if (!R || !dataGridContext) return null;
      const ctx = R.useContext(dataGridContext);
      const { children } = props;
      const rendered = ctx.items.map((item: any, idx: number) => {
        const rowId = item?.id ?? idx;
        const childOutput = typeof children === 'function'
          ? children({ item, rowId })
          : children;
        return R.createElement(dataGridContext.Provider, {
          key: rowId,
          value: { ...ctx, section: 'body', currentItem: item, currentRowId: rowId },
        }, childOutput);
      });
      return R.createElement('div', {
        'data-fluent': 'DataGridBody', role: 'rowgroup',
        style: { display: 'flex', flexDirection: 'column' },
      }, rendered);
    },
    DataGridRow: (props: any) => {
      const R = getReact();
      if (!R || !dataGridContext) return null;
      const ctx = R.useContext(dataGridContext);
      const { children } = props;
      const cells = ctx.columns.map((col: any) => {
        const callbacks = ctx.section === 'header'
          ? { renderHeaderCell: () => col.renderHeaderCell ? col.renderHeaderCell() : col.columnId }
          : { renderCell: (item: any) => col.renderCell ? col.renderCell(item ?? ctx.currentItem) : '' };
        const childOutput = typeof children === 'function' ? children(callbacks) : children;
        return R.createElement(R.Fragment, { key: col.columnId ?? Math.random() }, childOutput);
      });
      return R.createElement('div', {
        'data-fluent': 'DataGridRow', role: 'row',
        style: {
          display: 'flex', flexDirection: 'row',
          borderBottom: `1px solid ${v9Tokens.colorNeutralStroke2}`,
          minHeight: 36,
        },
      }, cells);
    },
    DataGridHeaderCell: (props: any) => {
      const R = getReact();
      if (!R) return null;
      return R.createElement('div', {
        'data-fluent': 'DataGridHeaderCell', role: 'columnheader',
        style: {
          flex: 1, padding: '8px 12px',
          display: 'flex', alignItems: 'center',
          color: v9Tokens.colorNeutralForeground1,
        },
      }, props.children);
    },
    DataGridCell: (props: any) => {
      const R = getReact();
      if (!R) return null;
      return R.createElement('div', {
        'data-fluent': 'DataGridCell', role: 'gridcell',
        style: {
          flex: 1, padding: '8px 12px',
          display: 'flex', alignItems: 'center',
          color: v9Tokens.colorNeutralForeground1,
        },
      }, props.children);
    },
    Toolbar: (props: any) => {
      const R = getReact();
      if (!R) return null;
      return R.createElement('div', {
        'data-fluent': 'Toolbar', role: 'toolbar',
        style: {
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '4px 8px',
          backgroundColor: v9Tokens.colorNeutralBackground1,
        },
      }, props.children);
    },
    ToolbarButton: (props: any) => {
      const R = getReact();
      if (!R) return null;
      const { children, icon, onClick, disabled, appearance } = props;
      return R.createElement('button', {
        type: 'button', 'data-fluent': 'ToolbarButton', 'data-appearance': appearance,
        onClick, disabled,
        style: {
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '4px 10px', minHeight: 28,
          background: 'transparent',
          border: '1px solid transparent', borderRadius: 4,
          color: v9Tokens.colorNeutralForeground1,
          fontFamily: v9Tokens.fontFamilyBase, fontSize: 14,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
        },
      }, icon, children);
    },
    ToolbarDivider: (props: any) => {
      const R = getReact();
      if (!R) return null;
      return R.createElement('div', {
        'data-fluent': 'ToolbarDivider',
        style: {
          width: 1, alignSelf: 'stretch', margin: '4px 4px',
          backgroundColor: v9Tokens.colorNeutralStroke2,
        },
      });
    },
  };

  // Common Fluent v9 hooks that bundles import. Provide minimal working stubs
  // so deployed controls don't crash on first render.
  let _hookIdCounter = 0;
  const fluentHooks: Record<string, any> = {
    useId: (prefix?: string) => {
      const R = getReact();
      if (!R) return `:fluent-${(_hookIdCounter++).toString(36)}:`;
      return R.useMemo(() => `${prefix ?? ':fluent'}-${(_hookIdCounter++).toString(36)}:`, []);
    },
    useFluent: () => ({ targetDocument: typeof document !== 'undefined' ? document : undefined, dir: 'ltr', theme: v9WebLightTheme }),
    useFluent_unstable: () => ({ targetDocument: typeof document !== 'undefined' ? document : undefined, dir: 'ltr', theme: v9WebLightTheme }),
    useThemeClassName_unstable: () => '',
    useTheme: () => v9WebLightTheme,
    useArrowNavigationGroup: () => ({}),
    useFocusableGroup: () => ({}),
    useFocusFinders: () => ({ findFirstFocusable: () => null, findLastFocusable: () => null, findAllFocusable: () => [] }),
    useTabster: () => null,
    useFocusVisible: () => ({}),
    useFocusWithin: () => () => {},
    useMergedRefs: (...refs: any[]) => (instance: any) => {
      for (const ref of refs) {
        if (typeof ref === 'function') ref(instance);
        else if (ref && typeof ref === 'object') ref.current = instance;
      }
    },
    useEventCallback: (fn: any) => {
      const R = getReact();
      if (!R) return fn;
      const ref = R.useRef(fn);
      R.useLayoutEffect ? R.useLayoutEffect(() => { ref.current = fn; }) : (ref.current = fn);
      return R.useCallback((...args: any[]) => ref.current?.(...args), []);
    },
    useFirstMount: () => false,
    useIsomorphicLayoutEffect: (fn: any, deps: any) => {
      const R = getReact();
      if (!R) return;
      (R.useLayoutEffect ?? R.useEffect)(fn, deps);
    },
    useControllableState: (opts: any) => {
      const R = getReact();
      if (!R) return [opts?.defaultState, () => {}];
      const [state, setState] = R.useState(opts?.state !== undefined ? opts.state : (typeof opts?.defaultState === 'function' ? opts.defaultState() : opts?.defaultState));
      return [opts?.state !== undefined ? opts.state : state, setState];
    },
    useOnClickOutside: () => {},
    useOnScrollOutside: () => {},
    canUseDOM: typeof document !== 'undefined',
    isHTMLElement: (x: any) => typeof HTMLElement !== 'undefined' && x instanceof HTMLElement,
    elementContains: (parent: any, child: any) => parent?.contains?.(child) ?? false,
    getNativeElementProps: (tag: string, props: any, excludedProps: any[] = []) => {
      const out: any = {};
      for (const k in props) if (!excludedProps.includes(k)) out[k] = props[k];
      return out;
    },
    getIntrinsicElementProps: (tag: string, props: any, excludedProps: any[] = []) => {
      const out: any = {};
      for (const k in props) if (!excludedProps.includes(k)) out[k] = props[k];
      return out;
    },
    getSlots: (state: any) => ({ slots: state?.components ?? {}, slotProps: state ?? {} }),
    getSlotsNext: (state: any) => ({ slots: state?.components ?? {}, slotProps: state ?? {} }),
    resolveShorthand: (value: any) => (value == null ? undefined : (typeof value === 'object' ? value : { children: value })),
    slot: { always: (v: any) => v, optional: (v: any) => v },
    mergeCallbacks: (...cbs: any[]) => (...args: any[]) => { for (const cb of cbs) cb?.(...args); },
  };
  Object.assign(allExports, fluentHooks);

  // Merge: v9 tokens/styles first, then v9 dialog components, then DataGrid family.
  // v9 Dialog component handles both v8 (hidden prop) and v9 (open prop).
  Object.assign(allExports, v9Components, v9DialogComponents, v9DataGridComponents);

  return new Proxy(allExports, {
    get(target, prop) {
      if (typeof prop === 'symbol') return undefined;
      const key = prop as string;

      // Known export
      if (key in target) return target[key];

      // Unknown uppercase — return a generic component stub
      if (key[0] >= 'A' && key[0] <= 'Z') {
        const c = comp('div', key);
        target[key] = c; // Cache it
        return c;
      }

      return undefined;
    },
  });
}

/**
 * Get the versioned ReactDOM global for rendering virtual control output.
 */
export function getReactDOMGlobal(resources: ManifestResources): any | null {
  const reactLib = resources.platformLibraries.find(l => l.name === 'React');
  if (!reactLib) return null;
  const major = reactLib.version.split('.')[0];
  const globalName = `ReactDOMv${major}`;
  return (window as any)[globalName] ?? (window as any).ReactDOM ?? null;
}
