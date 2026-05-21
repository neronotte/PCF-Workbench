// Scenario loading helpers shared by the ScenariosPanel UI and the
// App.tsx ?scenario=<name> URL auto-loader (used by the loop CLI in CI).
//
// Keep this module side-effect free apart from store writes inside
// applyScenarioToStore — App.tsx calls these before the control mounts
// so the harness boots in the requested scenario state.

import { useHarnessStore } from '../store/harness-store';
import { getEntityData } from '../store/data-store';

export interface TestScenario {
  name: string;
  description?: string;
  savedAt: string;
  propertyValues: Record<string, any>;
  /** Map property names to entity column names for field-level binding.
   *  When loaded, the harness resolves values from the data.json record
   *  matching pageEntityId + pageEntityTypeName. */
  fieldBindings?: Record<string, string>;
  pageEntityId: string;
  pageEntityTypeName: string;
  networkMode: string;
  devicePreset: string;
  isControlDisabled: boolean;
}

/**
 * Resolve property values by walking fieldBindings against the loaded
 * entity record. Pure — no store writes.
 */
export function resolveScenarioValues(scenario: TestScenario): Record<string, any> {
  const resolvedValues: Record<string, any> = { ...scenario.propertyValues };
  if (!scenario.fieldBindings || !scenario.pageEntityId || !scenario.pageEntityTypeName) {
    return resolvedValues;
  }

  const records = getEntityData(scenario.pageEntityTypeName);
  const normalId = scenario.pageEntityId.replace(/[{}]/g, '').toLowerCase();
  const record = records.find(r => {
    for (const key of Object.keys(r)) {
      if ((key.toLowerCase().endsWith('id') || key === 'id') &&
          String((r as any)[key]).replace(/[{}]/g, '').toLowerCase() === normalId) {
        return true;
      }
    }
    return false;
  }) as any;
  if (!record) return resolvedValues;

  for (const [propName, columnName] of Object.entries(scenario.fieldBindings)) {
    const val = record[columnName];
    if (val !== undefined) resolvedValues[propName] = val;
    // Lookup-style binding: pick up the OData formatted-value pair.
    const formatted = record[`_${columnName}_value@OData.Community.Display.V1.FormattedValue`]
      ?? record[`${columnName}@OData.Community.Display.V1.FormattedValue`];
    const lookupVal = record[`_${columnName}_value`] ?? record[columnName];
    if (formatted && typeof lookupVal === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}/.test(lookupVal)) {
      resolvedValues[propName] = [{ id: lookupVal, name: formatted, entityType: columnName }];
    }
  }
  return resolvedValues;
}

/**
 * Apply a scenario's resolved values to the harness store. Used by both
 * the ScenariosPanel "Load" button and the ?scenario=<name> auto-loader.
 */
export function applyScenarioToStore(scenario: TestScenario): void {
  const resolvedValues = resolveScenarioValues(scenario);
  const s = useHarnessStore.getState();
  s.setPropertyValues(resolvedValues);
  s.setPageEntityId(scenario.pageEntityId);
  s.setPageEntityTypeName(scenario.pageEntityTypeName);
  s.setNetworkMode(scenario.networkMode as any);
  s.setDevicePreset(scenario.devicePreset);
  s.setControlDisabled(scenario.isControlDisabled);
  s.addLogEntry({ category: 'scenario', method: 'load', args: { name: scenario.name } });
}

/** localStorage key — must mirror ScenariosPanel.storageKey(). */
function storageKey(controlId: string): string {
  return `pcf-workbench-scenarios-${controlId}`;
}

/**
 * Find a scenario by name. Searches localStorage first (user-modified
 * scenarios win), then /pcf-data/test-scenarios.json. Returns null
 * when no match exists in either source.
 */
export async function findScenarioByName(
  controlId: string,
  name: string,
): Promise<TestScenario | null> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(storageKey(controlId)) : null;
    if (raw) {
      const list = JSON.parse(raw) as TestScenario[];
      const hit = Array.isArray(list) ? list.find(s => s.name === name) : null;
      if (hit) return hit;
    }
  } catch { /* ignore corrupt localStorage */ }

  try {
    const r = await fetch('/pcf-data/test-scenarios.json');
    if (r.ok) {
      const list = await r.json() as TestScenario[];
      const hit = Array.isArray(list) ? list.find(s => s.name === name) : null;
      if (hit) return hit;
    }
  } catch { /* ignore */ }

  return null;
}
