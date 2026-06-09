# PCF Workbench — In-tree samples

These are real PCFs built with `pac pcf init` + `pcf-scripts`. They are committed to the repo (sources only, no `out/` or `node_modules/`) and are loaded by the harness as test fixtures.

## Prerequisites

- [Power Platform CLI](https://learn.microsoft.com/power-platform/developer/cli/introduction) (`pac`) — verified with 2.2.1
- [.NET SDK](https://dotnet.microsoft.com/download) 6+ — verified with 9.0.313
- Node.js 18+ — verified with v24
- npm 9+

## Layout

```
samples/
├── README.md                       (this file)
├── ConformanceTester/              real pac-pcf-init project
│   ├── ConformanceTester.pcfproj
│   ├── eslint.config.mjs
│   ├── package.json
│   ├── tsconfig.json
│   ├── data.json                   harness fixture seed
│   ├── test-scenarios.json         Playwright scenario manifest
│   └── ConformanceTester/
│       ├── ControlManifest.Input.xml
│       ├── index.ts
│       └── ConformanceGrid.tsx
└── StarRating/                     M10.P3 worked example — built end-to-end by AI
    ├── BUILT_WITH_AI.md            prompts + workflow (start here)
    ├── DESIGN.md                   AI-coauthored spec
    ├── PLAN.md                     milestoned plan + acceptance gates
    ├── data.json
    ├── test-scenarios.json
    └── StarRating/
        ├── ControlManifest.Input.xml
        ├── index.ts
        └── StarRating.tsx
```

## Building

```powershell
cd samples\ConformanceTester
npm install        # first time only
npm run build      # produces out\controls\ConformanceTester\bundle.js
```

`samples/**/out/` and `samples/**/node_modules/` are gitignored.

## Loading in the harness (single-control mode)

```powershell
cd harness
$env:PCF_CONTROL_PATH = "..\samples\ConformanceTester\ConformanceTester"
npx vite --port 8181
```

Then open http://localhost:8181 and select the **Form** panel to seed attributes via `data.json`. The control renders the conformance grid; click **Run all** to exercise the full shim surface.

## Conformance Tester

A field-bound PCF whose UI is a grid of one row per shim API. Each row has a stable `data-test-id` (`ct-row-<id>-status`, `ct-run-<id>`) so Playwright can drive it deterministically. See `harness/docs/showcase.html` for the M1 roadmap and `.github/copilot-instructions.md` § Validation workflow for the per-phase Playwright gate.

## StarRating — built end-to-end by AI

The worked example for **M10.P3** of the PCF Workbench roadmap. A 0–5 star field-bound rating control written entirely via the `pcf-engineer` + `pcf-workbench` Copilot CLI skills, validated by the headless harness loop, with zero Dataverse round-trips during development. Read [`StarRating/BUILT_WITH_AI.md`](./StarRating/BUILT_WITH_AI.md) for the exact prompts, the design/plan workflow, and how the AI caught a real harness bug along the way.

```powershell
cd harness
npx tsx bin/pcf-harness.ts loop --path ..\samples\StarRating\StarRating
```

Expected: `[summary] PASS — control rendered cleanly`, exit 0.

## Adding a new sample

```powershell
cd samples
pac pcf init --namespace PcfWorkbench --name <Name> --template <field|dataset> --framework react --run-npm-install
```

Commit only sources. The harness picks up new samples via `PCF_CONTROL_PATH` (single) or by symlinking into a workspace directory consumed by `PCF_WORKSPACE_ROOT` (gallery mode).
