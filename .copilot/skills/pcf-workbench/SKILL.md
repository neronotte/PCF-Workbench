---
name: pcf-workbench
description: "Run, diagnose, and iterate on Power Apps Component Framework (PCF) controls locally with the PCF Workbench harness. Replaces `pcf-scripts start` with a richer dev loop: gallery discovery, device emulation, network conditioning, WebAPI mocking from data.json, scenarios, lifecycle/leak tracking, and a headless build→render→report loop for AI-assisted iteration. ALWAYS use this skill for ANY PCF development work (alongside the pcf-engineer skill for code authoring/review) — the headless loop is the acceptance gate after any non-trivial code change. TRIGGER: PCF, PCF control, PCF component, Power Apps Component Framework, code component, PCF Workbench, pcf-harness, run pcf, test pcf locally, harness, pcf gallery, pcf loop, debug pcf control, pcf-scripts start replacement, build pcf, validate pcf, ControlManifest."
user-invocable: true
argument-hint: "[run|gallery|loop|diagnose] [control-path-or-workspace]"
---

# PCF Workbench

## ROLE
You operate the **PCF Workbench** harness (https://github.com/jaduplesms/PCF-Workbench) — a local dev environment for Power Apps Component Framework controls. You help the user:

1. Discover and launch PCF controls in interactive mode (with device emulation, network conditioning, WebAPI mocking, scenarios).
2. Run the headless `loop` command (build → render → JSON report + screenshot) and diagnose results.
3. Debug control failures by reading the harness lifecycle log, console output, and shim coverage.

This skill **does not write PCF control code** — use the `pcf-engineer` skill for that. This skill is the runner / diagnostician.

## REPO LAYOUT (critical — get this wrong and nothing works)

- The harness lives under `harness/` in the PCF-Workbench repo. **Always `cd harness` before running anything.**
- The harness loads the **compiled** bundle at `<control-project>/out/controls/<Name>/bundle.js`. If `out/` doesn't exist, the user must run `npm run build` in their PCF project first.
- A "control directory" is the one containing `ControlManifest.Input.xml` (e.g. `samples/ConformanceTester/ConformanceTester/`), **not** the project root.
- A "workspace" is a parent directory containing many control projects (gallery mode discovers them recursively).
- Marker `.pcf-private` in a control folder hides it from the gallery.
- Optional per-control files picked up automatically: `data.json` (WebAPI mock store), `test-scenarios.json` (saved scenarios), `thumbnail.{jpg,png,gif}` (gallery thumbnail).

## LAUNCH MODES

### A. Interactive single-control via CLI bin
From inside `harness/`:
```powershell
npm run harness -- start --path ..\samples\ConformanceTester\ConformanceTester --port 8181
```
Or the installed bin form (once linked): `pcf-harness start --path <dir>`.

### B. Interactive via env vars + raw Vite (preferred for ad-hoc demos)
```powershell
cd harness
$env:PCF_CONTROL_PATH = "..\samples\ConformanceTester\ConformanceTester"
npx vite --port 8181 --host 127.0.0.1
```
- Use `$env:PCF_WORKSPACE_ROOT` instead of `PCF_CONTROL_PATH` for **gallery mode** across many controls.
- If port 8181 is busy, Vite picks the next free port — read the actual URL from output, don't assume.
- The PCF mounts directly in the page (no iframe). For Playwright, use top-level `page.locator`.

### C. Headless build→render→report loop (the AI iteration loop)
```powershell
cd harness
npm run harness -- loop --path ..\samples\ConformanceTester\ConformanceTester --out .\pcf-loop-reports
```
- Default writes `report.json` + `screenshot.png` to `./pcf-loop-reports/`.
- `--skip-build` reuses an existing `out/` bundle (faster iteration).
- `--timeout <ms>` (default 60000) and `--headed` (debug visually) are available.
- This is the canonical "did my change work?" check for autonomous edits.

## STANDARD WORKFLOWS

### Workflow 1 — Demo / run a user's existing control
1. Confirm the control path (must contain `ControlManifest.Input.xml`).
2. Build it: `cd <control-project-root>; npm run build`. Verify `out/controls/<Name>/bundle.js` now exists.
3. Launch via env-var Vite (Mode B) — easier to background and capture URL.
4. Tell the user the URL and the side-panel features available: Properties, Device, Network, WebAPI, Scenarios, Lifecycle, Renders, Form (if formContext is bound).

### Workflow 2 — Gallery across a workspace
1. Set `PCF_WORKSPACE_ROOT` to the workspace folder.
2. Launch Vite; the home page is the gallery. Each tile reads its `ControlManifest.Input.xml` for display name/version and looks for `thumbnail.*`.
3. Clicking a tile loads it into the single-control shell.

### Workflow 3 — Headless validation after a code change
1. Run `loop` with `--out`.
2. Read `report.json`. Key fields to triage in order:
   - `bundleLoaded` / `lifecycle.initCalled` / `lifecycle.firstUpdateView` — did the control mount?
   - `console.errors` and `console.warnings` — shim warnings often reveal which API surface was hit.
   - `leaks` — outstanding listeners/intervals/observers from `resource-tracker.ts`.
   - `webApiCalls` — what the control asked for vs what `data.json` provided.
3. If failed: open `screenshot.png`, correlate with error, propose a fix. Re-run `loop --skip-build` if only data/config changed.

### Workflow 4 — Playwright acceptance against the ConformanceTester
This is the harness's own regression gate; useful as a smoke test after changing shims.
1. Build sample: `cd samples\ConformanceTester; npm run build`
2. Start harness (Mode B, port 8181 or whatever Vite picks).
3. `cd harness; $env:HARNESS_URL="http://127.0.0.1:<port>"; npx playwright test --reporter=list`
4. Baseline JSON + screenshot land in `harness/__visual__/conformance-<phase>.{json,png}`.

**First-load auto-generate dialog must be suppressed in automation.** When the harness opens a control with no saved scenarios it pops a "Generate starter scenarios?" dialog whose backdrop intercepts clicks and stalls headless runs. Suppress it via `page.addInitScript` setting `localStorage['pcf-workbench-suppress-autogen-all'] = '1'` (the `pcf-harness loop` bin and `conformance.spec.ts` already do this — copy the pattern for any new spec or external Playwright driver). Per-control opt-out also exists via the "Don't show this again" checkbox on the dialog (`pcf-workbench-suppress-autogen-${controlId}`).

### Workflow 5 — Test a specific saved scenario via the harness

Saved scenarios live in `<control-dir-or-project-root>/test-scenarios.json` and contain a complete reproducible state (property values, page context, network mode, device preset, user settings). Activate one of three ways:

**A. URL parameter (most reliable for automation & demos):**
```
http://127.0.0.1:<port>/?scenario=<URL-encoded-scenario-name>
```
e.g. `?scenario=Contact%20Card`. The harness auto-applies it on load (see `findScenarioByName` + `applyScenarioAsActive`). Combine with `&chrome=minimal` to hide the side panel.

**B. Headless `loop` with a specific scenario:**
```powershell
cd harness
npm run harness -- loop --path <control-dir> --scenario "Contact Card" --out .\pcf-loop-reports
```
The report records which scenario was active, so you can diff scenario-vs-scenario.

**C. Interactive — Scenarios side panel:**
1. Launch harness (Mode B).
2. Open the **Scenarios** tab in the side panel.
3. Pick the scenario from the dropdown — the control re-mounts with all scoped state applied (props, network, device, user).
4. Edit any field in the **Properties** tab and click **Save** to update the saved scenario, **Discard / Restore** (arrow icon) to revert uncommitted edits.

**Where scenario edits are stored:** edits live in **browser `localStorage`** under `pcf-workbench-scenarios-<namespace>.<constructor>` (e.g. `pcf-workbench-scenarios-Sample.InfoCard`). The active-scenario pointer is `pcf-workbench-active-scenario-<id>`. The `test-scenarios.json` file on disk is the **read-only seed** — the harness never writes to it. `loadAllScenarios` merges: localStorage wins per-name when its `savedAt` is strictly greater than the on-disk `savedAt`. This means **bumping the on-disk `savedAt`** is how a scenario file can override a user's stale localStorage edits.

**Scenario-state troubleshooting (lessons from real bugs):**
- *"My saved edit reverted after restarting Vite."* Vite restart doesn't clear `localStorage`; the browser does. Make sure the page is reloaded on the **same port + same origin** (port 8181 vs 8182 = different `localStorage`). Open DevTools → Application → Local Storage and inspect `pcf-workbench-scenarios-<id>` directly to confirm whether the edit landed.
- *"The Save button is disabled even though I made changes."* The harness only marks a scenario "dirty" when the changed key is in `SCENARIO_SCOPED_KEYS` (see `harness/src/store/harness-store.ts`). Editing form/data state outside that scope does not trigger dirty.
- *"On reload my value got overwritten."* The harness has a control-output writeback path (`applyOutputs` in `loader/control-host.ts`) that mirrors `notifyOutputChanged` into the store and the bound entity record. If your control's `getOutputs()` returns a different value for an input/configuration property than what the user typed, the user's value gets clobbered. Workaround: skip writeback by keeping the prop's `getOutputs` return identical to its `context.parameters.<name>.raw`, or use the `$column` sentinel for true bound bindings so the writeback routes to the record instead.
- *"Different scenarios collide."* `controlId` is `${manifest.namespace}.${manifest.constructor}` — if you rename the control mid-development, localStorage keys diverge and old edits "disappear" (they still exist under the old key).

**Reset a single scenario back to disk default:**
```js
// In browser devtools console:
const id = 'Sample.InfoCard';
const file = await fetch('/pcf-data/test-scenarios.json').then(r => r.json());
const target = 'Contact Card';
const list = JSON.parse(localStorage.getItem(`pcf-workbench-scenarios-${id}`));
const fileSc = file.find(s => s.name === target);
const idx = list.findIndex(s => s.name === target);
list[idx] = fileSc;
localStorage.setItem(`pcf-workbench-scenarios-${id}`, JSON.stringify(list));
location.reload();
```
Or use the **Discard / Restore** button on the Scenarios panel (reverts active scenario to last saved).

**Wipe all local edits for a control:**
```js
localStorage.removeItem(`pcf-workbench-scenarios-${id}`);
localStorage.removeItem(`pcf-workbench-active-scenario-${id}`);
location.reload();
```

## DIAGNOSIS CHEAT SHEET

| Symptom                                               | Likely cause                                                                                      |
|-------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| `bundle.js not found`                                 | User skipped `npm run build` in the PCF project, or `--path` points at project root not control dir |
| Control renders blank, no errors                      | `updateView` returned but bound property is empty — check `data.json` and manifest `<property>` names |
| `Cannot read properties of undefined (reading 'getAttribute')` | Control uses `formContext`/`Xrm.Page` before harness has wired form state — confirm `data.json` contains the entity row |
| Fluent v8/v9 component renders nothing                | Stub missing in `loader/platform-libs.ts` — add a functional stub there                            |
| Hot reload not firing on control code change          | User isn't running `npm run build --watch` in the PCF project; harness watches `out/`, not `src/`  |
| `@media` query not matching device preset             | Control's CSS is fine — the harness rewrites `@media` to `@container pcf-viewport`. Confirm the control's CSS is loaded via the layer, not inlined out-of-band |
| Leaked listeners reported on `destroy`                | Real bug in the control. Show the leak source (the tracker tags the call site).                    |

## CONVENTIONS TO RESPECT

- **TypeScript strict on**, `noUnusedLocals`/`noUnusedParameters` off — don't propose enabling them.
- **`npm run typecheck`** is the only pre-PR gate (no linter / unit suite). For UI/shim changes, also run a Playwright pass against ConformanceTester.
- **No Microsoft SDK source** is bundled in the harness — shims are original implementations. Don't suggest pulling in `@types/xrm` source or vendored Dataverse code; types-only references are fine.
- **One shim file per `context.*` namespace** (`src/shim/`). Extend by adding a new file, not by bulking up `context-factory.ts`.
- **`Xrm.Page` proxy in `xrm-form.ts`** must keep this file's `setFormNotification`/`clearFormNotification` at top priority in `mergedUi` — preferring `formContext.ui.*` causes infinite recursion.
- **Fluent v9 `<Button>`/`<Badge>` drop `data-*`** — wrap in `<span data-test-id="…">` for stable test selectors.
- **`useSyncExternalStore` snapshots must be version-keyed** (see `form-store.ts` `getFormStateVersion()` + `FormPanel.tsx`).

## OPERATING TIPS

- Always launch the dev server with `--host 127.0.0.1` so Playwright + curl can hit it deterministically.
- Background the Vite process in async PowerShell mode and capture the URL from the first ~10s of output before moving on.
- When done demoing, stop the Vite process by PID (the powershell tool requires `Stop-Process -Id <PID>`).
- For the PCF-Workbench repo itself, all source/configs/scripts live under `harness/`. The repo root only has README + LICENSE.

## QUICK-START SCRIPT (copy-paste demo)

```powershell
# From PCF-Workbench repo root
cd samples\ConformanceTester
npm install            # first time only
npm run build          # produces out/controls/ConformanceTester/bundle.js

cd ..\..\harness
npm install            # first time only
$env:PCF_CONTROL_PATH = "..\samples\ConformanceTester\ConformanceTester"
npx vite --port 8181 --host 127.0.0.1
# → open the printed URL; explore Properties / Device / Network / WebAPI / Scenarios / Lifecycle / Form panels
```

For a headless smoke test instead:
```powershell
cd harness
npm run harness -- loop --path ..\samples\ConformanceTester\ConformanceTester --out .\pcf-loop-reports
Get-Content .\pcf-loop-reports\report.json | ConvertFrom-Json
```
