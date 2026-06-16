# M12 — npm Publish (`pcfworkbench`) — Design

> **Status:** Draft for review · **Author:** AI-coauthored (Copilot + jaduples) · **Last updated:** 2026-06-16

Publish PCF Workbench to npm as a single package called **`pcfworkbench`** (no hyphen) so users can install and run it without cloning this repo. Ships **two CLI commands** in one package: `npx pcfworkbench loop` (headless CI) and `npx pcfworkbench start` (full harness UI launched into a browser). Bin alias `pcf-harness` retained for back-compat with existing `harness/bin/pcf-harness.js` callers.

---

## 1. Purpose & non-goals

**Purpose**
- Make adoption a one-liner: `npm i -D pcfworkbench` in any PCF project, then `npx pcfworkbench start`.
- Match the workflow CI runs already use today (`npm run harness -- loop`) without forcing a repo clone.
- Take the **`pcfworkbench`** name on npm before another conflicting package gets traction. The hyphenated `pcf-workbench` is already squatted by an unrelated 12-version package; we settled on the unhyphenated form (see session log 2026-06-15).
- Preserve the existing brand: README / showcase / UI / tooltips all continue to read **"PCF Workbench"**. Only the npm identifier and install instructions change.

**Non-goals**
- A `create-pcfworkbench` scaffolder (`npm init pcfworkbench`). Could land later; not on the path for M12.
- A programmatic API (`import { runLoop } from 'pcfworkbench'`). Users asked for a CLI; we keep the JS surface internal until there's real demand.
- Dispute / takeover of the bare `pcf-workbench` name. Decided 2026-06-15 that's not worth the time.
- Publishing the in-repo samples (`StarRating`, `ConformanceTester`) — they stay repo-only; npm package only ships the harness.
- Publishing skills inside the tarball. They live at `<repo>/.copilot/skills/` and get loaded when Copilot CLI runs inside the cloned repo. Bundling them in the npm package would break the auto-discovery contract.
- A monorepo split. Everything stays in this repo; the npm package is the `harness/` workspace, full stop.

---

## 2. Package layout — what's in the tarball

The published package is the existing `harness/` workspace, plus a few publish-only files. Only what's listed below ships. Everything else is excluded via `files` (allow-list, not `.npmignore` deny-list — safer).

```
pcfworkbench-1.0.0-beta.1.tgz
├── package.json
├── README.md                 (publish-friendly version, see §6)
├── LICENSE                   (copy of repo root LICENSE)
├── index.html                (the harness page; entry point Vite serves)
├── bin/
│   └── pcfworkbench.js       (esbuild-bundled CLI — see §3)
├── src/                      (TypeScript source — Vite transforms on demand)
│   └── …                     (React UI, plugins, shims, store, parser)
└── docs/
    ├── ai-loop-report.schema.json   (JSON schema for loop reports — agents read this)
    ├── ai-build-loop.md
    ├── ai-loop-skill.md
    └── examples/pcf-loop.yml
```

**Why ship the source instead of a prebuilt `dist/`?**
The harness UI imports `virtual:pcf-manifest` — a Vite virtual module resolved at transform time by `pcf-plugin.ts` based on the current `PCF_CONTROL_PATH` / `PCF_WORKSPACE_ROOT` env var. If we prebuild `dist/`, the manifest is baked in (whatever happened to be the current control during the publish build), and the CLI loses the ability to load arbitrary user PCFs at runtime. Running Vite in **dev mode** against `src/` re-resolves the virtual module per request, so the CLI can switch between controls without rebuilding.

**Excluded** via `package.json#files` allow-list: `tests/`, `__visual__/`, `coverage/`, `node_modules/`, `*.test.ts`, `vitest.config.ts`, `playwright.config.ts`, `tsconfig.*`, `.env*`, `pcf-loop-reports/`, `dist/`, `publish-staging/`, the milestone planning docs, `docs/showcase.html`, `docs/roadmap-internal.md`, debug Python scripts.

Estimated tarball size: **~1.5–2 MB compressed / ~5 MB unpacked** (TypeScript source is text-heavy but compresses well; the CLI bundle and runtime deps via npm install are the real install cost).

---

## 3. CLI surface — `bin/pcfworkbench`

One `bin` entry, two subcommands. The existing `bin/pcf-harness.ts` already has the Commander wiring; we extend it and rename the bin.

```
$ pcfworkbench --help

  pcfworkbench — PCF dev harness + AI build loop

  Commands:
    start [options]   Launch the harness UI in your browser
    loop  [options]   Run a headless build → render → report cycle
    --version         Show installed pcfworkbench version
    --help            Show this help

  Examples:
    pcfworkbench start --path ./MyControl
    pcfworkbench start --workspace ./samples       # gallery mode
    pcfworkbench loop  --path ./MyControl --out ./reports
```

**No alias.** The legacy `pcf-harness` bin name (used internally pre-publish) goes away. Reasons:
- It's generic platform-flavoured naming and could collide with future Microsoft tooling.
- No public user is installed under it — there's been no npm release yet.
- Our in-repo CI workflow (the only caller today) is fully under our control and gets updated in M4.
- Defensive reservation of `pcf-harness` on npm is also OUT — that's the same brand-squatting move the incumbent pulled on us. We just don't take the name.

**`pcfworkbench start`** — boots a local Vite dev server pre-wired with the PCF plugin + the prebuilt harness UI, opens the user's default browser at `http://127.0.0.1:8181`. Same env vars work as today (`PCF_CONTROL_PATH`, `PCF_WORKSPACE_ROOT`).

**`pcfworkbench loop`** — exactly what `bin/pcf-harness.ts loop` does today: spawns headless Chromium, runs the control through the harness, emits `report.json` + `screenshot.png`. No code change beyond entry-point renaming.

---

## 4. Build & distribution strategy

We need TWO builds because the package contains two different artifacts:

| Artifact | Toolchain | Output |
|---|---|---|
| **Harness UI** | `vite build` (existing) | `dist/index.html` + `dist/assets/*.js` + `dist/assets/*.css` |
| **CLI script** | `tsc` or esbuild | `bin/pcfworkbench.js` (single ESM file with shebang) |
| **Vite plugin** | `tsc` | `plugin/pcf-plugin.js` (CommonJS so it works inside Vite's Node runtime) |

Build orchestration via a new npm script: `npm run build:publish` runs the three builds in sequence and writes everything into a `publish-staging/` folder, which is what `npm pack` reads. Avoids polluting the repo's `dist/` (which is also used by `npm run preview` in dev).

**Tradeoff considered:** could ship raw TS + a `prepublish` script that runs `vite build` on install. Rejected: makes `npm i` slow (5-10s per install) and adds Vite as a runtime dep. Pre-building once at publish time is cleaner.

---

## 5. Versioning & release strategy

**Starting version: `1.0.0-beta.1`** (NOT bare `1.0.0`).

Rationale: the *codebase* has been at 1.0.0 for months internally and you've shipped M0–M10. But this is the **first public npm release**. A beta tag:
1. Lets us iterate on packaging gotchas (missing files, broken imports from the published tarball, OS-specific path bugs) without cutting a 1.0.x patch every time.
2. Sets expectations for early adopters from the announcement audience.
3. Cleanly graduates to `1.0.0` once we've dogfooded a real install + a fresh-machine test.

**Dist-tags:**
- `npm publish --tag beta` → installs require `npm i -D pcfworkbench@beta`. **For M12.P3 first ship.**
- After ~1 week of dogfood, `npm dist-tag add pcfworkbench@1.0.0 latest` → bare `npm i -D pcfworkbench` works. **M12.P4.**

**Future cadence:** semver. New shim-API surface is minor (1.1, 1.2, …); shim contract changes that break controls are major (2.0). CLI breaking changes are major. Patch versions for bugfixes only.

---

## 6. README & docs

The repo's current `README.md` is an internal-flavoured project README. The **published README** (the one users see on npmjs.com) needs different framing: install command first, value prop in 30 seconds, link out to the repo for deep docs.

Approach: **two READMEs**.
- `README.md` (repo root) — unchanged, internal/dev-flavoured.
- `harness/README.publish.md` — new, lean, publish-targeted. Copied to `README.md` inside the publish-staging folder by the build script.

Trade-off considered: maintain a single README with `<!-- npm-only -->` marker comments. Rejected: invisible-divergence risk; cleaner to have the two files visibly side-by-side.

---

## 7. Co-located artifacts to update

These all need their install instructions / brand text refreshed when the publish goes live. NOT in the M12 critical path but tracked here so we don't ship a partial story:

| File | Change |
|---|---|
| `README.md` (repo) | Add "Install via npm: `npm i -D pcfworkbench`" alongside the existing clone instructions |
| `BUILDING.md` | Step 1 (One-time setup) gets an alt path: install via npm instead of clone |
| `harness/docs/showcase.html` | "Quick Start" section updates to lead with `npm i -D pcfworkbench` |
| `samples/StarRating/showcase.html` | Reference link to npmjs.com/package/pcfworkbench |
| `samples/StarRating/BUILT_WITH_AI.md` | Update reproduction instructions |
| Skills (`.copilot/skills/{pcf-engineer,pcf-workbench}/SKILL.md`) | Add the npm install path as an alternative to the clone path |
| `.github/workflows/pcf-loop.yml` | No change — it stays on the in-repo `npm run harness` path. The published-package version is for downstream users, not our self-test. |
| LinkedIn / Twitter announcement | Update / repost with `npm i -D pcfworkbench` |

---

## 8. Defending against future name collisions

After publish, take three defensive moves:

1. **Reserve neighbouring names** as redirect/deprecated stubs pointing at the canonical name:
   - `pcf-workbench-cli`, `pcf-bench`, `pcfworkbench-cli` → publish empty packages with `"deprecated": "Use pcfworkbench instead — see https://npmjs.com/package/pcfworkbench"` in `package.json`.
   - Costs ~10 minutes; prevents a repeat of the squatting situation we just hit.
2. **Claim the GitHub org / handle parity** — `github.com/pcfworkbench` if available. Defensive only.
3. **Domain check** — `pcfworkbench.dev` or `.io`. If we want a marketing site later, lock now. (Not on the M12 critical path — defer.)

---

## 9. Open questions (for review)

1. **Beta period length.** I'm proposing ~1 week of dogfood before promoting to `latest`. That's an arbitrary number. Could be days (just verify install + start + loop work on a fresh machine) or 2–3 weeks (let early adopters file issues). **Recommendation:** ship beta, fix anything reported in the first week, promote to `latest` once we've done one full clean-install dogfood from a different machine.
2. **~~Bin name aliasing.~~** *Resolved 2026-06-16: NO alias.* Single bin `pcfworkbench`. The legacy `pcf-harness` name goes away — it's generic platform naming, could collide with future Microsoft tooling, and our in-repo CI workflow (the only caller today) gets updated in M4. We also do NOT defensively reserve `pcf-harness` on npm; that'd be the same squatting move the incumbent pulled on us.
3. **Browser auto-open on `start`.** Does `pcfworkbench start` open the default browser, or just print the URL? Vite has `--open` for this. **Recommendation:** auto-open by default; `--no-open` flag for headless / SSH cases.
4. **Telemetry / first-run notice.** Do we want a `Welcome to PCF Workbench v1.0.0-beta.1 — open https://… for docs` first-run notice, or stay silent? **Recommendation:** silent; respect user's terminal.
5. **`postinstall` hooks.** Should we run anything on install (e.g., `playwright install chromium` for `loop` to work)? **Recommendation:** NO `postinstall`. Detect missing Chromium at `loop` runtime and emit a one-line "run `npx playwright install chromium` and retry" message. `postinstall` hooks are a security smell and slow `npm i` to a crawl.
6. **Defensive package reservations.** Three names is what I proposed; we could go wider (10+) or narrower (just `pcf-workbench-cli`). **Recommendation:** the three listed. Wider feels like squatting in reverse.
7. **GitHub org name `pcfworkbench`.** Worth grabbing? Costs nothing. **Recommendation:** yes, grab it as a side task; don't block M12.

---

## 10. Success criteria

- `npm i -D pcfworkbench@beta` succeeds on a fresh machine.
- `npx pcfworkbench start --path ./StarRating/StarRating` boots the UI and loads the control end-to-end.
- `npx pcfworkbench loop --path ./StarRating/StarRating` exits 0 with a `report.json` matching the in-repo schema.
- `npx pcf-harness loop` (the alias) works identically.
- Repo `README.md` and `BUILDING.md` updated with the install path.
- Skill files reference the npm install path as an alternative.
- Tarball size <10 MB.
- The dogfood walkthrough (clean machine → install → run StarRating → see green report) works without manual intervention.

---

*Sign-off → produces `PLAN.md` → AI executes M1, halts at first failing milestone for review.*
