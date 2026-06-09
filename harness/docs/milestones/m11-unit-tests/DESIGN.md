# M11 — Unit Tests for Pure-Logic Modules — Design

> **Status:** Draft for review · **Author:** AI-coauthored (Copilot + jaduples) · **Last updated:** 2026-06-09

Stand up a Vitest unit-test runner inside `harness/` and write tests for the pure-logic modules where Playwright E2E coverage is expensive or impossible to reach. Catches a class of silent regression (OData filter precedence, scenario v1→v2 migration, date-rebase math, manifest XML edge cases) that the Conformance Tester grid wasn't built to surface.

---

## 1. Purpose & non-goals

**Purpose**
- Unit-test pure-logic modules that branch heavily and are off the UI critical path.
- Make those modules safe to refactor — today every change is gated by an E2E run plus manual sanity-check.
- Catch silent regressions in parser / mutator / migration code that wouldn't surface in Playwright until a customer hit them.

**Non-goals**
- Replacing Playwright. The conformance grid + gallery spec stay as the integration / contract gate. Unit tests complement, not duplicate.
- Testing React components / panels. Playwright already covers those end-to-end; React Testing Library would mostly duplicate effort.
- Testing the Vite plugin. That's integration territory; the plugin's behaviour is observable via E2E.
- Testing the shim implementations directly. The Conformance Tester grid IS the unit test for shims — running it via Playwright is the right gate.
- Chasing a coverage percentage. We're optimising for *bug-catching value per test*, not for a green badge.

---

## 2. Runner choice: Vitest (not Jest)

| Factor | Vitest | Jest |
|---|---|---|
| Vite integration | Reuses our existing `vite.config.ts`, virtual modules, aliases | Needs Babel + ts-jest, doesn't see Vite plugins |
| ESM support | Native | Requires CJS transforms or experimental ESM mode |
| Speed | Threadpool, hot test reload | Single-process by default |
| API | `describe / it / expect / vi.fn()` (Jest-compatible) | Same |
| TypeScript | Direct via esbuild, no extra config | `ts-jest` config + transform map |
| Bundle | One dev dep (`vitest`) | `jest`, `ts-jest`, `@types/jest`, `babel-jest`, presets |

**Decision:** Vitest. Jest in a Vite project is friction we don't need to take on. Same API for anyone fluent in Jest.

---

## 3. Modules in scope (P1 — first pass)

In priority order, with the bugs unit tests would have caught listed where known:

| # | Module | What we test | Bugs it would have caught |
|---|---|---|---|
| 1 | `lib/scenario-store.ts` | `normalizeScenario` v1→v2 migration · `resolveScenarioValues` fieldBindings + clamping · `buildDefaultScenario` defaults · `bootstrapLegacyDataJson` shape guards | H12 (data race) — partly. Future migration breakage. |
| 2 | `parser/manifest-parser.ts` | Single vs multiple `<code>` / `<css>` / `<img>` / `<property>` · type-groups · enum values · missing attributes · empty manifests · feature-usage parsing | H5 (`<img>`) shipped without one. |
| 3 | `shim/web-api.ts` OData parser | `$filter` parsing: `eq`/`ne`/`gt`/`ge`/`lt`/`le` · `and`/`or` precedence · `contains` / `startswith` / `endswith` · null literals · quoted strings with embedded apostrophes · `$select` + `$orderby` + `$top` + `maxPageSize` · `$expand` round-trip | Silent OData regressions. |
| 4 | `store/date-rebase.ts` | Anchor-relative rebasing · DST boundaries · leap years · 29-Feb edge case · timezone normalisation · null/undefined date fields | Time-travel scenarios going stale 6 months after capture. |
| 5 | `store/data-store.ts` | `replaceMockEntityData` deep clone · `mergeKeyedMockEntityData` dedup · subscriber notification ordering | Subtle stale-state UI bugs. |

**Out of P1 (deferred to P2 or never):**
- `loader/control-host.ts` (integration; Playwright)
- `loader/bundle-loader.ts` (network/DOM; Playwright)
- `loader/resource-tracker.ts` (DOM lifecycle; Playwright)
- `shim/form-context.ts` (the Conformance Tester is its unit test)
- `shim/xrm-global.ts` (same — conformance grid covers it)
- All `ui/*` (Playwright)

---

## 4. Layout

```
harness/
├── vitest.config.ts                NEW — minimal config inheriting from vite.config.ts
├── src/
│   ├── lib/
│   │   ├── scenario-store.ts
│   │   └── scenario-store.test.ts  NEW — colocated, *.test.ts pattern
│   ├── parser/
│   │   ├── manifest-parser.ts
│   │   └── manifest-parser.test.ts NEW
│   ├── shim/
│   │   ├── web-api.ts
│   │   └── web-api.odata.test.ts   NEW
│   └── store/
│       ├── data-store.ts
│       ├── data-store.test.ts      NEW
│       ├── date-rebase.ts
│       └── date-rebase.test.ts     NEW
```

Tests live next to their modules (Vitest default + matches repo conventions for keeping related code together).

---

## 5. Test fixtures

- Manifest XML fixtures: keep small literal strings in the test file unless they exceed ~30 lines, then `harness/src/parser/__fixtures__/<name>.xml`.
- Scenario JSON fixtures: literal objects in-test (avoids fs reads for unit speed).
- Date rebase: explicit anchor + offset pairs, no `Date.now()` non-determinism.
- OData filter strings: literal in-test.

No real HTTP, no fs reads in P1. Pure functions in, pure assertions out.

---

## 6. Edge cases / open questions (for review)

1. **Coverage reporting** — do we want `@vitest/coverage-v8` (free) wired up + a CI threshold, or just run-and-report? Recommendation: skip thresholds in P1 (premature gating). Add coverage *report* (no fail) and use it to find untested branches.
2. **CI integration** — add `npm run test` to the same GitHub Actions workflow that runs Playwright? Recommendation: yes, runs in <10s vs Playwright's minutes; fail-fast.
3. **Watch mode for dev** — Vitest defaults to watch on `npm run test`. Recommendation: keep, add `test:run` for CI one-shot.
4. **Snapshot tests** — `expect(...).toMatchSnapshot()` is supported but tempting to overuse. Recommendation: **no snapshots in P1** — every assertion explicit.
5. **Mocking** — Vitest has `vi.mock()`. Recommendation: **avoid in P1**. The modules in scope are already pure; if mocking is needed, scope went wrong.

---

## 7. Success criteria

- `npm run test` exists and passes.
- ~30–50 tests across the 5 P1 modules.
- Each module has at least one test per public function and one explicit edge-case test.
- Tests run in <5s wall-clock locally.
- `harness/typecheck` still green.
- `conformance.spec.ts` + `pcf-gallery.spec.ts` still green (Vitest setup must not affect Vite build).
- README and `.github/copilot-instructions.md` updated to mention the new gate.

---

*Sign-off → produces `PLAN.md` → AI executes M1, halts at first failing milestone for review.*
