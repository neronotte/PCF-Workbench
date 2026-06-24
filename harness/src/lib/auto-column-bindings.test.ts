import { describe, it, expect } from 'vitest';
import { deriveColumnBindings } from './auto-column-bindings';
import type { ManifestProperty } from '../types/manifest';

function col(name: string, ofType = 'SingleLine.Text'): ManifestProperty {
  return {
    name,
    displayNameKey: '',
    descriptionKey: '',
    ofType,
    usage: 'bound',
    required: false,
  };
}

describe('deriveColumnBindings', () => {
  it('matches "Product" property-set to msdyn_product as lookup _value', () => {
    const result = deriveColumnBindings(
      [col('Product', 'Lookup.Simple')],
      [{ name: 'msdyn_product' }, { name: 'msdyn_name' }],
    );
    expect(result.bindings.Product).toEqual({ field: '_msdyn_product_value' });
    expect(result.matched).toContain('Product');
  });

  it('matches plain string property-set to schema column without underscore-value wrap', () => {
    const result = deriveColumnBindings(
      [col('Name', 'SingleLine.Text')],
      [{ name: 'msdyn_name' }],
    );
    expect(result.bindings.Name).toEqual({ field: 'msdyn_name' });
  });

  it('matches OptionSet property-set', () => {
    const result = deriveColumnBindings(
      [col('LineStatus', 'OptionSet')],
      [{ name: 'msdyn_linestatus' }],
    );
    expect(result.bindings.LineStatus).toEqual({ field: 'msdyn_linestatus' });
  });

  it('reports unmatched property-sets', () => {
    const result = deriveColumnBindings(
      [col('Foo')],
      [{ name: 'msdyn_product' }],
    );
    expect(result.unmatched).toContain('Foo');
    expect(result.bindings.Foo).toBeUndefined();
  });

  it('preserves existing user-set bindings', () => {
    const result = deriveColumnBindings(
      [col('Product', 'Lookup.Simple')],
      [{ name: 'msdyn_product' }],
      { Product: { field: 'my_custom_field' } },
    );
    expect(result.bindings.Product).toEqual({ field: 'my_custom_field' });
  });

  it('handles common publisher prefixes (new_, cr123_)', () => {
    const result = deriveColumnBindings(
      [col('Region')],
      [{ name: 'new_region' }, { name: 'cr123_other' }],
    );
    expect(result.bindings.Region).toEqual({ field: 'new_region' });
  });

  it('does not wrap pre-underscored lookup fields again', () => {
    const result = deriveColumnBindings(
      [col('Unit', 'Lookup.Simple')],
      [{ name: '_msdyn_unit_value' }],
    );
    // The view column is already in _xxx_value shape — pass through.
    expect(result.bindings.Unit).toEqual({ field: '_msdyn_unit_value' });
  });
});
