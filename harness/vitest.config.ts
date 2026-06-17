import { defineConfig } from 'vitest/config';

// M11 — Vitest config for unit-testing pure-logic modules.
//
// Inherits NO vite.config.ts plugins (those are server-side, irrelevant to
// pure-logic node tests). Vitest discovers `*.test.ts` files colocated with
// the modules they test.
//
// Conventions (per harness/docs/milestones/m11-unit-tests/DESIGN.md):
//   - test.globals=true  → `it`, `expect`, `describe` available without import
//   - test.environment='node' → no jsdom; P1 modules are all pure logic
//   - NO snapshot tests (every assertion explicit)
//   - NO vi.mock() (if you need mocking, scope drifted out of unit-test land)
//
// Run:
//   npm run test         → watch mode (interactive dev)
//   npm run test:run     → one-shot (CI)
//   npm run test:coverage → one-shot + v8 coverage report

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'publish-staging', 'tests/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/vite-env.d.ts',
        'src/**/*.d.ts',
      ],
      // No thresholds in P1 (deliberate — see DESIGN §6 Q1). Coverage is
      // reported so you can find untested branches, not gated.
    },
  },
});
