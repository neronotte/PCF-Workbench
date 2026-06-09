/**
 * Legacy compatibility shim. The canonical scenario-handling module is now
 * `./scenario-store` — it owns the v2 schema, migration, name generation,
 * capture/apply, and storage. This file remains as a thin re-export so
 * existing imports (notably `App.tsx`'s `?scenario=<name>` URL loader) keep
 * working without changes. Migrate call sites to `./scenario-store` over time.
 */

export type { TestScenario } from './scenario-store';
export {
  resolveScenarioValues,
  applyScenarioToStore,
  applyScenarioAsActive,
  findScenarioByName,
} from './scenario-store';
