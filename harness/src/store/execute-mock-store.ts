/**
 * In-memory store for execute() mock responses.
 * Loaded from execute-mocks.json in the PCF project directory (if present).
 *
 * File format — keys are action/function names, values are the JSON body
 * that response.json() should resolve to:
 *
 * {
 *   "contoso_CreateCapacityInsufficientWorkException": {
 *     "Response": "{\"Description\":\"Capacity created successfully\"}"
 *   },
 *   "msdyn_ApproveTimeEntry": {
 *     "value": true
 *   }
 * }
 */

let mocks: Record<string, any> = {};

export function loadExecuteMocks(data: Record<string, any>): void {
  mocks = { ...data };
  const count = Object.keys(mocks).length;
  if (count > 0) {
    console.log(`[pcf-workbench] Loaded ${count} execute mock(s): ${Object.keys(mocks).join(', ')}`);
  }
}

export function getExecuteMock(actionName: string): any | undefined {
  return mocks[actionName];
}

export function getExecuteMockKeys(): string[] {
  return Object.keys(mocks);
}
