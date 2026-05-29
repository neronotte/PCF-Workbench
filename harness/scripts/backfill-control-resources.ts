/**
 * Backfill helper: for an already-extracted control, fetch every <css> and
 * <img> resource declared in the manifest from Dataverse and write it to disk
 * next to bundle.js, so the harness can serve it via /pcf-bundle/<path>.
 *
 * Usage:
 *   tsx scripts/backfill-control-resources.ts <orgUrl> <extractedProjectRoot>
 * Example:
 *   tsx scripts/backfill-control-resources.ts https://org9818e6e8.crm3.dynamics.com/ .pcf-extracted/SurveyControl
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { acquireDataverseToken, normalizeOrgUrl } from '../src/vite-plugin/dataverse-proxy';

interface ManifestResource { path: string; }

/** Pulls every <css path="..."/> and <img path="..."/> declared in a manifest XML. */
function parseResources(manifestXml: string): { css: ManifestResource[]; img: ManifestResource[] } {
  const css: ManifestResource[] = [];
  const img: ManifestResource[] = [];
  const cssRe = /<css\s+path="([^"]+)"/g;
  const imgRe = /<img\s+path="([^"]+)"/g;
  let m;
  while ((m = cssRe.exec(manifestXml))) css.push({ path: m[1] });
  while ((m = imgRe.exec(manifestXml))) img.push({ path: m[1] });
  return { css, img };
}

function parseNsCtor(manifestXml: string): { ns: string; ctor: string } {
  const ns = /<control[^>]*\snamespace="([^"]+)"/.exec(manifestXml)?.[1];
  const ctor = /<control[^>]*\sconstructor="([^"]+)"/.exec(manifestXml)?.[1];
  if (!ns || !ctor) throw new Error('Could not parse namespace/constructor from manifest');
  return { ns, ctor };
}

async function fetchWebresource(orgUrl: string, token: string, name: string): Promise<{ content: string; type: number } | null> {
  const url = `${orgUrl}/api/data/v9.2/webresourceset?$select=name,webresourcetype,content&$filter=name eq '${encodeURIComponent(name).replace(/'/g, "''")}'`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'OData-Version': '4.0' },
  });
  if (!res.ok) throw new Error(`${res.status} fetching ${name}: ${await res.text()}`);
  const body = await res.json() as { value: Array<{ content: string; webresourcetype: number }> };
  if (!body.value?.length) return null;
  return { content: body.value[0].content, type: body.value[0].webresourcetype };
}

async function main() {
  const [, , orgUrlRaw, projectRootRaw] = process.argv;
  if (!orgUrlRaw || !projectRootRaw) {
    console.error('Usage: tsx scripts/backfill-control-resources.ts <orgUrl> <extractedProjectRoot>');
    process.exit(2);
  }
  const orgUrl = normalizeOrgUrl(orgUrlRaw);
  const projectRoot = path.resolve(projectRootRaw);
  if (!fs.existsSync(projectRoot)) throw new Error(`Project root not found: ${projectRoot}`);

  // Find the manifest (it lives at <projectRoot>/<controlDir>/ControlManifest.Input.xml)
  const subdirs = fs.readdirSync(projectRoot, { withFileTypes: true }).filter(e => e.isDirectory());
  const controlDir = subdirs
    .map(d => path.join(projectRoot, d.name))
    .find(d => fs.existsSync(path.join(d, 'ControlManifest.Input.xml')));
  if (!controlDir) throw new Error(`No ControlManifest.Input.xml found under ${projectRoot}`);
  const manifestXml = fs.readFileSync(path.join(controlDir, 'ControlManifest.Input.xml'), 'utf8');

  const { ns, ctor } = parseNsCtor(manifestXml);
  const { css, img } = parseResources(manifestXml);
  console.log(`Control: ${ns}.${ctor}`);
  console.log(`Found ${css.length} CSS and ${img.length} image resources in manifest.`);

  const safe = path.basename(controlDir);
  const outDir = path.join(projectRoot, 'out', 'controls', safe);
  fs.mkdirSync(outDir, { recursive: true });

  const { token } = await acquireDataverseToken(orgUrl);
  const prefix = `cc_${ns}.${ctor}`;
  let okCount = 0, missCount = 0;

  for (const r of [...css, ...img]) {
    const wrName = `${prefix}/${r.path}`;
    const targetPath = path.join(outDir, r.path);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    try {
      const wr = await fetchWebresource(orgUrl, token, wrName);
      if (!wr) {
        console.warn(`  MISS  ${wrName}`);
        missCount++;
        continue;
      }
      // CSS (type 2) is plain text; binary (type 5 = png, 6 = jpg, 7 = gif, etc.) needs base64 → buffer.
      const isText = wr.type === 2 || wr.type === 3 || wr.type === 4; // 3=js, 4=xml
      if (isText) {
        const text = Buffer.from(wr.content, 'base64').toString('utf8');
        fs.writeFileSync(targetPath, text, 'utf8');
      } else {
        fs.writeFileSync(targetPath, Buffer.from(wr.content, 'base64'));
      }
      console.log(`  OK    ${wrName} -> ${targetPath} (${Math.round((wr.content.length * 3 / 4) / 1024)} KB)`);
      okCount++;
    } catch (e) {
      console.error(`  FAIL  ${wrName}: ${(e as Error).message}`);
      missCount++;
    }
  }

  console.log(`\nDone. ${okCount} fetched, ${missCount} missing/failed.`);
}

main().catch(e => { console.error(e); process.exit(1); });
