// M11.M5 — Unit tests for harness/src/store/date-rebase.ts
//
// date-rebase walks a data.json payload, finds the most-common date in the
// data (the "anchor"), computes the offset to today, and shifts every
// recognised date string by that offset. Bugs here cause silent scenario
// drift — relative dates ("4 days from now") quietly become stale, which is
// the worst kind of regression because the UI still renders.
//
// All assertions compute the expected offset dynamically from `new Date()`,
// so they survive the calendar advancing without test churn. No fake timers,
// no mocks (M11 discipline §6).

import { rebaseDatesToToday } from './date-rebase';

/** Today as YYYY-MM-DD in UTC, matching the production formula. */
const todayStr = (): string => new Date().toISOString().slice(0, 10);

/** Build a record with one ISO date column. */
const isoRow = (id: string, iso: string) => ({ id, when: iso });

describe('rebaseDatesToToday — empty / no dates', () => {
  it('returns input unchanged when no date strings are present', () => {
    const data = { accounts: [{ id: '1', name: 'Acme' }] };
    expect(rebaseDatesToToday(data)).toBe(data); // same reference (no-anchor early return)
  });

  it('returns input unchanged when data is an empty object', () => {
    const data = {};
    expect(rebaseDatesToToday(data)).toBe(data);
  });

  it('returns input unchanged when arrays are empty', () => {
    const data = { accounts: [], contacts: [] };
    expect(rebaseDatesToToday(data)).toBe(data);
  });
});

describe('rebaseDatesToToday — anchor detection', () => {
  it('picks the most frequently occurring date as anchor', () => {
    const data = {
      events: [
        isoRow('1', '2026-01-01T10:00:00Z'), // appears 3×
        isoRow('2', '2026-01-01T11:00:00Z'),
        isoRow('3', '2026-01-01T12:00:00Z'),
        isoRow('4', '2026-06-15T10:00:00Z'), // appears 1×
      ],
    };
    const out = rebaseDatesToToday(data);
    // The 3-event cluster should anchor to today; row 4 should shift by the same offset
    const today = todayStr();
    expect(out.events[0].when.startsWith(today)).toBe(true);
    expect(out.events[1].when.startsWith(today)).toBe(true);
    expect(out.events[2].when.startsWith(today)).toBe(true);
    // Row 4 anchor was 2026-01-01, shifted to today; row 4 was 2026-06-15 (165 days later)
    const row4Date = new Date(out.events[3].when);
    const todayMs = new Date(today + 'T00:00:00Z').getTime();
    const expectedRow4Ms = todayMs + (165 * 86400000);
    // Allow ±1 day tolerance for DST / leap-day boundaries
    expect(Math.abs(row4Date.getTime() - expectedRow4Ms)).toBeLessThan(86400000 + 1000);
  });

  it('preserves time-of-day when shifting (10:00 stays 10:00)', () => {
    const data = { events: [isoRow('1', '2026-01-01T10:30:45Z')] };
    const out = rebaseDatesToToday(data);
    expect(out.events[0].when).toMatch(/T10:30:45/);
  });
});

describe('rebaseDatesToToday — short-circuits', () => {
  it('returns original data when anchor is already today', () => {
    const today = todayStr();
    const data = { events: [isoRow('1', `${today}T10:00:00Z`)] };
    expect(rebaseDatesToToday(data)).toBe(data); // offset===0 early return
  });
});

describe('rebaseDatesToToday — multiple tables', () => {
  it('applies the same offset across every table', () => {
    const data = {
      events:   [isoRow('e1', '2026-01-01T08:00:00Z')],
      meetings: [isoRow('m1', '2026-01-05T14:00:00Z')], // 4 days after anchor
    };
    const out = rebaseDatesToToday(data);
    const today = todayStr();
    expect(out.events[0].when.startsWith(today)).toBe(true);
    const meetingDate = new Date(out.meetings[0].when);
    const todayMs = new Date(today + 'T00:00:00Z').getTime();
    expect(meetingDate.getTime()).toBe(todayMs + 4 * 86400000 + 14 * 3600000);
  });
});

describe('rebaseDatesToToday — US-format dates', () => {
  it('shifts MM/DD/YYYY HH:mm strings and preserves the time portion', () => {
    const data = {
      tasks: [
        { id: '1', due: '1/1/2026 8:00' },
        { id: '2', due: '1/1/2026 9:00' }, // 2× anchor at 2026-01-01
        { id: '3', due: '1/5/2026 10:00' }, // 4 days after anchor
      ],
    };
    const out = rebaseDatesToToday(data);
    // Tasks 1 & 2 anchor on today, retaining their time-of-day suffix
    expect(out.tasks[0].due).toMatch(/ 8:00$/);
    expect(out.tasks[1].due).toMatch(/ 9:00$/);
    expect(out.tasks[2].due).toMatch(/ 10:00$/);
    // Task 3 should be 4 days after today (just confirm the time portion survives)
    expect(out.tasks[2].due).toMatch(/^\d{1,2}\/\d{1,2}\/\d{4} 10:00$/);
  });

  it('does not modify strings that are not recognised date formats', () => {
    const data = {
      events: [
        isoRow('1', '2026-01-01T10:00:00Z'),
        { id: '2', label: 'not a date', other: '01-15-2026', stamp: '20260101T100000' },
      ],
    };
    const out = rebaseDatesToToday(data);
    expect(out.events[1].label).toBe('not a date');
    expect(out.events[1].other).toBe('01-15-2026'); // dashes, not slashes — no match
    expect(out.events[1].stamp).toBe('20260101T100000'); // compact format — no match
  });
});

describe('rebaseDatesToToday — nested data', () => {
  it('walks into nested objects and arrays', () => {
    const data = {
      events: [
        {
          id: '1',
          when: '2026-01-01T10:00:00Z',
          meta: {
            created: '2026-01-01T08:00:00Z',
            tags: ['x', 'y'],
            children: [
              { id: '1a', start: '2026-01-01T09:00:00Z' },
            ],
          },
        },
      ],
    };
    const out = rebaseDatesToToday(data);
    const today = todayStr();
    expect(out.events[0].when.startsWith(today)).toBe(true);
    expect(out.events[0].meta.created.startsWith(today)).toBe(true);
    expect(out.events[0].meta.children[0].start.startsWith(today)).toBe(true);
    // Non-date strings untouched
    expect(out.events[0].meta.tags).toEqual(['x', 'y']);
  });
});

describe('rebaseDatesToToday — immutability', () => {
  it('returns a new top-level object (does not mutate the input)', () => {
    const data = { events: [isoRow('1', '2026-01-01T10:00:00Z')] };
    const out = rebaseDatesToToday(data);
    expect(out).not.toBe(data);
    expect(out.events).not.toBe(data.events);
    // Original retains the pre-rebase date
    expect(data.events[0].when).toBe('2026-01-01T10:00:00Z');
  });
});

describe('rebaseDatesToToday — invalid ISO inputs', () => {
  it('leaves malformed ISO strings untouched (NaN guard)', () => {
    // String matches ISO_DATE_RE shape but new Date() returns NaN
    const data = {
      events: [
        isoRow('valid', '2026-01-01T10:00:00Z'),
        isoRow('bogus', '9999-99-99T99:99:99Z'), // shape matches but invalid
      ],
    };
    const out = rebaseDatesToToday(data);
    // valid row rebased to today
    expect(out.events[0].when.startsWith(todayStr())).toBe(true);
    // bogus row left untouched (Date.parse returns NaN, branch returns val unchanged)
    expect(out.events[1].when).toBe('9999-99-99T99:99:99Z');
  });
});
