# PCF Workbench

An enhanced development and testing environment for Power App Component Framework (PCF) controls, replacing the built-in `pcf-scripts start` harness with offline simulation, network conditioning, performance monitoring, and a control gallery.

## Quick Start

### Gallery Mode (browse all controls)
```bash
cd PCFBuilderFramework/harness
PCF_WORKSPACE_ROOT="C:/Claude.Code" npx vite --port 8181
```
Opens a gallery showing all PCF controls in the workspace with metadata, badges, and deep-link to open each one.

### Single Control Mode
```bash
# Via environment variable
PCF_CONTROL_PATH="../BookingStatusTransitionControl/BookingStatusTransitionControl" npx vite --port 8181

# Via CLI
node bin/pcf-harness.js --path ../BookingStatusTransitionControl/BookingStatusTransitionControl --port 8181
```

### Prerequisites
- The PCF control must be built first: `npm run build` in the control's project directory
- The compiled `bundle.js` must exist in `out/controls/{Name}/`

## Features

### Control Gallery
- Scans workspace for all PCF controls (built and unbuilt)
- Shows cards with: name, version, type (standard/virtual), platform libraries, features, property count
- Badges for: data.json, test scenarios, build status
- Click "Open" to switch to harness mode for that control
- Click "PCF Dev Harness" in the harness top bar to return to gallery

### Harness Panels (right sidebar, icon tabs)

| Icon | Panel | Purpose |
|------|-------|---------|
| Gear | **Props** | Control Info Card + Page Context + auto-generated property editors |
| Database | **Data** | View/edit mock entity data from data.json |
| Beaker | **Tests** | Save/load/export/import test scenarios |
| Plug | **Network** | Online / Offline / Slow 3G / Fast 3G / Custom latency |
| Phone | **Device** | Desktop / iPhone 14 / Pixel 7 / iPad presets |
| Gauge | **Perf** | Render timeline, heap timeline, top requests by duration/size, failed calls |

### Console Panel (bottom)
- Timestamped log of all ComponentFramework API calls
- Category filter badges: lifecycle, webAPI, navigation, device, mode, utils, data, scenario
- Click a badge to hide/show that category

### ComponentFramework Shim
Full mock implementation of the PCF Context interface:
- **webAPI**: retrieveMultipleRecords, retrieveRecord, createRecord, updateRecord, deleteRecord with OData $filter/$select/$top/$orderby parsing, latency injection, offline rejection
- **client**: isOffline(), getFormFactor(), isNetworkAvailable() — driven by Network/Device panels
- **device**: captureImage, getBarcodeValue, getCurrentPosition — mock implementations
- **mode**: isControlDisabled, allocatedWidth/Height — driven by harness UI
- **navigation**: openForm, openUrl, openAlertDialog — logs to console
- **formatting**: formatCurrency, formatDate, etc. — Intl-based implementations
- **resources**: getString() with RESX file parsing
- **fluentDesignLanguage**: tokenTheme for light/dark mode
- **page**: entityId, entityTypeName — configurable in Props panel

### Virtual (React) Control Support
- Detects `<platform-library name="React">` in manifest
- Loads React 16 or 18 UMD as versioned globals (`window.Reactv16`, `window.ReactDOMv16`)
- Provides Fluent UI v8 component stubs (Stack, Text, Dropdown, TextField, Checkbox, etc.)
- Renders `updateView()` React elements via the correct versioned ReactDOM

### Hot Reload
- Watches `out/controls/*/bundle.js` for changes
- When you rebuild the PCF project (`npm run build`), the harness auto-destroys and re-initialises the control

## Project Files

### Control-Side Files
Place these in your PCF control directory (alongside `ControlManifest.Input.xml`):

| File | Purpose |
|------|---------|
| `data.json` | Mock entity data for WebAPI calls. Structure: `{ "tableName": [{ ...record }] }` |
| `test-scenarios.json` | Pre-configured test scenarios (properties, page context, network mode, device preset) |
| `thumbnail.png` | Gallery thumbnail (auto-captured or manual) |
| `harness-meta.json` | Auto-generated metadata (thumbnail, last tested timestamp) |

### data.json Example
```json
{
  "bookingstatus": [
    { "bookingstatusid": "abc-123", "name": "Scheduled", "msdyn_statuscolor": "#0078D4" },
    { "bookingstatusid": "def-456", "name": "In Progress", "msdyn_statuscolor": "#FF8C00" }
  ],
  "contoso_bookingstatustransition": [
    { "contoso_validstatefrom": "Scheduled", "contoso_validstateto": "In Progress, Canceled" }
  ]
}
```

### test-scenarios.json Example
```json
[
  {
    "name": "Happy Path - Scheduled",
    "savedAt": "2026-04-03T00:00:00Z",
    "propertyValues": {
      "value": [{"id": "abc-123", "name": "Scheduled", "entityType": "bookingstatus"}],
      "transitionTable": "contoso_bookingstatustransition",
      "fromStateFieldName": "contoso_validstatefrom",
      "toStateFieldName": "contoso_validstateto"
    },
    "pageEntityId": "",
    "pageEntityTypeName": "",
    "networkMode": "online",
    "devicePreset": "desktop",
    "isControlDisabled": false
  }
]
```

## Architecture

```
harness/
  bin/pcf-harness.ts          # CLI entry point
  src/
    App.tsx                    # Gallery or Harness mode router
    ui/
      gallery/Gallery.tsx      # Control catalog with cards
      HarnessShell.tsx         # Harness layout (toolbar + panels + viewport)
      panels/                  # PropertyEditor, DataPanel, ScenariosPanel, NetworkPanel,
                               # DevicePanel, PerformancePanel, ConsolePanel, ControlInfoCard
    shim/                      # ComponentFramework mock (context-factory, web-api, client,
                               # device, mode, navigation, formatting, resources, fluent-design)
    loader/
      bundle-loader.ts         # Script injection + registerControl interceptor
      control-host.ts          # PCF lifecycle management (init/updateView/destroy)
      platform-libs.ts         # React UMD loading + Fluent UI stubs
    store/
      harness-store.ts         # Zustand state (properties, network, device, metrics, logs)
      data-store.ts            # In-memory entity data
    parser/
      manifest-parser.ts       # ControlManifest.Input.xml parser
      resx-parser.ts           # RESX localization file parser
    scanner/
      workspace-scanner.ts     # Finds all PCF controls in workspace
    vite-plugin/
      pcf-plugin.ts            # Vite plugin: virtual module, static serving, gallery API,
                               # control switching, bundle watching, thumbnail saving
```

## Roadmap

### Completed
- [x] Control gallery with workspace scanning
- [x] Single-control harness with all panels
- [x] Standard (DOM) and Virtual (React) control support
- [x] Network conditioning (online/offline/3G)
- [x] Device emulation presets
- [x] Performance monitoring (render timeline, heap, top requests)
- [x] Test scenarios (save/load/export/import)
- [x] Mock data editor
- [x] RESX localization
- [x] Hot reload on bundle changes
- [x] CLI entry point
- [x] Auto-capture viewport thumbnails for gallery
- [x] Initial Xrm global shims, execute mocks, Dialog v8/v9 fixes, date rebase
- [x] Viewport status bar with size badge

> **Effort sizing** — `S` = few days · `M` = 1–2 weeks · `L` = 3–4 weeks · `XL` = 1–2+ months / multiple devs. Single-dev estimates.

### Milestone 1 — UCI Fidelity & API Coverage  ·  `XL`
Reproduce the full Unified Client Interface runtime so any control that runs in production behaves identically in the harness. Multi-control hosting, form events, and form-level state all fall out of getting this right.

**Current coverage:** `ComponentFramework.Context` ~95% · `Xrm.*` globals ~25% by surface area, ~55% by real-world usage frequency. Form-level APIs are the biggest remaining gap.

- [ ] 100% coverage of `ComponentFramework.Context` (close the remaining `navigation.navigateTo` and copilot stub gaps)
- [ ] 100% coverage of `Xrm.WebApi`, `Xrm.Navigation`, `Xrm.Utility` (close `Xrm.Utility` gaps: progress indicator, refreshParentGrid, advanced config, allowed-status-transitions, invokeProcessAction)
- [ ] **Full form-level API surface** — `Xrm.Page` and modern `formContext`: `getAttribute`, `getControl`, `data`, `ui.tabs`, `ui.sections`, `ui.controls`, `addOnSave`/`addOnChange`/`addOnLoad`
- [ ] `executionContext` passed to every registered handler
- [ ] UCI-faithful form chrome around the viewport (header, command bar, tab strip, footer) so multi-control hosting works as a side effect, not a separate feature
- [ ] `Xrm.Device`, `Xrm.Encoding`, `Xrm.App`, `Xrm.Panel` shims
- [ ] Conformance test suite diffed against `@types/xrm` and `@types/powerapps-component-framework`
- [ ] Coverage panel that flags any runtime call hitting an unimplemented shim
- [ ] Versioned shim profiles (Dataverse 9.x vs 9.2 vs latest) so behavioural differences can be reproduced

### Milestone 2 — Live Dataverse Bridge  ·  `L`
Optional connected mode that replaces `data.json` with a real org. **Headline for the next release.**
- [ ] Live mode toggle that uses the active `pac auth` profile
- [ ] Read-only by default; writes require per-call confirmation
- [ ] On-disk response cache so repeat runs stay fast
- [ ] One-click "snapshot live data into data.json" for offline replay
- [ ] Indicator chrome when the control is hitting live data
- [ ] Per-scenario binding so scenarios can pin themselves to live or mock mode

### Milestone 3 — Automated Scenario Runner + Playwright  ·  `L`
Turn the harness into a test framework, not just a dev tool.
- [ ] Headless runner that executes every scenario in `test-scenarios.json`
- [ ] Per-scenario artifacts: screenshot, lifecycle log, perf metrics, console output
- [ ] Visual regression with pixel-diff against committed baselines
- [ ] Performance regression detection (render-time budget per scenario)
- [ ] CI-friendly artifacts written to `out/.harness-runs/`
- [ ] Reusable GitHub Actions workflow

### Milestone 4 — Diagnostics & Linting Panel  ·  `M`
A new "Audit" tab that enforces PCF best-practice constraints automatically.
- [ ] axe-core accessibility audit
- [ ] Banned-API check (`localStorage`, `sessionStorage`, `document.cookie`, etc.)
- [ ] Resource-cleanup completeness (extends the current leak detector with severities)
- [ ] Manifest validation (bound property must be `value`, version-bump check, feature-usage check)
- [ ] CSS scoping check (warn on unprefixed selectors)
- [ ] Bundle size budget warning
- [ ] Per-rule ignore mechanism via `.pcf-audit.json`

### Milestone 5 — Field Service Mobile / Offline Profiles  ·  `M`
Simulate the mobile app's offline-profile semantics so FSM controls can be validated locally.
- [ ] Configurable mobile offline profile (which entities and views are synced)
- [ ] Warn when the control reads or writes an entity that is not in the profile
- [ ] Simulate aggressive bundle caching (mobile app behavior)
- [ ] Field Service form-factor preset
- [ ] Offline-first checklist runner for FSM controls

### Milestone 6 — Add-in Framework  ·  `L`
A plug-in system so the workbench is extensible without forking it.
- [ ] Add-in manifest format and lifecycle hooks (`onLoad`, `onControlInit`, `onScenarioRun`, `onPanelMount`)
- [ ] UI extension slots: sidebar tab, toolbar button, viewport overlay, panel section
- [ ] Add-in API: read harness state, invoke shims, inspect manifest, read/write artifacts
- [ ] Sandboxing model (per-add-in permission scopes)
- [ ] Add-in discovery and install UI
- [ ] First-party reference add-ins ship with the harness (see Milestone 7)

### Milestone 7 — First-party Add-ins  ·  `L`
Built on top of the add-in framework.
- [ ] **AI Code Review add-in** `M` — provider-agnostic AI bridge (Anthropic / OpenAI / Azure / Ollama / WebLLM / no-AI fallback) reviewing the loaded control for PCF best practices, perf issues, and accessibility gaps; results render in the Audit panel
- [ ] **GitHub add-in** `S` — browse a configured GitHub org, clone a PCF control repo, build it, and load it directly into the gallery
- [ ] **Solution Push add-in** `S` — push the current control plus its test data into a Dataverse solution via `pac pcf push` and `pac solution import`; optional inclusion of `data.json` as configuration data
- [ ] **Schema-aware data generator add-in** `S` — wraps the `dataverse-datagenerator` skill to auto-populate `data.json` from a Dataverse table schema
- [ ] **Telemetry add-in** `S` — capture and replay App Insights / Dataverse telemetry events emitted by the control

### Milestone 8 — Polish  ·  `L`
Smaller items, batched into a single release.
- [ ] Auto-generate sample `data.json` and `test-scenarios.json` during control scaffolding
- [ ] Scenario diff view (side-by-side compare of two scenarios)
- [ ] Bundle analyzer (treemap of `bundle.js` contents)
- [ ] Source-map debugging (TypeScript breakpoints on the running control)
- [ ] Theme / RTL / high-contrast preview toggles
- [ ] Recording mode (capture user interactions, replay as a scenario)
- [ ] VS Code extension wrapper for one-click harness launch
- [ ] Onboarding wizard for first-time users
- [ ] Side-by-side control-version comparison
