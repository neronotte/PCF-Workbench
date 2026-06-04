import { createRoot } from 'react-dom/client';
import * as React from 'react';
import * as ReactDOMClient from 'react-dom/client';
import * as ReactDOM from 'react-dom';
import { App } from './App';
import { installXrmFormShim } from './shim/xrm-form';
import { installTestBridge } from './test-bridge';
import { installReactVersionedAliases } from './loader/react-aliases';

// Expose the harness's bundled React 18 as window.React/ReactDOM so that
// when resolveReactVersion picks 'fluent-upgrade' (manifest R16/R17 → R18),
// the pcf-plugin can SKIP loading a separate React 18 UMD and we reuse this
// single instance. Two React 18 instances in the same page collide on
// griffel's dispatcher state and unstyle the harness chrome — see
// pcf-plugin.transformIndexHtml for the matching skip-logic.
//
// ReactDOM is exposed as a merged object so consumers find both the legacy
// `render` (from 'react-dom') AND the React 18 `createRoot` (from
// 'react-dom/client') on the single global. Accessing createRoot off the
// plain 'react-dom' import triggers a deprecation warning in React 18.
//
// Only set when not already present (manifest-declared R16/R17 controls still
// inject their own UMD before main.tsx runs; don't clobber those globals).
const w = window as any;
if (!w.React) w.React = React;
if (!w.ReactDOM) w.ReactDOM = { ...ReactDOM, ...ReactDOMClient };

// H1 — install Reactv16 / Reactv18 / Reactv940 / Reactv8290 / Reactv81211
// versioned aliases at boot, regardless of whether a control declares React
// in <platformLibraries>. Community PCFs (e.g. rwilson504/PCFControls
// Calendar + AuditControl) reference window.Reactv16 directly without
// declaring it; aliasing only inside loadPlatformLibraries left them
// crashing with "Reactv16 is not defined". Surfaced by the gallery
// validation run on 2026-06-04.
installReactVersionedAliases();

installXrmFormShim();
installTestBridge();

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
