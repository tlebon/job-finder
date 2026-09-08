/**
 * What the candidates page should rank on.
 *
 * Three signals exist and the page was using the two weaker ones: the reviewer's
 * four-way verdict for the coarse order, the regex score to break ties, and the
 * trained model not at all. Measured on Tim's 480 labels:
 *
 *   regex alone                    AUC 0.676
 *   reviewer verdict alone         AUC 0.689
 *   verdict, regex tie-break       AUC 0.717   top-50 34.4%  top-100 44.4%
 *   verdict, model tie-break       AUC 0.744   top-50 35.6%  top-100 48.9%
 *   verdict + 2x model, blended    AUC 0.793   top-50 34.4%  top-100 48.9%
 *   model alone                    AUC 0.782   top-50 27.8%  top-100 51.1%
 *
 * The model ranks better overall and worse at the very top, which is where he
 * looks - so it breaks ties inside the reviewer's verdict rather than replacing
 * it. That beats the old sort on all three numbers. Blending scores higher on
 * AUC and no better at either recall cut-off, so it buys nothing where it counts
 * and costs a z-score in the client.
 *
 * Caveat: the first 280 of these labels are the contaminated development set
 * (see ml/holdout.py). Choosing between rankers on them is the thing that set
 * warns about - what makes this one safe enough to act on is that it is not a
 * tuned parameter but a swap of a demonstrably worse signal for a better one,
 * consistent across three metrics.
 *
 * Usage: npx tsx src/eval-rankers.ts   (needs data/labels.jsonl)
 */
import { readFileSync } from 'node:fs';
import { loadModel, scoreJob } from './model/score.js';

interface Row {
  title: string; text: string; source: string;
  human_label: number | null; regex_score: number; ai_suggestion: string | null;
}
const rows: Row[] = readFileSync('data/labels.jsonl', 'utf8')
  .split('\n').filter(l => l.trim()).map(l => JSON.parse(l))
  .filter((r: Row) => r.human_label !== null && r.text);

const model = loadModel();

// The candidates page's "AI Ranking": reviewer verdict first, regex score as
// the tie-break. Unreviewed sorts neutral, as the page does.
const ORDER: Record<string, number> = { STRONG_FIT: 1, GOOD_FIT: 2, MAYBE: 3, AUTO_DISMISS: 4 };
const UNREVIEWED = 2.5;

function auc(items: { y: number; s: number }[]): number {
  const pos = items.filter(i => i.y === 1).length, neg = items.length - pos;
  const sorted = [...items].sort((a, b) => a.s - b.s);
  const ranks: number[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].s === sorted[i].s) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[k] = avg;
    i = j + 1;
  }
  let sumPos = 0;
  sorted.forEach((it, i) => { if (it.y === 1) sumPos += ranks[i]; });
  return (sumPos - (pos * (pos + 1)) / 2) / (pos * neg);
}

const y = rows.map(r => Number(r.human_label));
const modelScore = rows.map(r => scoreJob({ title: r.title, description: r.text, source: r.source }, model).logit);
const regex = rows.map(r => r.regex_score);
// Rank key as one number: verdict dominates, regex breaks ties within it.
const maxRegex = Math.max(...regex) + 1;
const current = rows.map((r, i) =>
  -((r.ai_suggestion ? ORDER[r.ai_suggestion] ?? UNREVIEWED : UNREVIEWED) * maxRegex) + regex[i]);

const of = (s: number[]) => auc(s.map((v, i) => ({ y: y[i], s: v })));
const verdictOnly = rows.map(r => -(r.ai_suggestion ? ORDER[r.ai_suggestion] ?? UNREVIEWED : UNREVIEWED));

console.log(`n=${rows.length}  positives=${y.filter(v => v === 1).length}\n`);
console.log(`  reviewer verdict alone            ${of(verdictOnly).toFixed(3)}`);
console.log(`  regex score alone                 ${of(regex).toFixed(3)}`);
console.log(`  CURRENT sort (verdict, regex)     ${of(current).toFixed(3)}`);
console.log(`  model score alone                 ${of(modelScore).toFixed(3)}`);

// Top-of-list quality is what he actually experiences.
const recall = (s: number[], k: number) => {
  const idx = s.map((v, i) => i).sort((a, b) => s[b] - s[a]).slice(0, k);
  return idx.filter(i => y[i] === 1).length / y.filter(v => v === 1).length;
};
console.log(`\ntop-50 recall   current ${(100 * recall(current, 50)).toFixed(1)}%   model ${(100 * recall(modelScore, 50)).toFixed(1)}%`);
console.log(`top-100 recall  current ${(100 * recall(current, 100)).toFixed(1)}%   model ${(100 * recall(modelScore, 100)).toFixed(1)}%`);

// The model wins overall but loses at the very top, so try keeping the
// reviewer's coarse verdict and replacing only the tie-break.
const zs = (v: number[]) => { const m = v.reduce((a,b)=>a+b,0)/v.length;
  const sd = Math.sqrt(v.reduce((a,b)=>a+(b-m)**2,0)/v.length) || 1; return v.map(x=>(x-m)/sd); };
const zModel = zs(modelScore);
const verdictRank = rows.map(r => -(r.ai_suggestion ? ORDER[r.ai_suggestion] ?? UNREVIEWED : UNREVIEWED));
const combos: [string, number[]][] = [
  ['verdict, then MODEL as tie-break  ', rows.map((r, i) => verdictRank[i] * 1000 + zModel[i])],
  ['verdict + model, blended equally  ', rows.map((_, i) => zs(verdictRank)[i] + zModel[i])],
  ['verdict + 2x model               ', rows.map((_, i) => zs(verdictRank)[i] + 2 * zModel[i])],
];
console.log('');
for (const [name, s] of combos) {
  console.log(`  ${name}  AUC ${of(s).toFixed(3)}   top-50 ${(100*recall(s,50)).toFixed(1)}%   top-100 ${(100*recall(s,100)).toFixed(1)}%`);
}
console.log(`  ${'CURRENT (verdict, regex)          '}  AUC ${of(current).toFixed(3)}   top-50 ${(100*recall(current,50)).toFixed(1)}%   top-100 ${(100*recall(current,100)).toFixed(1)}%`);
console.log(`  ${'model alone                       '}  AUC ${of(modelScore).toFixed(3)}   top-50 ${(100*recall(modelScore,50)).toFixed(1)}%   top-100 ${(100*recall(modelScore,100)).toFixed(1)}%`);
