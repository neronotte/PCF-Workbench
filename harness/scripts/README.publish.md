# PCF Workbench

> A local development harness + AI build loop for **Power Apps Component Framework (PCF)** controls.

[![npm version](https://img.shields.io/npm/v/@pcfworkbench/cli/beta.svg?label=npm%40beta)](https://npmjs.com/package/@pcfworkbench/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

PCF Workbench replaces `pcf-scripts start` with a richer dev loop. Build your PCF, run it locally against shimmed `ComponentFramework.Context` APIs, and iterate without a Dataverse round-trip — or hand the whole thing to an AI agent that drives `build → render → report` until your control passes.

## Install

```bash
npm i -D @pcfworkbench/cli@beta
```

> Currently published under the `@beta` tag during the M12 stabilization period. Plain `npm i -D @pcfworkbench/cli` works once we promote to `@latest`.
> The package lives in the `@pcfworkbench` org on npm so that the **PCF Workbench** brand owns the whole scope; the CLI is invoked as `pcfworkbench` regardless of the install path.

## Two commands

```bash
# Interactive — boot the harness UI in your browser
npx pcfworkbench start --path ./MyControl

# Headless — run one build → render → report cycle and exit
npx pcfworkbench loop  --path ./MyControl --out ./reports
```

`start` opens the harness at `http://127.0.0.1:8181` with your control loaded. Add `--workspace ./samples` instead of `--path` for gallery mode (multiple controls in a directory).

`loop` is the AI / CI gate: builds the control if needed, runs it through the harness in headless Chromium, and writes a deterministic JSON report (`report.json` + `screenshot.png`) — agents and PR comments read this report.

## What you get

- **Full `ComponentFramework.Context` shim** — webAPI (with OData), navigation, device, formatting, mode, parameters, resources, userSettings, utils.
- **Modern `formContext` + legacy `Xrm.Page`** — `getAttribute`, `getControl`, `data`, `ui.tabs`/`ui.sections`, `addOnSave`/`addOnChange`/`addOnLoad`, plus `executionContext` on every handler.
- **Test scenarios** — capture harness state (network mode, device preset, mock entity records, page context, scenario data) into `test-scenarios.json` and replay them on demand or via URL deep-link (`?scenario=<name>`).
- **Network conditioning** — online / offline / fast-3G / slow-3G / custom latency.
- **Device emulation** — Desktop (fluid, reactive), Tablet, iPhone 14 Pro, Pixel 7 — your control's `@media` rules auto-rewrite to `@container pcf-viewport` so they fire at the emulated size.
- **Live Dataverse bridge** *(optional)* — connect to a real org via `pac auth`, capture live records into a scenario for offline replay, on-disk response cache so the second run is offline-fast.
- **Lifecycle + leak detection** — diffs listeners / timers / observers across `init` → `destroy`.
- **Auto build watcher** — edit your PCF `.ts` source, harness HMRs the new `bundle.js` automatically.

## AI build loop

Two GitHub Copilot CLI skills ship in the [PCF Workbench repo](https://github.com/jaduplesms/PCF-Workbench/tree/main/.copilot/skills): `pcf-engineer` (writes / reviews PCF code) and `pcf-workbench` (runs the harness loop and reports back). They turn `npx pcfworkbench loop` into the gate of an end-to-end **requirement → code → render → verify → ship** loop on your laptop.

See [`BUILDING.md`](https://github.com/jaduplesms/PCF-Workbench/blob/main/BUILDING.md) for the full plan-first workflow.

## Requirements

- Node.js 18+ (required by Vite 6)
- A built PCF — `out/controls/<Name>/bundle.js` must exist before `pcfworkbench` can load it. Run `npm run build` in your PCF project.

## Contributing

Source, tests, samples, and full docs live at **https://github.com/jaduplesms/PCF-Workbench**. Issues, ideas, and PRs welcome.

## License

[MIT](./LICENSE) © jaduplesms
