# StarRating — Built with AI

> The worked example for **M10.P3** of PCF Workbench. A field-bound 0–5 star rating control written end-to-end via the `pcf-engineer` + `pcf-workbench` Copilot CLI skills, validated by the headless harness loop, with **zero Dataverse round-trips during development**.

This file captures the actual prompts and the actual workflow used to build it, so you can read it as a recipe.

---

## The contract

Two artifacts, written *before* any code, signed off by a human:

| File | Purpose |
|---|---|
| [`DESIGN.md`](./DESIGN.md) | Bound property, manifest, UX states, a11y, edge cases, `isAuthoringMode`, lifecycle, open questions |
| [`PLAN.md`](./PLAN.md) | 5 milestones, todos per milestone, explicit acceptance gates |

Everything below is downstream of those two documents.

---

## The prompts

### Prompt 1 — Plan-first

> I want a StarRating control in `samples/StarRating` that lets a user rate a record 0–5 stars, writing back to a `Whole.None` field. Before writing any code, co-author with me:
>  1. A short `DESIGN.md` covering bound property, manifest properties, UX states, a11y, edge cases.
>  2. A milestoned `PLAN.md` with todos and acceptance criteria per milestone.
>
> Stop after the plan. I'll review and approve before you build.

### Prompt 2 — Go

> Plan approved. Execute M1, then run the headless harness loop and report. Stop at the first failing milestone so I can review.

That was it. The skills did the rest:

- **M1** — manifest replaced with `value` / `maxStars` / `allowClear`, `HelloWorld.tsx` swapped for `StarRating.tsx` skeleton, `index.ts` wired with React root + `notifyOutputChanged` + dirty-flag pattern. `npm run build` → 8.4 KiB bundle, 0 TS errors. **Gate: pass.**
- **M2 + M3** (collapsed into one prompt-less iteration once M1 was clean) — full rendering, hover preview, WAI-ARIA radiogroup keyboard pattern, `isAuthoringMode` preview, Fluent v9 tokens. Bundle grew to 16 KiB. **Gate: pass.**
- **M4** — `data.json` + 6-scenario `test-scenarios.json` covering default-empty, rated-3, clamp-high, invalid-max, disabled, authoring-mode. Headless loop (`npx pcf-harness loop`) ran clean: 0 console errors, 0 page errors, 0 leaks, 1 render, 16 DOM nodes, budget pass. **Gate: pass.**

Along the way the AI **caught and fixed a real harness bug** — `pcf-harness loop` used `page.goto(..., { waitUntil: 'networkidle' })` which never resolves under Vite HMR. Switched to `'load'` + the existing `__pcfwbHarnessReady` flag as the readiness signal. That's the kind of bug a planning-first / report-driven loop surfaces naturally.

---

## What this proves

1. **Two short prompts** got us a production-shaped PCF (manifest, lifecycle, a11y, edge cases, scenarios, headless validation).
2. **The plan is the spec.** When the AI strayed, the response was "check the plan", not "regenerate from scratch".
3. **Headless validation closes the loop.** No human eyeballed the rendered output until M4 was already green — we were verifying *behavior*, not *appearance*.
4. **The harness is a CI gate, not a debugger.** `pcf-harness loop` exits non-zero on render failure, console errors, leak count over budget, or perf budget violations. Drop it in `.github/workflows/pcf-loop.yml` and you have PR-time validation.

---

## Reproducing

```powershell
cd C:\path\to\PCF-Workbench
copilot

# In Copilot:
> Build a StarRating in samples/StarRating that does X. Plan first.
```

Or just run the existing loop against this sample:

```powershell
cd harness
npx tsx bin/pcf-harness.ts loop --path ..\samples\StarRating\StarRating
```

Expected: `[summary] PASS — control rendered cleanly`, exit 0, JSON report + screenshot in `./pcf-loop-reports/`.

---

## File map

```
samples/StarRating/
├── BUILT_WITH_AI.md          (this file)
├── DESIGN.md                  spec the AI built against
├── PLAN.md                    milestones + acceptance gates
├── data.json                  default property values + perf budget
├── test-scenarios.json        6 scenarios for the harness
├── StarRating.pcfproj
├── package.json
├── tsconfig.json
├── eslint.config.mjs
├── __visual__/                latest headless loop output
│   ├── report.json
│   └── screenshot.png
└── StarRating/
    ├── ControlManifest.Input.xml
    ├── index.ts               PCF entry — React mount, dirty-flag, getOutputs
    └── StarRating.tsx         component — render, hover, keyboard, authoring
```
