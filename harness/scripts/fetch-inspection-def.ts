/**
 * One-off helper: fetch an msdyn_inspectiondefinition record from a Dataverse
 * org via the harness's PAC-backed token acquisition, then decode its
 * msdyn_jsoncontent (atob → decodeURIComponent → JSON.parse) and print it.
 *
 * Usage:
 *   tsx scripts/fetch-inspection-def.ts <orgUrl> <recordId>
 */
import { acquireDataverseToken, normalizeOrgUrl } from '../src/vite-plugin/dataverse-proxy';

async function main() {
  const [, , orgUrlRaw, idRaw] = process.argv;
  if (!orgUrlRaw || !idRaw) {
    console.error('Usage: tsx scripts/fetch-inspection-def.ts <orgUrl> <recordId>');
    process.exit(2);
  }
  const orgUrl = normalizeOrgUrl(orgUrlRaw);
  const id = idRaw.replace(/[{}]/g, '');

  const { token } = await acquireDataverseToken(orgUrl);
  const url = `${orgUrl}/api/data/v9.2/msdyn_inspectiondefinitions(${id})?$select=msdyn_name,msdyn_jsoncontent`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
    },
  });
  if (!res.ok) {
    console.error(`Dataverse returned ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const body = await res.json() as { msdyn_name?: string; msdyn_jsoncontent?: string };
  console.log('Name:', body.msdyn_name);
  if (!body.msdyn_jsoncontent) {
    console.error('Record has no msdyn_jsoncontent.');
    process.exit(1);
  }
  const decoded = decodeURIComponent(Buffer.from(body.msdyn_jsoncontent, 'base64').toString('binary'));
  // Re-parse to validate + pretty-print
  const parsed = JSON.parse(decoded);
  console.log('--- decoded msdyn_jsoncontent ---');
  console.log(JSON.stringify(parsed, null, 2));
  console.log('--- raw base64 (paste into SurveyJSON) ---');
  console.log(body.msdyn_jsoncontent);
}

main().catch(e => { console.error(e); process.exit(1); });
