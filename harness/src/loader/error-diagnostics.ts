/**
 * Pattern-matched diagnostics for runtime errors thrown by PCF controls.
 *
 * The goal is to take a cryptic stack trace and turn it into something a
 * non-expert can act on: what API the control was probing, what's missing
 * in the harness shim, and what the fix usually is.
 *
 * Used by:
 *   - ControlViewport's error MessageBar (shown when isLoaded === false &&
 *     error !== null), so users without F12 still see actionable hints.
 *   - bin/pcf-harness.ts loop CLI's --explain flag, which writes the
 *     explanation into report.json next to the raw message.
 *
 * Add new rules below as new failure modes surface from third-party PCFs.
 * Each rule should be independently testable by message + stack alone.
 */

export interface ErrorExplanation {
  /** Short headline-style summary (one sentence, no jargon). */
  summary: string;
  /** Plain-English cause; what the control was actually trying to do. */
  likelyCause: string;
  /** Concrete next step the user can take to unblock themselves. */
  suggestedFix: string;
  /** Severity hint — fatal = control can't run; warning = degraded; info = noisy but harmless. */
  severity: 'fatal' | 'warning' | 'info';
  /** Stable identifier used by the loop CLI and tests. */
  ruleId: string;
}

interface DiagnosticRule {
  ruleId: string;
  /** Returns an explanation if the rule matches, otherwise null. */
  match: (message: string, stack: string | undefined) => ErrorExplanation | null;
}

const RULES: DiagnosticRule[] = [
  // ─── React 16 + Fluent v9.40+ runtime mismatch ────────────────────────────
  {
    ruleId: 'react16-fluent9-late',
    match: (msg, stack) => {
      const setOnUndefined = /Cannot read propert(?:y|ies) of undefined \(reading ['"]set['"]\)/i.test(msg);
      const fluentInStack = !!stack && /(fluentui|useSyncExternalStore|commitHookEffectListMount)/i.test(stack);
      if (!setOnUndefined || !fluentInStack) return null;
      return {
        ruleId: 'react16-fluent9-late',
        severity: 'fatal',
        summary: 'Control is using Fluent UI v9.40+ which requires React 17 — but the PCF runtime ships React 16.',
        likelyCause:
          'Fluent UI v9.40+ depends on React\'s useSyncExternalStore hook (added in React 18 ' +
          'with a backport for 17). The PCF platform-library entry pins React to 16.14.0, so the ' +
          'hook is undefined at runtime and Fluent crashes trying to subscribe to a store.',
        suggestedFix:
          'Either (a) downgrade @fluentui/react-components to <9.40 in the control project, or ' +
          '(b) wait for the harness React-17 loader (todo: react17-fluent9-late), or ' +
          '(c) test against a control built with React 18 once Microsoft ships that platform-library.',
      };
    },
  },

  // ─── Generic React commit-phase crash inside a Fluent component ───────────
  // Same root cause as react16-fluent9-late but with a different undefined
  // property (Fluent's internal store API surfaces .set / .getSnapshot /
  // .subscribe etc. depending on the Fluent component). Catches the long tail.
  {
    ruleId: 'react-commit-fluent-crash',
    match: (msg, stack) => {
      if (!stack) return null;
      const undefAccess = /Cannot read propert(?:y|ies) of (?:undefined|null)/i.test(msg);
      const commitPhase = /commitHookEffectListMount|commitLifeCycles|commitLayoutEffects|commitPassiveHookEffects/i.test(stack);
      const fluentFrame = /fluentui|Fluent|@fluentui/i.test(stack);
      if (!undefAccess || !commitPhase || !fluentFrame) return null;
      const propMatch = /reading ['"]([^'"]+)['"]/i.exec(msg);
      const prop = propMatch?.[1];
      return {
        ruleId: 'react-commit-fluent-crash',
        severity: 'fatal',
        summary: 'A Fluent UI component crashed during React commit — almost always a React/Fluent version mismatch.',
        likelyCause:
          `The crash happened inside React's commit phase (${commitPhase ? 'commitHookEffectListMount or similar' : 'commit'}) ` +
          `while a Fluent component was mounting. ` +
          (prop ? `Fluent tried to read .${prop} on a missing dispatcher. ` : '') +
          `This is the same family of failure as react16-fluent9-late: Fluent v9.40+ expects React 17/18 hooks that aren\'t available on React 16.14.`,
        suggestedFix:
          'Most reliable: downgrade @fluentui/react-components to a version <9.40 in the control project. ' +
          'Alternative: wait for the harness React-17/18 loader (todo: react17-fluent9-late). ' +
          'Quick check: open package.json in the failing control and look at the @fluentui/react-components version pin.',
      };
    },
  },

  // ─── Missing context.orgSettings.attributes accessor ──────────────────────
  {
    ruleId: 'orgsettings-attributes-undefined',
    match: (msg, stack) => {
      const undefAttr = /Cannot read propert(?:y|ies) of undefined \(reading ['"]attributes['"]\)/i.test(msg);
      const orgSettingsInStack = !!stack && /orgSettings/i.test(stack);
      if (!undefAttr) return null;
      if (!orgSettingsInStack) return null;
      return {
        ruleId: 'orgsettings-attributes-undefined',
        severity: 'fatal',
        summary: 'Control read context.orgSettings.attributes.<name> but orgSettings.attributes was undefined.',
        likelyCause:
          'A common pattern is context.orgSettings.attributes.maxuploadfilesize (without optional ' +
          'chaining). If the harness orgSettings shim was missing or returned an object without ' +
          'an attributes dictionary, the read throws.',
        suggestedFix:
          'The harness ships an orgSettings shim with the common attributes (maxuploadfilesize, ' +
          'isauditenabled, isAutoSaveEnabled, etc). If you hit this on a recent build, file an ' +
          'issue with the attribute name the control needed — we\'ll seed a default.',
      };
    },
  },

  // ─── Generic "Cannot read properties of undefined (reading 'X')" ──────────
  {
    ruleId: 'undefined-property-access',
    match: (msg, stack) => {
      const m = /Cannot read propert(?:y|ies) of undefined \(reading ['"]([^'"]+)['"]\)/i.exec(msg);
      if (!m) return null;
      const prop = m[1];
      return {
        ruleId: 'undefined-property-access',
        severity: 'fatal',
        summary: `Control tried to read .${prop} on a value that was undefined.`,
        likelyCause:
          `Usually one of: (a) a context.* / Xrm.* / formContext.* API returned undefined where the control ` +
          `expected an object, (b) a manifest-bound property has no value seeded in data.json or harness state, ` +
          `or (c) the control assumed a feature is always available without checking.`,
        suggestedFix:
          `Check the Shim Coverage tab for any 'Unimplemented' calls just before the crash — that often points ` +
          `at the missing shim. If the property name (${prop}) looks like a record column, seed it in data.json.` +
          (stack ? ` Top of stack: ${stack.split('\n')[1]?.trim() ?? ''}` : ''),
      };
    },
  },

  // ─── "X is not a function" ────────────────────────────────────────────────
  {
    ruleId: 'not-a-function',
    match: (msg) => {
      const m = /(.+?) is not a function/i.exec(msg);
      if (!m) return null;
      const what = m[1].trim();
      return {
        ruleId: 'not-a-function',
        severity: 'fatal',
        summary: `Control called ${what}() but the harness didn't expose it as a function.`,
        likelyCause:
          'Usually means a UCI API the control depends on hasn\'t been shimmed yet (returns undefined ' +
          'so calling it as a function throws). Less commonly: a typo in the control\'s code, or a ' +
          'Fluent / React library version mismatch where an exported helper moved.',
        suggestedFix:
          'Open the Shim Coverage tab — unimplemented APIs are logged there with category + method. ' +
          'If the missing call is in context.* / Xrm.* / formContext.*, the harness probably needs ' +
          'a new shim file (see src/shim/). For library functions, check the platform-library ' +
          'version against the control\'s package.json.',
      };
    },
  },

  // ─── "X is not defined" (ReferenceError) ──────────────────────────────────
  {
    ruleId: 'reference-error',
    match: (msg) => {
      const m = /^([A-Za-z_$][\w$]*) is not defined$/i.exec(msg);
      if (!m) return null;
      const name = m[1];
      return {
        ruleId: 'reference-error',
        severity: 'fatal',
        summary: `Control referenced a global named '${name}' that doesn't exist.`,
        likelyCause:
          `Likely either (a) the control expects a Microsoft / customer global (Xrm, parent, ` +
          `pcfwbHost) that the harness doesn't expose, or (b) the bundle's webpack externals are ` +
          `mis-aligned so the import landed on a global instead of being inlined.`,
        suggestedFix:
          `If '${name}' looks like Xrm / formContext / executionContext, that's a harness shim gap ` +
          `— file an issue with the control's name. If it looks like a library (React, ReactDOM, ` +
          `FluentUIReact), check the control's manifest <platform-library> declarations are correct.`,
      };
    },
  },

  // ─── Infinite loop / recursion ─────────────────────────────────────────────
  {
    ruleId: 'stack-overflow',
    match: (msg) => {
      if (!/Maximum call stack size exceeded/i.test(msg)) return null;
      return {
        ruleId: 'stack-overflow',
        severity: 'fatal',
        summary: 'Stack overflow — usually a notifyOutputChanged feedback loop.',
        likelyCause:
          'The most common cause is the control calling notifyOutputChanged() inside getOutputs() or ' +
          'updateView(), which triggers another updateView, which calls notifyOutputChanged again. ' +
          'A second cause: recursive React renders where a useEffect updates state on every render.',
        suggestedFix:
          'Open the Lifecycle Monitor tab — if updateView count is in the hundreds, you\'ve got a ' +
          'feedback loop. Guard notifyOutputChanged() with a value-changed check, or move it out of ' +
          'getOutputs().',
      };
    },
  },

  // ─── WebAPI HTTP errors ────────────────────────────────────────────────────
  {
    ruleId: 'webapi-http-error',
    match: (msg) => {
      const m = /(\d{3})\s+(.+)/.exec(msg);
      const looksWebApi = /webapi|retrieve|retrievemultiple|createrecord|updaterecord/i.test(msg);
      if (!m || !looksWebApi) return null;
      const code = m[1];
      return {
        ruleId: 'webapi-http-error',
        severity: 'warning',
        summary: `context.webAPI returned HTTP ${code}.`,
        likelyCause:
          code.startsWith('4')
            ? 'A 4xx response means the request was rejected. 401/403 = auth/role problem (check user roles in the User Settings tab); 404 = entity or column doesn\'t exist; 400 = malformed FetchXML or OData query.'
            : code.startsWith('5')
            ? '5xx = server-side error. In mock mode this should never happen — file a bug. In live mode it\'s a Dataverse problem; retry or check the org status.'
            : 'Non-2xx response. See the WebAPI log in the Console tab for the request details.',
        suggestedFix:
          'Open the Console tab and filter by WebAPI to see the exact request and response. If you\'re in mock mode (Data tab), check data.json has the expected entity + records.',
      };
    },
  },

  // ─── Bundle load / syntax errors ───────────────────────────────────────────
  {
    ruleId: 'bundle-syntax',
    match: (msg) => {
      if (!/(unexpected token|syntaxerror|invalid or unexpected token)/i.test(msg)) return null;
      return {
        ruleId: 'bundle-syntax',
        severity: 'fatal',
        summary: 'bundle.js failed to parse — usually a stale or broken build.',
        likelyCause:
          'The harness loaded out/controls/<Name>/bundle.js but the JS engine couldn\'t parse it. ' +
          'Most common reason: a webpack build that was interrupted mid-write, or a build that ' +
          'targets a JS version the harness\'s browser doesn\'t understand (ES2022+ in old Chromium).',
        suggestedFix:
          'Re-run `npm run build` in the control project — make sure it finishes successfully. ' +
          'If it still fails, check the build output for warnings about target browsers.',
      };
    },
  },

  // ─── Generic React render error ───────────────────────────────────────────
  {
    ruleId: 'react-render-error',
    match: (msg, stack) => {
      const reactInStack = !!stack && /(react-dom|reconciler|commitWork|renderWithHooks)/i.test(stack);
      if (!reactInStack) return null;
      return {
        ruleId: 'react-render-error',
        severity: 'fatal',
        summary: 'React threw while rendering the control.',
        likelyCause:
          'Could be: invalid hook call (hook used outside a function component), state update during render, ' +
          'incorrect component return value (undefined / multiple roots without a fragment), or a key collision ' +
          'inside a list.',
        suggestedFix:
          'Open the browser DevTools console (F12) — React errors include a component stack that points at the ' +
          'offending component. The harness can\'t reconstruct that stack itself.',
      };
    },
  },
];

/**
 * Match an error against the diagnostic ruleset. Returns null if no rule
 * matches; in that case callers should fall back to showing the raw message.
 */
export function explainError(message: string, stack?: string): ErrorExplanation | null {
  if (!message) return null;
  for (const rule of RULES) {
    try {
      const hit = rule.match(message, stack);
      if (hit) return hit;
    } catch {
      // Rule itself threw — never let a diagnostic crash the diagnostics.
    }
  }
  return null;
}

/**
 * Test-only: list rule ids. Used by the loop CLI's --explain output and
 * potentially by a future Audit panel that enumerates supported diagnostics.
 */
export function listDiagnosticRules(): string[] {
  return RULES.map(r => r.ruleId);
}
