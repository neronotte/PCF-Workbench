import { describe, it, expect } from 'vitest';
import {
  synthesizeDefaultView,
  synthesizeDefaultBinding,
  isResolvedView,
  ensureViewsLibrary,
  generateViewId,
  type DatasetBinding,
  type ViewSelector,
  type ViewDefinition,
} from './dataset-binding';

describe('synthesizeDefaultView', () => {
  it('produces a system view with every column visible in manifest order', () => {
    const v = synthesizeDefaultView('grid', 'msdyn_workorderproduct', ['name', 'qty', 'product']);
    expect(v).toEqual({
      viewId: 'synthesized-grid',
      displayName: 'All columns (default)',
      entityType: 'msdyn_workorderproduct',
      viewType: 'system',
      columns: [{ name: 'name' }, { name: 'qty' }, { name: 'product' }],
    });
  });

  it('handles empty column list (homegrid with no manifest property-set)', () => {
    const v = synthesizeDefaultView('empty', 'account', []);
    expect(v.columns).toEqual([]);
    expect(v.viewType).toBe('system');
  });
});

describe('synthesizeDefaultBinding', () => {
  it('defaults to homegrid host (no parent FK filter)', () => {
    const b = synthesizeDefaultBinding('grid', 'account', ['name']);
    expect(b.host).toBe('homegrid');
    expect(b.parentRecordRef).toBeUndefined();
    expect(b.lookupColumn).toBeUndefined();
    expect(b.relationshipName).toBeUndefined();
  });

  it('embeds a synthesised view rather than a selector', () => {
    const b = synthesizeDefaultBinding('grid', 'account', ['name', 'createdon']);
    expect(isResolvedView(b.view)).toBe(true);
    const v = b.view as ViewDefinition;
    expect(v.columns.map(c => c.name)).toEqual(['name', 'createdon']);
  });
});

describe('isResolvedView', () => {
  it('returns true for a ViewDefinition (has columns + entityType)', () => {
    const v: ViewDefinition = {
      viewId: 'v1',
      displayName: 'Active',
      entityType: 'account',
      viewType: 'system',
      columns: [{ name: 'name' }],
    };
    expect(isResolvedView(v)).toBe(true);
  });

  it('returns false for a ViewSelector (viewId only)', () => {
    const s: ViewSelector = { viewId: 'savedquery:00000000-0000-0000-0000-000000000001' };
    expect(isResolvedView(s)).toBe(false);
  });

  it('returns false for a fetchxml-only selector', () => {
    const s: ViewSelector = { viewFetchXml: '<fetch />' };
    expect(isResolvedView(s)).toBe(false);
  });
});

describe('DatasetBinding shape', () => {
  it('accepts a subgrid binding with parent ref + lookup column', () => {
    const b: DatasetBinding = {
      host: 'subgrid',
      lookupColumn: 'msdyn_workorder',
      parentRecordRef: {
        entityType: 'msdyn_workorder',
        entityId: '11111111-1111-1111-1111-111111111111',
        recordName: 'WO-001',
      },
      view: synthesizeDefaultView('grid', 'msdyn_workorderproduct', ['name', 'qty']),
    };
    expect(b.host).toBe('subgrid');
    expect(b.parentRecordRef?.entityId).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('accepts an associated binding with relationship name', () => {
    const b: DatasetBinding = {
      host: 'associated',
      relationshipName: 'account_contact_n_n',
      parentRecordRef: { entityType: 'account', entityId: 'a' },
      view: { viewId: 'savedquery:abc' },
    };
    expect(b.relationshipName).toBe('account_contact_n_n');
    expect(isResolvedView(b.view)).toBe(false);
  });
});

describe('ensureViewsLibrary', () => {
  it('seeds views: [view] when missing and view is resolved', () => {
    const view = synthesizeDefaultView('grid', 'account', ['name']);
    const b: DatasetBinding = { host: 'homegrid', view };
    const next = ensureViewsLibrary(b);
    expect(next.views).toEqual([view]);
  });

  it('returns the binding untouched when views already populated', () => {
    const v1 = synthesizeDefaultView('grid', 'account', ['name']);
    const v2 = { ...v1, viewId: 'v2', displayName: 'V2' };
    const b: DatasetBinding = { host: 'homegrid', view: v1, views: [v1, v2] };
    expect(ensureViewsLibrary(b)).toBe(b);
  });

  it('leaves selector-only bindings alone (P5 will hydrate)', () => {
    const sel: ViewSelector = { viewId: 'savedquery:abc' };
    const b: DatasetBinding = { host: 'homegrid', view: sel };
    const next = ensureViewsLibrary(b);
    expect(next.views).toBeUndefined();
  });
});

describe('generateViewId', () => {
  it('includes the dataset name and a unique tail', () => {
    const a = generateViewId('grid');
    const b = generateViewId('grid');
    expect(a).toMatch(/^view-grid-\d+-[a-z0-9]+$/);
    expect(a).not.toBe(b);
  });
});

describe('synthesizeDefaultBinding (multi-view)', () => {
  it('seeds views: [view] so the picker always has at least one entry', () => {
    const b = synthesizeDefaultBinding('grid', 'account', ['name']);
    expect(b.views).toHaveLength(1);
    expect(b.views?.[0]).toEqual(b.view);
  });
});
