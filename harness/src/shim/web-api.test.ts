// M11.M4 — Unit tests for the OData parser surface of harness/src/shim/web-api.ts
//
// Tests cover the three exported pure helpers — parseFilter, parseSelect,
// applySelect — across every operator + edge case noted in DESIGN.md §3.
// Silent OData regressions are the highest-cost bug class in this file
// (controls render but return the wrong data), so each operator gets at
// least one positive + one boundary test.
//
// The full CRUD path (createRecord / retrieveMultipleRecords / etc.) is
// store-coupled and queued as describe.todo per the M2 pattern.

import { parseFilter, parseSelect, applySelect } from './web-api';

/** Drive a parser-returned predicate against a fixture row, returns boolean. */
const matches = (filter: string | undefined, row: Record<string, any>) =>
  parseFilter(filter)(row);

const ALICE = { id: '1', name: 'Alice', age: 30, role: 'admin', email: 'alice@acme.com', notes: '', active: true };
const BOB   = { id: '2', name: 'Bob',   age: 25, role: 'user',  email: 'bob@acme.com',   notes: null, active: false };
const CARL  = { id: '3', name: 'Carl',  age: 40, role: 'user',  email: 'carl@beta.com',  notes: 'VIP', active: true };

/* -------------------------------------------------------------------------- */
/* parseFilter — undefined / empty                                            */
/* -------------------------------------------------------------------------- */

describe('parseFilter — empty / undefined input', () => {
  it('returns match-all predicate when filter is undefined', () => {
    expect(parseFilter(undefined)(ALICE)).toBe(true);
    expect(parseFilter(undefined)({})).toBe(true);
  });

  it('returns match-all predicate when filter is empty string', () => {
    expect(parseFilter('')(ALICE)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* eq                                                                         */
/* -------------------------------------------------------------------------- */

describe('parseFilter — eq', () => {
  it('matches a quoted string value', () => {
    expect(matches(`name eq 'Alice'`, ALICE)).toBe(true);
    expect(matches(`name eq 'Alice'`, BOB)).toBe(false);
  });

  it('matches an unquoted numeric value (compared as string)', () => {
    expect(matches(`age eq 30`, ALICE)).toBe(true);
    expect(matches(`age eq 30`, BOB)).toBe(false);
  });

  it('matches an unquoted GUID value', () => {
    const row = { id: 'abc-123-def' };
    expect(matches(`id eq abc-123-def`, row)).toBe(true);
  });

  it('returns false when the field is missing on the row', () => {
    expect(matches(`missing eq 'foo'`, ALICE)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* ne                                                                         */
/* -------------------------------------------------------------------------- */

describe('parseFilter — ne', () => {
  it('matches when the value does not equal', () => {
    expect(matches(`name ne 'Alice'`, BOB)).toBe(true);
    expect(matches(`name ne 'Alice'`, ALICE)).toBe(false);
  });

  it('matches against unquoted numeric values', () => {
    expect(matches(`age ne 30`, BOB)).toBe(true);
    expect(matches(`age ne 30`, ALICE)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* null literals                                                              */
/* -------------------------------------------------------------------------- */

describe('parseFilter — null literals', () => {
  it('`eq null` matches null, empty string, and literal "null" string', () => {
    expect(matches(`notes eq null`, BOB)).toBe(true);   // notes: null
    expect(matches(`notes eq null`, ALICE)).toBe(true); // notes: '' (empty)
    expect(matches(`notes eq null`, { notes: 'null' })).toBe(true); // literal 'null'
    expect(matches(`notes eq null`, CARL)).toBe(false); // notes: 'VIP'
  });

  it('`ne null` is the precise inverse of `eq null`', () => {
    expect(matches(`notes ne null`, BOB)).toBe(false);
    expect(matches(`notes ne null`, ALICE)).toBe(false);
    expect(matches(`notes ne null`, CARL)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Comparison operators (gt / ge / lt / le)                                   */
/* -------------------------------------------------------------------------- */

describe('parseFilter — comparison operators on numbers', () => {
  it('gt: strictly greater than', () => {
    expect(matches(`age gt 30`, CARL)).toBe(true);
    expect(matches(`age gt 30`, ALICE)).toBe(false); // 30 is NOT > 30
    expect(matches(`age gt 30`, BOB)).toBe(false);
  });

  it('ge: greater than or equal', () => {
    expect(matches(`age ge 30`, ALICE)).toBe(true);
    expect(matches(`age ge 30`, CARL)).toBe(true);
    expect(matches(`age ge 30`, BOB)).toBe(false);
  });

  it('lt: strictly less than', () => {
    expect(matches(`age lt 30`, BOB)).toBe(true);
    expect(matches(`age lt 30`, ALICE)).toBe(false);
  });

  it('le: less than or equal', () => {
    expect(matches(`age le 30`, ALICE)).toBe(true);
    expect(matches(`age le 30`, BOB)).toBe(true);
    expect(matches(`age le 30`, CARL)).toBe(false);
  });

  it('returns false for any comparison when field is null', () => {
    const row = { age: null };
    expect(matches(`age gt 10`, row)).toBe(false);
    expect(matches(`age lt 10`, row)).toBe(false);
    expect(matches(`age ge 10`, row)).toBe(false);
    expect(matches(`age le 10`, row)).toBe(false);
  });
});

describe('parseFilter — comparison operators on dates', () => {
  const events = [
    { id: 'past',   when: '2026-01-01' },
    { id: 'today',  when: '2026-06-17' },
    { id: 'future', when: '2026-12-31' },
  ];

  it('gt with ISO date strings', () => {
    expect(matches(`when gt '2026-06-01'`, events[0])).toBe(false); // 2026-01 not > 2026-06
    expect(matches(`when gt '2026-06-01'`, events[1])).toBe(true);
    expect(matches(`when gt '2026-06-01'`, events[2])).toBe(true);
  });

  it('le with ISO date strings', () => {
    expect(matches(`when le '2026-06-17'`, events[0])).toBe(true);
    expect(matches(`when le '2026-06-17'`, events[1])).toBe(true);
    expect(matches(`when le '2026-06-17'`, events[2])).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Function-style operators: contains / startswith / endswith                 */
/* -------------------------------------------------------------------------- */

describe('parseFilter — contains', () => {
  it('matches case-insensitively on substring', () => {
    expect(matches(`contains(name,'ali')`, ALICE)).toBe(true);
    expect(matches(`contains(name,'ALI')`, ALICE)).toBe(true);
    expect(matches(`contains(name,'xyz')`, ALICE)).toBe(false);
  });

  it('handles null field gracefully (treats as empty string)', () => {
    expect(matches(`contains(notes,'foo')`, BOB)).toBe(false); // notes: null
  });

  it('matches empty-string argument against any row (vacuously true on substring)', () => {
    expect(matches(`contains(name,'')`, ALICE)).toBe(true);
  });
});

describe('parseFilter — startswith', () => {
  it('case-insensitive prefix match', () => {
    expect(matches(`startswith(name,'Al')`, ALICE)).toBe(true);
    expect(matches(`startswith(name,'AL')`, ALICE)).toBe(true);
    expect(matches(`startswith(name,'lice')`, ALICE)).toBe(false);
  });
});

describe('parseFilter — endswith', () => {
  it('case-insensitive suffix match', () => {
    expect(matches(`endswith(email,'@acme.com')`, ALICE)).toBe(true);
    expect(matches(`endswith(email,'@beta.com')`, ALICE)).toBe(false);
    expect(matches(`endswith(email,'@ACME.COM')`, BOB)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Boolean composition: and / or                                              */
/* -------------------------------------------------------------------------- */

describe('parseFilter — and (top-level)', () => {
  it('all clauses must match', () => {
    expect(matches(`role eq 'user' and active eq true`, BOB)).toBe(false);  // BOB active=false
    expect(matches(`role eq 'user' and active eq true`, CARL)).toBe(true);  // CARL user + active
    expect(matches(`role eq 'user' and active eq true`, ALICE)).toBe(false); // ALICE admin
  });
});

describe('parseFilter — or (within an AND group)', () => {
  it('any clause matches', () => {
    expect(matches(`role eq 'admin' or role eq 'user'`, ALICE)).toBe(true);
    expect(matches(`role eq 'admin' or role eq 'user'`, BOB)).toBe(true);
    expect(matches(`role eq 'guest' or role eq 'admin'`, BOB)).toBe(false);
  });
});

describe('parseFilter — and/or precedence', () => {
  it('treats `a and b or c` as `(a and b) or c` — OR groups split inside each AND group', () => {
    // Implementation: split top-level on ` and ` first, then split each AND-group on ` or `.
    // That means `name eq 'Alice' and role eq 'admin' or role eq 'user'` becomes:
    //   AND group 1: `name eq 'Alice'`
    //   AND group 2: `role eq 'admin' or role eq 'user'`
    // Both must hold → effectively `name eq 'Alice' AND (role eq 'admin' OR role eq 'user')`.
    // For ALICE (admin) and BOB (user) the second OR group passes; only ALICE passes the first.
    const f = `name eq 'Alice' and role eq 'admin' or role eq 'user'`;
    expect(matches(f, ALICE)).toBe(true);  // Alice + admin matches AND-group-2 via 'admin'
    expect(matches(f, BOB)).toBe(false);   // Bob fails AND-group-1 (name!=Alice)
    expect(matches(f, CARL)).toBe(false);  // Carl fails AND-group-1
  });
});

/* -------------------------------------------------------------------------- */
/* parseSelect                                                                */
/* -------------------------------------------------------------------------- */

describe('parseSelect', () => {
  it('returns null when select is undefined', () => {
    expect(parseSelect(undefined)).toBeNull();
  });

  it('returns null when select is empty string', () => {
    expect(parseSelect('')).toBeNull();
  });

  it('splits a single column into a one-element array', () => {
    expect(parseSelect('name')).toEqual(['name']);
  });

  it('splits multiple columns on comma and trims whitespace', () => {
    expect(parseSelect('id, name ,  age')).toEqual(['id', 'name', 'age']);
  });
});

/* -------------------------------------------------------------------------- */
/* applySelect                                                                */
/* -------------------------------------------------------------------------- */

describe('applySelect', () => {
  it('returns a clone of the entity when columns is null (no projection)', () => {
    const result = applySelect(ALICE, null);
    expect(result).toEqual(ALICE);
    expect(result).not.toBe(ALICE); // must be a copy, not the same reference
  });

  it('projects only the requested columns', () => {
    const result = applySelect(ALICE, ['name', 'age']);
    expect(result).toEqual({ name: 'Alice', age: 30 });
  });

  it('skips columns that do not exist on the entity', () => {
    const result = applySelect(ALICE, ['name', 'nonexistent']);
    expect(result).toEqual({ name: 'Alice' });
  });

  it('preserves OData formatted-value annotations for selected columns', () => {
    const entity = {
      id: '1',
      role: 'admin',
      'role@OData.Community.Display.V1.FormattedValue': 'Administrator',
      other: 'untouched',
      'other@OData.Community.Display.V1.FormattedValue': 'Other',
    };
    const result = applySelect(entity, ['role']);
    expect(result).toEqual({
      role: 'admin',
      'role@OData.Community.Display.V1.FormattedValue': 'Administrator',
    });
  });

  it('preserves lookup _<col>_value annotations when the base column is selected', () => {
    const entity = {
      id: '1',
      ownerid: '_owner_value',
      '_ownerid_value@OData.Community.Display.V1.FormattedValue': 'Alice',
    };
    const result = applySelect(entity, ['ownerid']);
    expect(result['_ownerid_value@OData.Community.Display.V1.FormattedValue']).toBe('Alice');
  });

  it('returns empty object when no requested columns match', () => {
    const result = applySelect(ALICE, ['no', 'such', 'cols']);
    expect(result).toEqual({});
  });
});

/* -------------------------------------------------------------------------- */
/* Store-coupled CRUD surface — queued for a future pass                      */
/* -------------------------------------------------------------------------- */

describe.todo('createRecord (store-coupled: writes to in-memory entity store)');
describe.todo('updateRecord (store-coupled: mutates entity by id)');
describe.todo('deleteRecord (store-coupled: removes entity by id)');
describe.todo('retrieveRecord (store-coupled: reads entity by id + applies $select)');
describe.todo('retrieveMultipleRecords (store-coupled: applies $filter + $orderby + $top + paging)');
describe.todo('network conditioning delay (store-coupled: reads networkMode + customLatencyMs)');
describe.todo('online/offline routing (auto vs explicit .online vs .offline branches)');
