# M12 — npm Publish (`pcfworkbench`) — Plan

> **Status:** Draft for review · **Depends on:** `DESIGN.md` (sign-off required before M1 starts)

5 milestones, each with a hard acceptance gate. AI stops at the first failure for human review.

---

## M1 — Package metadata + build:publish script

**Goal:** `npm pack` (locally, no network publish) produces a clean tarball with the right shape, contents, and metadata. Nothing has been published to npm yet.

Todos:
- [ ] Update `harness/package.json`:
  - `name` → `pcfworkbench`
  - `version` → `1.0.0-beta.1`
  - `description` → user-facing one-liner ("PCF dev harness + AI build loop for Power Apps Component Framework controls")
  - `keywords` → `["pcf","powerapps","power-apps","dataverse","component-framework","harness","testing","vite"]`
  - `repository` → `{"type":"git","url":"git+https://github.com/jaduplesms/PCF-Workbench.git"}`
  - `homepage` → `https://github.com/jaduplesms/PCF-Workbench#readme`
  - `bugs` → `{"url":"https://github.com/jaduplesms/PCF-Workbench/issues"}`
  - `license` → `MIT` (matches repo root LICENSE)
  - `author` → `jaduplesms`
  - `engines.node` → `>=18`
  - `bin` → `{"pcfworkbench":"./bin/pcfworkbench.js"}` (single bin, no alias)
  - `files` → `["bin/","dist/","plugin/","docs/ai-loop-report.schema.json","README.md","LICENSE"]` (allow-list)
  - `publishConfig` → `{"access":"public","tag":"beta"}` (forces `--tag beta` even if `npm publish` invoked plainly)
  - Move `@playwright/test`, `tsx`, `vitest` (when M11 lands), test-only types into a new `peerDependenciesMeta` set OR move to top-level `dependencies` — we need playwright at runtime for `loop`, so it has to be a regular `dependency`. Re-audit `dependencies` vs `devDependencies` against §2 of DESIGN.md.
- [ ] Add `harness/.npmignore` as belt-and-braces (even with `files` allow-list, this catches any drift).
- [ ] Add new npm script `build:publish` to `harness/package.json`:
  ```
  "build:publish": "rm -rf publish-staging && npm run build && tsc --project tsconfig.cli.json && cp -R dist publish-staging/dist && cp bin/pcfworkbench.js publish-staging/bin/ && cp README.publish.md publish-staging/README.md && cp ../LICENSE publish-staging/"
  ```
  Cross-platform variant — use a small Node script `scripts/build-publish.mjs` instead of shell. Avoids `cp`/`rm` Windows-vs-Unix divergence.
- [ ] Add `harness/tsconfig.cli.json` — narrow TS config for compiling just `bin/` to `bin/pcfworkbench.js` (ESM, target node18, single-file output).
- [ ] Copy repo `LICENSE` to `harness/LICENSE` so `files` can pick it up. (Alternative: have `build-publish.mjs` copy it from the repo root.)
- [ ] Run `npm pack --dry-run` from `harness/`. Inspect the file list it would publish.

**Acceptance gate (M1):**
- `npm run build:publish` exits 0 from `harness/`.
- `npm pack --dry-run` lists ONLY the files in DESIGN.md §2 (no `src/`, `tests/`, `node_modules/`, `__visual__/`, etc.).
- The would-be tarball size is < 10 MB.
- `harness/typecheck` still green.

---

## M2 — CLI bundling + `start` command

**Goal:** `node ./publish-staging/bin/pcfworkbench.js --help` works from a fresh shell, both subcommands run successfully against an in-repo sample. Locally simulating what a `npm i` user would experience.

Todos:
- [ ] Refactor `bin/pcf-harness.ts` → `bin/pcfworkbench.ts`. Keep the existing Commander setup. Add a top-level `start` subcommand alongside the existing `loop`. **Delete the old `bin/pcf-harness.js` shim** so there's only one entry point.
- [ ] `start` command behaviour:
  - `--path <dir>` (single-control mode) OR `--workspace <dir>` (gallery mode) — required (one of)
  - `--port <n>` (default 8181)
  - `--host <name>` (default 127.0.0.1)
  - `--open` / `--no-open` (default open)
  - Boots a programmatic Vite server using the bundled `dist/index.html` as the entry. The PCF plugin is imported from `./plugin/pcf-plugin.js`.
  - Logs the URL with a clear startup banner.
- [ ] Confirm `loop` subcommand works unchanged from the published bin path (no env-var assumptions about repo root).
- [ ] Add `--version` flag — reads from `package.json` at runtime.
- [ ] Polish help text — current help is minimal. Match DESIGN.md §3.
- [ ] Smoke test: `node publish-staging/bin/pcfworkbench.js start --path ../samples/StarRating/StarRating` — UI must boot, browser opens, control renders.
- [ ] Smoke test: `node publish-staging/bin/pcfworkbench.js loop --path ../samples/StarRating/StarRating --skip-build` — exits 0, writes `report.json`.

**Acceptance gate (M2):**
- Both smoke tests pass.
- The published bin path runs WITHOUT requiring a working directory under the repo (try from `C:\Temp\fresh-folder`).
- Existing `npm run harness` script in `harness/package.json` updated to call the new bin path; still works in dev.
- `npx pcf-harness` no longer resolves anywhere — confirms the rename is clean (not a typo-tolerated alias).

---

## M3 — Beta publish (`@beta` dist-tag) + dogfood

**Goal:** Real npm publish under the `beta` dist-tag. Real install on a different machine works.

Todos:
- [ ] **Create the npm org `pcfworkbench`** at https://www.npmjs.com/org/create. Pick the **Free** plan (sufficient for public packages). Add yourself as the sole owner. This is a one-time prerequisite — without it, `npm publish --access public` for `@pcfworkbench/cli` will fail with 403.
- [ ] Run `npm whoami` — confirm we're logged in as the right user. If not, `npm login`.
- [ ] Create npm 2FA token if one isn't already in place. (Required for publish under default org settings.)
- [ ] From `publish-staging/`, run `npm publish --tag beta --access public`.
- [ ] Verify on npmjs.com: package page renders the `README.publish.md`, version `1.0.0-beta.1`, install command shown is `npm i -D @pcfworkbench/cli@beta`.
- [ ] **Dogfood install** on a clean folder (ideally a different machine, or at minimum a totally fresh directory):
  - `mkdir C:\Temp\pcfworkbench-test && cd C:\Temp\pcfworkbench-test`
  - `npm init -y && npm i -D @pcfworkbench/cli@beta`
  - `npx pcfworkbench --help` — works
  - `npx pcfworkbench start --path C:\Temp\some-pcf-control` — UI boots
  - `npx pcfworkbench loop --path C:\Temp\some-pcf-control` — produces a green report
- [ ] If anything breaks during dogfood: bump `1.0.0-beta.2`, fix, republish, retry.

**Acceptance gate (M3):**
- `npm view @pcfworkbench/cli@beta` returns version `1.0.0-beta.x`.
- Fresh-machine dogfood test passes both `start` and `loop`.
- The `@pcfworkbench` npm org exists and you're the sole owner.

---

## M4 — Repo + docs refresh

**Goal:** Anyone landing on the repo via the npm package, the announcement, or a Google search sees a consistent install story.

Todos:
- [ ] `README.md` (repo root):
  - Add a top-of-fold "Install" section — `npm i -D pcfworkbench` first, "Or clone and contribute" second.
  - Refresh the screenshot caption / badge bar.
  - Add an npm version badge: `[![npm version](https://img.shields.io/npm/v/pcfworkbench/beta.svg)](https://npmjs.com/package/pcfworkbench)`.
- [ ] `BUILDING.md`:
  - Step 1 ("One-time setup") gets two paths side-by-side: A) `npm i -D pcfworkbench` for users, B) clone for contributors.
- [ ] `harness/docs/showcase.html`:
  - Quick Start section: lead with `npx pcfworkbench start --path ./MyControl`.
  - Install snippet: `npm i -D pcfworkbench` (or `@beta` until M5).
- [ ] `samples/StarRating/showcase.html`:
  - Footer "Built with PCF Workbench" link points at npmjs.com/package/pcfworkbench instead of the GitHub repo.
- [ ] `samples/StarRating/BUILT_WITH_AI.md`:
  - Reproduction steps switch to `npx pcfworkbench loop`.
- [ ] `.copilot/skills/{pcf-engineer,pcf-workbench}/SKILL.md`:
  - Add the npm-install alternative alongside the clone-the-repo path. Both should work.
- [ ] `.github/workflows/pcf-loop.yml` (CI self-test):
  - Replace `npm run harness -- loop ...` with `npx pcfworkbench loop ...` to dogfood the published binary path on every PR. **OR** keep `npm run harness` for in-repo speed and update the user-facing example workflow at `harness/docs/examples/pcf-loop.yml` only. Recommendation: keep `npm run harness` in the self-test for in-repo iteration speed; user-facing example uses `npx pcfworkbench loop`.
  - Either way: replace any literal `pcf-harness` references with `pcfworkbench`.

**Acceptance gate (M4):**
- All listed files updated.
- Repo `README.md` install section is the first H2 after the hero.
- typecheck still green.

---

## M5 — Promote to `latest` + announcement update

**Goal:** Beta has been stable for a week (or sooner if dogfood is clean). Promote, refresh the announcement, close M12.

Todos:
- [ ] Verify no critical issues filed against `1.0.0-beta.x` since the M3 publish.
- [ ] Run the full dogfood walkthrough one more time on a clean folder.
- [ ] Bump version: `1.0.0-beta.x` → `1.0.0`. Edit `package.json`, commit.
- [ ] `npm publish --access public` (no `--tag` → goes to `latest`).
- [ ] Verify on npmjs.com: `latest` resolves to `1.0.0`. `npm i -D pcfworkbench` works without `@beta`.
- [ ] Update repo `README.md` install snippets to drop `@beta`.
- [ ] Update `harness/docs/showcase.html` Quick Start.
- [ ] Update LinkedIn / Twitter announcement: post follow-up with `npm i -D pcfworkbench` and a 30-second demo gif/screenshot.
- [ ] Mark M12 done in `harness/docs/showcase.html` Roadmap; bump the "What's next" card to whatever's next.
- [ ] Final commit: `release: pcfworkbench 1.0.0 → latest`.

**Acceptance gate (M5):**
- `npm view pcfworkbench` shows `latest: 1.0.0`.
- `npm i -D pcfworkbench` (no tag) installs cleanly.
- Repo + showcase + announcement all reference `1.0.0`.
- `harness/typecheck` green; working tree clean after final commit.

---

## Out of scope (explicitly deferred)

- **`create-pcfworkbench` scaffolder.** `npm init pcfworkbench` to scaffold a PCF project pre-wired with the harness. Worth doing later; not blocking M12.
- **Programmatic API.** `import { runLoop } from 'pcfworkbench'`. No demand yet; revisit when scriptable users emerge.
- **Skills inside the npm tarball.** Stays repo-only by design.
- **Domain registration** (`pcfworkbench.dev`). Defensive nice-to-have; doesn't block M12.
- **GitHub org `pcfworkbench`** — pursue as a side task; doesn't block M12.
- **Migration story for the squatted `pcf-workbench`.** We're not pursuing it (decision 2026-06-15). If they go quiet for 12+ months, we can revisit then.
- **VS Code extension wrapper.** Roadmap M8 territory; entirely separate milestone.

---

*Once approved, AI executes M1, halts at first failing acceptance gate for review.*
