# Building PCFs with AI

> The AI-first workflow for Power Apps Component Framework (PCF) controls.
> Pair **GitHub Copilot CLI** with the two skills shipped in this repo and PCF Workbench, and you get a tight **requirement → code → render → verify → ship** loop on your laptop — no Dataverse round-trip until you're ready.

---

## TL;DR

```bash
# 1. Scaffold
pac pcf init --namespace YourCo --name MyControl --template field --framework react --run-npm-install

# 2. Author with AI (Copilot CLI auto-loads pcf-engineer + pcf-workbench from this repo)
copilot
> Build a MyControl that does X. Bind to Y. Validate with PCF Workbench against scenarios A/B/C.

# 3. The loop runs itself
#    pcf-engineer writes the code → pcf-workbench builds, renders, reports → AI fixes → repeat
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

### 2. Drop a requirement on Copilot

From the repo root:

```powershell
cd C:\path\to\PCF-Workbench
copilot
```

Then describe what you want. The more concrete, the better:

```
Build a MyControl in samples\MyControl\ that:
- Binds to a SingleLine.Text field
- Renders a Fluent v9 SearchBox with debounced onChange
- Pushes the typed value back via notifyOutputChanged
- Shows a small inline error when value.length > 100
- Disabled state should grey out and stop input

Validate with PCF Workbench using two scenarios:
1. empty starting value, type "hello", expect output "hello"
2. starting value of 105 chars, expect error visible
```

`pcf-engineer` writes the manifest + `index.ts` + React component. `pcf-workbench` then:

1. Builds the control (`npm run build` in `samples\MyControl`)
2. Launches the harness pointed at it
3. Runs each scenario headlessly
4. Captures screenshot + JSON report (pass / fail / N/A per row)
5. Hands the result back to Copilot

If anything fails, Copilot reads the report and patches the code. Loop until green.

### 3. Iterate

You don't need to babysit the loop. Just keep adding requirements:

```
Also support a "max length" property in the manifest and read it via context.parameters.maxLength.raw
```

`pcf-engineer` updates the manifest (bumps version), updates `index.ts`, `pcf-workbench` rebuilds + reruns scenarios. Saved scenarios mean regressions get caught the moment they regress.

### 4. Ship

When the harness is green and the scenarios pass, push to a real environment:

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
Renders each row as a horizontal bar where width = (row.value / maxValue) * 100%.
Validate with one scenario of 5 rows, screenshot and confirm bars are visible and proportional.
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
