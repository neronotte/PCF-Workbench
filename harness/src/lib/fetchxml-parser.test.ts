import { describe, it, expect } from 'vitest';
import { parseFetchXml, fetchXmlToViewFragment } from './fetchxml-parser';

describe('parseFetchXml', () => {
  it('returns the empty shape for null / undefined / empty / non-string input', () => {
    const empty = { entityName: '', attributes: [], orders: [], conditions: [], hasLinks: false, isAggregate: false };
    expect(parseFetchXml(null)).toEqual(empty);
    expect(parseFetchXml(undefined)).toEqual(empty);
    expect(parseFetchXml('')).toEqual(empty);
    expect(parseFetchXml('   ')).toEqual(empty);
    // @ts-expect-error - exercising the runtime guard
    expect(parseFetchXml(42)).toEqual(empty);
  });

  it('returns the empty shape for non-XML / non-fetch root', () => {
    expect(parseFetchXml('plain text')).toEqual({
      entityName: '', attributes: [], orders: [], conditions: [], hasLinks: false, isAggregate: false,
    });
    // Valid XML but not a <fetch> root
    expect(parseFetchXml('<other><entity name="x"/></other>').entityName).toBe('');
  });

  it('returns the empty shape for malformed XML', () => {
    expect(parseFetchXml('<fetch><entity name="account"').entityName).toBe('');
  });

  it('extracts entity name + attributes in document order', () => {
    const xml = `
      <fetch version="1.0" mapping="logical">
        <entity name="account">
          <attribute name="name" />
          <attribute name="telephone1" />
          <attribute name="emailaddress1" />
        </entity>
      </fetch>`;
    const r = parseFetchXml(xml);
    expect(r.entityName).toBe('account');
    expect(r.attributes).toEqual(['name', 'telephone1', 'emailaddress1']);
  });

  it('handles a single attribute (fast-xml-parser would otherwise scalarise it)', () => {
    const xml = `<fetch><entity name="contact"><attribute name="fullname" /></entity></fetch>`;
    expect(parseFetchXml(xml).attributes).toEqual(['fullname']);
  });

  it('handles zero attributes', () => {
    const xml = `<fetch><entity name="contact" /></fetch>`;
    expect(parseFetchXml(xml).attributes).toEqual([]);
  });

  it('parses <order> with descending=true/false/missing', () => {
    const xml = `
      <fetch>
        <entity name="account">
          <order attribute="name" descending="false" />
          <order attribute="createdon" descending="true" />
          <order attribute="modifiedon" />
        </entity>
      </fetch>`;
    expect(parseFetchXml(xml).orders).toEqual([
      { attribute: 'name', descending: false },
      { attribute: 'createdon', descending: true },
      { attribute: 'modifiedon', descending: false },
    ]);
  });

  it('parses <filter><condition> with and without value', () => {
    const xml = `
      <fetch>
        <entity name="incident">
          <filter type="and">
            <condition attribute="statecode" operator="eq" value="0" />
            <condition attribute="customerid" operator="not-null" />
          </filter>
        </entity>
      </fetch>`;
    const r = parseFetchXml(xml);
    expect(r.conditions).toEqual([
      { attribute: 'statecode', operator: 'eq', value: '0' },
      { attribute: 'customerid', operator: 'not-null' },
    ]);
  });

  it('flattens conditions across multiple <filter> blocks', () => {
    const xml = `
      <fetch>
        <entity name="account">
          <filter><condition attribute="a" operator="eq" value="1" /></filter>
          <filter><condition attribute="b" operator="eq" value="2" /></filter>
        </entity>
      </fetch>`;
    expect(parseFetchXml(xml).conditions.map(c => c.attribute)).toEqual(['a', 'b']);
  });

  it('flags hasLinks when <link-entity> is present', () => {
    const xml = `
      <fetch>
        <entity name="account">
          <attribute name="name" />
          <link-entity name="contact" from="parentcustomerid" to="accountid" />
        </entity>
      </fetch>`;
    expect(parseFetchXml(xml).hasLinks).toBe(true);
  });

  it('does not flag hasLinks when no <link-entity>', () => {
    expect(parseFetchXml(`<fetch><entity name="x"/></fetch>`).hasLinks).toBe(false);
  });

  it('flags isAggregate when aggregate="true" on root', () => {
    const xml = `
      <fetch aggregate="true">
        <entity name="opportunity">
          <attribute name="estimatedvalue" aggregate="sum" alias="total" />
        </entity>
      </fetch>`;
    expect(parseFetchXml(xml).isAggregate).toBe(true);
  });

  it('does not flag isAggregate when aggregate attr missing or non-true', () => {
    expect(parseFetchXml(`<fetch><entity name="x"/></fetch>`).isAggregate).toBe(false);
    expect(parseFetchXml(`<fetch aggregate="false"><entity name="x"/></fetch>`).isAggregate).toBe(false);
  });

  it('ignores attribute elements without a name attribute', () => {
    const xml = `
      <fetch>
        <entity name="account">
          <attribute />
          <attribute name="name" />
        </entity>
      </fetch>`;
    expect(parseFetchXml(xml).attributes).toEqual(['name']);
  });

  it('ignores order/condition elements missing required attributes', () => {
    const xml = `
      <fetch>
        <entity name="account">
          <order />
          <order descending="true" />
          <filter><condition operator="eq" value="1" /></filter>
        </entity>
      </fetch>`;
    const r = parseFetchXml(xml);
    expect(r.orders).toEqual([]);
    expect(r.conditions).toEqual([]);
  });
});

describe('fetchXmlToViewFragment', () => {
  it('inlines sortDirection on columns whose attribute is in the order list', () => {
    const xml = `
      <fetch>
        <entity name="account">
          <attribute name="name" />
          <attribute name="telephone1" />
          <attribute name="createdon" />
          <order attribute="name" descending="false" />
          <order attribute="createdon" descending="true" />
        </entity>
      </fetch>`;
    const r = fetchXmlToViewFragment(xml);
    expect(r.entityType).toBe('account');
    expect(r.columns).toEqual([
      { name: 'name', sortDirection: 'asc' },
      { name: 'telephone1' },
      { name: 'createdon', sortDirection: 'desc' },
    ]);
    expect(r.isAggregate).toBe(false);
    expect(r.hasLinks).toBe(false);
  });

  it('returns empty columns + entityType when parse yields nothing', () => {
    expect(fetchXmlToViewFragment(null)).toEqual({
      entityType: '', columns: [], isAggregate: false, hasLinks: false,
    });
  });
});
