# Building PCFs with AI

> The AI-first workflow for Power Apps Component Framework (PCF) controls.
> Pair **GitHub Copilot CLI** with the two skills shipped in this repo and PCF Workbench, and you get a tight **requirement → code → render → verify → ship** loop on your laptop — no Dataverse round-trip until you're ready.

---

## TL;DR

```bash
# 1. Scaffold
pac pcf init --namespace YourCo --name MyControl --template field --framework react --run-npm-install

# 2. Plan with AI — co-author DESIGN.md + PLAN.md, sign off, THEN build
copilot
> I want a MyControl that does X. Bind to Y. Co-author DESIGN.md and a milestoned PLAN.md first, stop for my approval, then build and validate with PCF Workbench against scenarios A/B/C.

# 3. The loop runs itself
#    pcf-engineer writes the code per the plan → pcf-workbench builds, renders, reports → AI fixes → repeat
```

---

## Why AI-first?

PCF dev historically meant: write code → `npm run build` → push to a Dev environment → wait for solution import → click into a form → debug in DevTools → tweak → repeat. **Minutes per iteration.**

With PCF Workbench + Copilot CLI skills you get:

| Step | Without AI loop | With AI loop |
|---|---|---|
| Read manifest, decide bound property | Manual | `pcf-engineer` enforces conventions |
| Wire `init` / `updateView` / `getOutputs` / `destroy` | Manual, error-prone | Generated correctly first time |
| Build + render | Manual `npm run build`, manual import | Single watcher rebuilds + HMR |
| Test scenarios | Click through Dataverse forms | Saved JSON scenarios replay instantly |
| Diagnose leaks / a11y / perf | DevTools by hand | Harness flags them in-panel |
| Verify before solution import | Hope for the best | Headless build → render → report gate |

**Result:** sub-second iteration loops and a control that actually conforms to UCI before it ever hits a Dataverse environment.

---

## The two skills

Both ship in [`.copilot/skills/`](./.copilot/skills/) and auto-load when you run `copilot` inside this repo. They're designed to be used **together**.

### `pcf-engineer` — author / review / debug

The senior PCF engineer in your terminal. Knows the official Microsoft Learn surface area plus the hard-won patterns Microsoft doesn't always document.

Use it for:

- Scaffolding new controls (manifest, `index.ts`, virtual vs standard, React vs none)
- Reviewing existing PCF code for correctness, a11y, perf, antipatterns
- Field-bound, dataset, and lookup controls
- Field Service Mobile / offline considerations
- `isAuthoringMode` design-time UX (InfoCard-style designer previews)
- Fluent UI v8 / v9 integration inside PCFs
- Lifecycle correctness (no leaks, proper `destroy`, no stale `updateView` state)

### `pcf-workbench` — run / test / diagnose

Operates the harness. Picks the right launch mode (gallery vs single control), wires `data.json` and `test-scenarios.json`, drives the build→render→report loop, and reads back the JSON report so the next AI turn has structured feedback.

Use it for:

- One-shot "render my control with scenario X and tell me what broke"
- Headless acceptance gate after any non-trivial code change
- Device / network emulation (desktop / tablet / mobile, fast 3G, offline)
- Leak triage (the harness diffs added listeners/timers/observers across `init`/`destroy`)
- Build watcher integration (M9 — rebuild a sample, harness HMRs automatically)

---

## End-to-end workflow

### 0. One-time setup

```powershell
# Power Platform CLI (Microsoft)
dotnet tool install --global Microsoft.PowerApps.CLI.Tool

# GitHub Copilot CLI
npm install -g @github/copilot

# Clone this repo (skills auto-load when copilot runs inside it)
git clone https://github.com/jaduplesms/PCF-Workbench.git
cd PCF-Workbench
```

Optional — make the skills global for every workspace:

```powershell
# Windows
Copy-Item -Recurse -Force .\.copilot\skills\* "$env:USERPROFILE\.copilot\skills\"
```

```bash
# macOS / Linux
cp -R ./.copilot/skills/* ~/.copilot/skills/
```

### 1. Scaffold the control

```powershell
mkdir samples\MyControl
cd samples\MyControl
pac pcf init --namespace YourCo --name MyControl --template field --framework react --run-npm-install
```

Pick `field` for property-bound (single value), `dataset` for grid/list controls. `--framework react` is the modern default.

### 2. Plan first — don't jump to code

The single biggest predictor of a clean AI build is a written plan you've signed off on *before* any code is generated. Ask Copilot to produce two artifacts and **stop**:

1. **`DESIGN.md`** — bound property, manifest properties, UX states (default / focus / disabled / error / empty), Fluent component choice, a11y notes, edge cases. You can write it yourself or co-author it with Copilot.
2. **`PLAN.md`** — milestoned plan with todos and explicit acceptance criteria per milestone. e.g. M1: manifest + skeleton, M2: render + bound value, M3: validation + a11y, M4: scenarios + headless gate.

Review both, push back, iterate. *Only then* green-light the build. This catches half the bugs before a single line is written and gives you a checklist to verify against later.

```
I want a MyControl in samples\MyControl that lets a user rate a record
0-5 stars, writing back to a Whole.None field.

Before writing any code, co-author with me:
  1. A short DESIGN.md covering bound property, manifest properties,
     UX states, a11y, edge cases
  2. A milestoned PLAN.md with todos and acceptance criteria per
     milestone

Stop after the plan. I'll review and approve before you build.
```

Copilot drafts both files, you tighten them, then say *"go"*. The skills now have an explicit contract to build against — not a vibe.

### 3. Build — then let the loop close itself

```
Plan approved. Execute M1, then run the headless harness loop and
report. Stop at the first failing milestone so I can review.
```

`pcf-engineer` writes the manifest + `index.ts` + React component per the plan. `pcf-workbench` then:

1. Builds the control (`npm run build` in `samples\MyControl`)
2. Launches the harness pointed at it
3. Runs each scenario headlessly
4. Captures screenshot + JSON report (pass / fail / N/A per row)
5. Hands the result back to Copilot

If anything fails, Copilot reads the report, patches the code, and reruns — ticking off the plan's todos as it goes. Loop until green.

### 4. Iterate by extending the plan

New work goes into the plan first, not straight into code:

```
Add a new milestone to PLAN.md: support a "max length" manifest
property read via context.parameters.maxLength.raw. Update DESIGN.md's
UX states if it affects the error path, then build once I approve.
```

`pcf-engineer` updates the manifest (bumps version), updates `index.ts`, `pcf-workbench` rebuilds + reruns scenarios. Saved scenarios mean regressions get caught the moment they regress.

### 5. Generate `showcase.html` — the shareable single-page exhibit

Before shipping, ask Copilot to produce a self-contained `showcase.html` in the control's folder. It's the page you send to a stakeholder or partner so they can understand what you built without cloning the repo. One file, no build, opens in any browser.

```
Generate samples\MyControl\showcase.html. Use the harness loop screenshot
(__visual__/screenshot.png) as the hero image. Cover:

  1. Brief        — one paragraph: what it does + bound property
  2. Screenshot   — rendered output from the headless loop
  3. How to use   — manifest snippet + a 3-step "drop into your form" guide
  4. Technology   — Fluent UI v9, React, manifest version, bundle size
  5. License      — repo license + any 3rd-party dependencies you pulled in

Keep it single-file (inline CSS, no JS frameworks). Match the dark / brand
visual language of harness/docs/showcase.html so the family resembles.
```

Treat this as a hard output — not a nice-to-have. The discipline of writing the showcase forces you to articulate scope, dependencies, and licensing before the control leaves your laptop. It's also the artifact that surfaces *"oh, I depended on a GPL library, that's a problem"* before it ships.

A reference exhibit lives at [`samples/StarRating/showcase.html`](./samples/StarRating/showcase.html) — Copilot can pattern-match against it.

### 6. Ship

When the harness is green, the scenarios pass, and `showcase.html` is reviewed, push to a real environment:

```powershell
pac solution init --publisher-name yourco --publisher-prefix yc
pac solution add-reference --path .\samples\MyControl
pac solution pack --zipfile MyControl.zip --folder .
pac solution import --path MyControl.zip
```

Or wire it into a GitHub Actions workflow that runs the harness headlessly on every PR — same `build → render → report` loop, just in CI.

---

## Sample prompts

### One-liner (rapid prototyping)

```
Use pcf-engineer + pcf-workbench to build a field-bound rating star control (1-5), Fluent v9, validate with a scenario per star value.
```

### Three-liner (most real work)

```
New control in samples\PercentBar — dataset, no framework.
Plan first (DESIGN.md + PLAN.md), wait for my OK, then build:
each row is a horizontal bar where width = (row.value / maxValue) * 100%.
Validate with one scenario of 5 rows, screenshot and confirm proportional.
```

### Verbose (production-grade)

```
Build a virtual control "DurationPicker" in samples\DurationPicker.

Manifest:
- type-group: numbers (bound property: value, of-type: Whole.None)
- input properties: minMinutes (Whole.None, default 0), maxMinutes (Whole.None, default 480), stepMinutes (Whole.None, default 15)
- requires-react: true
- platform-library Fluent v9

Behavior:
- Two side-by-side Fluent v9 Dropdowns: hours and minutes
- minutes options stepped by stepMinutes
- total minutes clamped to [minMinutes, maxMinutes]
- emits via notifyOutputChanged on every valid change
- disabled state disables both dropdowns
- isAuthoringMode shows a static "00:00" preview without dropdowns

Validation:
- scenario 1: defaults, pick 2h 30m, expect output = 150
- scenario 2: max=60, attempt 2h 0m, expect clamp to 60 with visible warning
- scenario 3: disabled=true, attempt to open dropdown, expect no menu
- scenario 4: isAuthoringMode=true, expect static preview, no interaction

Acceptance gate: harness JSON report must be 100% pass, 0 leaks reported, 0 axe-core violations.
```

---

## CI / GitHub Actions integration *(preview)*

The same headless build→render→report loop runs in CI. Sketch:

```yaml
name: PCF Workbench acceptance
on: [pull_request]
jobs:
  harness:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
        working-directory: harness
      - run: npm ci && npm run build
        working-directory: samples/MyControl
      - run: npx playwright install --with-deps
        working-directory: harness
      - run: npx playwright test --reporter=list
        working-directory: harness
        env:
          PCF_CONTROL_PATH: ${{ github.workspace }}/samples/MyControl/MyControl
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: harness-report
          path: harness/__visual__/
```

This is the M3 roadmap shape — scenarios become the contract, CI is the enforcement.

---

## Limits and honest caveats

- **AI doesn't replace knowing the platform.** The skills encode best practice, but you still need to understand what the control is *for*. Garbage requirement in, garbage control out.
- **The harness is a fidelity layer, not the real UCI.** It targets ~95% behavioural parity. A few edge cases — XrmAddOn, very advanced ribbon integration, some offline-only Field Service APIs — still need a real environment to verify before ship.
- **Build size and a11y are your job.** The harness flags them; the AI fixes them when asked; but the bar for "good enough" is yours to set.
- **Don't skip manifest version bumps.** The skills enforce this, but if you hand-edit manifest, remember Dataverse caches aggressively.

---

## Related

- [`README.md`](./README.md) — feature tour and Quick Start
- [`.copilot/skills/pcf-engineer/SKILL.md`](./.copilot/skills/pcf-engineer/SKILL.md) — the authoring skill (full text)
- [`.copilot/skills/pcf-workbench/SKILL.md`](./.copilot/skills/pcf-workbench/SKILL.md) — the harness skill (full text)
- [PCF official docs](https://learn.microsoft.com/power-apps/developer/component-framework/overview) — Microsoft Learn
- [GitHub Copilot CLI](https://github.com/github/copilot-cli)
