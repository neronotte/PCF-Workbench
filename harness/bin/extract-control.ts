#!/usr/bin/env node
/**
 * CLI wrapper around the in-process extraction core.
 *
 * Real logic lives in `src/vite-plugin/extract-control.ts` so the Gallery's
 * "Deployed" tab and this CLI share the same implementation.
 *
 * Usage (from harness/):
 *   npx tsx bin/extract-control.ts \
 *     --org https://contoso.crm.dynamics.com \
 *     --name MscrmControls.Slider.LinearSliderControl
 *
 * Default --out is `harness/.pcf-extracted/` (gitignored). Pre-M9.P2-chunk-3
 * extracts that already live under `samples/_extracted/` are still readable
 * by the gallery.
 */

import { Command } from 'commander';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  extractDeployedControl,
  ExtractError,
} from '../src/vite-plugin/extract-control';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const harnessRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(harnessRoot, '..');

const program = new Command();

program
  .name('extract-control')
  .description('Extract a deployed PCF control from Dataverse into a synthetic workspace.')
  .requiredOption('--org <url>', 'Dataverse org URL (e.g. https://contoso.crm.dynamics.com)')
  .requiredOption('--name <controlName>', 'Full control name (e.g. MscrmControls.Slider.LinearSliderControl)')
  .option('--out <dir>', 'Output base directory', path.join(harnessRoot, '.pcf-extracted'))
  .action(async (opts) => {
    const { org, name, out } = opts;
    console.log(`\n[extract-control] Extracting "${name}" from ${org}...`);
    try {
      const result = await extractDeployedControl({ orgUrl: org, controlName: name, outBase: out });
      const { meta, manifestPath, bundlePath, controlDir } = result;
      console.log(`[extract-control] Found: ${meta.deployedName} v${meta.version} (${meta.customcontrolid})`);
      console.log(`[extract-control]   manifest: ${meta.manifestBytes} chars`);
      console.log(`[extract-control]   bundle:   ${meta.bundleBytes} chars`);
      console.log(`[extract-control]   fluent:   ${meta.requiredFluentMajors.length ? meta.requiredFluentMajors.join(', ') : '(none)'}`);
      console.log(`\n[extract-control] Wrote:`);
      console.log(`  ${path.relative(repoRoot, manifestPath)}`);
      console.log(`  ${path.relative(repoRoot, bundlePath)}`);
      console.log(`\nLoad in harness:`);
      console.log(`  cd harness`);
      console.log(`  $env:PCF_CONTROL_PATH = "${path.relative(harnessRoot, controlDir)}"`);
      console.log(`  npx vite --port 8181 --host 127.0.0.1\n`);
    } catch (e) {
      if (e instanceof ExtractError) {
        console.error(`\n[extract-control] FAILED (${e.code}): ${e.message}`);
        // Map error codes to historic exit codes for backward compat with any
        // wrapper scripts that branched on them.
        const codeMap: Record<ExtractError['code'], number> = {
          'control-not-found': 2,
          'manifest-missing': 3,
          'manifest-unparseable': 4,
          'bundle-not-found': 5,
          'http-error': 6,
          'auth-failed': 7,
        };
        process.exit(codeMap[e.code] ?? 1);
      }
      console.error('\n[extract-control] FAILED:', (e as Error)?.message ?? e);
      process.exit(1);
    }
  });

program.parseAsync().catch((e) => {
  console.error('\n[extract-control] FAILED:', e?.message ?? e);
  process.exit(1);
});
