#!/usr/bin/env node
/**
 * M9.P1 spike — extract a deployed PCF control (manifest + bundle) from a
 * Dataverse org and stage it as a synthetic workspace the harness can load.
 *
 * Reuses the M2.P1 PAC token cache via acquireDataverseToken so we don't
 * have to reinvent auth.
 *
 * Usage (from harness/):
 *   npx tsx bin/extract-control.ts \
 *     --org https://contoso.crm.dynamics.com \
 *     --name MscrmControls.Slider.LinearSliderControl
 *
 * Writes:
 *   ../samples/_extracted/<safe>/<safe>/ControlManifest.Input.xml
 *   ../samples/_extracted/<safe>/out/controls/<safe>/bundle.js
 *   ../samples/_extracted/<safe>/.extract-meta.json
 *
 * Then load with:
 *   $env:PCF_CONTROL_PATH = "..\samples\_extracted\<safe>\<safe>"
 *   npx vite --port 8181
 */

import { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs';
import https from 'node:https';
import { fileURLToPath, URL } from 'node:url';

import { acquireDataverseToken, normalizeOrgUrl } from '../src/vite-plugin/dataverse-proxy';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

interface CustomControlRow {
  customcontrolid: string;
  name: string;
  manifest: string;       // XML
  clientjson: string;     // registration metadata pointing at webresources
  version: string;
  compatibledatatypes: string | null;
}

function safeName(controlName: string): string {
  // msdyn_FieldService.TimePromised -> TimePromised
  // Falls back to a sanitized full name if no dot present.
  const tail = controlName.includes('.') ? controlName.split('.').pop()! : controlName;
  return tail.replace(/[^A-Za-z0-9_-]/g, '_');
}

function odataGet(orgUrl: string, token: string, pathAndQuery: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = new URL(pathAndQuery, normalizeOrgUrl(orgUrl) + '/');
    const req = https.request(
      {
        method: 'GET',
        host: url.hostname,
        path: url.pathname + url.search,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'OData-MaxVersion': '4.0',
          'OData-Version': '4.0',
          Prefer: 'odata.include-annotations="*"',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if ((res.statusCode ?? 0) >= 400) {
            reject(new Error(`HTTP ${res.statusCode} ${pathAndQuery}\n${body.slice(0, 500)}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`Bad JSON from ${pathAndQuery}: ${(e as Error).message}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

const program = new Command();

program
  .name('extract-control')
  .description('M9.P1 spike: extract a deployed PCF control from Dataverse into a synthetic workspace.')
  .requiredOption('--org <url>', 'Dataverse org URL (e.g. https://contoso.crm.dynamics.com)')
  .requiredOption('--name <controlName>', 'Full control name (e.g. MscrmControls.Slider.LinearSliderControl)')
  .option('--out <dir>', 'Output base directory', path.join(repoRoot, 'samples', '_extracted'))
  .action(async (opts) => {
    const { org, name, out } = opts;
    console.log(`\n[extract-control] Acquiring token for ${org}...`);
    const tokenInfo = await acquireDataverseToken(org);
    console.log(`[extract-control] Token acquired for ${tokenInfo.account.username}`);

    const safe = safeName(name);
    const outRoot = path.resolve(out, safe);
    const controlDir = path.join(outRoot, safe);
    const bundleDir = path.join(outRoot, 'out', 'controls', safe);

    console.log(`[extract-control] Querying customcontrols for "${name}"...`);
    const select = '$select=customcontrolid,name,manifest,clientjson,version,compatibledatatypes';
    const filter = `$filter=name eq '${encodeURIComponent(name).replace(/'/g, "''")}'`;
    const query = `api/data/v9.2/customcontrols?${select}&${filter}`;
    const result = await odataGet(org, tokenInfo.token, query);
    const rows: Array<{
      customcontrolid: string;
      name: string;
      manifest: string;
      clientjson: string;
      version: string;
      compatibledatatypes: string | null;
    }> = result.value ?? [];
    if (!rows.length) {
      console.error(`[extract-control] No customcontrol row found for name="${name}".`);
      process.exit(2);
    }
    if (rows.length > 1) {
      console.warn(`[extract-control] Found ${rows.length} rows; using first.`);
    }
    const row = rows[0];
    console.log(`[extract-control] Found: ${row.name} v${row.version} (${row.customcontrolid})`);
    console.log(`[extract-control]   manifest: ${row.manifest?.length ?? 0} chars`);
    console.log(`[extract-control]   clientjson: ${row.clientjson?.length ?? 0} chars`);

    if (!row.manifest) {
      console.error(`[extract-control] Row is missing manifest. Aborting.`);
      process.exit(3);
    }

    // Parse namespace + constructor out of the manifest XML to build the
    // webresource name. The webresource convention is:
    //   cc_<namespace>.<constructor>/bundic.js
    const nsMatch = row.manifest.match(/<control[^>]*\snamespace="([^"]+)"/);
    const ctorMatch = row.manifest.match(/<control[^>]*\sconstructor="([^"]+)"/);
    if (!nsMatch || !ctorMatch) {
      console.error(`[extract-control] Could not parse namespace/constructor from manifest.`);
      process.exit(4);
    }
    const ns = nsMatch[1];
    const ctor = ctorMatch[1];
    const wrBundleName = `cc_${ns}.${ctor}/bundle.js`;
    console.log(`[extract-control] Looking for bundle webresource: ${wrBundleName}`);

    const wrQuery = `api/data/v9.2/webresourceset?$select=name,webresourcetype,content&$filter=` +
      encodeURIComponent(`name eq '${wrBundleName}'`);
    const wrResult = await odataGet(org, tokenInfo.token, wrQuery);
    if (!wrResult.value?.length) {
      console.error(`[extract-control] Bundle webresource not found: ${wrBundleName}`);
      console.error(`[extract-control] (This control may be a platform-only OOB control whose bundle is served from CDN, not Dataverse.)`);
      process.exit(5);
    }
    const wr = wrResult.value[0];
    const decodedBundle = Buffer.from(wr.content, 'base64').toString('utf8');
    console.log(`[extract-control]   bundle: ${decodedBundle.length} chars (${wr.content.length} base64)`);
    console.log(`[extract-control]   contains registerControl? ${decodedBundle.includes('registerControl')}`);

    fs.mkdirSync(controlDir, { recursive: true });
    fs.mkdirSync(bundleDir, { recursive: true });

    // Save the deployed manifest under .Input.xml — that's the filename the
    // harness scanner looks for. The deployed form is the *processed* manifest
    // but our parser (fast-xml-parser) should still be able to read it.
    const manifestPath = path.join(controlDir, 'ControlManifest.Input.xml');
    fs.writeFileSync(manifestPath, row.manifest, 'utf8');

    const bundlePath = path.join(bundleDir, 'bundle.js');
    fs.writeFileSync(bundlePath, decodedBundle, 'utf8');

    // M9.P2 — record which Fluent majors the bundle actually references. The
    // Vite plugin re-detects this at load time too, but persisting it here gives
    // us traceability ("which deployed controls are v8-only vs v8+v9?") and a
    // sanity check that extraction captured what the bundle expects.
    const fluentMajors = new Set<'v8' | 'v9'>();
    for (const m of decodedBundle.matchAll(/FluentUIReactv(\d+)/g)) {
      const lead = m[1][0];
      if (lead === '8') fluentMajors.add('v8');
      else if (lead === '9') fluentMajors.add('v9');
    }
    const requiredFluentMajors = [...fluentMajors].sort();

    fs.writeFileSync(
      path.join(outRoot, '.extract-meta.json'),
      JSON.stringify(
        {
          extractedAt: new Date().toISOString(),
          orgUrl: org,
          extractedBy: tokenInfo.account.username,
          customcontrolid: row.customcontrolid,
          deployedName: row.name,
          namespace: ns,
          constructor: ctor,
          version: row.version,
          compatibledatatypes: row.compatibledatatypes,
          manifestBytes: row.manifest.length,
          bundleBytes: decodedBundle.length,
          bundleWebresourceName: wr.name,
          requiredFluentMajors,
        },
        null,
        2,
      ),
      'utf8',
    );
    console.log(`[extract-control]   fluent majors referenced: ${requiredFluentMajors.length ? requiredFluentMajors.join(', ') : '(none)'}`);

    console.log(`\n[extract-control] Wrote:`);
    console.log(`  ${path.relative(repoRoot, manifestPath)}`);
    console.log(`  ${path.relative(repoRoot, bundlePath)}`);
    console.log(`\nLoad in harness:`);
    console.log(`  cd harness`);
    console.log(`  $env:PCF_CONTROL_PATH = "${path.relative(path.join(repoRoot, 'harness'), controlDir)}"`);
    console.log(`  npx vite --port 8181 --host 127.0.0.1\n`);
  });

program.parseAsync().catch((e) => {
  console.error('\n[extract-control] FAILED:', e?.message ?? e);
  process.exit(1);
});
