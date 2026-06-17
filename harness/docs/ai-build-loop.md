# AI-Assisted PCF Build Loop

> *Internal milestone MAI.* This document describes how an AI coding agent
> can drive PCF Workbench end-to-end — build, run, screen, analyse,
> refactor — without a Dataverse org or human-in-the-loop.

## TL;DR

```bash
# As a user (recommended) — after `npm i -D @pcfworkbench/cli`:
npx pcfworkbench loop --path <absolute-path-to-pcf-control>

# In dev (cloned repo):
cd harness
npm run harness -- loop --path <absolute-path-to-pcf-control>

# → writes ./pcf-loop-reports/report.json + screenshot.png
```

Read `report.json`. If `summary.status !== 'pass'`, edit the control
sources, re-run. Loop until green.

---

## The loop

```
   ┌──────────────────────────────────────────────────────┐
   │            pcfworkbench loop --path <dir>            │
   └──────────────────────────────────────────────────────┘
                          │
                          ▼
        ┌────────┐   ┌─────────┐   ┌────────────┐   ┌─────────┐
        │  Build │ → │  Run    │ → │  Screen    │ → │ Analyse │
        │ (npm)  │   │ (Vite)  │   │ (Playwrt)  │   │ (JSON)  │
        └────────┘   └─────────┘   └────────────┘   └─────────┘
            │           │              │                  │
            ▼           ▼              ▼                  ▼
        ts errors   port=auto      screenshot         report.json
                    headless       console errors
                                   lifecycle events
                                   leaks / WebAPI

                          │
                          ▼
                   ┌─────────────┐
                   │  Refactor   │  ← agent reads report,
                   │  (you/AI)   │     edits sources, loops
                   └─────────────┘
```

### Each step

1. **Build** — runs `npm run build` in the project root (walked up from
   `--path`). On failure the loop stops with `build.errors[]` populated
   and `summary.status = 'fail'`. Skip with `--skip-build` when iterating
   on harness wiring only.
2. **Run** — finds a free port from 8181 upward and starts the harness
   Vite server in-process. `PCF_CONTROL_PATH` is exported so the Vite
   plugin loads the target control.
3. **Screen** — launches headless Chromium (1920×1080), navigates to the
   harness root, and waits for `window.__pcfwbHarnessReady === true`.
   That flag flips on the first successful `updateView`. Default timeout
   60s — override with `--timeout 120000`.
4. **Analyse** — calls `window.__pcfwbHarnessReport()` (installed by
   `src/test-bridge.ts`) and serialises lifecycle events, performance
   metrics, resource leaks, WebAPI calls, and the shim log into the
   report. Adds Playwright-captured `consoleErrors` + `pageErrors`.

The CLI exits `0` only when `summary.status === 'pass'`.

---

## Report shape

Authoritative schema: [`ai-loop-report.schema.json`](./ai-loop-report.schema.json).

Top-level keys an agent should read first:

| Key | Why it matters |
| --- | --- |
| `summary.status` | `pass` / `warn` / `fail` — single-bit health. |
| `summary.headline` | One-line human-readable reason. |
| `build.errors` | Up to 30 TS / pcf-scripts error lines. |
| `harness.consoleErrors` + `harness.pageErrors` | Browser-side errors. |
| `harness.report.lifecycle.events` | Did `init` run? Did `updateView` fire? `destroy`? |
| `harness.report.lifecycle.firstUpdateViewMs` | First-paint latency. |
| `harness.report.leaks` | Event listeners / timers / observers not cleaned up. |
| `harness.report.performance.avgRenderTimeMs` | Render-time budget check. |
| `harness.report.webApi.errorCount` | OData / WebAPI failures. |
| `harness.report.logs.unimplementedCount` | Control hit a shim that's wired but does nothing — surfaces missing harness coverage. |

`screenshot.png` sits next to `report.json` in the same `--out` directory.

---

## Remediation playbook

A short decision table the agent can follow when `status !== 'pass'`:

| Symptom in report | Likely cause | First thing to try |
| --- | --- | --- |
| `build.ok = false`, TS errors in `build.errors` | Type or import error in the PCF source. | Open the cited file/line; fix; re-run. |
| `harness.ok = false`, `harness.error` matches `__pcfwbHarnessReady` timeout | Control threw during `init` or never called `notifyOutputChanged`. | Inspect `consoleErrors` + `pageErrors`; check `lifecycle.initCalled`. |
| `consoleErrors` mentions `Cannot read properties of undefined` near a Fluent name | Manifest declares wrong Fluent version, or the control imports a v9 API from a v8 namespace. | Re-check `ControlManifest.Input.xml` `<platform-library>` entries. |
| `pageErrors` mentions `Hooks can only be called inside the body of a function component` | Two React copies on the page. | Confirm the control externalises React (manifest `<platform-library name="React" .../>`). |
| `harness.report.leaks[].type = eventListener` | Handler added in `init` not removed in `destroy`. | Audit `destroy()` for matching `removeEventListener`. |
| `harness.report.leaks[].type = timer` | `setInterval` / `setTimeout` not cleared. | Track returned IDs and clear them in `destroy()`. |
| `harness.report.lifecycle.firstUpdateViewMs > 500` | Heavy synchronous work in `init` or first `updateView`. | Defer non-critical work; profile renders. |
| `harness.report.logs.unimplementedCount > 0` | Control depends on a harness shim that has no behaviour. | Check `logs.recent` for the method; see if a fixture / scenario can supply the missing data. |

---

## CLI reference

```text
pcfworkbench loop --path <dir>
  --out <dir>          Where to write report.json + screenshot.png
                       (default: ./pcf-loop-reports)
  --skip-build         Reuse existing out/controls/<Name>/bundle.js
  --timeout <ms>       Max ms to wait for the first updateView
                       (default: 180000 — covers first-run Fluent UI download)
  --headed             Run Chromium in headed mode for debugging
  --scenario <name>    Apply a saved scenario via the ?scenario= URL param
```

Exit codes: `0` on `pass`, `1` on `warn` or `fail`.

---

## Setting perf budgets

The loop can enforce per-control performance budgets so a refactor that
silently doubles render time fails CI immediately. Budgets are opt-in —
without them the loop behaves exactly as before.

Add a `perfBudget` block to the control's `data.json` (control dir
first, then project root — same resolution order the harness uses):

```jsonc
{
  "record": "ct-record-0001",
  "textInput": "hello",
  "perfBudget": {
    "firstUpdateViewMs": { "warn": 300, "fail": 1000 },
    "avgRenderTimeMs":   { "warn": 100, "fail": 200 },
    "leaks": 0,
    "unimplementedCount": { "warn": 5, "fail": 20 }
  }
}
```

Each metric accepts either a bare number (hard `fail` limit) or
`{ warn?: number, fail?: number }` for independent soft and hard
thresholds. Supported metrics:

| Metric | Source | Typical use |
| --- | --- | --- |
| `firstUpdateViewMs` | `lifecycle.firstUpdateViewMs` | Catches `init` regressions (synchronous work, `await` inside init). |
| `avgRenderTimeMs` | `performance.avgRenderTimeMs` | Catches steady-state render regressions. |
| `lastRenderTimeMs` | `performance.lastRenderTimeMs` | Useful when the last render is the canonical one (most loops only fire one updateView). |
| `renderCount` | `performance.renderCount` | Catches render storms (e.g. `setState` in `useEffect` without deps). |
| `leaks` | `harness.report.leaks.length` | Hard cap on listener/timer/observer leaks. Almost always `0`. |
| `unimplementedCount` | `logs.unimplementedCount` | Catches drift onto unimplemented shims. |

Behaviour:

- **`fail` violation** → `budget.status = "fail"` → `summary.status` is
  pulled up to `fail` → CLI exits non-zero → CI turns red.
- **`warn`-only violations** → `budget.status = "warn"` → `summary.status`
  is `warn` (still exits non-zero, since `warn` is non-pass).
- **No `perfBudget` in `data.json`** → `budget` is `null` in the report
  and the loop runs exactly as before.
- **Missing metric** → not evaluated. Add only the metrics you care
  about; the rest are ignored.

The `budget.violations[]` array in the report enumerates every metric
that tripped, with `actual`, `budget`, `delta` (= actual − budget), and
`severity` so agents and CI can target the worst offender first.

---

## Running in CI (GitHub Actions)

The build loop is designed to run on every pull request so regressions
are caught **before** merge — not after a developer notices the broken
control in production.

A ready-to-use GitHub Actions workflow lives at
[`examples/pcf-loop.yml`](./examples/pcf-loop.yml). Copy it into your
PCF project at `.github/workflows/pcf-loop.yml`, edit the three `env`
variables (`PCF_PROJECT_DIR`, `PCF_CONTROL_DIR`, `PCF_WORKBENCH_REF`),
optionally set `PCF_SCENARIO` to auto-load a saved scenario before
mount (highly recommended — see below), and commit. From the next PR
onwards:

1. Workflow triggers when a PR touches `**/*.ts`, `**/*.tsx`,
   `**/ControlManifest.Input.xml`, `**/*.css`, `**/data.json`, or
   `**/test-scenarios.json`.
2. It builds your control, runs `pcfworkbench loop` against the bundle
   with `--scenario "$PCF_SCENARIO"` if set.
3. `report.json` + `screenshot.png` are uploaded as the
   `pcf-loop-reports` artifact (30-day retention by default).
4. A sticky comment is posted (and updated on each push) on the PR
   with a one-table summary:

   ```text
   🤖 PCF Build Loop — ❌ FAIL
   Render: ✅ rendered
   Leaks:  ✅ none
   Budget: ❌ fail
           ❌ avgRenderTimeMs 312 (fail >200)
   Perf:   firstUpdateView: 180ms · avgRender: 312ms · renders: 1
   ```
5. The workflow exits non-zero on `warn` or `fail`, turning the PR
   check red. Combine with branch protection to block merge.

**Set `PCF_SCENARIO` or you're testing a blank control.** Without a
scenario, the harness boots with manifest defaults — for most field /
dataset controls that means empty values, no bound record, and no
useful UI to render. The loop will report `pass` because nothing
crashed, but you're not actually exercising the control. To assert
real behaviour:

1. Run the harness locally, configure properties + page entity + data
   + network the way a real user would see them, save as a named
   scenario in the Scenarios panel.
2. Export → commit `test-scenarios.json` to the repo next to the
   manifest.
3. Set `PCF_SCENARIO: 'your-scenario-name'` in the workflow env.

The harness auto-applies the scenario via the `?scenario=<name>` URL
param before mount, exactly as if you'd clicked "Load" in the
Scenarios panel.

**Pin the Workbench ref.** The example sets `PCF_WORKBENCH_REF: 'main'`
so you always get the latest, but production teams should pin to a
known-good commit (`PCF_WORKBENCH_REF: 'abc1234'`) and bump
deliberately when they're ready to absorb upstream changes.

**Cost.** A run takes ~90 seconds on `ubuntu-latest`. GitHub-hosted
runners are free for public repos and have generous monthly quotas on
private repos (2,000 min/month on Free).

---

## Tips for agent prompts

- **Always read `summary.status` first.** Don't waste tokens parsing
  the full report when a one-line headline tells you what to fix.
- **Don't trust `screenshot.png` for layout judgements when
  `summary.status = 'fail'`** — the screenshot may have been taken
  before mount.
- **Diff successive runs by `runId`.** Same control + same sources
  should produce identical `lifecycle.events.length`,
  `performance.renderCount`, and `webApi.totalCalls`. Drift on any of
  those is a regression signal.
- **`warn` is not safe to merge.** A resource leak today is a perf
  bug tomorrow.

---

## Worked example

See [`samples/MAILoopDemo/`](../../samples/MAILoopDemo/README.md) for a
deliberately broken control + the resulting report, and the fix that
takes it green.

## Reference agent prompt

The drop-in skill that teaches an agent to run and interpret this loop
lives at [`harness/docs/ai-loop-skill.md`](./ai-loop-skill.md). Use it
verbatim as a Copilot CLI skill or as a Claude system-prompt fragment.
