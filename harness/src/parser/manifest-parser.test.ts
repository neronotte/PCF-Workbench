// M11.M3 — Unit tests for harness/src/parser/manifest-parser.ts
//
// The parser is a pure function — no store coupling — so every branch is
// directly testable. Tests cover the manifest surface PCF controls actually
// emit (single/multiple children, fallbacks, enum values, the H5 <img>
// regression that shipped without a test), plus malformed-input behaviour.

import { parseManifest } from './manifest-parser';

/* -------------------------------------------------------------------------- */
/* Test fixture helpers                                                       */
/* -------------------------------------------------------------------------- */

/** Wrap inner XML in the standard manifest shell. */
const xml = (inner: string, controlAttrs = `namespace="Acme" constructor="MyControl" version="1.0.0"`) => `
<?xml version="1.0" encoding="utf-8" ?>
<manifest>
  <control ${controlAttrs}>
    ${inner}
  </control>
</manifest>`;

/** Bare-minimum manifest (no children) — for top-level attribute tests. */
const empty = (controlAttrs?: string) => xml('', controlAttrs);

/* -------------------------------------------------------------------------- */
/* Top-level control attributes                                               */
/* -------------------------------------------------------------------------- */

describe('parseManifest — control element attributes', () => {
  it('parses namespace + constructor + version', () => {
    const m = parseManifest(empty('namespace="Acme" constructor="StarRating" version="1.0.0"'));
    expect(m.namespace).toBe('Acme');
    expect(m.constructor).toBe('StarRating');
    expect(m.version).toBe('1.0.0');
  });

  it('defaults controlType to "standard" when @control-type is omitted', () => {
    const m = parseManifest(empty());
    expect(m.controlType).toBe('standard');
  });

  it('parses controlType="virtual" verbatim', () => {
    const m = parseManifest(empty(
      'namespace="A" constructor="B" version="1.0.0" control-type="virtual"',
    ));
    expect(m.controlType).toBe('virtual');
  });

  it('falls back displayNameKey to the constructor name when @display-name-key is missing', () => {
    const m = parseManifest(empty('namespace="A" constructor="MyKeylessControl" version="1.0.0"'));
    expect(m.displayNameKey).toBe('MyKeylessControl');
  });

  it('uses explicit @display-name-key when provided', () => {
    const m = parseManifest(empty(
      'namespace="A" constructor="B" version="1.0.0" display-name-key="My_Pretty_Name"',
    ));
    expect(m.displayNameKey).toBe('My_Pretty_Name');
  });

  it('defaults descriptionKey to empty string when omitted', () => {
    const m = parseManifest(empty());
    expect(m.descriptionKey).toBe('');
  });
});

/* -------------------------------------------------------------------------- */
/* <property>                                                                 */
/* -------------------------------------------------------------------------- */

describe('parseManifest — properties', () => {
  it('parses a single property (fast-xml-parser would normally return a single object — isArray forces an array)', () => {
    const m = parseManifest(xml(`<property name="value" of-type="SingleLine.Text" usage="bound" required="true" />`));
    expect(m.properties).toHaveLength(1);
    expect(m.properties[0]).toMatchObject({
      name: 'value',
      ofType: 'SingleLine.Text',
      usage: 'bound',
      required: true,
    });
  });

  it('parses multiple properties as an array', () => {
    const m = parseManifest(xml(`
      <property name="title" of-type="SingleLine.Text" usage="bound" required="true" />
      <property name="subtitle" of-type="SingleLine.Text" usage="input" required="false" />
      <property name="rating" of-type="Whole.None" usage="bound" required="true" />
    `));
    expect(m.properties.map(p => p.name)).toEqual(['title', 'subtitle', 'rating']);
    expect(m.properties.map(p => p.usage)).toEqual(['bound', 'input', 'bound']);
    expect(m.properties.map(p => p.required)).toEqual([true, false, true]);
  });

  it('defaults missing usage to "bound" and missing of-type to "Property"', () => {
    const m = parseManifest(xml(`<property name="loose" />`));
    expect(m.properties[0].usage).toBe('bound');
    expect(m.properties[0].ofType).toBe('Property');
  });

  it('treats required="false" and missing required attribute as false (only "true" string counts as true)', () => {
    const m = parseManifest(xml(`
      <property name="explicitlyFalse" of-type="SingleLine.Text" usage="bound" required="false" />
      <property name="omittedRequired" of-type="SingleLine.Text" usage="bound" />
    `));
    expect(m.properties.map(p => p.required)).toEqual([false, false]);
  });

  it('parses default-value attribute', () => {
    const m = parseManifest(xml(`
      <property name="rating" of-type="Whole.None" usage="bound" default-value="3" />
    `));
    expect(m.properties[0].defaultValue).toBe('3');
  });

  it('parses of-type-group reference', () => {
    const m = parseManifest(xml(`
      <type-group name="numbers"><type>Whole.None</type><type>Decimal</type></type-group>
      <property name="value" of-type-group="numbers" usage="bound" required="true" />
    `));
    expect(m.properties[0].ofTypeGroup).toBe('numbers');
  });

  it('falls back display-name-key + description-key sensibly (display→name, description→empty)', () => {
    const m = parseManifest(xml(`<property name="value" of-type="SingleLine.Text" usage="bound" />`));
    expect(m.properties[0].displayNameKey).toBe('value');
    expect(m.properties[0].descriptionKey).toBe('');
  });
});

/* -------------------------------------------------------------------------- */
/* <property> enum values                                                     */
/* -------------------------------------------------------------------------- */

describe('parseManifest — enum values', () => {
  it('parses <value> children into enumValues with display-name-key fallback', () => {
    const m = parseManifest(xml(`
      <property name="status" of-type="Enum" usage="bound">
        <value name="active" display-name-key="Active">1</value>
        <value name="archived">0</value>
      </property>
    `));
    expect(m.properties[0].enumValues).toEqual([
      { name: 'active', displayNameKey: 'Active', value: '1' },
      { name: 'archived', displayNameKey: 'archived', value: '0' },
    ]);
  });

  it('leaves enumValues undefined when property has no <value> children', () => {
    const m = parseManifest(xml(`<property name="text" of-type="SingleLine.Text" usage="bound" />`));
    expect(m.properties[0].enumValues).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* <type-group>                                                               */
/* -------------------------------------------------------------------------- */

describe('parseManifest — type groups', () => {
  it('parses a single type-group with multiple <type> children', () => {
    const m = parseManifest(xml(`
      <type-group name="numbers">
        <type>Whole.None</type>
        <type>Currency</type>
        <type>FP</type>
        <type>Decimal</type>
      </type-group>
    `));
    expect(m.typeGroups.numbers).toEqual(['Whole.None', 'Currency', 'FP', 'Decimal']);
  });

  it('parses multiple type-groups into a map keyed by name', () => {
    const m = parseManifest(xml(`
      <type-group name="numbers"><type>Whole.None</type></type-group>
      <type-group name="dates"><type>DateAndTime.DateOnly</type><type>DateAndTime.DateAndTime</type></type-group>
    `));
    expect(Object.keys(m.typeGroups).sort()).toEqual(['dates', 'numbers']);
    expect(m.typeGroups.dates).toEqual(['DateAndTime.DateOnly', 'DateAndTime.DateAndTime']);
  });

  it('drops type-groups with no <type> children', () => {
    const m = parseManifest(xml(`<type-group name="empty"></type-group>`));
    expect(m.typeGroups.empty).toBeUndefined();
  });

  it('returns empty typeGroups object when none declared', () => {
    const m = parseManifest(empty());
    expect(m.typeGroups).toEqual({});
  });
});

/* -------------------------------------------------------------------------- */
/* <feature-usage>                                                            */
/* -------------------------------------------------------------------------- */

describe('parseManifest — feature usage', () => {
  it('parses a single uses-feature with required="true"', () => {
    const m = parseManifest(xml(`
      <feature-usage>
        <uses-feature name="WebAPI" required="true" />
      </feature-usage>
    `));
    expect(m.featureUsage).toEqual([{ name: 'WebAPI', required: true }]);
  });

  it('parses multiple uses-feature elements', () => {
    const m = parseManifest(xml(`
      <feature-usage>
        <uses-feature name="WebAPI" required="true" />
        <uses-feature name="Utility" required="true" />
        <uses-feature name="Device.captureImage" required="false" />
      </feature-usage>
    `));
    expect(m.featureUsage.map(f => f.name)).toEqual(['WebAPI', 'Utility', 'Device.captureImage']);
    expect(m.featureUsage.map(f => f.required)).toEqual([true, true, false]);
  });

  it('returns empty featureUsage array when block is absent', () => {
    const m = parseManifest(empty());
    expect(m.featureUsage).toEqual([]);
  });

  it('returns empty featureUsage array when block is present but empty', () => {
    const m = parseManifest(xml(`<feature-usage></feature-usage>`));
    expect(m.featureUsage).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* <resources>                                                                */
/* -------------------------------------------------------------------------- */

describe('parseManifest — resources.code', () => {
  it('parses a single <code> entry', () => {
    const m = parseManifest(xml(`
      <resources><code path="index.ts" order="1" /></resources>
    `));
    expect(m.resources.code).toEqual([{ path: 'index.ts', order: 1 }]);
  });

  it('parses multiple <code> entries and preserves the declared order attribute', () => {
    const m = parseManifest(xml(`
      <resources>
        <code path="b.ts" order="2" />
        <code path="a.ts" order="1" />
      </resources>
    `));
    expect(m.resources.code).toEqual([
      { path: 'b.ts', order: 2 },
      { path: 'a.ts', order: 1 },
    ]);
  });

  it('defaults order to 1 when @order attribute is omitted', () => {
    const m = parseManifest(xml(`<resources><code path="index.ts" /></resources>`));
    expect(m.resources.code).toEqual([{ path: 'index.ts', order: 1 }]);
  });
});

describe('parseManifest — resources.css', () => {
  it('parses a single <css> entry', () => {
    const m = parseManifest(xml(`
      <resources>
        <code path="index.ts" />
        <css path="css/MyControl.css" order="1" />
      </resources>
    `));
    expect(m.resources.css).toEqual([{ path: 'css/MyControl.css', order: 1 }]);
  });

  it('parses multiple <css> entries', () => {
    const m = parseManifest(xml(`
      <resources>
        <code path="index.ts" />
        <css path="a.css" order="1" />
        <css path="b.css" order="2" />
      </resources>
    `));
    expect(m.resources.css.map(c => c.path)).toEqual(['a.css', 'b.css']);
  });
});

describe('parseManifest — resources.images (H5 regression)', () => {
  // M11.M3 / H5: this is the explicit regression test the H5 fix shipped
  // without. <img path="..."/> declarations were silently dropped before H5
  // because the parser didn't read them. Locking it down now so any future
  // refactor of the parser keeps this working.

  it('parses a single <img> declaration into resources.images', () => {
    const m = parseManifest(xml(`
      <resources>
        <code path="index.ts" />
        <img path="icons/star.png" />
      </resources>
    `));
    expect(m.resources.images).toEqual([{ path: 'icons/star.png' }]);
  });

  it('parses multiple <img> declarations preserving order', () => {
    const m = parseManifest(xml(`
      <resources>
        <code path="index.ts" />
        <img path="icons/star.png" />
        <img path="icons/half-star.png" />
        <img path="fonts/icon-font.woff" />
      </resources>
    `));
    expect(m.resources.images.map(i => i.path)).toEqual([
      'icons/star.png',
      'icons/half-star.png',
      'fonts/icon-font.woff',
    ]);
  });

  it('returns empty images array when no <img> declared', () => {
    const m = parseManifest(xml(`<resources><code path="index.ts" /></resources>`));
    expect(m.resources.images).toEqual([]);
  });
});

describe('parseManifest — resources.platformLibraries', () => {
  it('parses React + Fluent platform libraries together', () => {
    const m = parseManifest(xml(`
      <resources>
        <code path="index.ts" />
        <platform-library name="React" version="16.14.0" />
        <platform-library name="Fluent" version="9.68.0" />
      </resources>
    `));
    expect(m.resources.platformLibraries).toEqual([
      { name: 'React', version: '16.14.0' },
      { name: 'Fluent', version: '9.68.0' },
    ]);
  });

  it('returns empty platformLibraries when none declared', () => {
    const m = parseManifest(xml(`<resources><code path="index.ts" /></resources>`));
    expect(m.resources.platformLibraries).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* <data-set>                                                                 */
/* -------------------------------------------------------------------------- */

describe('parseManifest — data-sets', () => {
  it('parses a single data-set', () => {
    const m = parseManifest(xml(`
      <data-set name="records" display-name-key="Records" />
    `));
    expect(m.dataSets).toEqual([{ name: 'records', displayNameKey: 'Records', columns: [] }]);
  });

  it('parses multiple data-sets', () => {
    const m = parseManifest(xml(`
      <data-set name="primary" display-name-key="Primary" />
      <data-set name="related" display-name-key="Related" />
    `));
    expect(m.dataSets.map(d => d.name)).toEqual(['primary', 'related']);
  });

  it('falls back displayNameKey to data-set name when attribute is omitted', () => {
    const m = parseManifest(xml(`<data-set name="records" />`));
    expect(m.dataSets[0].displayNameKey).toBe('records');
  });

  it('returns empty dataSets array when none declared', () => {
    const m = parseManifest(empty());
    expect(m.dataSets).toEqual([]);
  });

  it('parses <property-set> children into dataSets[].columns with ofType', () => {
    const m = parseManifest(xml(`
      <data-set name="productDataSet" display-name-key="Products">
        <property-set name="Name" display-name-key="Name" of-type="SingleLine.Text" usage="bound" required="true"/>
        <property-set name="EstimateUnitAmount" display-name-key="Estimate" of-type="Currency" usage="bound" required="true"/>
        <property-set name="LineStatus" display-name-key="Status" of-type="OptionSet" usage="bound" required="true"/>
        <property-set name="Unit" display-name-key="Unit" of-type="Lookup.Simple" usage="bound" required="true"/>
      </data-set>
    `));
    expect(m.dataSets).toHaveLength(1);
    const cols = m.dataSets[0].columns;
    expect(cols.map(c => c.name)).toEqual(['Name', 'EstimateUnitAmount', 'LineStatus', 'Unit']);
    expect(cols.map(c => c.ofType)).toEqual(['SingleLine.Text', 'Currency', 'OptionSet', 'Lookup.Simple']);
    expect(cols.every(c => c.usage === 'bound' && c.required === true)).toBe(true);
  });

  it('parses <property-set of-type-group=…> for type-group-bound columns', () => {
    const m = parseManifest(xml(`
      <type-group name="configColumnTypes">
        <type>SingleLine.Text</type>
        <type>Currency</type>
      </type-group>
      <data-set name="productDataSet" display-name-key="Products">
        <property-set name="ConfigColumn1" display-name-key="Cfg1" of-type-group="configColumnTypes" usage="bound" required="false"/>
      </data-set>
    `));
    const col = m.dataSets[0].columns[0];
    expect(col.ofTypeGroup).toBe('configColumnTypes');
    expect(col.required).toBe(false);
  });

  it('keeps dataSets[].columns as empty array when no property-sets declared', () => {
    const m = parseManifest(xml(`<data-set name="records" display-name-key="Records"/>`));
    expect(m.dataSets[0].columns).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Empty / malformed input                                                    */
/* -------------------------------------------------------------------------- */

describe('parseManifest — edge cases', () => {
  it('parses a minimal manifest with no children (returns valid shape with empty arrays/objects)', () => {
    const m = parseManifest(empty());
    expect(m.properties).toEqual([]);
    expect(m.dataSets).toEqual([]);
    expect(m.featureUsage).toEqual([]);
    expect(m.typeGroups).toEqual({});
    expect(m.resources).toEqual({
      code: [],
      css: [],
      images: [],
      platformLibraries: [],
    });
  });

  it('throws on completely malformed input (not silent — parser failure should surface)', () => {
    // fast-xml-parser is lenient with malformed XML and may not throw, but
    // passing complete garbage that has no manifest.control should still
    // fail loudly when the parser tries to read .control off undefined.
    expect(() => parseManifest('not xml at all')).toThrow();
  });

  it('throws when the root <manifest> element is missing', () => {
    expect(() => parseManifest('<?xml version="1.0"?><wrong><thing /></wrong>')).toThrow();
  });
});
