/**
 * What range restriction does to a measurement.
 *
 * Tim's applications are the top of the model's own ranking: the candidates
 * page sorts by AI ranking and he applies to what he sees. Evaluating on them
 * would restrict the sample to the band where the score has almost no variance
 * left, and AUC is made of that variance.
 *
 * Same model, same labels, only the slice changes:
 *
 *   full sample        n=480  pos=90  base rate=18.8%  AUC=0.782
 *   top 50% by score   n=240  pos=76  base rate=31.7%  AUC=0.639
 *   top 20% by score   n= 96  pos=46  base rate=47.9%  AUC=0.519
 *
 * A working ranker measured in the band it already sorted looks like a coin
 * flip. This is the same mistake as the earlier "score does not rank" claim,
 * which came from a sample drawn highest-score-first.
 *
 * Restricted to the development batch, for the same reason every other tuning
 * question is: the rejects holdout is measured once, at the end.
 *
 * Usage: npx tsx src/eval-range-restriction.ts   (needs data/labels.jsonl)
 */
import { readFileSync } from 'node:fs';
import { batchOf } from './labels/batches.js';
import { loadModel, scoreJob } from './model/score.js';

interface Row {
  title: string; text: string; source: string; location: string;
  stratum: string; human_label: number | null;
}

const rows: Row[] = readFileSync('data/labels.jsonl', 'utf8')
  .split('\n').filter(l => l.trim()).map(l => JSON.parse(l))
  .filter((r: Row) => r.human_label !== null && r.text)
  .filter((r: Row) => batchOf(r.stratum).id === 'source-stratified');

const model = loadModel();
const scored = rows.map(r => ({
  y: Number(r.human_label),
  s: scoreJob({ title: r.title, description: r.text, source: r.source, location: r.location },
    model).logit,
}));

/** Rank-based AUC, ties averaged. */
function auc(items: { y: number; s: number }[]): number | null {
  const pos = items.filter(i => i.y === 1).length;
  const neg = items.length - pos;
  if (!pos || !neg) return null;
  const sorted = [...items].sort((a, b) => a.s - b.s);
  const ranks = new Array(sorted.length);
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

const byScore = [...scored].sort((a, b) => b.s - a.s);
const pct = (n: number) => `${(100 * n).toFixed(1)}%`;

console.log(`full sample            n=${scored.length}  pos=${scored.filter(r => r.y === 1).length}`
  + `  base rate=${pct(scored.filter(r => r.y === 1).length / scored.length)}`
  + `  AUC=${auc(scored)!.toFixed(3)}`);

for (const frac of [0.5, 0.3, 0.2, 0.1]) {
  const top = byScore.slice(0, Math.round(byScore.length * frac));
  const a = auc(top);
  const pos = top.filter(r => r.y === 1).length;
  console.log(`top ${pct(frac).padStart(5)} by score   n=${String(top.length).padStart(3)}  pos=${String(pos).padStart(3)}`
    + `  base rate=${pct(pos / top.length)}`
    + `  AUC=${a === null ? 'undefined' : a.toFixed(3)}`);
}
