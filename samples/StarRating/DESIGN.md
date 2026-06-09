# StarRating — Design

> **Status:** Draft for review · **Author:** AI-coauthored (Copilot + jaduples) · **Last updated:** 2026-06-09

A small field-bound PCF control that lets a user rate a record on a 0–5 star scale and writes the chosen value back to a bound `Whole.None` field. Built end-to-end via the AI loop as the worked example for **M10.P3** (AI-built sample) in PCF Workbench.

---

## 1. Purpose & non-goals

**Purpose**
- Provide a simple, accessible 0–5 star picker for any `Whole.None` (integer) field in a model-driven form.
- Serve as the canonical "built end-to-end by AI" sample for the `pcf-engineer` + `pcf-workbench` skill loop.

**Non-goals**
- Half-star ratings (out of scope; integer field only).
- Fractional / weighted aggregates (this is a single-record input, not a roll-up).
- Custom icon themes (one Fluent-style star icon, two states: filled / outline).
- Animation / hover micro-interactions beyond the standard Fluent focus ring + hover scale.

---

## 2. Bound property & manifest

| Property | Type | Usage | Notes |
|---|---|---|---|
| `value` | `Whole.None` (bound) | The 0–5 rating, integer | `of-type-group="numbers"` not used — keep simple |
| `maxStars` | `Whole.None` (input, default `5`) | Total stars rendered | Allows `3` or `10`-star variants without code change |
| `allowClear` | `TwoOptions` (input, default `true`) | Clicking the currently-selected star clears to `0` | Off → minimum rating is 1 |

- Manifest version `1.0.0` for first ship.
- `requires-react: true`, `platform-library` Fluent v9.
- No CSS resource needed — inline `style` and Fluent tokens only (keeps the bundle tiny).

---

## 3. UX states

| State | Behaviour | Notes |
|---|---|---|
| **Default (value=0)** | All stars rendered as outlines, brand-coloured | Tooltip: "Not rated" |
| **Rated (value=N)** | Stars 1..N filled, N+1..max outlined | Tooltip: "Rated N of M" |
| **Hover** | Hovered star + all to its left preview as filled (no write) | Visual only; commits on click |
| **Focused** | Standard Fluent focus ring on the focused star | Keyboard nav target |
| **Disabled** | All stars dimmed (Fluent `colorNeutralForegroundDisabled`), no pointer events, no focus | Reads `context.mode.isControlDisabled` |
| **Read-only** | Same as Disabled visually; we don't distinguish | Per Dynamics convention for field controls |
| **Empty (null)** | Treated as `0` for rendering, but `getOutputs()` returns `undefined` if user never interacted | Avoid spurious 0-writes on form load |

---

## 4. Accessibility

- Wrap the row in `role="radiogroup"` with `aria-label="Rating, 0 to M stars"`.
- Each star is `role="radio"` with `aria-checked` reflecting the current value.
- Keyboard:
  - `Tab` enters the group (lands on the currently-selected star, or the first star if none).
  - `Left` / `Right` / `Up` / `Down` move and **commit** (matches WAI-ARIA radiogroup pattern).
  - `Home` → 1 star, `End` → M stars.
  - `0` key clears (when `allowClear=true`).
- Hover-preview is visual only; screen reader only hears the committed `aria-checked` change.
- High-contrast mode: rely on Fluent tokens (`colorBrandForeground1`, `colorNeutralForeground3`) — no hard-coded hex.
- Each star has an `aria-label` of the form `"N stars"` for individual-star announcement.

---

## 5. Edge cases

- **value > maxStars** — clamp to `maxStars` on render; do not write back (no silent data mutation).
- **value < 0** — clamp to `0` on render; same: no write-back.
- **maxStars ≤ 0** — render an inline error placeholder ("Invalid maxStars: must be ≥ 1"), no stars.
- **maxStars > 20** — same error path; we don't need to support 100-star ratings.
- **Bound value changes externally** (other control writes to same field) — `updateView` picks it up and rerenders; no leak.
- **Disabled mid-interaction** (user hovering when form goes read-only) — clear hover state on the next `updateView`.

---

## 6. `isAuthoringMode` (designer preview)

When `context.mode.isAuthoringMode === true`, render a static preview: 3 filled + 2 outlined stars + the label "Rating control" beneath. No interaction. This is what the form designer / app maker sees in the canvas before binding data.

---

## 7. Lifecycle correctness (no leaks)

- React root created in `init`, unmounted in `destroy`.
- All event listeners are React `onClick` / `onKeyDown` props — no manual `addEventListener`.
- No `setInterval` / `setTimeout` / `ResizeObserver` needed.
- `notifyOutputChanged` only called from the user-action handler — never from `updateView` (avoids loops).

---

## 8. Open questions (for review)

1. **Hover preview without commit** — confirmed acceptable? Fluent's own `Rating` (v9 preview) commits on hover-and-leave; we're matching the more common pattern of "click to commit, hover is just preview".
2. **`allowClear` default** — true (Dynamics convention is clearable rating). Push back if you want strictly 1–N.
3. **Tooltip wording** — using "Rated N of M". OK or prefer "N stars" / "N out of M"?

---

*Sign-off → produces `PLAN.md` → AI executes M1, halts at first failing milestone for review.*
