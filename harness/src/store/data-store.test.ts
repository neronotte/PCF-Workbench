// M11.M5 — Unit tests for harness/src/store/data-store.ts
//
// data-store is the in-memory entity table shared by the WebAPI shim, the
// dataset shim, and the DataPanel UI. It's lightly coupled to the Zustand
// harness-store (only for the dataSource branch and dirty marking) — these
// tests use the REAL store (no vi.mock per M11 §6), resetting entity state
// in beforeEach to keep tests independent.
//
// Coverage is focused on the parts that have historically bitten:
//   • id-field detection (the `<entityType>id` convention, plain `id`,
//     and the findIdField fallback)
//   • defensive cloning (snapshot/replace must not share references with
//     the caller, or scenario Save can leak mutations into saved JSON)
//   • merge upsert keying — wrong id resolution duplicates records
//
// CRUD-with-notify is exercised via a real subscriber rather than a spy.

import {
  loadEntityData,
  getEntityData,
  getEntityStoreKeys,
  clearEntityData,
  deleteEntityTable,
  createEntityTable,
  getMockEntityDataSnapshot,
  replaceMockEntityData,
  mergeMockEntityData,
  mergeKeyedMockEntityData,
  subscribeData,
  addEntityRecord,
  updateEntityRecord,
  deleteEntityRecord,
} from './data-store';

beforeEach(() => {
  clearEntityData();
});

/* -------------------------------------------------------------------------- */
/* load / get / clear                                                         */
/* -------------------------------------------------------------------------- */

describe('loadEntityData / getEntityData', () => {
  it('loads a fresh entity table and reads it back', () => {
    loadEntityData({ accounts: [{ id: '1', name: 'Acme' }] });
    expect(getEntityData('accounts')).toEqual([{ id: '1', name: 'Acme' }]);
  });

  it('returns empty array for unknown entity', () => {
    expect(getEntityData('missing')).toEqual([]);
  });

  it('replaces the entire store (does not merge with prior load)', () => {
    loadEntityData({ accounts: [{ id: '1' }], contacts: [{ id: 'c1' }] });
    loadEntityData({ accounts: [{ id: '2' }] });
    expect(getEntityData('accounts')).toEqual([{ id: '2' }]);
    expect(getEntityData('contacts')).toEqual([]);
  });
});

describe('clearEntityData', () => {
  it('removes all entity tables', () => {
    loadEntityData({ accounts: [{ id: '1' }], contacts: [{ id: 'c1' }] });
    clearEntityData();
    expect(getEntityStoreKeys()).toEqual([]);
  });
});

describe('getEntityStoreKeys', () => {
  it('returns the names of loaded entity tables', () => {
    loadEntityData({ accounts: [], contacts: [], events: [] });
    expect(getEntityStoreKeys().sort()).toEqual(['accounts', 'contacts', 'events']);
  });
});

/* -------------------------------------------------------------------------- */
/* createEntityTable / deleteEntityTable                                      */
/* -------------------------------------------------------------------------- */

describe('createEntityTable', () => {
  it('creates an empty table and returns true', () => {
    expect(createEntityTable('newthing')).toBe(true);
    expect(getEntityData('newthing')).toEqual([]);
  });

  it('refuses to overwrite an existing table and returns false', () => {
    loadEntityData({ accounts: [{ id: '1' }] });
    expect(createEntityTable('accounts')).toBe(false);
    expect(getEntityData('accounts')).toEqual([{ id: '1' }]); // unchanged
  });
});

describe('deleteEntityTable', () => {
  it('removes a table and returns true', () => {
    loadEntityData({ accounts: [{ id: '1' }], contacts: [{ id: 'c1' }] });
    expect(deleteEntityTable('accounts')).toBe(true);
    expect(getEntityStoreKeys()).toEqual(['contacts']);
  });

  it('returns false when the table does not exist', () => {
    expect(deleteEntityTable('nope')).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* getMockEntityDataSnapshot — defensive cloning                              */
/* -------------------------------------------------------------------------- */

describe('getMockEntityDataSnapshot', () => {
  it('returns a deep clone (caller mutations do not leak back into the store)', () => {
    loadEntityData({ accounts: [{ id: '1', name: 'Acme' }] });
    const snap = getMockEntityDataSnapshot();
    snap.accounts[0].name = 'MUTATED';
    snap.accounts.push({ id: '2', name: 'Bogus' });
    // Original store untouched
    expect(getEntityData('accounts')).toEqual([{ id: '1', name: 'Acme' }]);
  });

  it('returns an empty object when nothing is loaded', () => {
    expect(getMockEntityDataSnapshot()).toEqual({});
  });
});

/* -------------------------------------------------------------------------- */
/* replaceMockEntityData — defensive cloning on the way in                    */
/* -------------------------------------------------------------------------- */

describe('replaceMockEntityData', () => {
  it('replaces the entire store with a defensive clone of the input', () => {
    const incoming = { accounts: [{ id: '1', name: 'Acme' }] };
    replaceMockEntityData(incoming);
    // Mutating the source after replace must not affect the stored copy
    incoming.accounts[0].name = 'MUTATED';
    incoming.accounts.push({ id: '2', name: 'Bogus' });
    expect(getEntityData('accounts')).toEqual([{ id: '1', name: 'Acme' }]);
  });
});

/* -------------------------------------------------------------------------- */
/* mergeMockEntityData — id-field resolution + upsert                         */
/* -------------------------------------------------------------------------- */

describe('mergeMockEntityData', () => {
  it('inserts new entities and reports addedCount', () => {
    const res = mergeMockEntityData({
      accounts: [{ accountid: 'a1', name: 'Acme' }],
    });
    expect(res).toEqual({ entityCount: 1, addedCount: 1, updatedCount: 0 });
    expect(getEntityData('accounts')).toEqual([{ accountid: 'a1', name: 'Acme' }]);
  });

  it('updates existing records by matching the conventional `<entityType>id` field', () => {
    loadEntityData({ accounts: [{ accountid: 'a1', name: 'Acme' }] });
    const res = mergeMockEntityData({
      accounts: [{ accountid: 'a1', name: 'Acme Renamed' }],
    });
    expect(res).toEqual({ entityCount: 1, addedCount: 0, updatedCount: 1 });
    expect(getEntityData('accounts')[0].name).toBe('Acme Renamed');
    expect(getEntityData('accounts').length).toBe(1); // upsert, not append
  });

  it('falls back to the generic `id` field when no `<entityType>id` exists', () => {
    loadEntityData({ widgets: [{ id: 'w1', name: 'Cog' }] });
    const res = mergeMockEntityData({
      widgets: [{ id: 'w1', name: 'Updated Cog' }, { id: 'w2', name: 'New' }],
    });
    expect(res).toEqual({ entityCount: 1, addedCount: 1, updatedCount: 1 });
    expect(getEntityData('widgets').length).toBe(2);
  });

  it('skips entities with empty incoming arrays', () => {
    const res = mergeMockEntityData({ accounts: [] });
    expect(res).toEqual({ entityCount: 0, addedCount: 0, updatedCount: 0 });
  });

  it('preserves untouched entity tables', () => {
    loadEntityData({
      accounts: [{ accountid: 'a1', name: 'Acme' }],
      contacts: [{ contactid: 'c1', name: 'Alice' }],
    });
    mergeMockEntityData({ accounts: [{ accountid: 'a2', name: 'Beta' }] });
    expect(getEntityData('contacts')).toEqual([{ contactid: 'c1', name: 'Alice' }]);
    expect(getEntityData('accounts').length).toBe(2);
  });
});

/* -------------------------------------------------------------------------- */
/* mergeKeyedMockEntityData — buffer-shape input                              */
/* -------------------------------------------------------------------------- */

describe('mergeKeyedMockEntityData', () => {
  it('injects the key as the `<entityType>id` field when the record lacks it (Dataverse singular convention)', () => {
    // Real Dataverse table names are singular: `account`, not `accounts`.
    // The code derives idField as `${entityType}id` literally.
    const res = mergeKeyedMockEntityData({
      account: {
        'a1': { name: 'Acme' },
        'a2': { name: 'Beta' },
      },
    });
    expect(res.addedCount).toBe(2);
    const accounts = getEntityData('account');
    expect(accounts.find(r => r.accountid === 'a1')?.name).toBe('Acme');
    expect(accounts.find(r => r.accountid === 'a2')?.name).toBe('Beta');
  });

  it('returns per-entity stats including the resolved idField', () => {
    const res = mergeKeyedMockEntityData({
      account: { 'a1': { name: 'Acme' } },
    });
    expect(res.perEntity.account).toEqual({
      added: 1,
      updated: 0,
      total: 1,
      idField: 'accountid',
    });
  });

  it('updates existing records when keys collide', () => {
    loadEntityData({ account: [{ accountid: 'a1', name: 'Old' }] });
    const res = mergeKeyedMockEntityData({
      account: { 'a1': { name: 'New' } },
    });
    expect(res.addedCount).toBe(0);
    expect(res.updatedCount).toBe(1);
    expect(getEntityData('account')[0].name).toBe('New');
  });

  it('skips entities with no incoming ids', () => {
    const res = mergeKeyedMockEntityData({ account: {} });
    expect(res.entityCount).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* addEntityRecord / updateEntityRecord / deleteEntityRecord                  */
/* -------------------------------------------------------------------------- */

describe('addEntityRecord', () => {
  it('appends a record and auto-assigns an id when missing', () => {
    loadEntityData({ widgets: [{ id: 'w1', name: 'A' }] });
    const added = addEntityRecord('widgets', { name: 'B' });
    expect(added.id).toBeDefined();
    expect(typeof added.id).toBe('string');
    expect(getEntityData('widgets').length).toBe(2);
  });

  it('respects a caller-supplied id rather than overwriting it', () => {
    loadEntityData({ widgets: [{ id: 'w1' }] });
    addEntityRecord('widgets', { id: 'custom', name: 'C' });
    expect(getEntityData('widgets').find(r => r.id === 'custom')?.name).toBe('C');
  });

  it('uses the entity-id convention when the existing table uses it', () => {
    loadEntityData({ accounts: [{ accountid: 'a1', name: 'Acme' }] });
    const added = addEntityRecord('accounts', { name: 'Beta' });
    expect(added.accountid).toBeDefined();
    expect(added.id).toBeUndefined();
  });

  it('creates an entirely new table when the entity is unknown', () => {
    const added = addEntityRecord('newthing', { name: 'X' });
    expect(added.id).toBeDefined();
    expect(getEntityData('newthing').length).toBe(1);
  });
});

describe('updateEntityRecord', () => {
  it('merges the patch into the matched record', () => {
    loadEntityData({ widgets: [{ id: 'w1', name: 'Old', count: 1 }] });
    expect(updateEntityRecord('widgets', 'w1', { name: 'New' })).toBe(true);
    expect(getEntityData('widgets')[0]).toEqual({ id: 'w1', name: 'New', count: 1 });
  });

  it('returns false when the entity table does not exist', () => {
    expect(updateEntityRecord('missing', 'x', { foo: 'bar' })).toBe(false);
  });

  it('returns false when the id is not found', () => {
    loadEntityData({ widgets: [{ id: 'w1' }] });
    expect(updateEntityRecord('widgets', 'nope', { foo: 'bar' })).toBe(false);
  });
});

describe('deleteEntityRecord', () => {
  it('removes the matched record and returns true', () => {
    loadEntityData({ widgets: [{ id: 'w1' }, { id: 'w2' }] });
    expect(deleteEntityRecord('widgets', 'w1')).toBe(true);
    expect(getEntityData('widgets')).toEqual([{ id: 'w2' }]);
  });

  it('returns false when the entity table does not exist', () => {
    expect(deleteEntityRecord('missing', 'x')).toBe(false);
  });

  it('returns false when the id is not found (and leaves the list unchanged)', () => {
    loadEntityData({ widgets: [{ id: 'w1' }] });
    expect(deleteEntityRecord('widgets', 'nope')).toBe(false);
    expect(getEntityData('widgets').length).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* subscribeData                                                              */
/* -------------------------------------------------------------------------- */

describe('subscribeData', () => {
  it('notifies subscribers on data mutations', () => {
    let notifyCount = 0;
    const unsub = subscribeData(() => { notifyCount++; });
    loadEntityData({ widgets: [{ id: 'w1' }] });
    addEntityRecord('widgets', { id: 'w2' });
    expect(notifyCount).toBeGreaterThanOrEqual(2);
    unsub();
  });

  it('returns an unsubscribe function that stops further notifications', () => {
    let notifyCount = 0;
    const unsub = subscribeData(() => { notifyCount++; });
    loadEntityData({ widgets: [] });
    const before = notifyCount;
    unsub();
    loadEntityData({ widgets: [{ id: 'w1' }] });
    expect(notifyCount).toBe(before);
  });
});
