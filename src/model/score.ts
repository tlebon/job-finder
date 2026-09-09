/**
 * Scores a posting with the trained model.
 *
 * This must reproduce scikit-learn's arithmetic exactly. Production has no
 * labels, so a tokenisation difference would degrade ranking silently and
 * permanently - which is why score.test.ts asserts agreement with 200
 * Python-computed scores to 1e-6.
 *
 * The rules being mirrored:
 *   - lowercase, no accent stripping (sklearn's strip_accents defaults to None)
 *   - token pattern (?u)\b\w\w+\b, so single characters are dropped
 *   - sublinear tf: 1 + ln(count)
 *   - each block L2-normalised on its own, then concatenated
 *
 * Stop words need no handling: they were dropped when the vocabulary was fitted,
 * so a lookup simply misses.
 */

import { readFileSync } from 'node:fs';
import { extract } from './features.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Block {
  vocabulary: Record<string, number>;
  idf: number[];
  ngram_max: number;
}

interface Model {
  version: number;
  title: Block;
  body: Block;
  sources: string[];
  /** The structured block, standardised at fit time. See src/model/features.ts. */
  struct: { names: string[]; mean: number[]; scale: number[] };
  offsets: { title: number; body: number; source: number; struct: number };
  coef: number[];
  intercept: number;
}

let cached: Model | null = null;

export function loadModel(): Model {
  if (cached) return cached;
  const here = dirname(fileURLToPath(import.meta.url));
  cached = JSON.parse(readFileSync(join(here, 'model.json'), 'utf8')) as Model;
  return cached;
}

/** sklearn's default token_pattern: two or more word characters. */
const TOKEN = /[\p{L}\p{N}_]{2,}/gu;

export function tokenize(text: string, ngramMax: number): string[] {
  const words = (text ?? '').toLowerCase().match(TOKEN) ?? [];
  if (ngramMax < 2) return words;

  const out = [...words];
  for (let n = 2; n <= ngramMax; n++) {
    for (let i = 0; i + n <= words.length; i++) {
      out.push(words.slice(i, i + n).join(' '));
    }
  }
  return out;
}

/** One TF-IDF block: sublinear tf, idf weighting, L2 normalisation. */
function blockVector(text: string, block: Block): Map<number, number> {
  const counts = new Map<number, number>();
  for (const token of tokenize(text, block.ngram_max)) {
    const idx = block.vocabulary[token];
    if (idx === undefined) continue;
    counts.set(idx, (counts.get(idx) ?? 0) + 1);
  }

  const weighted = new Map<number, number>();
  let sumSquares = 0;
  for (const [idx, count] of counts) {
    const value = (1 + Math.log(count)) * block.idf[idx];
    weighted.set(idx, value);
    sumSquares += value * value;
  }

  if (sumSquares > 0) {
    const norm = Math.sqrt(sumSquares);
    for (const [idx, value] of weighted) weighted.set(idx, value / norm);
  }
  return weighted;
}

export interface Scored {
  /** Probability the reviewer would call this a good fit. */
  probability: number;
  /** Log-odds, for ranking without the sigmoid's compression at the ends. */
  logit: number;
}

export function scoreJob(
  job: { title?: string; description?: string; source?: string; location?: string },
  model: Model = loadModel()
): Scored {
  let z = model.intercept;

  for (const [text, block, offset] of [
    [job.title ?? '', model.title, model.offsets.title],
    [job.description ?? '', model.body, model.offsets.body],
  ] as const) {
    for (const [idx, value] of blockVector(text, block)) {
      z += value * model.coef[offset + idx];
    }
  }

  // One-hot, and unseen sources contribute nothing - matching
  // handle_unknown='ignore' at fit time.
  const at = model.sources.indexOf(job.source ?? '');
  if (at >= 0) z += model.coef[model.offsets.source + at];

  // The structured block, standardised with the mean and scale from fit time.
  // TF-IDF cannot compare 3 years against 10 - both are the token "years" - and
  // these are worth dev AUC 0.810 -> 0.838 and top-50 recall 43.5% -> 51.6%
  // (ml/struct_ablation.py).
  const f = extract(job.title ?? '', job.description ?? '', job.location ?? '');
  model.struct.names.forEach((name, i) => {
    const scale = model.struct.scale[i] || 1;
    z += model.coef[model.offsets.struct + i] * ((f[name] - model.struct.mean[i]) / scale);
  });

  return { probability: 1 / (1 + Math.exp(-z)), logit: z };
}
