import { describe, it, expect } from 'vitest';
import { filterByParentFk } from './context-factory';

const PARENT = '11111111-1111-1111-1111-111111111111';
const OTHER  = '22222222-2222-2222-2222-222222222222';

describe('filterByParentFk', () => {
  it('matches against bare FK column name', () => {
    const rows = [
      { id: 'a', msdyn_workorder: PARENT },
      { id: 'b', msdyn_workorder: OTHER },
    ];
    const out = filterByParentFk(rows, 'msdyn_workorder', PARENT);
    expect(out.map(r => r.id)).toEqual(['a']);
  });

  it('matches OData _<col>_value lookup shape', () => {
    const rows = [
      { id: 'a', _msdyn_workorder_value: PARENT },
      { id: 'b', _msdyn_workorder_value: OTHER },
    ];
    const out = filterByParentFk(rows, 'msdyn_workorder', PARENT);
    expect(out.map(r => r.id)).toEqual(['a']);
  });

  it('matches <col>id shape used by some seed files', () => {
    const rows = [
      { id: 'a', msdyn_workorderid: PARENT },
      { id: 'b', msdyn_workorderid: OTHER },
    ];
    const out = filterByParentFk(rows, 'msdyn_workorder', PARENT);
    expect(out.map(r => r.id)).toEqual(['a']);
  });

  it('matches case-insensitively and strips braces from both sides', () => {
    const rows = [
      { id: 'a', msdyn_workorder: `{${PARENT.toUpperCase()}}` },
      { id: 'b', msdyn_workorder: OTHER },
    ];
    const out = filterByParentFk(rows, 'msdyn_workorder', `{${PARENT}}`);
    expect(out.map(r => r.id)).toEqual(['a']);
  });

  it('returns empty when no rows match', () => {
    const rows = [
      { id: 'a', msdyn_workorder: OTHER },
      { id: 'b', msdyn_workorder: OTHER },
    ];
    const out = filterByParentFk(rows, 'msdyn_workorder', PARENT);
    expect(out).toEqual([]);
  });

  it('returns input unchanged when parentEntityId is empty (no filter)', () => {
    const rows = [{ id: 'a' }, { id: 'b' }];
    expect(filterByParentFk(rows, 'msdyn_workorder', '')).toEqual(rows);
  });

  it('does not match rows missing the FK column', () => {
    const rows = [{ id: 'a' }, { id: 'b', msdyn_workorder: PARENT }];
    const out = filterByParentFk(rows, 'msdyn_workorder', PARENT);
    expect(out.map(r => r.id)).toEqual(['b']);
  });
});
