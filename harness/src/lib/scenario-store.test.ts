// M11.M2 — Unit tests for harness/src/lib/scenario-store.ts
//
// Scope (this commit): pure functions only. The store-coupled functions
// (`buildDefaultScenario`, `resolveScenarioValues`, `captureScenarioFromStore`,
// `applyScenarioToStore`) require live Zustand store wiring and entity-data
// store interaction — they're queued as `describe.todo` and will be covered in
// a future pass that stands up a real (non-mocked) store instance per test.
// Per DESIGN.md §6 Q5: NO `vi.mock` allowed in P1.

import {
  scenariosStorageKey,
  activeScenarioStorageKey,
  autoGenSuppressStorageKey,
  normalizeScenario,
  normalizeScenarioList,
  nextTestScenarioNames,
  findUniqueCopyName,
  renameScenario,
  deleteScenario,
  upsertScenario,
  SCENARIO_SCHEMA_VERSION,
  type TestScenario,
} from './scenario-store';

const v2 = (name: string, extra: Partial<TestScenario> = {}): TestScenario => ({
  schemaVersion: SCENARIO_SCHEMA_VERSION,
  name,
  savedAt: '2026-01-01T00:00:00.000Z',
  ...extra,
});

/* -------------------------------------------------------------------------- */
/* Storage key helpers                                                        */
/* -------------------------------------------------------------------------- */

describe('storage key helpers', () => {
  it('scenariosStorageKey: prefixes the control id', () => {
    expect(scenariosStorageKey('PcfWorkbench.StarRating'))
      .toBe('pcf-workbench-scenarios-PcfWorkbench.StarRating');
  });

  it('activeScenarioStorageKey: prefixes the control id', () => {
    expect(activeScenarioStorageKey('PcfWorkbench.StarRating'))
      .toBe('pcf-workbench-active-scenario-PcfWorkbench.StarRating');
  });

  it('autoGenSuppressStorageKey: prefixes the control id', () => {
    expect(autoGenSuppressStorageKey('PcfWorkbench.StarRating'))
      .toBe('pcf-workbench-suppress-autogen-PcfWorkbench.StarRating');
  });

  it('storage keys are namespaced distinctly so they cannot collide', () => {
    const id = 'X';
    const keys = [
      scenariosStorageKey(id),
      activeScenarioStorageKey(id),
      autoGenSuppressStorageKey(id),
    ];
    expect(new Set(keys).size).toBe(3);
  });
});

/* -------------------------------------------------------------------------- */
/* normalizeScenario — defensive parser for unknown localStorage / disk blobs */
/* -------------------------------------------------------------------------- */

describe('normalizeScenario', () => {
  describe('rejection paths', () => {
    it('rejects null', () => {
      expect(normalizeScenario(null)).toBeNull();
    });

    it('rejects non-object primitives', () => {
      expect(normalizeScenario('hello')).toBeNull();
      expect(normalizeScenario(42)).toBeNull();
      expect(normalizeScenario(true)).toBeNull();
    });

    it('rejects array input (must be a scenario object, not a list)', () => {
      expect(normalizeScenario([])).toBeNull();
    });

    it('rejects missing name field', () => {
      expect(normalizeScenario({ savedAt: '2026-01-01' })).toBeNull();
    });

    it('rejects empty-string name', () => {
      expect(normalizeScenario({ name: '' })).toBeNull();
    });
  });

  describe('v1 → v2 migration', () => {
    it('detects v1 by presence of legacy flat fields (no schemaVersion + pageEntityId)', () => {
      const v1 = {
        name: 'Old scenario',
        savedAt: '2026-01-01T00:00:00.000Z',
        propertyValues: { foo: 'bar' },
        pageEntityId: 'abc-123',
        pageEntityTypeName: 'account',
        pageEntityRecordName: 'Contoso',
        networkMode: 'slow3g',
        devicePreset: 'iphone-14-pro',
        isControlDisabled: false,
      };
      const result = normalizeScenario(v1);
      expect(result).not.toBeNull();
      expect(result!.schemaVersion).toBe(SCENARIO_SCHEMA_VERSION);
      expect(result!.name).toBe('Old scenario');
      expect(result!.propertyValues).toEqual({ foo: 'bar' });
      // v1's flat fields became v2 nested objects:
      expect(result!.pageContext).toEqual({
        entityId: 'abc-123',
        typeName: 'account',
        recordName: 'Contoso',
      });
      expect(result!.network).toEqual({ mode: 'slow3g' });
      expect(result!.device).toEqual({ preset: 'iphone-14-pro' });
    });

    it('drops pageContext entirely when all three legacy page fields are empty', () => {
      const v1 = {
        name: 'No page context',
        savedAt: '2026-01-01T00:00:00.000Z',
        propertyValues: {},
        pageEntityId: '',
        pageEntityTypeName: '',
        networkMode: 'online',
        devicePreset: 'desktop',
        isControlDisabled: false,
      };
      const result = normalizeScenario(v1);
      expect(result!.pageContext).toBeUndefined();
    });

    it('coerces invalid network mode to default `online` during v1 migration', () => {
      const v1 = {
        name: 'Bad network mode',
        savedAt: '2026-01-01T00:00:00.000Z',
        propertyValues: {},
        pageEntityId: '',
        pageEntityTypeName: '',
        networkMode: 'gigabit', // invalid
        devicePreset: 'desktop',
        isControlDisabled: false,
      };
      const result = normalizeScenario(v1);
      expect(result!.network).toEqual({ mode: 'online' });
    });
  });

  describe('v2 passthrough', () => {
    it('accepts a minimal v2 scenario (name + savedAt only)', () => {
      const result = normalizeScenario({
        schemaVersion: 2,
        name: 'Minimal',
        savedAt: '2026-01-01T00:00:00.000Z',
      });
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Minimal');
      expect(result!.schemaVersion).toBe(2);
    });

    it('round-trips full pageContext / network / device / userSettings', () => {
      const input = {
        schemaVersion: 2,
        name: 'Full',
        savedAt: '2026-01-01T00:00:00.000Z',
        propertyValues: { rating: 5 },
        pageContext: { entityId: 'g', typeName: 'account', recordName: 'Acme' },
        network: { mode: 'slow3g', customLatencyMs: 1500 },
        device: { preset: 'iphone-14-pro', containerWidth: 390, containerHeight: 844, host: 'Web', isFullBleed: false },
        userSettings: {
          languageId: 1033,
          isRTL: false,
          timeZoneOffsetMinutes: -300,
          userId: 'u1',
          userName: 'Alice',
          securityRoles: ['System Administrator'],
        },
        dataSource: 'mock',
      };
      const result = normalizeScenario(input);
      expect(result!.pageContext).toEqual({ entityId: 'g', typeName: 'account', recordName: 'Acme' });
      expect(result!.network).toEqual({ mode: 'slow3g', customLatencyMs: 1500 });
      expect(result!.device).toEqual({ preset: 'iphone-14-pro', containerWidth: 390, containerHeight: 844, host: 'Web', isFullBleed: false });
      expect(result!.userSettings).toMatchObject({ languageId: 1033, isRTL: false, userId: 'u1', userName: 'Alice' });
      expect(result!.userSettings?.securityRoles).toEqual(['System Administrator']);
      expect(result!.dataSource).toBe('mock');
    });

    it('drops invalid dataSource values (must be "mock" or "live")', () => {
      const result = normalizeScenario({
        schemaVersion: 2,
        name: 'Bad dataSource',
        savedAt: '2026-01-01T00:00:00.000Z',
        dataSource: 'somethingElse',
      });
      expect(result!.dataSource).toBeUndefined();
    });

    it('drops userSettings entirely when every field is invalid', () => {
      const result = normalizeScenario({
        schemaVersion: 2,
        name: 'Bad user settings',
        savedAt: '2026-01-01T00:00:00.000Z',
        userSettings: { languageId: 'not-a-number', isRTL: 'not-a-bool' },
      });
      expect(result!.userSettings).toBeUndefined();
    });

    it('keeps device.containerWidth=null (explicit null is meaningful, means "auto")', () => {
      const result = normalizeScenario({
        schemaVersion: 2,
        name: 'Null container',
        savedAt: '2026-01-01T00:00:00.000Z',
        device: { preset: 'desktop', containerWidth: null, containerHeight: null },
      });
      expect(result!.device).toEqual({ preset: 'desktop', containerWidth: null, containerHeight: null });
    });
  });

  describe('savedAt fallback', () => {
    it('defaults to epoch when savedAt is missing', () => {
      const result = normalizeScenario({ schemaVersion: 2, name: 'No date' });
      expect(result!.savedAt).toBe('1970-01-01T00:00:00.000Z');
    });
  });
});

/* -------------------------------------------------------------------------- */
/* normalizeScenarioList                                                      */
/* -------------------------------------------------------------------------- */

describe('normalizeScenarioList', () => {
  it('returns empty array for non-array input', () => {
    expect(normalizeScenarioList(null)).toEqual([]);
    expect(normalizeScenarioList('not an array')).toEqual([]);
    expect(normalizeScenarioList({ name: 'single' })).toEqual([]);
  });

  it('drops unrecognizable entries silently and keeps the rest', () => {
    const result = normalizeScenarioList([
      { name: 'Good', savedAt: '2026-01-01T00:00:00.000Z', schemaVersion: 2 },
      null,
      { invalid: 'no name' },
      { name: '', savedAt: '2026-01-01' }, // empty name → rejected
      { name: 'Also good', savedAt: '2026-01-01T00:00:00.000Z', schemaVersion: 2 },
    ]);
    expect(result.map(s => s.name)).toEqual(['Good', 'Also good']);
  });
});

/* -------------------------------------------------------------------------- */
/* nextTestScenarioNames                                                      */
/* -------------------------------------------------------------------------- */

describe('nextTestScenarioNames', () => {
  it('starts at 1 when no existing scenarios', () => {
    expect(nextTestScenarioNames([], 3)).toEqual([
      'Test scenario 1',
      'Test scenario 2',
      'Test scenario 3',
    ]);
  });

  it('continues after the highest existing index, even with gaps', () => {
    const existing = [v2('Test scenario 2'), v2('Test scenario 5'), v2('Custom name')];
    expect(nextTestScenarioNames(existing, 2)).toEqual([
      'Test scenario 6',
      'Test scenario 7',
    ]);
  });

  it('ignores non-matching names when computing max index', () => {
    const existing = [v2('Test scenario abc'), v2('Test scenario'), v2('Foo')];
    expect(nextTestScenarioNames(existing, 1)).toEqual(['Test scenario 1']);
  });

  it('returns empty array when count is 0', () => {
    expect(nextTestScenarioNames([], 0)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* findUniqueCopyName                                                         */
/* -------------------------------------------------------------------------- */

describe('findUniqueCopyName', () => {
  it('appends "(copy)" when name is free', () => {
    expect(findUniqueCopyName([], 'Foo')).toBe('Foo (copy)');
  });

  it('appends "(copy 2)" when "(copy)" is already taken', () => {
    expect(findUniqueCopyName([v2('Foo (copy)')], 'Foo')).toBe('Foo (copy 2)');
  });

  it('keeps incrementing past collisions', () => {
    const existing = [
      v2('Foo (copy)'),
      v2('Foo (copy 2)'),
      v2('Foo (copy 3)'),
      v2('Foo (copy 4)'),
    ];
    expect(findUniqueCopyName(existing, 'Foo')).toBe('Foo (copy 5)');
  });

  it('does not consider unrelated names as collisions', () => {
    expect(findUniqueCopyName([v2('Bar (copy)')], 'Foo')).toBe('Foo (copy)');
  });
});

/* -------------------------------------------------------------------------- */
/* renameScenario                                                             */
/* -------------------------------------------------------------------------- */

describe('renameScenario', () => {
  it('returns the same list when oldName === newName (no-op)', () => {
    const list = [v2('A'), v2('B')];
    expect(renameScenario(list, 'A', 'A')).toBe(list);
  });

  it('throws when newName collides with an existing scenario', () => {
    const list = [v2('A'), v2('B')];
    expect(() => renameScenario(list, 'A', 'B')).toThrow(/already exists/);
  });

  it('renames the matching scenario and bumps savedAt', () => {
    const list = [v2('A'), v2('B')];
    const result = renameScenario(list, 'A', 'Z');
    expect(result.map(s => s.name)).toEqual(['Z', 'B']);
    expect(result[0].savedAt).not.toBe('2026-01-01T00:00:00.000Z');
  });

  it('returns a new array (does not mutate the input)', () => {
    const list = [v2('A')];
    const result = renameScenario(list, 'A', 'Z');
    expect(result).not.toBe(list);
    expect(list[0].name).toBe('A');
  });

  it('silently no-ops when oldName does not exist', () => {
    const list = [v2('A')];
    const result = renameScenario(list, 'Nonexistent', 'Z');
    expect(result.map(s => s.name)).toEqual(['A']);
  });
});

/* -------------------------------------------------------------------------- */
/* deleteScenario                                                             */
/* -------------------------------------------------------------------------- */

describe('deleteScenario', () => {
  it('removes the matching scenario', () => {
    const list = [v2('A'), v2('B'), v2('C')];
    expect(deleteScenario(list, 'B').map(s => s.name)).toEqual(['A', 'C']);
  });

  it('returns the same shape when no match', () => {
    const list = [v2('A')];
    expect(deleteScenario(list, 'Nonexistent').map(s => s.name)).toEqual(['A']);
  });

  it('returns a new array (does not mutate)', () => {
    const list = [v2('A'), v2('B')];
    const result = deleteScenario(list, 'A');
    expect(result).not.toBe(list);
    expect(list.length).toBe(2);
  });
});

/* -------------------------------------------------------------------------- */
/* upsertScenario                                                             */
/* -------------------------------------------------------------------------- */

describe('upsertScenario', () => {
  it('appends when no scenario with that name exists', () => {
    const list = [v2('A')];
    const result = upsertScenario(list, v2('B'));
    expect(result.map(s => s.name)).toEqual(['A', 'B']);
  });

  it('replaces in-place when a scenario with the same name exists', () => {
    const list = [v2('A', { description: 'old' }), v2('B')];
    const updated = v2('A', { description: 'new' });
    const result = upsertScenario(list, updated);
    expect(result.length).toBe(2);
    expect(result[0].description).toBe('new');
    expect(result[0]).toBe(updated);
  });

  it('preserves order on replace', () => {
    const list = [v2('A'), v2('B'), v2('C')];
    const result = upsertScenario(list, v2('B', { description: 'updated' }));
    expect(result.map(s => s.name)).toEqual(['A', 'B', 'C']);
  });

  it('returns a new array (does not mutate input)', () => {
    const list = [v2('A')];
    const result = upsertScenario(list, v2('B'));
    expect(result).not.toBe(list);
    expect(list.length).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Store-coupled functions — queued for a future pass                         */
/* -------------------------------------------------------------------------- */

// These functions read from / write to the live Zustand store and the in-memory
// entity-data store. Testing them properly without `vi.mock` (per DESIGN §6 Q5)
// requires standing up real store instances per test and seeding entity data.
// Queued as a follow-up so M11.M2 ships now without scope creep.
describe.todo('buildDefaultScenario (store-coupled: reads getMockEntityDataSnapshot)');
describe.todo('resolveScenarioValues (store-coupled: reads manifest + getEntityData)');
describe.todo('captureScenarioFromStore (store-coupled: reads useHarnessStore.getState)');
describe.todo('applyScenarioToStore (store-coupled: writes to useHarnessStore via setters)');
describe.todo('applyScenarioAsActive (store-coupled: wraps applyScenarioToStore + setActiveScenarioName)');
describe.todo('captureScenarioFromStore: live mode omits dataRecords (rubber-duck #4 regression)');
