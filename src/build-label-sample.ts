#!/usr/bin/env tsx
/**
 * Draw a pre-gate sample for Tim to label by hand.
 *
 * Fetches every source, partitions on filterJob(), and samples across
 * source x gate-passed strata. The rejects are the point: they are never
 * stored otherwise, so nothing in the database can tell us what the gate loses.
 *
 * Allocation is proportional to stratum size with a floor, so a small stratum
 * still gets looked at, and each row records the probability it was drawn with
 * so estimates can be weighted back to the raw stream afterwards.
 *
 * Usage:
 *   npx tsx src/build-label-sample.ts --dry-run
 *   npx tsx src/build-label-sample.ts --confirm [--target=300] [--floor=8]
 *   npx tsx src/build-label-sample.ts --from=rejects --confirm [--target=200]
 *   npx tsx src/build-label-sample.ts --from=active --confirm [--target=300]
 *
 * --from=active is triage rather than sampling: the live candidate list, best
 * first by model score, queued into the same keyboard-driven UI. Every yes is a
 * job worth applying to rather than only a label, which is the point - scrolling
 * a page of 800 is not a decision procedure.
 *
 * Those rows carry stratum 'triage' and a sampling probability of 1, because
 * they are not a random draw and must never be mistaken for one. The evaluation
 * scripts exclude them by that marker.
 *
 * --from=rejects draws a second batch out of rejected_jobs, which the first
 * batch could not reach because rejects were not stored then. It skips the
 * rules that reject on job function - account executive, recruiting, marketing,
 * design, product management, legal, customer success - which were measured
 * against Tim's own labels at zero false negatives over 43 matches. Spending
 * fifteen seconds each to confirm those again buys nothing.
 *
 * What it keeps is where the gate actually loses: the 1,522 rejected for no
 * reason beyond failing to match a pass rule, and the rules that reject on
 * level or stack, which were 25-33% wrong. Strata are bands of model score, so
 * the uncertain middle is sampled more heavily than the confident ends - each
 * with its own recorded probability, so estimates still weight back.
 */

import { createHash } from 'node:crypto';
import { config } from 'dotenv';
import { fetchAllJobs } from './sources/index.js';
import { filterJob } from './filters/jobFilter.js';
import { cleanJobDescription } from './utils/jobText.js';
import { insertLabelRows, labelProgress } from './storage/labelSample.js';
import { db } from './storage/db.js';
import { scoreJob } from './model/score.js';
import type { RawJob } from './types.js';

config({ quiet: true });

const arg = (n: string, d: number) =>
  Number(process.argv.find(a => a.startsWith(`--${n}=`))?.split('=')[1] ?? d);

const target = arg('target', 300);
const floor = arg('floor', 8);
const confirm = process.argv.includes('--confirm');

const fromRejects = process.argv.includes('--from=rejects');
const fromActive = process.argv.includes('--from=active');

if (fromActive) {
  const rows = db.prepare(`
    SELECT id, url, title, company, location, description, source, score,
           COALESCE(model_score, 0) model_score, ai_suggestion, ai_reach
    FROM jobs
    WHERE status NOT IN ('NOT_FIT', 'ARCHIVED', 'DEAD', 'EXPIRED', 'APPLIED', 'INTERVIEW')
      AND LENGTH(description) > 400
      AND url NOT IN (SELECT url FROM label_sample)
    ORDER BY
      CASE ai_suggestion WHEN 'STRONG_FIT' THEN 0 WHEN 'GOOD_FIT' THEN 1
                         WHEN 'MAYBE' THEN 2 ELSE 3 END,
      model_score DESC,
      score DESC
    LIMIT ?
  `).all(target) as {
    id: string; url: string; title: string; company: string; location: string;
    description: string; source: string; score: number; model_score: number;
    ai_suggestion: string | null; ai_reach: string | null;
  }[];

  console.log(`${rows.length} active candidates queued for triage, best first`);
  const byVerdict = rows.reduce<Record<string, number>>((a, r) => {
    const k = `${r.ai_suggestion ?? 'unreviewed'}/${r.ai_reach ?? '-'}`;
    a[k] = (a[k] ?? 0) + 1;
    return a;
  }, {});
  for (const [k, n] of Object.entries(byVerdict).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`  ${k.padEnd(24)}${n}`);
  }

  const start = ((db.prepare('SELECT MAX(display_order) m FROM label_sample').get() as { m: number | null }).m ?? 0) + 1;
  const picked = rows.map((r, i) => ({
    id: `ls_${createHash('sha1').update(r.url).digest('hex').slice(0, 24)}`,
    source: r.source, title: r.title, company: r.company,
    location: r.location || 'Not stated',
    description: r.description, url: r.url,
    gate_passed: 1, regex_score: r.score,
    // Not a random draw, and marked so nothing mistakes it for one.
    stratum: 'triage', sampling_prob: 1, stratum_size: rows.length,
    // Ranked order is kept: the best candidates first, so stopping early still
    // means having seen the best of them.
    display_order: start + i,
  }));

  console.log(`\nTotal to triage: ${picked.length}`);
  if (!confirm) {
    console.log('DRY RUN: pass --confirm to queue.');
    process.exit(0);
  }
  const n = insertLabelRows(picked);
  const p = labelProgress();
  console.log(`Queued ${n}. ${p.labelled}/${p.total} done overall.`);
  process.exit(0);
}

/**
 * Rules that reject on what the job *is*. Measured at zero false negatives over
 * 43 of Tim's labels, so re-confirming them costs his attention for nothing.
 * Rules about seniority or stack are deliberately absent: /staff .../ was 33%
 * wrong and Backend-only 25% wrong, which is exactly what needs labelling.
 */
const FUNCTION_RULES = /(account executive|account manager|\\bsales\\b|business development|\\bmarket(ing|er)\\b|\\brecruiter\\b|customer success|\\bcounsel\\b|product designer|\\bit support\\b|head of)/i;

if (fromRejects) {
  const rows = db.prepare(`
    SELECT url, title, company, location, description, source, score, reason
    FROM rejected_jobs
    WHERE LENGTH(description) > 400
      AND url NOT IN (SELECT url FROM label_sample)
  `).all() as {
    url: string; title: string; company: string; location: string;
    description: string; source: string; score: number; reason: string;
  }[];

  const worth = rows.filter(r => !FUNCTION_RULES.test(r.reason));
  console.log(`${rows.length} stored rejects, ${worth.length} after skipping the function rules`);

  // Bands of model score: the middle is where a label changes a decision, the
  // ends are where it merely confirms one.
  const band = (p: number) =>
    p < 0.05 ? 'confident-no' : p < 0.15 ? 'low' : p < 0.35 ? 'uncertain' : 'high';
  const share: Record<string, number> = { 'confident-no': 0.1, low: 0.25, uncertain: 0.45, high: 0.2 };

  const strata = new Map<string, typeof worth>();
  for (const r of worth) {
    const p = scoreJob({ title: r.title, description: r.description, source: r.source }).probability;
    const key = band(p);
    if (!strata.has(key)) strata.set(key, []);
    strata.get(key)!.push(r);
  }

  console.log('\nband           population  sampled  p(draw)');
  const picked: Parameters<typeof insertLabelRows>[0] = [];
  for (const [key, pool] of strata) {
    const take = Math.min(pool.length, Math.round(target * (share[key] ?? 0.25)));
    const prob = take / pool.length;
    console.log(`${key.padEnd(14)}${String(pool.length).padStart(11)}${String(take).padStart(9)}   ${prob.toFixed(3)}`);
    for (const r of [...pool].sort(() => Math.random() - 0.5).slice(0, take)) {
      picked.push({
        id: `ls_${createHash('sha1').update(r.url).digest('hex').slice(0, 24)}`,
        source: r.source, title: r.title, company: r.company,
        location: r.location || 'Not stated',
        description: r.description, url: r.url,
        gate_passed: 0, regex_score: r.score,
        stratum: `reject|${key}`, sampling_prob: prob, stratum_size: pool.length,
        display_order: 0,
      });
    }
  }

  const existing = db.prepare('SELECT MAX(display_order) m FROM label_sample').get() as { m: number | null };
  const start = (existing.m ?? 0) + 1;
  [...picked].sort(() => Math.random() - 0.5).forEach((row, i) => { row.display_order = start + i; });

  console.log(`\nTotal to add: ${picked.length}`);
  if (!confirm) {
    console.log('DRY RUN: pass --confirm to write.');
    process.exit(0);
  }
  const n = insertLabelRows(picked);
  const p2 = labelProgress();
  console.log(`Added ${n}. Queue now ${p2.labelled}/${p2.total} labelled.`);
  process.exit(0);
}

console.log('Fetching all sources...');
const all = await fetchAllJobs();

interface Candidate { job: RawJob; passed: boolean; score: number; stratum: string }

const seen = new Set<string>();
const strata = new Map<string, Candidate[]>();

for (const job of all) {
  if (!job.url || seen.has(job.url)) continue;
  if (!job.description || job.description.length < 200) continue;
  seen.add(job.url);

  const r = filterJob(job);
  const stratum = `${job.source}|${r.passed ? 'pass' : 'reject'}`;
  if (!strata.has(stratum)) strata.set(stratum, []);
  strata.get(stratum)!.push({ job, passed: r.passed, score: r.score, stratum });
}

const population = [...strata.values()].reduce((a, v) => a + v.length, 0);
console.log(`\n${population} unique postings with a usable description\n`);

// Proportional allocation with a floor, then scaled back to the target so the
// floor does not quietly inflate the total.
const sizes = [...strata.entries()].map(([k, v]) => [k, v.length] as const);
const raw = sizes.map(([k, n]) => [k, Math.max(floor, Math.round((n / population) * target))] as const);
const rawTotal = raw.reduce((a, [, n]) => a + n, 0);
const alloc = new Map(raw.map(([k, n]) => [k, Math.min(
  strata.get(k)!.length,
  Math.max(1, Math.round(n * (target / rawTotal)))
)]));

console.log('stratum'.padEnd(28) + 'population'.padStart(11) + 'sampled'.padStart(9) + '     p(draw)');
const picked: Parameters<typeof insertLabelRows>[0] = [];

for (const [stratum, pool] of strata) {
  const take = alloc.get(stratum)!;
  const prob = take / pool.length;
  console.log(stratum.padEnd(28) + String(pool.length).padStart(11) + String(take).padStart(9) + `     ${prob.toFixed(3)}`);

  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  for (const c of shuffled.slice(0, take)) {
    picked.push({
      // Hashed, not truncated. This was base64 of the URL cut to 40 characters,
      // and every Greenhouse or Ashby posting shares that prefix - so INSERT OR
      // IGNORE silently collapsed 291 sampled rows into 41, leaving a subset
      // that was no longer the stratified draw it reported being.
      id: `ls_${createHash('sha1').update(c.job.url).digest('hex').slice(0, 24)}`,
      source: c.job.source,
      title: c.job.title,
      company: c.job.company,
      location: c.job.location || 'Not stated',
      description: cleanJobDescription(c.job.description),
      url: c.job.url,
      gate_passed: c.passed ? 1 : 0,
      regex_score: c.score,
      stratum,
      sampling_prob: prob,
      stratum_size: pool.length,
      display_order: 0,
    });
  }
}

// One shuffle across the whole sample, so the labelling order carries no
// information about stratum, source or the gate's opinion.
const order = [...picked].sort(() => Math.random() - 0.5);
order.forEach((row, i) => { row.display_order = i; });

console.log(`\nTotal to label: ${picked.length}`);
console.log(`  gate passed:  ${picked.filter(p => p.gate_passed === 1).length}`);
console.log(`  gate rejected:${picked.filter(p => p.gate_passed === 0).length}`);

if (!confirm) {
  console.log('\nDRY RUN: pass --confirm to write the sample.');
  process.exit(0);
}

const inserted = insertLabelRows(picked);
const p = labelProgress();
console.log(`\nInserted ${inserted} rows. Sample now ${p.labelled}/${p.total} labelled.`);
console.log('Label them at /label');
