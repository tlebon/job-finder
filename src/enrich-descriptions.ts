#!/usr/bin/env tsx
/**
 * Fetch the real posting for jobs whose stored description is a stub.
 *
 * Adzuna's API returns a hard 500-character blurb and nothing else, and Adzuna
 * is roughly a quarter of the corpus - so a quarter of every verdict the regex,
 * the reviewer or any future model produces is formed on an intro paragraph
 * that never reaches the requirements.
 *
 * Outcomes are kept distinct on purpose. A 403 is a bot block, not a dead
 * posting, and conflating the two would archive live jobs - which is why only
 * 404 and 410 are reported as gone, matching cleanup-deadlinks.
 *
 * Prefers the schema.org JobPosting JSON-LD that most boards emit, since that
 * is the description proper rather than the page around it.
 *
 * Two targets, because they are different populations. `jobs` holds only what
 * the gate kept; the rejected rows in `label_sample` were never stored there
 * and so are unreachable from it - which is most of the labelling set, and the
 * part that exists to test what the gate throws away.
 *
 * Usage:
 *   npx tsx src/enrich-descriptions.ts --dry-run [--limit=20]
 *   npx tsx src/enrich-descriptions.ts --confirm [--limit=200] [--min-length=800]
 *   npx tsx src/enrich-descriptions.ts --target=sample --confirm
 */

import { config } from 'dotenv';
import { db } from './storage/db.js';
import { cleanJobDescription } from './utils/jobText.js';

config({ quiet: true });

const arg = (n: string, d: number) =>
  Number(process.argv.find(a => a.startsWith(`--${n}=`))?.split('=')[1] ?? d);

const limit = arg('limit', 100);
const minLength = arg('min-length', 800);
const confirm = process.argv.includes('--confirm');
const DELAY_MS = 700;

type Outcome = 'enriched' | 'no-better' | 'blocked' | 'gone' | 'error';

/** The description proper, when the page publishes one. */
function fromJsonLd(html: string): string | null {
  const blocks = html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi);
  for (const m of blocks) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const nodes = Array.isArray(parsed) ? parsed : [parsed, ...(parsed['@graph'] ?? [])];
      for (const n of nodes) {
        if (n && n['@type'] === 'JobPosting' && typeof n.description === 'string') return n.description;
      }
    } catch {
      // Malformed JSON-LD is common; fall through to the next block.
    }
  }
  return null;
}

function fromHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(nav|header|footer)[\s\S]*?<\/\1>/gi, ' ');
}

async function fetchDescription(url: string): Promise<{ outcome: Outcome; text?: string; status?: number }> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36' },
      signal: AbortSignal.timeout(15000),
    });

    if (res.status === 404 || res.status === 410) return { outcome: 'gone', status: res.status };
    if (!res.ok) return { outcome: 'blocked', status: res.status };

    const html = await res.text();
    const text = cleanJobDescription(fromJsonLd(html) ?? fromHtml(html));
    return { outcome: 'enriched', text, status: res.status };
  } catch {
    return { outcome: 'error' };
  }
}

const target = process.argv.find(a => a.startsWith('--target='))?.split('=')[1] ?? 'jobs';

// Unlabelled first: a row Tim has already judged is worth re-fetching, but a row
// still ahead of him in the queue needs the full text before he reaches it.
const rows = (target === 'sample'
  ? db.prepare(`
      SELECT id, url, title, company, source, LENGTH(description) len
      FROM label_sample
      WHERE LENGTH(description) < ?
      ORDER BY human_label IS NOT NULL, display_order
      LIMIT ?
    `)
  : db.prepare(`
      SELECT id, url, title, company, source, LENGTH(description) len
      FROM jobs
      WHERE description IS NOT NULL AND LENGTH(description) < ?
        AND status NOT IN ('ARCHIVED', 'DEAD', 'EXPIRED')
      ORDER BY score DESC
      LIMIT ?
    `)
).all(minLength, limit) as { id: string; url: string; title: string; company: string; source: string; len: number }[];

console.log(`${rows.length} ${target === 'sample' ? 'sample rows' : 'jobs'} with a description under ${minLength} characters\n`);

const updateJob = db.prepare('UPDATE jobs SET description = ? WHERE id = ?');
const updateSample = db.prepare('UPDATE label_sample SET description = ? WHERE url = ?');
const clearStaleLabel = db.prepare(`
  UPDATE label_sample SET human_label = NULL, labelled_at = NULL
  WHERE url = ? AND human_label IS NOT NULL
`);

const tally: Record<Outcome, number> = { enriched: 0, 'no-better': 0, blocked: 0, gone: 0, error: 0 };
let gained = 0;

for (const [i, r] of rows.entries()) {
  const res = await fetchDescription(r.url);
  let outcome = res.outcome;

  if (outcome === 'enriched') {
    // A page that yields no more than the stub is not an improvement; keeping
    // the stub is better than replacing it with navigation chrome.
    if (!res.text || res.text.length < r.len * 1.5 || res.text.length < 600) {
      outcome = 'no-better';
    } else if (confirm) {
      const text = res.text.slice(0, 50000);
      updateJob.run(text, r.id);
      updateSample.run(text, r.url);
      // A judgement made on a 500-character stub was made on different
      // evidence, so it goes back in the queue rather than standing.
      clearStaleLabel.run(r.url);
      gained += res.text.length - r.len;
    } else {
      gained += res.text.length - r.len;
    }
  }

  tally[outcome]++;
  if (i % 10 === 0 || outcome === 'gone') {
    console.log(`  ${String(i + 1).padStart(4)}/${rows.length} ${outcome.padEnd(10)}${res.status ?? ''} ${r.title.slice(0, 44)} @ ${r.company.slice(0, 20)}`);
  }
  await new Promise(r2 => setTimeout(r2, DELAY_MS));
}

console.log(`\nenriched   ${tally.enriched}`);
console.log(`no better  ${tally['no-better']}   page gave no more than the stub`);
console.log(`blocked    ${tally.blocked}   403/429/5xx - live, just not scrapable`);
console.log(`gone       ${tally.gone}   404/410 - posting removed`);
console.log(`error      ${tally.error}   timeout or network failure`);
if (tally.enriched) console.log(`\naverage gain: ${Math.round(gained / tally.enriched)} characters per enriched job`);
if (!confirm) console.log('\nDRY RUN: nothing written. Pass --confirm.');
