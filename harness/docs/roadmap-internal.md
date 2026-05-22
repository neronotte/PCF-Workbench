# PCF Workbench — Internal Roadmap

> **Private milestone tracker.** Not linked from `showcase.html`. Public milestones
> (M0–M8) live in `showcase.html` and `.copilot-instructions.md`. Anything in
> this file is internal-only — work that's either too experimental, too narrow,
> or too strategic to advertise on the public roadmap.

---

## M9 — Deployed Control Extraction & Live Loading

**Status:** P1 spike landed; P2 chunks 1–3 shipped.

**Goal:** load a customer's *deployed* PCF straight out of their Dataverse org —
no source, no `pcf-scripts`, no `npm install`. Browse → click → run, with all
the same shims as a local build.

### Shipped

- **M9.P1** *(spike)* — Extract & load deployed PCF controls from Dataverse
  Commit `f24fa4d`. Proves the WebResource pull + bundle disassembly path
  works end-to-end against a real org.

- **M9.P2 chunk 1** — Real Fluent UMDs via on-demand esbuild bundle
  Commit `983cf16`. `/__pcf/fluent-cdn/...` middleware does a one-off
  `npm install` + esbuild for the exact Fluent version a deployed bundle needs,
  caches under `harness/.fluent-cache/`.

- **M9.P2 chunk 2** — Load Fluent v8 + v9 in parallel from bundle scan
  Commit `c338242`. Plugin scans the bundle for `FluentUIReactv*` references
  and loads every major it finds (deployed bundles routinely mix v8 + v9).

- **M9.P2 chunk 3** — In-process extract + Gallery "Deployed" tab
  Commit `5e60743`. Extract runs inside the Vite dev server; Gallery surfaces
  deployed controls alongside local ones with one-click load.

### Pending

- **M9.P3** — Persisted extract cache + refresh UX
  Cache extracted controls per-org so re-opening the workbench doesn't re-pull
  from Dataverse. Surface "last extracted" timestamp + refresh button.

- **M9.P4** — Source map recovery for deployed bundles
  Where the deployed `bundle.js` ships with an embedded or sibling `.map`,
  enable TS-level breakpoints in the harness. Stretch: best-effort beautify
  fallback when no map exists.

- **M9.P5** — Solution import round-trip
  After modifying property values / scenarios against a deployed control,
  generate a patch solution that imports back into the source org. Mostly
  test-data oriented (saved scenarios become a solution-shipped seed pack).

### Why internal

The deployed-control extraction path touches solution metadata and the
WebResources endpoint in ways that some customers will read as "scraping their
org." Until we have clear positioning (read-only by default, never modifies
solutions, mirrors what `pac solution clone` already does), the feature stays
off the public roadmap.

---

## Process

- Every internal milestone gets a card here with the same shape as a public
  milestone in `showcase.html`: numbered chunks, commit references when shipped,
  short rationale when pending.
- When an internal milestone matures enough to advertise, copy its card into
  the appropriate section of `showcase.html` and replace it here with a
  "Promoted to public roadmap → see M*" pointer.
- Don't link this file from `showcase.html`, the README, or any public doc.
