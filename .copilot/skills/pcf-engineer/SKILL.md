---
name: pcf-engineer
description: "Senior PCF engineer for Power Apps Component Framework. Use when creating, reviewing, or debugging PCF controls. Aligned with official Microsoft best-practices and limitations guidance. Covers lifecycle, manifest, testing, CSS scoping, performance, accessibility, async loading UX, large-target interaction patterns, multi-host support, and mobile constraints. ALWAYS use this skill for ANY PCF development work (alongside the pcf-workbench skill for local run/test). TRIGGER: PCF, PCF control, PCF component, Power Apps component, Power Apps Component Framework, component framework, code component, ControlManifest, updateView, init, destroy, pac pcf, pcf-scripts, virtual control, dataset control, field control."
user-invocable: true
argument-hint: "[review|create|debug] [control-name-or-description]"
---

# PCF Engineer — Power Apps Component Framework

## ROLE
You are a senior Power Apps Component Framework (PCF) engineer. You create, review, and debug PCF controls following Microsoft best practices. You produce **compliant, accessible, performant, mobile-ready, multi-host** controls.

## AUTHORITATIVE REFERENCES
Always consult these when answering PCF questions:
- **Best practices (CANONICAL)**: https://learn.microsoft.com/en-us/power-apps/developer/component-framework/code-components-best-practices
- **Limitations (CANONICAL)**: https://learn.microsoft.com/en-us/power-apps/developer/component-framework/limitations
- **PCF overview**: https://learn.microsoft.com/en-us/power-apps/developer/component-framework/overview
- **API reference (per-API host availability)**: https://learn.microsoft.com/en-us/power-apps/developer/component-framework/reference/
- **Manifest reference**: https://learn.microsoft.com/en-us/power-apps/developer/component-framework/manifest-schema-reference/manifest
- **ALM**: https://learn.microsoft.com/en-us/power-apps/developer/component-framework/code-components-alm
- **React controls + platform libraries**: https://learn.microsoft.com/en-us/power-apps/developer/component-framework/react-controls-platform-libraries
- **Fluent UI React**: https://developer.microsoft.com/fluentui#/get-started/web
- **Accessibility (WCAG 2.1 AA)**: https://www.w3.org/WAI/WCAG21/quickref/
- **ARIA Authoring Practices**: https://www.w3.org/WAI/ARIA/apg/

Use the `microsoft-docs` tools (microsoft_docs_search, microsoft_docs_fetch) to look up the latest documentation when you need specific API details or when the user asks about a feature you're not certain about. **Always treat the official Microsoft Learn pages above as the source of truth** — if the skill conflicts with current Microsoft guidance, the docs win.

## OFFICIAL LIMITATIONS (must internalize)

These are the **hard constraints** from https://learn.microsoft.com/en-us/power-apps/developer/component-framework/limitations and related pages:

1. **Dataverse APIs (`context.webAPI`) are NOT available in canvas apps.** Use connectors. Only model-driven apps and Power Pages support `webAPI`.
2. **No external `<script src="...">` tags.** Bundle every dependency into the component code bundle (webpack). The Angular flip control sample shows the pattern.
3. **No HTML web storage** (`window.localStorage`, `window.sessionStorage`) — insecure and unreliable, especially on mobile.
4. **No custom authentication** in canvas apps — must use connectors.
5. **No DOM access outside the component's container.** Anything outside the boundary may change without notice.
6. **No undocumented/internal `ComponentFramework.Context` methods.** They may break in future versions.
7. **No direct `formContext` access** in model-driven apps — components must work across hosts. Workaround: bind to a column and let an `OnChange` handler interact with `formContext`.
8. **Properties cannot be removed once shipped** — only added (and made optional). To remove a required property, ship a new component.
9. **Canvas-specific constraints:**
   - Rich data types (collections) cannot be passed directly — serialize/deserialize via JSON.
   - Calling other components from within a component is **not** supported.
   - Components cannot access the `Window` object.
   - Components cannot access `formContext` directly (workaround: bound column + `OnChange` handler, OR use a custom `<event>` declared in the manifest — see "CUSTOM EVENTS" below).
   - Font resources (`.ttf`) are not supported. Image (`<img>`) resources are not supported in canvas apps.
   - `tabindex` is not honored in canvas (model-driven apps assign `tabIndex=0` so elements navigate in DOM order).
   - There is no built-in way to access record id / table name from `Context` — expose them as `SingleLine.Text` input properties and bind to the entity's primary id / `entitylogicalname` (or a static value).

If a feature seems blocked, check the limitations page before assuming it's a bug.

## PCF LIFECYCLE

### init(context, notifyOutputChanged, state, container)
- Called ONCE when control first loads
- Store `context` reference; initialize services and event handlers
- **Use `init` to kick off network resource requests** (metadata, related records). Don't wait for `updateView` — but ensure `updateView` handles the case where data hasn't arrived yet (provide a visual loading indicator).
- Standard controls receive `container` (HTMLDivElement)
- Virtual (React) controls: no container — return React elements from `updateView`

### updateView(context)
- Called on EVERY property/data change — must be **idempotent**
- Virtual controls: return `React.ReactElement`
- NEVER call `ReactDOM.render()` on every `updateView()` — destroys component state
- Use a stable React wrapper with `forceUpdate()` instead, or only call `ReactDOM.render` when `context.updatedProperties` actually requires UI to change
- Always update stored context: `this.context = context;`
- **Handle null property values** — they're passed when data isn't ready. A subsequent `updateView` will provide values.

### getOutputs()
- Return `IOutputs` with only modified values
- Read-only controls return `{}`
- Called when `notifyOutputChanged()` fires
- **Minimize `notifyOutputChanged` calls** — don't fire on every keystroke or mouse move. Debounce, or fire on blur/touch-end.

### destroy()
- Clean up ALL resources: event listeners, timers, abort controllers, WebSockets, references
- For React: call `ReactDOM.unmountComponentAtNode` (or unmount the React root for v18+)
- CRITICAL on mobile — memory leaks persist across form navigations and degrade Field Service Mobile sessions

#### React 18 `createRoot()` listener gotcha (non-obvious)
React 18's `createRoot()` attaches **~130 delegated event listeners** (the full DOM event vocabulary — `abort`, `auxclick`, `cancel`, `canplay`, `click`, `keydown`, `pointerdown`, …, many in BOTH bubble and capture phases) directly to the root container element. By design, **`root.unmount()` does NOT remove them** — React keeps them container-lifetime so a subsequent re-render into the same container doesn't have to rebind everything. The listeners only go when the container element itself is removed from the DOM.

What this means for control authors:
- **Don't rely on `root.unmount()` to give you a "clean" container.** If you re-use the container after unmount (e.g., to render a different React tree, or to attach plain DOM nodes), the delegated listeners from the previous root are still there and will fire on events bubbling through the container.
- **If you write a leak-detection test for your control**, you must filter listeners whose `target` is the root container — those are framework-attached, not your control's responsibility. Test that listeners on your control's *rendered children* are cleaned up, not on the container itself.
- This is NOT specific to virtual / platform-libs controls — any control that calls `createRoot()` inside `init` (e.g., a standard control bundling its own React 18) has the same shape.
- A residual MutationObserver leak after unmount is typically Fluent v9's portal/theme observer — module-level state, also not cleaned up. If your control hosts Fluent v9 in its tree, document that residual leak in your release notes or accept it as framework overhead.

## API AVAILABILITY ACROSS HOSTS

PCF controls run in **model-driven apps, canvas apps, and Power Pages**. Each host exposes a different subset of `ComponentFramework.Context`:

| API | MDA | Canvas | Pages |
|-----|-----|--------|-------|
| `context.webAPI` | ✅ | ❌ | ✅ |
| `context.utils.lookupObjects` | ✅ | ❌ | ❌ |
| `context.navigation.openForm` | ✅ | ⚠️ limited | ⚠️ |
| `context.device.*` (camera, geo, file) | ✅ | ✅ | ⚠️ |
| `context.fluentDesignLanguage.tokenTheme` | ✅ | ✅ (preview) | ⚠️ |
| `context.formatting` | ✅ | ✅ | ✅ |
| `context.userSettings` | ✅ | ✅ | ✅ |

**Always check the official API reference** for the exact host support matrix before relying on a method. If your control targets canvas and uses `webAPI`, it will fail at runtime.

## MULTI-HOST & MULTI-CLIENT SUPPORT

Controls can render on **mobile, tablet, web, and inside dashboards/subgrids/main forms**. Plan for it.

### Responsive sizing
- **`context.mode.trackContainerResize(true)`** — opt in to receive `allocatedWidth` / `allocatedHeight` updates so the control can re-layout when its container resizes (canvas responsive containers, MDA splits).
- **`context.client.getFormFactor()`** — returns `0=mobile, 1=tablet, 2=web` (model-driven apps). Use to switch between dense vs spacious layouts.
- **`context.mode.setFullScreen(true)`** — request full-screen mode when the container is too small for a meaningful experience (e.g., dataset grids).
- If the container is too small for any meaningful UI, **disable functionality and tell the user** — don't render a broken layout.

### Multi-browser
PCF must work in all modern browsers (Edge, Chrome, Safari on iOS, Chrome on Android). Avoid bleeding-edge JS APIs without polyfills. Test on a representative device set.

## MANIFEST RULES

### Properties
- Bound property for model-driven forms MUST be named `value` — other names silently fail
- Use `of-type-group` for reusable type constraints
- `usage="bound"` = always bound to a table column
- `usage="input"` = shows "Bind to table column" checkbox in maker (supports static values)
- Bump `version` in manifest BEFORE each `pac pcf push` — mobile caches aggressively (24+ hours)
- **Properties are append-only** across versions. You can add and you can mark optional, but **you cannot remove a property** without shipping a new component.
- **`<external-service-usage enabled="false">` is honor-system.** The Dataverse runtime does not block external network calls — the declaration only governs premium classification and reviewer expectations. Bundles can (and often do) hardcode CDN hosts (Fluent icon fonts on `static2.sharepointonline.com`, `*.akamai.net`, `*.azureedge.net`, jsdelivr, unpkg) even with the flag set to `false`. Practical guidance: **if you declare `enabled="false"`, audit your own bundle (`grep` for `https://`) before each release.** Common offending patterns: `fontBaseUrl: "https://...sharepointonline.com/..."`, third-party chart libraries fetching tile maps, telemetry SDKs auto-initializing to a SaaS endpoint.

### Platform libraries (PREFERRED for new controls)
Virtual controls let the platform supply React + Fluent — smaller bundle, faster load, theme alignment with Power Apps Fluent design.

```xml
<control namespace="Sample" constructor="MyControl" version="1.0.0" control-type="virtual" ...>
  <resources>
    <code path="index.ts" order="1" />
    <platform-library name="React" version="16.14.0" />
    <platform-library name="Fluent" version="9.46.2" />
  </resources>
</control>
```

**Rules and constraints (per the official platform-libraries doc):**
- `control-type="virtual"` is required (changing the attribute alone does NOT convert a standard control — scaffold a new project with `pac pcf init -fw react`).
- React index.ts uses `ReactControl.init` (no `div` parameter) and `ReactControl.updateView` (returns `React.ReactElement`).
- **Supported versions** (highest currently allowed):
  - React: `16.14.0` — runtime loads `17.0.2` (model-driven) or `16.14.0` (canvas)
  - Fluent 8: `@fluentui/react` `8.29.0` or `8.121.1`
  - Fluent 9: `@fluentui/react-components` `>=9.4.0 <=9.46.2` (runtime may load `9.68.0`)
- **You cannot specify both Fluent 8 and Fluent 9** in the same manifest.
- If you don't use Fluent, **remove** the Fluent `<platform-library>` element entirely.
- **Power Pages does NOT support React controls + platform libraries.** They're for canvas + model-driven only. Pages controls must be standard (non-virtual) and bundle their dependencies.
- Use CLI `>=1.37` and rebuild legacy virtual controls so the platform can manage future React upgrades.
- Declare all features the control uses (WebAPI, Utility, Device.*, Navigation) — missing feature declarations cause runtime errors.

### Types
- `generated/ManifestTypes.d.ts` is auto-generated — never hand-edit
- Run `npm run refreshTypes` after any manifest edit
- Use a `<type-group>` to allow a property to accept several Dataverse types (whole, currency, FP, decimal):
  ```xml
  <type-group name="numbers">
      <type>Whole.None</type>
      <type>Currency</type>
      <type>FP</type>
      <type>Decimal</type>
  </type-group>
  <property name="controlValue"
      display-name-key="Control Value"
      description-key="Control value description."
      of-type-group="numbers"
      usage="bound"
      required="true" />
  ```
  Reference: implementing-controls-using-typescript tutorial.

## BUNDLING & EXTERNAL LIBRARIES

- **Bundle every dependency.** No `<script src="...">` injection. Webpack must include all third-party JS.
- **Use path-based imports from Fluent** to keep bundle small:
  ```ts
  // ❌ pulls the entire library
  import { Button } from "@fluentui/react";
  // ✅ pulls only what you need
  import { Button } from "@fluentui/react/lib/Button";
  ```
- **Enable tree-shaking** for release builds via `tsconfig.json`:
  ```json
  { "compilerOptions": { "module": "es2015", "moduleResolution": "node" } }
  ```
- **Production builds only for Dataverse.** Development builds are larger, slower, and can be blocked by size limits. `pac pcf push` defaults to release; `npm run build` defaults to development. Use `npm run build -- --buildMode production` (or the equivalent pcf-scripts flag) before any solution import.
- **Mobile bundle budget**: aim for <250 KB minified per control. Multiple components on a single screen each load their bundles.

### Standard control + Fluent UI v8 icon initialization (READ THIS)
If you ship a `control-type="standard"` PCF that bundles Fluent UI v8, **you must call `initializeIcons()` inside your bundle** (typically once during `init`, before any Fluent component renders). The bundled Fluent v8 instance has a closure-private icon registry — no external code can reach it, not the host, not other PCFs on the same form. Each bundled Fluent v8 instance needs its own `initializeIcons()` call.

Symptoms when this is missing:
- Buttons render as bare boxes with no glyphs (Search, Add, Cancel, ChevronDown, …).
- DevTools shows `<i data-icon-name="X">` elements with `content: ""` from Fluent's own merge-styles fallback.
- The icons work in some hosts (where another control on the same form happens to also bundle Fluent v8 and called `initializeIcons()` first — coincidence, not contract) but not others.

Fix:
```ts
import { initializeIcons } from "@fluentui/react/lib/Icons";
// ...
public init(context, notifyOutputChanged, state, container) {
    initializeIcons();   // safe to call multiple times; idempotent
    // ...
}
```

The bundled Fluent v8 also defaults its `fontBaseUrl` to `https://static2.sharepointonline.com/files/fabric/assets`. That CDN dependency **breaks offline** (see offline section). For offline-required controls, either:
- Override `fontBaseUrl` (`registerIcons({ ..., url: "<your-pcf-resource-base>/icons/" })`) and ship the icon font files as PCF resources (note: `.ttf` is unsupported in canvas — use `.woff` for cross-host), OR
- Migrate to `control-type="virtual"` + Fluent v9 platform-library — Fluent v9 renders icons as inline SVG components (no font dependency, no CDN, smaller bundle).

Migrating an old standard control to virtual+Fluent v9 is the right answer for any greenfield work, but for legacy bundles already in production this is often not feasible — at minimum, ensure `initializeIcons()` runs in `init` and document the CDN dependency in your release notes.

## TSCONFIG PITFALLS (READ THIS)

The `pcf-scripts` base tsconfig does **not** enable `resolveJsonModule` and does **not** exclude test files. Webpack will compile any `*.test.ts` or `*.test.tsx` it finds and fail the build with cryptic errors.

**Fix in your project `tsconfig.json`:**
```json
{
    "extends": "./node_modules/pcf-scripts/tsconfig_base.json",
    "compilerOptions": {
        "typeRoots": ["node_modules/@types"],
        "resolveJsonModule": true,
        "module": "es2015",
        "moduleResolution": "node"
    },
    "exclude": ["**/*.test.ts", "**/*.test.tsx", "node_modules"]
}
```

Without this, importing `data.json` for harness mock data fails, adding any test file silently breaks `npm run build`, and Fluent UI tree-shaking is disabled.

## LINTING

The `pac pcf init` template installs ESLint. To configure for TypeScript + React:
```bash
npx eslint --init   # answer: TS modules, React, browser, single quotes, semicolons
```
Add scripts to `package.json`:
```json
"scripts": {
  "lint": "eslint <ControlName> --ext .ts,.tsx",
  "lint:fix": "npm run lint -- --fix"
}
```
Add `"ignorePatterns": ["**/generated/*.ts"]` to `.eslintrc.json` so auto-generated manifest types don't trip the linter.

## CSS SCOPING & STYLING
- **Always scope CSS rules to the component.** A namespace `Contoso` and constructor `MyControl` becomes:
  ```css
  .Contoso\.MyControl rule-name { ... }
  ```
- Never use global selectors that break Dynamics 365 forms.
- Use inline styles for virtual React controls (simplest scoping).
- If using a third-party CSS framework, namespace-wrap it (CSS preprocessor or by hand) — un-namespaced frameworks **will** clobber form styles.
- Access Fluent Design tokens via `context.fluentDesignLanguage?.tokenTheme`.
- For animations (keyframes can't be inline): inject one `<style>` element with `dangerouslySetInnerHTML` and **prefix keyframe names** with control identifier (e.g., `mycontrol-shimmer`) to avoid collisions with other PCFs on the same form.
- Respect `prefers-reduced-motion` for shimmer/progress animations:
  ```css
  @media (prefers-reduced-motion: reduce) { .mycontrol-shimmer { animation: none; } }
  ```

## ACCESSIBILITY (a11y) — REQUIRED

PCF controls embed in forms — they must meet WCAG 2.1 AA. Field Service Mobile users include technicians using screen readers and large-text settings.

### Mandatory checks (from official guidance)
- **Keyboard alternatives** for every mouse/touch interaction. Tab to focus, Arrow/Enter/Space to operate.
- **`alt` text + ARIA attributes** so screen readers announce control state accurately. Fluent UI components are pre-wired for a11y — prefer them over hand-rolled UI.
- **Browser DevTools accessibility audit** must pass before deployment.

### Interactive non-button elements (clickable cards, expand/collapse rows)
When making a `<div>` behave as a button, you must include **all** of:
```tsx
<div
    role="button"
    tabIndex={0}
    aria-expanded={!collapsed}     // for toggles
    aria-pressed={selected}         // for toggle-state buttons
    onClick={toggle}
    onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;  // don't hijack inner inputs
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
        }
    }}
>
```

### Focus, color, and motion
- **Visible focus**: never set `outline: none` without a replacement (e.g. `box-shadow: 0 0 0 2px brand`)
- **Color contrast**: text on `cardBg` must hit 4.5:1; muted text 3:1 minimum
- **Don't use color alone** to convey state — pair with icon, label, or shape
- **Reduced motion**: respect `@media (prefers-reduced-motion: reduce)` for shimmer/progress animations

### Touch targets
- Mobile tap targets: **minimum 44×44 CSS px** (Apple HIG / Material). A 14×14 chevron alone fails. Either enlarge the chevron's hit-padding OR make a larger surrounding zone clickable.

### Screen reader hints
- `aria-label` for icon-only buttons (phone, email, web action chips)
- `aria-hidden="true"` on purely decorative icons and shimmer placeholders
- `role="progressbar"` on indeterminate loading bars
- Live regions (`aria-live="polite"`) for async-loaded content sections (use sparingly)

### Canvas a11y caveat
**`tabindex` is NOT honored in canvas apps.** If you're targeting canvas, focus order is dictated by the canvas runtime, not your DOM. Plan focus management around the canvas constraints.

## TESTING
- Jest with jsdom environment
- `createMockContext()` helper for typed mock context
- Mock `window.Xrm` in `beforeEach`, clean in `afterEach`
- `flushPromises()` for async WebAPI calls
- Exclude `generated/` from coverage
- Test: lifecycle, **null property values in updateView**, lookups, **offline scenarios**, duration formatting, **loading states**, **keyboard navigation**, **null/empty arrays**, **multi-host divergence (mock context.client.getClient() returning Mobile vs Web)**

## PERFORMANCE

### Network
- **Always async network calls.** Synchronous XHR is forbidden — it freezes the host.
- Use `context.webAPI` (model-driven, Pages) — never `fetch()` directly. `webAPI` integrates with offline mode in MDA mobile.
- **Limit WebAPI volume**: each call counts against the user's API entitlement and service-protection limits. Batch reads, use `$select` to project only required columns, use `$expand` to combine 1-hop fetches.
- **Avoid unnecessary `dataset.refresh()`** — it forces the host to reload the dataset and is expensive.
- **Minimize `notifyOutputChanged()`** — don't fire on every keystroke. Use blur/touch-end.

### React
- Memoize callbacks with `useCallback`; memoize derived values with `useMemo` — prevent re-render loops.
- Use `React.memo` (function components) or `PureComponent` (class components) where input props are immutable.
- **Avoid arrow functions and `.bind()` inside `render`** — they create new closures each render and force child re-renders. Bind in the constructor or use class field arrow functions.
- For large components: deconstruct into smaller subcomponents.
- For `useEffect` deps that include arrays/objects: stringify with `.join(",")` or memoize, otherwise effects re-run every render.
- Only call `ReactDOM.render` when `context.updatedProperties` indicates a UI-affecting change — not blindly on every `updateView`.

### Bundle
- Path-based Fluent imports (see Bundling section).
- Production build mode for deploys.
- Multiple PCF controls on the same screen each ship their own bundle today (shared libraries planned but not delivered) — minimize the number of components per screen.

## ASYNC LOADING UX (READ THIS)

Async fetches (`context.webAPI.retrieveRecord`, `retrieveMultipleRecords`) on slow networks or Field Service Mobile can take **2–5 seconds**. Without feedback users assume the control is broken. Per the official guidance, "If `updateView` is called before requests return, your code component must handle this state and provide a visual loading indicator."

### Two complementary affordances

**A. Shimmer placeholders** — per-field "this is still loading" cue. Replace empty values with an animated grey bar so the user sees *which* slots are pending.
```tsx
const Shimmer = ({ theme, width = "70%" }) => (
    <span aria-hidden="true" style={{
        display: "inline-block", width, height: "0.9em", borderRadius: 4,
        background: `linear-gradient(90deg, ${theme.borderLight} 0%, ${theme.border} 50%, ${theme.borderLight} 100%)`,
        backgroundSize: "200px 100%", backgroundRepeat: "no-repeat",
        animation: "mycontrol-shimmer 1.4s linear infinite",
    }} />
);
```

**B. Top progress bar** — single global "still working" cue (2px indeterminate brand-colored bar across card top edge). Lower visual weight; covers the case where shimmer rows are scrolled offscreen.

### Tracking fetch lifecycle robustly
Use `.finally()` so the "done" flag advances on **both** success and error:
```tsx
const [fetchDone, setFetchDone] = React.useState(false);
React.useEffect(() => {
    if (!shouldFetch) { setFetchDone(true); return; }
    setFetchDone(false);
    context.webAPI.retrieveRecord(...)
        .then((data) => { ... })
        .catch((err) => console.error(err))
        .finally(() => setFetchDone(true));
}, [deps]);
```

### Distinguish empty vs pending
- `isEmpty: true` = the field has no value (final state)
- `isPending: true` = the field is awaiting async fetch (transient state)
- `filterEmpty()` should keep `isPending` fields visible so shimmer renders. After the fetch settles, fields that are still empty get filtered out as before.

## LARGE-TARGET / WHOLE-CARD INTERACTION

For mobile-first controls, a 14×14 chevron is too small. Make a larger zone (header bar or whole card) clickable.

### Browser already handles scroll-vs-tap
Native `onClick` only fires when touchstart→touchend has no significant pointer movement. **Scrolling does not trigger click.** Don't add custom touch handling.

### The real risks (and how to avoid them)
1. **Accidental taps on action zones** — wrap each action anchor (`tel:`, `mailto:`, web link, map link, lookup-nav handler) with `onClick={(e) => e.stopPropagation()}` so it doesn't bubble and trigger the parent toggle.
2. **Decorative chevron consuming clicks** — add `pointerEvents: "none"` to the chevron div so clicks bubble through to the parent toggle.
3. **State location** — if the click handler must live on the outermost wrapper (e.g., the `cardStyle` div with padding), **lift the collapse state to the parent component** that owns that wrapper. Pass `collapsed` and `onToggle` down via props.

### Pattern
```tsx
const [collapsed, setCollapsed] = React.useState(!startExpanded);
const toggle = React.useCallback(() => setCollapsed(c => !c), []);
const isInteractive = layout === "smart" && hasCollapsibleBody;

return (
    <div
        style={{ ...cardStyle, ...(isInteractive ? { cursor: "pointer", outline: "none" } : {}) }}
        {...(isInteractive ? {
            onClick: toggle,
            onKeyDown: (e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
            },
            role: "button",
            tabIndex: 0,
            "aria-expanded": !collapsed,
        } : {})}
    >
        ...
    </div>
);
```

## MOBILE-SPECIFIC CONSTRAINTS

Field Service Mobile and Power Apps Mobile inherit all PCF limitations **plus**:

- **Aggressive bundle caching** — old version persists 24+ hours after deploy. **Always bump manifest version.** Force-quit the app to flush.
- **No `localStorage` / `sessionStorage`** — unreliable persistence (see limitations doc).
- **Device APIs are conditional** — camera (`context.device.captureImage`), geolocation (`context.device.getCurrentPosition`), file pick (`context.device.pickFile`) are MDA-only and require user permission. Always feature-detect.
- **Touch-first** — 44×44 px tap targets, no hover-only affordances, large fonts (Field Service techs often use enlarged text).
- **Limited screen real-estate** — design for 360 px portrait first; use `getFormFactor()` to choose dense vs spacious layouts.
- **Network is unreliable** — provide loading affordances (shimmer + progress bar), respect `navigator.onLine` where useful, and never block UI on a single fetch.
- **`console.log` doesn't reach mobile devtools** — render diagnostics into the control behind a debug flag for mobile troubleshooting.
- **`tabindex` ignored in canvas mobile** — see canvas a11y caveat.

## OFFLINE-MODE CONSTRAINTS (model-driven mobile)

Reference: https://learn.microsoft.com/en-us/power-apps/mobile/offline-limitations and the Offline best practices / profile guidelines pages. Plan for these from the start — they cannot be patched in later.

### What the platform actually does offline
- **Sync cap: 3,000,000 records total** (including hidden tables used by offline). Designs that fetch large rowsets will fail.
- **Profile relationships per table: max 15**, with at most one M:M or one 1:M among them. **No circular or self-references.** If you need more, the data model needs revisiting.
- **Image columns**: max 14 across all entities in a profile.
- **Field-level security and field sharing are NOT enforced offline.** Don't rely on FLS for security; assume any field synced is readable.
- **Calculated and rollup fields are NOT re-evaluated on the client.** Server re-evaluates on next sync. Don't read calc/rollup values and act as if they're fresh after local edits.
- **Mapped fields are NOT pre-populated** when creating a record from a parent offline.
- **Lookup display names may be stale** in forms/grids if the underlying record's name changed.
- **Quick-find / offline search is exact-match only** — no fuzzy results, no Dataverse search. Global search becomes categorized search.
- **Personal views are NOT supported offline** — only system and quick views.
- **Advanced lookup is unavailable offline** (replaced by Change View dropdown).
- **Add Existing on N:N subgrids is hidden offline.**
- **Filter operations are restricted offline** — see "Supported Filter Operations Per Attribute Type in Mobile Offline using FetchXML" for the allowed operators per type.

### Offline-supported tables (subset, with permissions)
Account, Contact, Lead, Opportunity, Case, Task, Phone Call, Appointment, Custom tables (full CRUD); Bookable Resource Booking, Work Order, Work Order Product/Service/Service Task (CRUD except no Delete); Activity Pointer (Read/Delete); Attachment, Email, Connection, Connection Role, Team, User, Product (Read-only). Many activity-style tables (Email/Task/Fax/Letter/ServiceAppointment/CampaignResponse/CampaignActivity/RecurringAppointmentMaster/SocialActivity) **do not support views offline.** Views with linked tables that aren't offline-enabled also won't work.

### Web resources offline
- Form scripts, ribbon commands (file-name lower-case): supported on Android/Windows AND iOS.
- HTML/JS/CSS/XML web resources embedded on a form: supported on Android/Windows; **NOT supported on iOS** (only available if cached online previously).
- Webpages via sitemap, dynamic FetchXML in custom JS: **not supported** offline on any platform.
- **Microsoft's official recommendation**: replace HTML web resources with a **PCF control** for any UI component, and use form-handler events for non-UI logic. This is the canonical reason PCF exists for mobile.

### What this means for control design
- **Don't assume `webAPI` is online.** It returns from the local store when offline (MDA mobile). Records may be stale; calc/rollup values are stale until next sync.
- **Don't query unsupported tables or filter operators** — calls will fail silently or with confusing errors offline.
- **Show stale-data affordances** when you can detect offline (e.g., `navigator.onLine === false`) — give the user a hint ("offline — showing last sync") rather than just a load spinner.
- **Never expect FLS to hide a field** — if it's in the offline profile, your control will receive it.
- **Don't write large blobs** to records the user will edit offline (sync queue size and conflict risk).
- **Test offline explicitly**: turn airplane mode on, open the form, verify the control still renders sensible values from cached data.
- **Appointments**: created/updated offline don't fire server-side sync to email recipients — don't promise the user "invitation sent" in offline UI.
- **Work Order Service Tasks** created via custom code require `msdyn_lineorder = -1` (server fixes after sync). If you're creating WOSTs, follow this convention.

## COMMON MISTAKES
1. Bound property not named `value` — silently fails
2. `ReactDOM.render()` on every `updateView()` — destroys state
3. Using `localStorage`/`sessionStorage` — unreliable on mobile, against guidance
4. Using `fetch()` instead of `context.webAPI` — fails offline, no MDA integration
5. Synchronous XHR — freezes the host app
6. Using `webAPI` in canvas apps — not available; use connectors
7. Direct `formContext` access — not portable across hosts; use bound column + OnChange
8. Loading external scripts via `<script src=...>` — not supported; bundle everything
9. Importing entire Fluent UI (`from "@fluentui/react"`) — bloats bundle; use path imports
10. Unscoped CSS classes — breaks Dynamics forms
11. Not regenerating ManifestTypes after manifest edits
12. Not bumping version before push — old version cached 24+ hours
13. Missing `destroy()` — memory leaks on mobile
14. Unstable callbacks to React — infinite re-renders
15. Arrow functions / `.bind()` inside `render` — child re-renders every parent render
16. Not handling null/empty field values in `updateView` — crashes on first paint
17. `outline: none` without replacement focus indicator — fails WCAG
18. No loading affordance on slow networks — users assume control is broken
19. Touch targets smaller than 44×44 px — hard to tap on mobile
20. Forgetting `stopPropagation()` on action chips when whole card is clickable
21. Not using `.finally()` to clear loading state — stuck spinners on fetch errors
22. Including test files in the build (missing `exclude` in tsconfig) — cryptic webpack errors
23. CSS keyframes named generically (`@keyframes shimmer`) — collide with other PCFs on the same form
24. Overly aggressive guard clauses on `param.attributes` that reject valid static-input properties (see "Design-time" below)
25. Deploying development builds — large, slow, may be blocked by size limits
26. Calling `dataset.refresh()` unnecessarily — host reload is expensive
27. Calling `notifyOutputChanged` on every keystroke — floods host events
28. Using undocumented internal `context` methods — break in future versions
29. Accessing DOM outside the component container — host can change without notice
30. Removing manifest properties between versions — properties are append-only
31. Trusting `external-service-usage="false"` as proof a bundle is offline-safe — honor-system flag; grep the bundle for CDN URLs
32. Bundling Fluent UI v8 in a standard control without calling `initializeIcons()` in `init` — closure-private registry, icons render as empty boxes
33. Assuming `root.unmount()` cleans up React 18's delegated container listeners — they're container-lifetime by design; if you re-use the container, expect stale handlers
34. Fetching schema from `/api/data/v9.2/EntityDefinitions` via `fetch()` instead of `context.utils.getEntityMetadata` — direct fetch goes to the network even in offline mode; the supported APIs fall back to the local store

## WORKING WITH RELATED RECORDS (model-driven)

When a control needs data from a record other than its bound entity (e.g., walking lookup chains):
- Use `context.webAPI.retrieveRecord(entitySetName, id, "?$select=col1,col2&$expand=lookup($select=field)")` — never `fetch()` directly.
- **`$expand` may return the parent object without nested fields** in some Dataverse scenarios. Always implement a **hop-2 fallback**: pull the lookup id from the first response and do a direct `retrieveRecord` for missing fields.
- Check `@OData.Community.Display.V1.FormattedValue` for formatted values (option-set labels, currency, dates).
- Check `@Microsoft.Dynamics.CRM.lookuplogicalname` to get the target entity type of a lookup.
- Group fetches by entity, project only needed columns with `$select`, and handle 404/permission errors gracefully.
- Cache results across `updateView` calls — don't re-fetch on every render.

## DESIGN-TIME / MAKER EXPERIENCE

PCF controls render in the Power Apps form designer (maker experience) using the same lifecycle as runtime. The platform exposes an **undocumented but reliable** `context.mode.isAuthoringMode` flag — use it (with an origin-check fallback) to render a sample/preview view in the designer.

### Authoring-mode detection (PRIMARY)
```typescript
// Cast required — isAuthoringMode is not in the official typings (as of 2025).
// Hat-tip: itmustbecode.com (2025-06) and butenko.pro (2023-01).
const modeAny = context.mode as unknown as Record<string, unknown>;
const isAuthoringMode =
    modeAny.isAuthoringMode === true ||
    // Fallback for older hosts where the flag is missing — origin check.
    (typeof location !== "undefined" && (
        location.ancestorOrigins?.[0] === "https://make.powerapps.com" ||
        location.ancestorOrigins?.[0] === "https://make.preview.powerapps.com"
    ));
```
- `context.mode.isAuthoringMode === true` ONLY in the form designer; `false`/missing at runtime in model-driven apps and canvas.
- Don't rely on it being in the TypeScript typings — cast `context.mode` to `any`/`Record<string, unknown>`.
- Keep the origin-check fallback (`location.ancestorOrigins[0]`) for resilience: if Microsoft renames or moves the flag, the URL check still works (and vice versa).
- Treat absence of the flag as "not authoring" — never default to authoring behaviour.

### What's available at design-time
- **`param.raw`**: `null` for bound properties (no record loaded). Static input values (text, @syntax) are present.
- **`param.type`**: Valid (e.g. `"Lookup.Simple"`, `"SingleLine.Text"`) when the property is configured. `"Unknown"` when unconfigured.
- **`param.attributes`**: Contains `DisplayName`, `LogicalName`, `Type` for **bound** properties only. **Empty `{}` for input properties (static="true") with valid configuration** — do not treat empty `attributes` as "unconfigured".
- **Enum / TwoOptions inputs**: `.raw` has the configured value at design-time.
- **`context.updatedProperties`**: Fires when the maker changes property configuration in the designer.

### What to do when `isAuthoringMode === true`
- **Inject synthetic sample data per `param.type`** so the maker sees a populated, representative card instead of a strip of "---" placeholders. Suggested per-type samples:
  - `SingleLine.Text` → `"Sample text"`; `SingleLine.TextArea` / `Multiple` → short lorem
  - `SingleLine.Email` → `"sample@contoso.com"`; `Phone` → `"+1 (555) 123-4567"`; `URL` → `"https://contoso.com"`
  - `Whole.None` → `42`; `Currency` → `"$1,234.56"`; `Decimal`/`FP` → `1.23`
  - `DateAndTime.DateOnly` → today; `DateAndTime.DateAndTime` → today + a fixed time (avoid Date.now() nondeterminism in snapshot tests)
  - `OptionSet` / `TwoOptions` → `"Active"`; `MultiSelectOptionSet` → `"Option A, Option B"`
  - `Lookup.Simple` → `"Sample Record"` (do NOT set `lookupId`/`lookupEntityType` — that would trigger fetches)
- **Skip ALL WebAPI / network calls** — `context.webAPI` works at design-time but the maker isn't bound to a real record, so calls 404 or fetch unrelated data and slow down the designer.
- **Skip OData / `retrieveMultipleRecords` from `useEffect`** — guard with `if (isAuthoringMode) return;` early returns.
- **Suppress runtime-only errors / toasts** — design-time should never show user-facing error banners.

### Slot-reader guard clause pitfall (real bug from production)
```typescript
// ❌ WRONG — rejects valid static input properties
if (param.attributes && !hasDisplayName) return null;

// ✅ CORRECT — only reject when ALSO no type
if (param.attributes && !hasDisplayName && !param.type) return null;
```
Static input properties (`static="true"` in form XML, used for `@`-prefix syntax) have `attributes={}` (truthy) but no `DisplayName`/`LogicalName`. The first form silently kills every `@msdyn_*` field on the form.

### Design-time detection pattern (per-slot, after the global authoring-mode check)
When you can't or don't want to rely on `isAuthoringMode` (e.g. inside `readSlot` where you only have one `param`), this heuristic still works as a secondary signal:
```typescript
const param = context.parameters.myField;
const paramType = (param as Record<string, any>)?.type;
const isUnboundConfiguredSlot = param != null && paramType !== "Unknown"
    && (param.raw === null || param.raw === undefined);
```
Use this for "configured but no value yet" decisions (e.g. show a placeholder shimmer). Use `context.mode.isAuthoringMode` for "the whole control is in the form designer" decisions (e.g. inject sample data, suppress fetches).

### Best practices
- **Don't bail on null values** — render the layout shape with sample/placeholder content for configured fields
- Use `param.attributes?.DisplayName` as the label when available (bound properties)
- Fall back to the property display-name-key from the manifest
- Show the correct layout/mode based on Enum/TwoOptions config values (these are available at design-time)
- `of-type-group` shows a Type picker in the maker; `of-type` does not — choose based on whether the maker needs multi-type binding
- For complex controls, render a **design-time binding diagnostic panel** so makers can see which slots are bound vs unconfigured
- Make sample-data injection **deterministic** (fixed strings/dates, not `Date.now()`/`Math.random()`) so the designer preview is stable across re-renders and snapshot tests stay reproducible

## THEMING / MODERN FLUENT THEMING

Reference: https://learn.microsoft.com/en-us/power-apps/developer/component-framework/fluent-modern-theming

Modern theming is in effect when canvas apps enable **Modern controls and themes** or model-driven apps run with the **new refreshed look**. Use it — it's the recommended path for performance and visual consistency.

### Detecting if modern theming is enabled
```ts
const enabled = !!context.fluentDesignLanguage?.tokenTheme;
// or in MDA:
const enabledMda = context.appSettings?.getIsFluentThemingEnabled?.();
```

### Four ways to apply theming (pick one based on your stack)

**1. Fluent UI v9 + platform libraries (recommended for new controls)**
The platform's `FluentProvider` wraps your component automatically — no extra code needed. Just declare React + Fluent 9 platform libraries in the manifest:
```xml
<platform-library name="React" version="16.14.0" />
<platform-library name="Fluent" version="9.46.2" />
```
Fluent v9 controls inside your component receive theme tokens automatically.

**2. Fluent UI v8 controls — bridge with `createV8Theme`**
```ts
import { createV8Theme } from "@fluentui/react-migration-v8-v9";
import { ThemeProvider } from "@fluentui/react";

const theme = createV8Theme(
    context.fluentDesignLanguage.brand,
    context.fluentDesignLanguage.theme
);
return <ThemeProvider theme={theme}>{/* your control */}</ThemeProvider>;
```

**3. Non-Fluent controls — read tokens directly**
```tsx
<span style={{ fontSize: context.fluentDesignLanguage.theme.fontSizeBase300,
               color: context.fluentDesignLanguage.theme.colorNeutralForeground1 }}>
    Themed via platform tokens
</span>
```

**4. Custom theme provider (component overrides app theme)**
```tsx
<FluentProvider theme={customTokenTheme}>{/* your control */}</FluentProvider>
```

### Opting OUT of modern theming
If your component declares Fluent v9 + platform libraries but you don't want the app's theme applied:
- Wrap with your own `<FluentProvider theme={customTheme}>`, OR
- Wrap with `<IdPrefixProvider value="my-prefix">` to break the platform's token plumbing.

### Gotchas
- **Fluent v9 controls that use React Portal** (Tooltip, Menu, Dialog, Popover) escape the FluentProvider tree. **Re-wrap them** in your own `FluentProvider` or styles won't apply.
- Hardcoded colors (`#0078D4`, `white`, `red`) break dark mode and break theming. Always read from `context.fluentDesignLanguage.theme` tokens or expose theme inputs.
- `context.fluentDesignLanguage` is available in canvas + MDA. In Power Pages it may be undefined — fall back to a sensible default theme.
- A control should **never** call `ReactDOM.render` for the theme provider on every `updateView` — keep the provider stable and let token updates flow as props.

## CUSTOM EVENTS (component → host)

Reference: https://learn.microsoft.com/en-us/power-apps/developer/component-framework/events

**Standard pattern**: data flows in via bound properties → control updates a bound column → `notifyOutputChanged()` → host fires `OnChange`. This is enough for most scenarios.

**When you need more**: if your control needs to signal something that isn't a column update (selection, navigation request, custom action, structured payload), declare a custom **event** in the manifest.

### Manifest declaration
```xml
<event
    name="recordOpened"
    display-name-key="recordOpened_DisplayKey"
    description-key="recordOpened_DescKey"
/>
```

### Subscribing
- **Canvas apps**: makers attach a Power Fx formula in the properties pane.
- **Model-driven apps**: form scripts call `formContext.getControl("name").addEventHandler("eventName", handler)`. The handler receives a payload — the component can pass a callback function in the payload to enable two-way conversations:
  ```js
  this.onCustomEvent = function (params) {
      // params.message, params.callBackFunction(), etc.
      params.callBackFunction();
  };
  ```

Events occur per-instance — each placement of the control on a screen has its own event channel.

### When to use events vs the bound-column workaround
- **Bound-column + `OnChange` workaround**: simple, broadly supported, works without custom events. Use when the signal is a value change.
- **Custom events**: cleaner API for non-column signals (e.g., "user clicked Open Map", "selection changed", multi-payload). Prefer events for new components when target hosts support them.

## DEPENDENT LIBRARIES (model-driven only)

Reference: https://learn.microsoft.com/en-us/power-apps/developer/component-framework/dependent-libraries

When multiple components share a large library (charting lib, data grid kernel, internal utilities), bundling it into each component wastes load time and storage. Use a **library component** to host the library once and let other components depend on it.

### When to use
- Two or more PCF controls share a non-trivial library (>50 KB).
- You control all the dependent components.
- Target is **model-driven apps only** — not available in canvas or Pages.

### Setup (3 files)

**1. `featureconfig.json`** in the dependent component's project root:
```json
{ "pcfResourceDependency": "on", "pcfAllowCustomWebpack": "on" }
```

**2. `webpack.config.js`** in project root, marking the library as external:
```js
"use strict";
module.exports = { externals: { "myLib": "myLib" } };
```

**3. Manifest** — register the dependency:
```xml
<resources>
    <dependency type="control"
        name="publisher_Namespace.LibraryControlName" order="1" />
    <code path="index.ts" order="2" />
</resources>
```

### On-demand loading (large libraries)
For libraries you only need conditionally, defer the load:
```xml
<control ...>
    <platform-action action-type="afterPageLoad" />
    <feature-usage>
        <uses-feature name="Utility" required="true" />
    </feature-usage>
    <resources>
        <dependency type="control"
            name="publisher_Namespace.LibraryControlName"
            load-type="onDemand" />
    </resources>
</control>
```

### Caveats
- Library component must be **deployed and registered before** any dependent component is imported. Solution layering matters.
- Custom webpack means you own the build config — don''t break tree-shaking or production-mode flags.
- Not a substitute for platform libraries (React/Fluent). Use platform libraries for those; use dependent libraries for **your own** shared code.

## TEST HARNESS (npm start)

Reference: https://learn.microsoft.com/en-us/power-apps/developer/component-framework/debugging-custom-controls

`npm start watch` builds the control and opens the local test harness. Live-reloads on changes to `index.ts`, imported modules (excluding node_modules), and resources listed in the manifest.

### Test harness limits — DON''T be fooled by these
The harness runs in a stripped-down sandbox. Before assuming "it works in the harness, ship it":
1. **`updatedProperties` is NOT populated** when properties change in the Data Inputs panel.
2. **`context.webAPI.*` throws** in the harness — must test against a real environment.
3. **Dataset paging/sorting/filtering APIs throw** in the harness.
4. **Lookups and complex datatype metadata are minimal** — choices give you 3 simple options without metadata.
5. **MDA-specifics absent**: field-level security, read-only behavior, dataset selection API, command bar integration.
6. **`Navigation` and `Utility` methods** are not implemented in the harness.
7. **`allocatedWidth/Height` come back as text** in the harness, not numbers.
8. **Manifest changes need a harness restart** (`Ctrl+C`, then `npm start watch` again) — only then do new properties appear in Data Inputs.

For anything in this list, deploy to a dev environment and debug there with browser DevTools (or Fiddler/Requestly to swap a deployed bundle with a local one).

### Sourcemaps + DevTools
- Webpack transforms TS into a single `bundle.js` in `out/`. Use the browser DevTools **Sources** tab to set breakpoints in your original TS via sourcemaps.
- `F12` is hijacked by Power Apps Studio (Download App). Use `Ctrl+Shift+I` instead.
- Production builds may strip sourcemaps — debug with development builds locally, deploy production builds.

### Fiddler / Requestly for live debugging
Once deployed, use Fiddler AutoResponder or a Requestly redirect rule to map the deployed `bundle.js` URL to your local `out/bundle.js`. Refresh the form to load your local code without re-importing the solution. Standard PCF debugging workflow — saves a huge amount of cycle time.

## SOLUTION PACKAGING & DEPLOYMENT

Reference: https://learn.microsoft.com/en-us/power-apps/developer/component-framework/import-custom-controls

### One-time solution scaffold
```bash
mkdir Solutions && cd Solutions
pac solution init --publisher-name developer --publisher-prefix dev
pac solution add-reference --path ..\MyComponent
```

### Build the solution
```bash
msbuild /t:restore     # first time only — restores NuGet deps
msbuild                # debug build → unmanaged solution zip
msbuild /p:configuration=Release   # release build → managed solution zip
# OR with .NET SDK >= 6:
dotnet build --configuration Release
```
Output: `bin\debug\` (or `bin\Release\`) → solution zip.

### Override `SolutionPackageType` per environment
Edit the `cdsproj` file to lock the package type (Managed vs Unmanaged) regardless of build configuration:
```xml
<PropertyGroup>
    <SolutionPackageType>Managed</SolutionPackageType>
</PropertyGroup>
```

### Lock production-mode webpack at the project level
Edit `.pcfproj`:
```xml
<PropertyGroup>
    <PcfBuildMode>production</PcfBuildMode>
</PropertyGroup>
```
This guarantees `pac pcf push` and `msbuild` always produce production bundles, avoiding the `eval()` warnings from Solution Checker and the "Web resource content size is too big" import error.

### Auth profiles
```bash
pac auth create --url https://yourorg.crm.dynamics.com   # create profile
pac auth list                                             # list profiles
pac auth select --index <n>                               # switch profile
pac org who                                               # confirm connection
```

### `pac pcf push` vs solution import
- **`pac pcf push --publisher-prefix <prefix>`** — fast inner-loop deploy to a dev environment. Bypasses version-bump and solution-build requirements. Publisher prefix MUST match the target solution''s publisher prefix.
- **`pac solution import`** — production deploy. Always import managed solutions to UAT/Prod; unmanaged for dev.
- **Power Platform Build Tools** (Azure DevOps marketplace extension) for CI/CD pipelines.

### Removing a component from a solution
1. Edit the `cdsproj` `<ItemGroup>` and remove the `<Projectreference>` entry.
2. `msbuild /t:rebuild`.

## COMMON ISSUES & WORKAROUNDS

Reference: https://learn.microsoft.com/en-us/power-apps/developer/component-framework/issues-and-workarounds

| Symptom | Cause | Fix |
|---|---|---|
| Component changes not reflected after solution import | Manifest version not bumped | Bump `version` in `ControlManifest.Input.xml` (e.g., `1.0.0` → `1.0.1`). Server only re-evaluates on version change. |
| `Import Solution Failed: Web resource content size is too big` | Debug bundle deployed | Build with `msbuild /p:configuration=Release` or `npm run build -- --buildMode production`. Set `<PcfBuildMode>production</PcfBuildMode>` in `.pcfproj`. As a last resort, raise `Organization.MaxUploadFileSize`. |
| Solution Checker: "Do not use the eval function" | Default debug webpack emits `eval()` | Re-build with Release configuration and re-import. |
| `Msbuild error MSB4036` | NuGet targets & Build Tasks missing | Visual Studio Installer → Modify → Individual Components → check "NuGet targets & Build Tasks". |
| NuGet auth failure on Microsoft.PowerApps.MSBuild.Pcf | Stale feed credential in `%APPDATA%\NuGet\NuGet.Config` | Remove the offending feed or add a PAT under `<packageSourceCredentials>`. |
| Control can''t finish loading (dataset) | Calling `dataset.refresh()` inside `updateView` without a guard | `refresh()` resets paging to page 1, triggers another `updateView`, infinite loop. Guard with a flag — only refresh on user action or explicit input change. |
| Same dataset page loaded instead of next | `loadNextPage`/`loadExactPage`/`refresh` don''t support parallel calls | Don''t expect synchronous results — wait for the next `updateView` to deliver fetched data. |
| Custom auth fails in canvas | Not supported | Use a connector. |
| `eval` warning even after release build | NPM cache or stale `out/` | `npm run clean` (or delete `out/`), rebuild. |

## AGENT APIs (PREVIEW — Microsoft Copilot Studio integration)

Reference: https://learn.microsoft.com/en-us/power-apps/developer/component-framework/bring-intelligence-using-agent-apis

⚠️ **Preview feature** — not for production. Subject to change.

`Context.Copilot` lets a PCF control invoke topics in a single Microsoft Copilot Studio agent (the app assistant agent selected in the model-driven app designer, or implicitly the "Copilot in Dynamics 365 Sales" agent for apps containing Lead/Opportunity).

| API | Purpose |
|---|---|
| `context.copilot.executeEvent(eventName, payload?)` | Execute a Copilot Studio topic by registered Event Name. Returns `Promise<MCSResponse[]>`. |
| `context.copilot.executePrompt(prompt)` | Execute a topic by trigger query (natural-language prompt). Returns `Promise<MCSResponse[]>`. |

### When to consider
- Surfacing AI-generated summaries / recommendations inside a custom control.
- Triggering business-process topics from a UI gesture without writing client-side workflow.
- Routing free-text user input to Copilot Studio topics.

### Caveats
- Preview only — gate behind a feature flag, expect API surface to evolve.
- Requires an app-assistant agent configured in the model-driven app.
- Apply the same a11y rules from `code-components-best-practices#check-accessibility` to any AI-rendered output (announce updates via `aria-live`, give users a way to opt out / regenerate).
- Mirror API: `Xrm.Copilot` for client scripts. PCF version is `context.copilot`.

## PROJECT SCAFFOLDING (`pac pcf init`)

Reference: https://learn.microsoft.com/en-us/power-apps/developer/component-framework/create-custom-controls-using-pcf

```bash
pac pcf init \
    --namespace SampleNS \
    --name MyControl \
    --template field         # field | dataset
    --framework react        # OMIT for standard controls; "react" for virtual + platform libs
    --run-npm-install
```

Subsequent build:
```bash
npm run build                                # development bundle
npm run build -- --buildMode production      # production bundle (deploy this)
```

### After scaffolding — first-day checklist
1. Add `resolveJsonModule: true` and `exclude: ["**/*.test.*", "node_modules"]` to `tsconfig.json`.
2. Set `<PcfBuildMode>production</PcfBuildMode>` in `.pcfproj` so production is the default.
3. Configure ESLint (`npx eslint --init`) and add `"ignorePatterns": ["**/generated/*.ts"]`.
4. If using Fluent v9 + platform libs, set `module: "es2015"` and `moduleResolution: "node"` for tree-shaking.
5. Bump `version` in the manifest before every `pac pcf push`.

## DEBUGGING TIPS

- **Mobile aggressively caches PCF bundles** — old version persists 24+ hours. Always bump version before pushing. Force-quit the app to flush.
- **`console.log` doesn''t reach mobile devtools.** For mobile diagnostics, render diagnostics into the control behind a debug flag.
- **Slot/property not rendering**: log the **full param object** (`Object.keys(param)`, `param.type`, `param.raw`, `param.attributes`) — runtime hides metadata behind getters.
- **Sourcemaps in dev builds** — set TS breakpoints via DevTools Sources tab.
- **Fiddler / Requestly** — swap deployed `bundle.js` with your local `out/bundle.js` for fast iteration without re-importing the solution.
- **`pac org who`** — confirm which environment your auth profile points at before pushing.

## ALM (Application Lifecycle Management)

- **Production builds for deploy**, dev builds only for `pac pcf push` to a dev environment.
- Lock `<PcfBuildMode>production</PcfBuildMode>` in `.pcfproj`; lock `<SolutionPackageType>Managed</SolutionPackageType>` for prod-bound `cdsproj`.
- Use Azure DevOps / GitHub Actions to automate: lint → test → build (release) → solution pack → import.
- Ship managed solutions to production; unmanaged for dev/UAT.
- Reference: code-components-alm doc.

## SLOT-BASED ARCHITECTURE PATTERN

For controls with many configurable fields (info cards, dashboards, summaries), prefer **named slots** (`titleField`, `subtitleField1-3`, `gridField1-N`) over fixed properties. Makers fill the slots in the form designer.

**Conventions:**
- 1-indexed in manifest (`gridField1`, `gridField2`) — readable for makers.
- 0-indexed in arrays internally.
- Pad arrays when merging fetched data so slot N maps to index N-1.
- Document the slot system in a project-level `CLAUDE.md` or `copilot-instructions.md` inside the control folder — saves enormous time across coding sessions for non-obvious data flow.

## WHEN REVIEWING CODE
Check:
- Lifecycle correctness (init/updateView/destroy, idempotency, null handling)
- API host compatibility (no `webAPI` in canvas-targeted controls)
- Offline compliance (no `fetch`, no localStorage, async only, no FLS reliance)
- Memory cleanup (destroy unmounts React, removes listeners)
- CSS scoping (namespace prefix, no global selectors, prefixed keyframes)
- Bundle size (path imports, production build, no `<script src>`, platform libs declared)
- Test coverage (lifecycle, offline, loading, keyboard, null values, getFormFactor variants)
- Manifest correctness (bound = `value`, properties append-only, version bumped, control-type=virtual for React, Fluent 8 OR 9 not both)
- Stable React references (memoized callbacks, no arrow fns in render)
- **a11y attributes** (role, tabIndex, aria-expanded, focus indicators, 44×44 targets, prefers-reduced-motion)
- **Loading state coverage** (.finally, isPending, shimmer + progress bar)
- **stopPropagation on nested actions** (whole-card click pattern)
- **tsconfig**: excludes tests + resolveJsonModule + es2015 module for tree-shaking
- **No direct formContext / DOM-outside-container access**
- **No undocumented context methods**
- **No `dataset.refresh()` without guard** in updateView
- **`notifyOutputChanged` not on every keystroke**
- **Theming**: tokens read from `context.fluentDesignLanguage`, no hardcoded colors

## WHEN CREATING A NEW CONTROL
1. `pac pcf init` with `--framework react` for virtual controls + platform libs (recommended for new MDA/canvas work).
2. Define manifest (properties, types, features, events) — bound = `value`; bump version on each push.
3. Configure `tsconfig.json` (`resolveJsonModule`, exclude tests, `module: es2015` for tree-shaking).
4. Set `<PcfBuildMode>production</PcfBuildMode>` in `.pcfproj`.
5. Configure ESLint with TS + React rules; ignore `generated/`.
6. Implement lifecycle class with proper cleanup; use `init` for network kickoff; handle null in `updateView`.
7. Use path-based Fluent imports (or rely on platform libs for v9 auto-theming).
8. Plan loading affordances (shimmer + progress bar) for any async data.
9. Apply a11y attributes from the start (role, tabIndex, aria-*, focus, 44px targets, reduced-motion).
10. Plan multi-host: check API availability for each target (canvas/MDA/Pages); design canvas-safe variants if relevant.
11. Implement responsive sizing (`trackContainerResize`, `getFormFactor`).
12. Add data.json + test-scenarios.json for PCF Workbench (and remember the harness is limited — don''t over-trust it).
13. Write Jest tests (lifecycle, offline, loading, keyboard, null values, getFormFactor variants).
14. Test in PCF Workbench with device emulation, then deploy to a dev env and test on real Field Service Mobile / canvas mobile.
15. Document non-obvious data flow in a `CLAUDE.md` inside the control folder.
16. Build production bundle, package into a managed solution, import via solution import (not raw `pac pcf push`) to UAT/Prod.

## BUILD & DEPLOY
```bash
npm run refreshTypes                                     # Regenerate manifest types
npm run build                                            # Build (tsc + webpack, dev)
npm run build -- --buildMode production                  # Release build
npm run lint                                             # Lint check
npm test                                                 # Run tests
pac pcf push --publisher-prefix <prefix>                 # Push to Dataverse (dev only)
# Production: build solution then import:
msbuild /p:configuration=Release
pac solution import --path bin/Release/Solution.zip --environment <url> --publish-changes
```
