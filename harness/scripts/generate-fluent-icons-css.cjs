#!/usr/bin/env node
/*
 * Regenerates harness/src/loader/fluent-mdl2-icons.css from
 * @fluentui/font-icons-mdl2 so that page-level CSS can render Fluent v8
 * `<i data-icon-name="X">` icons even when the host bundle's Fluent
 * instance is closure-private and never calls `initializeIcons()`.
 *
 * The CDN URLs and hashes match what the npm package ships, so this is
 * stable as long as the package version in package.json is.
 *
 * Run: node scripts/generate-fluent-icons-css.cjs
 */
const fs = require('fs');
const path = require('path');

const pkgDir = path.join(__dirname, '..', 'node_modules', '@fluentui', 'font-icons-mdl2', 'lib');
const outPath = path.join(__dirname, '..', 'src', 'loader', 'fluent-mdl2-icons.css');
const cdn = 'https://static2.sharepointonline.com/files/fabric/assets/icons/';

const files = fs.readdirSync(pkgDir).filter(f => /^fabric-icons[-.].*\.js$/.test(f) || f === 'fabric-icons.js');

const header = `/* AUTO-GENERATED from @fluentui/font-icons-mdl2.
 * Run: node scripts/generate-fluent-icons-css.cjs to regenerate.
 *
 * Page-level @font-face + [data-icon-name] rules so deployed PCF bundles
 * (which often inline a private Fluent v8 instance and never call
 * initializeIcons()) still render MDL2 icon glyphs.
 */

i[data-icon-name], .ms-Icon { font-style: normal; font-weight: normal; speak: none; line-height: 1; -webkit-font-smoothing: antialiased; }

`;

let body = '';
let total = 0;
const seen = new Set();

for (const f of files) {
  const src = fs.readFileSync(path.join(pkgDir, f), 'utf8');
  // fontFamily looks like either: fontFamily: "\"FabricMDL2Icons-0\""  (numbered subsets)
  //                        or:    fontFamily: `"FabricMDL2Icons"`     (core file uses template literal)
  const fontFamilyMatch =
    src.match(/fontFamily:\s*"\\"([^"\\]+)\\""/) ||
    src.match(/fontFamily:\s*[`"]"([^"`]+)"[`"]/);
  // src looks like either: concat(baseUrl, "fabric-icons-0-XXXX.woff') format('woff')")
  //                or:     `url('${baseUrl}fabric-icons-XXXX.woff') format('woff')`  (core file template)
  const srcMatch =
    src.match(/concat\(baseUrl,\s*"([^"]+\.woff)/) ||
    src.match(/\$\{baseUrl\}([\w.-]+\.woff)/);
  // icons: { ... }, sometimes followed by };  — allow a trailing comma before the outer close brace.
  const iconsMatch = src.match(/icons:\s*\{([\s\S]+?)\},?\s*\}/);
  if (!fontFamilyMatch || !srcMatch || !iconsMatch) continue;

  const family = fontFamilyMatch[1];
  const woffFile = path.basename(srcMatch[1]);
  const fontUrl = cdn + woffFile;
  body += `@font-face { font-family: '${family}'; src: url('${fontUrl}') format('woff'); font-display: block; }\n`;

  const rules = [];
  const iconRegex = /["']?([\w-]+)["']?\s*:\s*['"]\\u([0-9A-Fa-f]{4,5})['"]/g;
  let m;
  while ((m = iconRegex.exec(iconsMatch[1])) !== null) {
    const name = m[1];
    const cp = m[2].toUpperCase();
    if (seen.has(name)) continue;
    seen.add(name);
    rules.push(`i[data-icon-name="${name}"]:before{font-family:'${family}'!important;content:'\\${cp}'!important}`);
    total++;
  }
  body += rules.join('\n') + '\n\n';
}

fs.writeFileSync(outPath, header + body);
console.log(`Wrote ${total} icons across ${files.length} font subsets to ${path.relative(process.cwd(), outPath)}`);
