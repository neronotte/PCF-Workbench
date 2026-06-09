# StarRating — Plan

> **Status:** Draft for review · **Depends on:** `DESIGN.md` (sign-off required before M1 starts)

Five milestones. Each ends at a hard, automatable acceptance gate. AI stops at the first failure for human review.

---

## M1 — Manifest + skeleton

**Goal:** A buildable PCF that registers in the harness and shows *something*.

Todos:
- [ ] Replace scaffolded `HelloWorld.tsx` with `StarRating.tsx` placeholder (renders "TODO" text).
- [ ] Update `ControlManifest.Input.xml`:
  - bound `value` property (`Whole.None`)
  - input `maxStars` (`Whole.None`, default `5`)
  - input `allowClear` (`TwoOptions`, default `true`)
  - `requires-react: true`, Fluent v9 platform-library reference
- [ ] Update `index.ts` to mount `StarRating` via React root in `init`, unmount in `destroy`.
- [ ] `npm run build` succeeds, `out/controls/StarRating/bundle.js` exists.

**Acceptance gate (M1):**
- `npm run build` exit 0, no TS errors.
- Harness loads control (single-control mode) and renders "TODO" without console errors.

---

## M2 — Render stars + bound value

**Goal:** Stars render and reflect the bound integer value.

Todos:
- [ ] Implement star row: `maxStars` × outline/filled SVG icons.
- [ ] Read `context.parameters.value.raw` and `maxStars.raw` in `updateView`.
- [ ] Clamp out-of-range values per design §5 (render-only, no write-back).
- [ ] Apply Fluent tokens (`colorBrandForeground1` filled, `colorNeutralForeground3` outline).
- [ ] Click handler updates internal state + calls `notifyOutputChanged()`.
- [ ] `getOutputs()` returns `{ value }` — `undefined` if user never interacted (avoid spurious 0-writes on load).

**Acceptance gate (M2):**
- Harness scenario `default-empty`: load with no value → 5 outlines, no console errors.
- Harness scenario `rated-3`: load with `value: 3` → 3 filled + 2 outlined.
- Harness scenario `click-rate`: load empty, click 4th star → store updates to `4`, lifecycle log shows `notifyOutputChanged`.

---

## M3 — Hover preview + keyboard a11y

**Goal:** Full WAI-ARIA radiogroup pattern + hover preview.

Todos:
- [ ] Hover preview (filled left-of-cursor, no commit).
- [ ] `role="radiogroup"` + per-star `role="radio"` with `aria-checked`, `aria-label`.
- [ ] Keyboard: `Tab` enters, `Left`/`Right`/`Up`/`Down` move + commit, `Home`/`End`, `0` clears (when `allowClear`).
- [ ] Focus ring via Fluent's `makeStyles` focus visuals.
- [ ] Disabled state: dim + no pointer events + `tabIndex={-1}`.
- [ ] `isAuthoringMode` static preview (3 filled, 2 outlined, "Rating control" label).

**Acceptance gate (M3):**
- Harness scenario `keyboard-nav`: focus first star, press `Right` 3× → value = 3, `aria-checked` reflects on 3rd star.
- Harness scenario `disabled`: load with `isControlDisabled: true` → no hover effect, no keyboard response, dimmed.
- Harness scenario `authoring-mode`: `isAuthoringMode: true` → static preview rendered.
- axe-core (via harness audit) reports 0 violations on the control root.

---

## M4 — Scenarios + headless gate

**Goal:** A `test-scenarios.json` covering every UX state, validated by the headless `pcf-harness loop` CLI.

Todos:
- [ ] Author `data.json` (3 records, mixed ratings: 0, 3, 5).
- [ ] Author `test-scenarios.json` with the 7 scenarios from M2 + M3 above + edge cases:
  - `clamp-high` (value=10, maxStars=5) → renders 5 filled
  - `invalid-max` (maxStars=0) → error placeholder
  - `clear-via-zero-key` (rated=3, press `0`) → value=0, output updated
- [ ] Capture thumbnail (`thumbnail.png`) via harness Save Thumbnail.
- [ ] `npx pcf-harness loop --path samples\StarRating\StarRating --reporter json` exits 0.

**Acceptance gate (M4):**
- Loop JSON report: 100% scenarios pass, 0 leaks, 0 console errors, 0 axe-core violations.
- Screenshots committed under `__visual__/` for visual diff baseline.

---

## M5 — Documentation + commit

**Goal:** A new user can read the sample's docs and understand both the control *and* how it was built.

Todos:
- [ ] `BUILT_WITH_AI.md` in the sample folder — captures the exact prompts used, the design/plan iteration, and links to `DESIGN.md` + `PLAN.md` as the contract.
- [ ] Update `samples/README.md` — add StarRating to the layout diagram, link to `BUILT_WITH_AI.md` as the worked example for the AI loop.
- [ ] Update `showcase.html` "Recently shipped" section — add an M10 card noting skills-in-repo (M10.P1), `BUILDING.md` (M10.P2), and the StarRating worked example (M10.P3).
- [ ] Commit: `feat(samples): StarRating — first AI-built sample (M10.P3)`.

**Acceptance gate (M5):**
- `npm run typecheck` in `harness/` still green (no broken refs).
- `git status` clean after commit; sample folder excludes `node_modules`, `out`, `obj`, `bin`, `generated` per repo `.gitignore`.

---

## Out of scope (explicitly deferred)

- Playwright spec in `harness/tests/` covering StarRating end-to-end — would belong with M3.P2 (CI loop) work, not M10.P3.
- Half-star support, custom icons, animations — see DESIGN.md §1 non-goals.
- Solution-pack + push to a real Dataverse env — sample stays source-only.

---

*Once approved, AI executes M1, halts at first failing acceptance gate for review.*
