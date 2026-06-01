/**
 * M2.P4 — Live-write gate. Wraps the dialog bus + sessionStorage so the
 * WebAPI shim's live create/update/delete paths can `await` user
 * confirmation before a POST/PATCH/DELETE actually leaves the browser.
 *
 * Behaviour:
 *   - First live write of the session → confirm dialog.
 *   - User can tick "Always allow this session" → subsequent writes auto-pass
 *     without dialog (sessionStorage scoped, cleared on tab close).
 *   - User cancel → caller throws "Live write cancelled by user".
 *   - Live block (M2.P6) is enforced upstream by setDataSource (we never
 *     reach this path under block), but we double-check defensively.
 */

import { pushDialog, type LiveWriteConfirmRequest } from '../shim/dialog-bus';
import { isLiveBlocked } from './live-block';

const ALLOW_KEY = 'pcf-workbench-live-writes-allow';

export function isAlwaysAllow(): boolean {
  try {
    return sessionStorage.getItem(ALLOW_KEY) === '1';
  } catch {
    return false;
  }
}

export function setAlwaysAllow(value: boolean): void {
  try {
    if (value) sessionStorage.setItem(ALLOW_KEY, '1');
    else sessionStorage.removeItem(ALLOW_KEY);
  } catch { /* ignore */ }
}

export interface LiveWriteRequestArgs {
  method: 'create' | 'update' | 'delete';
  entityType: string;
  recordId?: string;
  payload?: Record<string, any>;
  orgUrl: string;
}

/**
 * Returns true if the write should proceed, false if cancelled. Throws
 * synchronously when called under the live-block guardrail (defensive — the
 * normal flow is `setDataSource` already forced mock).
 */
export async function confirmLiveWrite(args: LiveWriteRequestArgs): Promise<boolean> {
  if (isLiveBlocked()) {
    throw new Error('Live writes blocked: ?live=block or harness CLI flag is set.');
  }
  if (isAlwaysAllow()) return true;

  return new Promise<boolean>((resolve) => {
    pushDialog<LiveWriteConfirmRequest>({
      kind: 'liveWriteConfirm',
      method: args.method,
      entityType: args.entityType,
      recordId: args.recordId,
      payload: args.payload,
      orgUrl: args.orgUrl,
      resolve: (result) => {
        if (result.alwaysAllow) setAlwaysAllow(true);
        resolve(result.confirmed);
      },
    });
  });
}
