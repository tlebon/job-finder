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
 *   npx tsx src/enrich-descriptions.ts --confirm --mark-gone
 *
 * --mark-gone sets status DEAD for 404 and 410. Enrichment and status changes
 * are separate concerns and were kept apart on purpose, but the alternative is
 * crawling the same 1,400 URLs twice to learn the same thing. The flag is
 * opt-in, off by default, and acts only on 404 and 410 - never on 403, 429 or a
 * timeout, which mean blocked or unknown rather than gone. A first pass already
 * found 944 of these; anything marked has now returned gone on two separate
 * crawls.
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
const markGone = process.argv.includes('--mark-gone');
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
    .replace(/<(nav|header|footer|aside|form|select|button)[\s\S]*?<\/\1>/gi, ' ');
}

/**
 * Everything after the page stops being the job.
 *
 * Aggregator pages append related listings, salary widgets and search links,
 * all of which survive tag-stripping and swamp the posting itself.
 */
const TRAILING_CHROME = /(similar jobs|popular searches|receive similar jobs|related jobs|back to last search|you might also|recommended jobs|jobs by email|share this job|report this job)/i;

/**
 * The stub is the true opening of the description, so it says exactly where the
 * real content starts on a page otherwise full of navigation. Without this the
 * fallback returned a country selector, a salary chart and six unrelated
 * vacancies, with the posting somewhere in the middle - strictly worse than the
 * 500 characters it replaced.
 */
function anchorOnStub(text: string, stub: string): string | null {
  const probe = stub.replace(/…\s*$/, '').trim().slice(0, 80);
  if (probe.length < 30) return null;

  const norm = (x: string) => x.replace(/\s+/g, ' ');
  const at = norm(text).indexOf(norm(probe));
  if (at < 0) return null;

  let body = norm(text).slice(at);
  const chrome = body.search(TRAILING_CHROME);
  if (chrome > 400) body = body.slice(0, chrome);
  return body.trim();
}

/**
 * The longest run of prose in a page of navigation.
 *
 * Needed to repair rows enriched before the chrome guard existed: their stored
 * text is a country selector and six unrelated vacancies wrapped around the
 * real posting, and the stub that would have anchored it was overwritten. Link
 * text comes in short lines, a job description in long ones, so the longest
 * contiguous run of long lines is the posting.
 */
function largestProseBlock(text: string): string {
  const lines = text.split('\n');
  const isProse = (l: string) => l.trim().split(/\s+/).length >= 8;

  let best = { start: 0, end: 0, words: 0 };
  let start = -1, words = 0;

  for (let i = 0; i <= lines.length; i++) {
    if (i < lines.length && isProse(lines[i])) {
      if (start < 0) start = i;
      words += lines[i].trim().split(/\s+/).length;
    } else if (start >= 0) {
      // A single short line inside a paragraph run - a bullet, a heading - is
      // part of the posting, so only two in a row end the block.
      const gapEndsIt = i + 1 >= lines.length || !isProse(lines[i + 1]);
      if (gapEndsIt) {
        if (words > best.words) best = { start, end: i, words };
        start = -1;
        words = 0;
      }
    }
  }

  if (best.words < 60) return text;
  return lines.slice(best.start, best.end).join('\n').trim();
}

/**
 * Navigation reads as many very short lines; prose does not. A page that is
 * mostly link text should be rejected rather than stored.
 */
function looksLikeChrome(text: string): boolean {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 12) return false;
  const short = lines.filter(l => l.split(/\s+/).length <= 3).length;
  return short / lines.length > 0.55;
}

async function fetchDescription(url: string, stub: string): Promise<{ outcome: Outcome; text?: string; status?: number }> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36' },
      signal: AbortSignal.timeout(15000),
    });

    if (res.status === 404 || res.status === 410) return { outcome: 'gone', status: res.status };
    if (!res.ok) return { outcome: 'blocked', status: res.status };

    const html = await res.text();

    const jsonLd = fromJsonLd(html);
    let text = jsonLd ? cleanJobDescription(jsonLd) : '';

    if (!text) {
      const stripped = cleanJobDescription(fromHtml(html));
      text = anchorOnStub(stripped, stub) ?? largestProseBlock(stripped);
    }

    if (looksLikeChrome(text)) return { outcome: 'no-better', status: res.status };
    return { outcome: 'enriched', text, status: res.status };
  } catch {
    return { outcome: 'error' };
  }
}

const target = process.argv.find(a => a.startsWith('--target='))?.split('=')[1] ?? 'jobs';
const repair = process.argv.includes('--repair');

// Unlabelled first: a row Tim has already judged is worth re-fetching, but a row
// still ahead of him in the queue needs the full text before he reaches it.
// Repair operates on stored text alone - no fetching. The damage is that
// navigation was saved around the posting; the posting is still in there.
if (repair) {
  const table = target === 'sample' ? 'label_sample' : 'jobs';
  const all = db.prepare(`SELECT id, description FROM ${table} WHERE LENGTH(description) > 800`)
    .all() as { id: string; description: string }[];

  const fix = db.prepare(`UPDATE ${table} SET description = ? WHERE id = ?`);
  let repaired = 0, saved = 0;
  for (const r of all) {
    if (!looksLikeChrome(r.description)) continue;
    const cleaned = largestProseBlock(r.description);
    if (cleaned.length < 300 || cleaned.length >= r.description.length) continue;
    saved += r.description.length - cleaned.length;
    if (confirm) fix.run(cleaned, r.id);
    repaired++;
  }
  console.log(`${repaired} of ${all.length} rows in ${table} held navigation around the posting`);
  console.log(`average ${repaired ? Math.round(saved / repaired) : 0} characters of chrome removed each`);
  if (!confirm) console.log('DRY RUN: nothing written.');
  process.exit(0);
}

const rows = (target === 'sample'
  ? db.prepare(`
      SELECT id, url, title, company, source, description, LENGTH(description) len
      FROM label_sample
      WHERE LENGTH(description) < ?
      ORDER BY human_label IS NOT NULL, display_order
      LIMIT ?
    `)
  : db.prepare(`
      SELECT id, url, title, company, source, description, LENGTH(description) len
      FROM jobs
      WHERE description IS NOT NULL AND LENGTH(description) < ?
        AND status NOT IN ('ARCHIVED', 'DEAD', 'EXPIRED')
      ORDER BY score DESC
      LIMIT ?
    `)
).all(minLength, limit) as { id: string; url: string; title: string; company: string; source: string; description: string; len: number }[];

console.log(`${rows.length} ${target === 'sample' ? 'sample rows' : 'jobs'} with a description under ${minLength} characters\n`);

const updateJob = db.prepare('UPDATE jobs SET description = ? WHERE id = ?');
const updateSample = db.prepare('UPDATE label_sample SET description = ? WHERE url = ?');
const markDead = db.prepare(`
  UPDATE jobs SET status = 'DEAD', status_source = 'system', status_changed_at = ?
  WHERE id = ? AND status NOT IN ('DEAD', 'EXPIRED', 'APPLIED', 'INTERVIEW')
`);
const clearStaleLabel = db.prepare(`
  UPDATE label_sample SET human_label = NULL, labelled_at = NULL
  WHERE url = ? AND human_label IS NOT NULL
`);

const tally: Record<Outcome, number> = { enriched: 0, 'no-better': 0, blocked: 0, gone: 0, error: 0 };
let gained = 0;
let marked = 0;

for (const [i, r] of rows.entries()) {
  const res = await fetchDescription(r.url, r.description ?? '');
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

  // APPLIED and INTERVIEW are excluded in the statement: a posting coming down
  // after Tim applied is normal and must not erase the application.
  if (outcome === 'gone' && markGone && confirm && target === 'jobs') {
    marked += markDead.run(new Date().toISOString(), r.id).changes;
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
if (markGone) {
  console.log(confirm ? `marked DEAD: ${marked}` : `would mark DEAD: ${tally.gone}`);
}
if (!confirm) console.log('\nDRY RUN: nothing written. Pass --confirm.');
