/**
 * Phase 1 — pcf.gallery catalog scraper.
 *
 * Walks every index page on https://pcf.gallery/, extracts cards, then visits
 * each detail page to capture the Download URL + author. Outputs a single
 * catalog JSON. Read-only — no GitHub calls, no clones.
 *
 * Usage:
 *   tsx scripts/scrape-pcf-gallery.ts [--max-pages N] [--max-details N] [--out <path>]
 *   tsx scripts/scrape-pcf-gallery.ts --resume   # continue from a prior catalog (skip already-fetched details)
 *
 * Default output: C:\Github.Copilot\PowerApps\PCFGallery\_catalog\pcf-gallery-catalog.json
 * Override with $env:PCF_GALLERY_ROOT or --out.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const BASE = 'https://pcf.gallery';
const DEFAULT_ROOT = process.env.PCF_GALLERY_ROOT || 'C:\\Github.Copilot\\PowerApps\\PCFGallery';
const UA = 'PCFWorkbench-Scraper/0.1 (internal harness validation; +https://github.com/jaduplesms/PCF-Workbench)';
const FETCH_DELAY_MS = 150; // be polite

interface IndexCard {
  slug: string;
  detailUrl: string;
  name: string;
  summary: string;
  thumbnailUrl: string;
  tags: string[];
  supports: { modelDriven: boolean; canvas: boolean; powerPages: boolean };
  hasLicense: boolean;
  hasManagedSolution: boolean;
}

interface CatalogEntry extends IndexCard {
  author?: string;
  authorPublishedAt?: string;
  downloadUrl?: string | null;
  download?: {
    kind: 'github-repo' | 'github-release' | 'github-other' | 'other' | 'unknown';
    owner?: string;
    repo?: string;
    ref?: string;
  };
  visitUrl?: string | null;
  detailFetchedAt?: string;
  detailFetchError?: string;
}

interface Catalog {
  scrapedAt: string;
  source: string;
  totalIndexed: number;
  totalDetailed: number;
  entries: CatalogEntry[];
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

/** Extract every <div class="card">...</div> block from an index page and parse it. */
function parseIndexPage(html: string): IndexCard[] {
  const cards: IndexCard[] = [];
  // Each card is wrapped by <div class="col-... mb-4"> then <div class="card">.
  // We split on the card-title anchor as the most reliable anchor point.
  const titleRe = /<a class="card-title"[^>]*href="\/([^"]+)"[^>]*>\s*<b class="pcf-name">([^<]+)<\/b>/g;
  let m: RegExpExecArray | null;
  const titleHits: { slug: string; name: string; matchStart: number }[] = [];
  while ((m = titleRe.exec(html))) {
    titleHits.push({ slug: m[1].replace(/\/$/, ''), name: m[2].trim(), matchStart: m.index });
  }

  for (let i = 0; i < titleHits.length; i++) {
    const { slug, name, matchStart } = titleHits[i];
    const blockStart = Math.max(0, matchStart - 600); // search backwards for the <img class="img-card"
    const blockEnd = i + 1 < titleHits.length ? titleHits[i + 1].matchStart : matchStart + 2000;
    const block = html.slice(blockStart, blockEnd);

    const summary = /<small class="pcf-summary">([^<]*)<\/small>/.exec(block)?.[1]?.trim() ?? '';
    const thumb = /<img class="img-card"[^>]*src="([^"?]+)/.exec(block)?.[1] ?? '';
    const tags = Array.from(block.matchAll(/<a class="tag-link"[^>]*>([^<]+)<\/a>/g)).map(t => t[1].trim());

    // Support icons: presence of "d-none" class means NOT supported.
    const supports = {
      modelDriven: !/icon-modeldriven\s+d-none/.test(block),
      canvas: !/icon-canvas\s+d-none/.test(block),
      powerPages: !/icon-powerpages\s+d-none/.test(block),
    };
    const hasLicense = !/icon-license\s+d-none/.test(block);
    const hasManagedSolution = !/icon-managedsolution\s+d-none/.test(block);

    cards.push({
      slug,
      detailUrl: `${BASE}/${slug}/`,
      name,
      summary,
      thumbnailUrl: thumb.startsWith('http') ? thumb : `${BASE}${thumb}`,
      tags,
      supports,
      hasLicense,
      hasManagedSolution,
    });
  }
  return cards;
}

/** Walk pagination until <link rel="next"> is absent. */
async function scrapeAllIndexPages(maxPages: number | undefined): Promise<IndexCard[]> {
  const all: IndexCard[] = [];
  const seen = new Set<string>();
  let pageNum = 1;
  let url: string | null = `${BASE}/`;
  while (url) {
    if (maxPages && pageNum > maxPages) break;
    process.stdout.write(`  Page ${pageNum}: ${url}  `);
    const html = await fetchText(url);
    const cards = parseIndexPage(html);
    let newCount = 0;
    for (const c of cards) {
      if (!seen.has(c.slug)) { seen.add(c.slug); all.push(c); newCount++; }
    }
    console.log(`→ ${cards.length} cards (${newCount} new, ${all.length} total)`);
    const next = /<link rel="next" href="([^"]+)"/.exec(html)?.[1];
    url = next ?? null;
    pageNum++;
    if (url) await sleep(FETCH_DELAY_MS);
  }
  return all;
}

/** Parse a detail page → download URL + author. */
function parseDetailPage(html: string): Pick<CatalogEntry, 'author' | 'authorPublishedAt' | 'downloadUrl' | 'visitUrl'> {
  const author = /<meta name="author" content="([^"]+)"/.exec(html)?.[1];
  const authorPublishedAt = /<meta property="article:published_time" content="([^"]+)"/.exec(html)?.[1];

  // The detail page has buttons rendered as <a class="btn ..." href="...">Download</a> /  >Visit</a>.
  // The exact button class varies; match by visible text.
  const downloadUrl =
    /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>\s*(?:<[^>]+>\s*)?Download\b/i.exec(html)?.[1] ?? null;
  const visitUrl =
    /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>\s*(?:<[^>]+>\s*)?Visit\b/i.exec(html)?.[1] ?? null;

  return { author, authorPublishedAt, downloadUrl, visitUrl };
}

/** Classify a Download URL. */
function classifyDownload(downloadUrl: string | null | undefined): CatalogEntry['download'] {
  if (!downloadUrl) return { kind: 'unknown' };
  try {
    const u = new URL(downloadUrl);
    if (u.hostname === 'github.com' || u.hostname === 'www.github.com') {
      const segs = u.pathname.split('/').filter(Boolean);
      // /owner/repo[/...]
      if (segs.length >= 2) {
        const owner = segs[0];
        const repo = segs[1].replace(/\.git$/, '');
        if (segs.length === 2) return { kind: 'github-repo', owner, repo };
        if (segs[2] === 'releases' || segs[2] === 'archive') return { kind: 'github-release', owner, repo };
        if (segs[2] === 'tree' || segs[2] === 'blob') return { kind: 'github-repo', owner, repo, ref: segs[3] };
        return { kind: 'github-other', owner, repo };
      }
    }
    return { kind: 'other' };
  } catch {
    return { kind: 'unknown' };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const getArg = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const maxPages = getArg('--max-pages') ? Number(getArg('--max-pages')) : undefined;
  const maxDetails = getArg('--max-details') ? Number(getArg('--max-details')) : undefined;
  const outPath = getArg('--out') || path.join(DEFAULT_ROOT, '_catalog', 'pcf-gallery-catalog.json');
  const resume = args.includes('--resume');

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  // Load prior catalog if resuming
  const prior = new Map<string, CatalogEntry>();
  if (resume && fs.existsSync(outPath)) {
    try {
      const j = JSON.parse(fs.readFileSync(outPath, 'utf8')) as Catalog;
      for (const e of j.entries) prior.set(e.slug, e);
      console.log(`Resuming: ${prior.size} prior entries loaded (${[...prior.values()].filter(e => e.detailFetchedAt).length} with details).`);
    } catch (e) {
      console.warn(`Could not load prior catalog (${(e as Error).message}); starting fresh.`);
    }
  }

  console.log(`\n[1/2] Scraping index pages from ${BASE}/  (maxPages=${maxPages ?? 'all'})`);
  const indexed = await scrapeAllIndexPages(maxPages);
  console.log(`Indexed ${indexed.length} unique cards.`);

  // Merge with prior so we don't lose details on resumed runs
  const merged = new Map<string, CatalogEntry>();
  for (const card of indexed) {
    const prev = prior.get(card.slug);
    merged.set(card.slug, prev ? { ...prev, ...card } : { ...card });
  }

  const toFetch = [...merged.values()].filter(e => !e.detailFetchedAt);
  const target = maxDetails ? toFetch.slice(0, maxDetails) : toFetch;
  console.log(`\n[2/2] Fetching ${target.length} detail pages (${[...merged.values()].length - target.length} already cached).`);

  let okCount = 0, errCount = 0;
  for (let i = 0; i < target.length; i++) {
    const entry = target[i];
    const prefix = `  [${i + 1}/${target.length}] ${entry.slug}`.padEnd(60);
    try {
      const html = await fetchText(entry.detailUrl);
      const det = parseDetailPage(html);
      Object.assign(entry, det, { detailFetchedAt: new Date().toISOString() });
      entry.download = classifyDownload(entry.downloadUrl);
      entry.detailFetchError = undefined;
      console.log(`${prefix} OK  ${entry.download?.kind ?? '?'}${entry.download?.owner ? ` (${entry.download.owner}/${entry.download.repo})` : ''}`);
      okCount++;
    } catch (e) {
      entry.detailFetchError = (e as Error).message;
      console.warn(`${prefix} ERR ${entry.detailFetchError}`);
      errCount++;
    }
    if (i % 25 === 24) {
      // Incremental save every 25 entries so a crash doesn't lose progress
      writeCatalog(outPath, merged);
    }
    await sleep(FETCH_DELAY_MS);
  }

  writeCatalog(outPath, merged);

  const finalEntries = [...merged.values()];
  const withRepo = finalEntries.filter(e => e.download?.kind === 'github-repo').length;
  const detailed = finalEntries.filter(e => e.detailFetchedAt).length;
  console.log(`\nDone. ${finalEntries.length} total / ${detailed} with details / ${withRepo} resolve to clean owner/repo.`);
  console.log(`Detail fetch: ${okCount} OK, ${errCount} errors.`);
  console.log(`Output: ${outPath}`);
}

function writeCatalog(outPath: string, merged: Map<string, CatalogEntry>) {
  const entries = [...merged.values()];
  const catalog: Catalog = {
    scrapedAt: new Date().toISOString(),
    source: BASE,
    totalIndexed: entries.length,
    totalDetailed: entries.filter(e => e.detailFetchedAt).length,
    entries,
  };
  fs.writeFileSync(outPath, JSON.stringify(catalog, null, 2), 'utf8');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
