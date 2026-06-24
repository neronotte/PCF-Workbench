import { describe, it, expect } from 'vitest';
import { filterByParentFk, buildDatasetColumns, resolveViewForBinding } from './context-factory';
import type { ManifestDataSet } from '../types/manifest';
import type { DatasetBinding, ViewDefinition } from '../types/dataset-binding';
import { __clearLiveViewsCache } from '../api/dv-client';

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

describe('buildDatasetColumns — columnBindings', () => {
  const lcid = () => 1033;
  const typeGroups: Record<string, string[]> = {
    configColumnTypes: ['SingleLine.Text', 'Currency', 'OptionSet', 'Decimal'],
  };
  const ds: ManifestDataSet = {
    name: 'productDataSet',
    displayNameKey: undefined,
    columns: [
      { name: 'Name', usage: 'bound', ofType: 'SingleLine.Text', required: false },
      { name: 'ConfigColumn1', usage: 'bound', ofType: '', ofTypeGroup: 'configColumnTypes', required: false },
    ] as any,
  } as any;

  it('falls back to first type in group + name as alias when no binding given', () => {
    const cols = buildDatasetColumns(ds, 'productDataSet', () => [], typeGroups, lcid);
    const cfg = cols.find((c: any) => c.name === 'ConfigColumn1')!;
    expect(cfg.alias).toBe('ConfigColumn1');
    expect(cfg.dataType).toBe('SingleLine.Text');
  });

  it('honours bound ofType from columnBindings for of-type-group columns', () => {
    const cols = buildDatasetColumns(ds, 'productDataSet', () => [], typeGroups, lcid, undefined, {
      ConfigColumn1: { field: 'estimateunitamount', ofType: 'Currency' },
    });
    const cfg = cols.find((c: any) => c.name === 'ConfigColumn1')!;
    expect(cfg.dataType).toBe('Currency');
    expect(cfg.alias).toBe('estimateunitamount');
  });

  it('ignores invalid ofType not in the group and falls back to default', () => {
    const cols = buildDatasetColumns(ds, 'productDataSet', () => [], typeGroups, lcid, undefined, {
      ConfigColumn1: { field: 'foo', ofType: 'NotAType' },
    });
    const cfg = cols.find((c: any) => c.name === 'ConfigColumn1')!;
    expect(cfg.dataType).toBe('SingleLine.Text');
    expect(cfg.alias).toBe('foo');
  });

  it('does not change ofType for non-type-group columns even when a binding sets one', () => {
    const cols = buildDatasetColumns(ds, 'productDataSet', () => [], typeGroups, lcid, undefined, {
      Name: { field: 'product_name', ofType: 'Currency' },
    });
    const nameCol = cols.find((c: any) => c.name === 'Name')!;
    expect(nameCol.dataType).toBe('SingleLine.Text');
    expect(nameCol.alias).toBe('product_name');
  });
});

describe('resolveViewForBinding (P5.2)', () => {
  const ds: ManifestDataSet = {
    name: 'productGrid',
    columns: [{ name: 'Name' }, { name: 'Price' }],
  } as unknown as ManifestDataSet;

  const SIMPLE_FETCH = `<fetch><entity name="account">
    <attribute name="name" />
    <attribute name="revenue" />
    <order attribute="name" descending="true" />
  </entity></fetch>`;

  function makeView(viewId: string, displayName: string, entityType = 'product'): ViewDefinition {
    return {
      viewId,
      displayName,
      entityType,
      viewType: 'system',
      columns: [{ name: 'Name' }],
    };
  }

  it('returns a synthesised default when no binding is set', () => {
    const view = resolveViewForBinding(ds, undefined, 'product');
    expect(view.viewId).toBe('synthesized-productGrid');
    expect(view.entityType).toBe('product');
    expect(view.columns.map(c => c.name)).toEqual(['Name', 'Price']);
  });

  it('returns the inline ViewDefinition when binding.view is already resolved', () => {
    const resolved = makeView('savedquery:abc', 'My View', 'product');
    const binding: DatasetBinding = { host: 'homegrid', view: resolved };
    expect(resolveViewForBinding(ds, binding, 'product')).toBe(resolved);
  });

  it('parses inline viewFetchXml into an ad-hoc view', () => {
    const binding: DatasetBinding = {
      host: 'homegrid',
      view: { viewFetchXml: SIMPLE_FETCH },
    };
    const view = resolveViewForBinding(ds, binding, 'product');
    expect(view.entityType).toBe('account');
    expect(view.columns.map(c => c.name)).toEqual(['name', 'revenue']);
    expect(view.columns[0].sortDirection).toBe('desc');
    expect(view.fetchXml).toBe(SIMPLE_FETCH);
    expect(view.viewId).toBe('inline-productGrid');
  });

  it('resolves selector viewId against binding.views library before anything else', () => {
    const libView = makeView('savedquery:lib-1', 'From library');
    const binding: DatasetBinding = {
      host: 'homegrid',
      view: { viewId: 'savedquery:lib-1' },
      views: [libView, makeView('savedquery:lib-2', 'Other')],
    };
    expect(resolveViewForBinding(ds, binding, 'product')).toBe(libView);
  });

  it('falls back to synthesised view when selector viewId matches nothing', () => {
    __clearLiveViewsCache();
    const binding: DatasetBinding = {
      host: 'homegrid',
      view: { viewId: 'savedquery:missing' },
    };
    const view = resolveViewForBinding(ds, binding, 'product');
    expect(view.viewId).toBe('synthesized-productGrid');
  });

  it('prefers library hit over fallback even when live cache is empty', () => {
    __clearLiveViewsCache();
    const libView = makeView('userquery:p1', 'Personal pick');
    const binding: DatasetBinding = {
      host: 'homegrid',
      view: { viewId: 'userquery:p1' },
      views: [libView],
    };
    expect(resolveViewForBinding(ds, binding, 'product').viewId).toBe('userquery:p1');
  });
});

