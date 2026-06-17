// M11.M1 canary test — proves the Vitest toolchain is wired correctly.
// Real tests for scenario-store land in M11.M2.

describe('vitest toolchain', () => {
  it('runs', () => {
    expect(true).toBe(true);
  });

  it('has globals from vitest.config.ts', () => {
    // describe/it/expect should be globally available — no `import { ... } from 'vitest'`
    // anywhere in this file. If this test runs, globals are working.
    expect(typeof describe).toBe('function');
    expect(typeof it).toBe('function');
    expect(typeof expect).toBe('function');
  });
});
