import type { HarnessStore } from '../store/harness-store';

/**
 * `context.reporting` shim — telemetry surface used by Microsoft's internal
 * MscrmControls (and likely any control that follows the same convention) to
 * log success/failure events for diagnostics.
 *
 * Status: observed in real bundles; public-vs-internal status of this surface
 * is still being verified (see todo `explore-context-reporting-public-use`).
 * Keep the shim either way — the bundles crash without it.
 *
 * In UCI these calls route to App Insights. Locally we:
 *   1. Push every call into the harness log panel (category 'factory'), so
 *      they show up in the Logs tab and Shim Coverage tab.
 *   2. Echo to the browser console so developers see failures even when the
 *      harness UI isn't visible:
 *        reportSuccess → console.debug   (low-noise, opt-in via DevTools verbose)
 *        reportFailure → console.warn    (high-visibility, includes the Error)
 *
 * Signatures mirror what we've observed in real bundles:
 *   reportSuccess(name, additionalProperties?)
 *   reportFailure(name, error, eventName?, additionalProperties?)
 *   reportEvent({ eventName, eventParameters? })   // App Insights custom event
 *
 * Always log — never throw. The whole point of telemetry is that it can't
 * itself crash the host control. Every body is wrapped in try/catch so a
 * malformed `additionalProperties` payload never propagates out.
 */
export function createReportingShim(getState: () => HarnessStore) {
  return {
    reportSuccess(
      name: string,
      additionalProperties?: Array<{ name: string; value: any }>,
    ): void {
      try {
        getState().addLogEntry({
          category: 'factory',
          method: 'reporting.reportSuccess',
          args: { name, additionalProperties },
          coverage: 'implemented',
        });
        // eslint-disable-next-line no-console
        console.debug(
          `[pcf-workbench] context.reporting.reportSuccess(${name})`,
          additionalProperties ?? '',
        );
      } catch { /* never throw from telemetry */ }
    },
    reportFailure(
      name: string,
      error: Error | unknown,
      eventName?: string,
      additionalProperties?: Array<{ name: string; value: any }>,
    ): void {
      try {
        const errPayload = error instanceof Error
          ? { message: error.message, stack: error.stack, name: error.name }
          : { value: error };
        getState().addLogEntry({
          category: 'factory',
          method: 'reporting.reportFailure',
          args: { name, error: errPayload, eventName, additionalProperties },
          coverage: 'implemented',
        });
        // High-visibility console output — preserves the original Error object
        // so DevTools' clickable stack-trace expansion still works.
        // eslint-disable-next-line no-console
        console.warn(
          `[pcf-workbench] context.reporting.reportFailure(${name})${eventName ? ` event=${eventName}` : ''}`,
          error,
          additionalProperties ?? '',
        );
      } catch { /* never throw from telemetry */ }
    },
    reportEvent(
      event: { eventName: string; eventParameters?: Array<{ name: string; value: any }> } | undefined,
    ): void {
      try {
        const eventName = event?.eventName ?? '(unnamed)';
        const eventParameters = event?.eventParameters;
        getState().addLogEntry({
          category: 'factory',
          method: 'reporting.reportEvent',
          args: { eventName, eventParameters },
          coverage: 'implemented',
        });
        // eslint-disable-next-line no-console
        console.debug(
          `[pcf-workbench] context.reporting.reportEvent(${eventName})`,
          eventParameters ?? '',
        );
      } catch { /* never throw from telemetry */ }
    },
  };
}

