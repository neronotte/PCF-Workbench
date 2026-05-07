/**
 * Conformance diff: enumerates the public surface of @types/xrm and
 * @types/powerapps-component-framework and reports which members the
 * workbench's shims actually implement. Output is a markdown report at
 * `harness/__visual__/conformance-diff.md`.
 *
 * Run via `npm run conformance:diff` from the `harness` folder.
 *
 * The "implemented inventory" below is hand-curated from the shim sources.
 * Treat the markdown report as a coverage *snapshot* — when shims grow,
 * append to the relevant Set so the report keeps tracking real progress.
 */

import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const HARNESS_DIR = path.resolve(__dirname, '..');
const OUT_FILE = path.join(HARNESS_DIR, '__visual__', 'conformance-diff.md');

// ──────────────────────────────────────────────────────────────────────────
// Implemented inventory — what our shims actually expose. Update when a new
// shim member ships.
// ──────────────────────────────────────────────────────────────────────────

const IMPLEMENTED = new Set<string>([
  // Xrm.WebApi
  'WebApi.createRecord', 'WebApi.deleteRecord', 'WebApi.retrieveRecord',
  'WebApi.retrieveMultipleRecords', 'WebApi.updateRecord', 'WebApi.execute',
  'WebApi.executeMultiple', 'WebApi.online', 'WebApi.offline',

  // Xrm.Navigation
  'Navigation.openAlertDialog', 'Navigation.openConfirmDialog',
  'Navigation.openErrorDialog', 'Navigation.openForm', 'Navigation.openUrl',
  'Navigation.openFile', 'Navigation.navigateTo',
  'Navigation.openWebResource', 'Navigation.items',

  // Xrm.Utility
  'Utility.getGlobalContext', 'Utility.getEntityMetadata',
  'Utility.getResourceString', 'Utility.lookupObjects',
  'Utility.alertDialog', 'Utility.confirmDialog',
  'Utility.showProgressIndicator', 'Utility.closeProgressIndicator',
  'Utility.invokeProcessAction', 'Utility.refreshParentGrid',
  'Utility.getAllowedStatusTransitions', 'Utility.getPageContext',
  'Utility.openQuickCreate',

  // Xrm.Encoding
  'Encoding.htmlEncode', 'Encoding.htmlDecode', 'Encoding.htmlAttributeEncode',
  'Encoding.xmlEncode', 'Encoding.xmlAttributeEncode',

  // Xrm.Device
  'Device.captureAudio', 'Device.captureImage', 'Device.captureVideo',
  'Device.getBarcodeValue', 'Device.getCurrentPosition', 'Device.pickFile',

  // Xrm.App
  'App.addGlobalNotification', 'App.clearGlobalNotification', 'App.sidePanes',

  // Xrm.Panel
  'Panel.loadPanel',

  // ComponentFramework.Context
  'Context.parameters', 'Context.client', 'Context.device', 'Context.factory',
  'Context.formatting', 'Context.mode', 'Context.navigation',
  'Context.resources', 'Context.userSettings', 'Context.utils',
  'Context.webAPI', 'Context.events', 'Context.fluentDesignLanguage',
  'Context.copilot', 'Context.updatedProperties',

  // FormContext
  'FormContext.getAttribute', 'FormContext.getControl', 'FormContext.data',
  'FormContext.ui', 'FormContext.addOnLoad', 'FormContext.removeOnLoad',
  'FormContext.addOnSave', 'FormContext.removeOnSave',
  'FormContext.addOnPostSave', 'FormContext.removeOnPostSave',
]);

const INTENTIONALLY_OMITTED = new Set<string>([
  'Utility.getAdvancedConfigSetting',
  'Utility.getLearningPathAttributeName',
  // Deprecated in v9 — replaced by Xrm.Navigation.openForm / openWebResource / Xrm.Utility.getEntityMetadata.
  // We intentionally don't ship shims for deprecated surface to avoid encouraging new usage.
  'Utility.isActivityType',
  'Utility.openEntityForm',
  'Utility.openWebResource',
  'WebApi.isAvailableOffline',
]);

// ──────────────────────────────────────────────────────────────────────────
// .d.ts walker
// ──────────────────────────────────────────────────────────────────────────

interface NamespaceMembers {
  namespace: string;
  members: string[];
  source: string;
}

function loadDts(filename: string): ts.SourceFile {
  const content = fs.readFileSync(filename, 'utf-8');
  return ts.createSourceFile(filename, content, ts.ScriptTarget.Latest, true);
}

function collectMembersFromInterface(node: ts.InterfaceDeclaration): string[] {
  return node.members
    .map(m => (m as any).name?.getText?.())
    .filter((n: string | undefined): n is string => !!n);
}

function findMembers(sf: ts.SourceFile, interfaceName: string): string[] {
  const found: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
      found.push(...collectMembersFromInterface(node));
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return [...new Set(found)];
}

const XRM_NAMESPACES: Record<string, string> = {
  WebApi: 'WebApi',
  Navigation: 'Navigation',
  Utility: 'Utility',
  Encoding: 'Encoding',
  Device: 'Device',
  App: 'App',
  Panel: 'Panel',
  FormContext: 'FormContext',
};

function diffNamespace(ns: NamespaceMembers): { implemented: string[]; missing: string[]; omitted: string[] } {
  const implemented: string[] = [];
  const missing: string[] = [];
  const omitted: string[] = [];
  for (const m of ns.members) {
    const key = `${ns.namespace}.${m}`;
    if (IMPLEMENTED.has(key)) implemented.push(m);
    else if (INTENTIONALLY_OMITTED.has(key)) omitted.push(m);
    else missing.push(m);
  }
  return { implemented, missing, omitted };
}

function pct(part: number, total: number): string {
  if (total === 0) return '—';
  return `${Math.round((part / total) * 100)}%`;
}

function main() {
  const xrmDts = require.resolve('@types/xrm/index.d.ts', { paths: [HARNESS_DIR] });
  const pcfDts = require.resolve('@types/powerapps-component-framework/componentframework.d.ts', { paths: [HARNESS_DIR] });

  const xrmSf = loadDts(xrmDts);
  const pcfSf = loadDts(pcfDts);

  const namespaces: NamespaceMembers[] = [];
  for (const [shortName, ifaceName] of Object.entries(XRM_NAMESPACES)) {
    namespaces.push({
      namespace: shortName,
      members: findMembers(xrmSf, ifaceName),
      source: '@types/xrm',
    });
  }
  namespaces.push({
    namespace: 'Context',
    members: findMembers(pcfSf, 'Context'),
    source: '@types/powerapps-component-framework',
  });

  const lines: string[] = [];
  lines.push('# PCF Workbench — UCI Conformance Diff');
  lines.push('');
  lines.push(`Generated ${new Date().toISOString()} from \`${path.relative(HARNESS_DIR, xrmDts)}\` and \`${path.relative(HARNESS_DIR, pcfDts)}\`.`);
  lines.push('');
  lines.push('| Namespace | Source | Total | Implemented | Stub/Missing | Coverage |');
  lines.push('|-----------|--------|------:|------------:|-------------:|---------:|');

  let grandTotal = 0;
  let grandImplemented = 0;
  const details: string[] = [];

  for (const ns of namespaces) {
    if (ns.members.length === 0) continue;
    const { implemented, missing, omitted } = diffNamespace(ns);
    const counted = ns.members.length - omitted.length;
    grandTotal += counted;
    grandImplemented += implemented.length;
    lines.push(`| \`${ns.namespace}\` | ${ns.source} | ${counted} | ${implemented.length} | ${missing.length} | ${pct(implemented.length, counted)} |`);

    details.push('');
    details.push(`## ${ns.namespace} (${ns.source})`);
    details.push('');
    if (implemented.length) {
      details.push(`**Implemented (${implemented.length}):** ${implemented.map(m => `\`${m}\``).join(', ')}`);
      details.push('');
    }
    if (missing.length) {
      details.push(`**Missing (${missing.length}):** ${missing.map(m => `\`${m}\``).join(', ')}`);
      details.push('');
    }
    if (omitted.length) {
      details.push(`<sub>Intentionally omitted: ${omitted.map(m => `\`${m}\``).join(', ')}</sub>`);
      details.push('');
    }
  }

  lines.push(`| **Total** | | **${grandTotal}** | **${grandImplemented}** | **${grandTotal - grandImplemented}** | **${pct(grandImplemented, grandTotal)}** |`);
  lines.push('');
  lines.push(...details);

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, lines.join('\n'));
  console.log(`[conformance-diff] ${grandImplemented}/${grandTotal} (${pct(grandImplemented, grandTotal)}) — wrote ${path.relative(HARNESS_DIR, OUT_FILE)}`);
}

main();
