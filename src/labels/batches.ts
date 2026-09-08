/**
 * Which labelling epoch a row came from.
 *
 * `label_sample` holds three batches drawn under three different rules, and the
 * only thing distinguishing them is the shape of the `stratum` string. That was
 * fragile: the rule "exclude triage" was hardcoded separately in
 * eval-gate-vs-human.ts, holdout.py and three_way.py, and nothing tied those
 * three copies together or said why. The registry is the shared definition, in
 * JSON so Python reads the same file.
 */
import registry from './batches.json' with { type: 'json' };

export interface LabelBatch {
  id: string;
  name: string;
  match: { equals?: string; prefix?: string; default?: boolean };
  drawn: string;
  command: string;
  population: string;
  /** How rows were chosen: a probability sample, or the top of a ranking. */
  selection: 'probability' | 'ranked';
  /** Whether a model may be scored on these rows at all. */
  evalEligible: boolean;
  /** Whether the labeller could infer anything about the batch's composition. */
  blind: 'yes' | 'partial' | 'no';
  why: string;
  use: string;
}

// Imported rather than read from disk: this module is bundled into the Next
// app through the @shared alias, where import.meta.url points into the bundle
// and a readFileSync would not find the file. Python reads the same JSON.
export const BATCHES: LabelBatch[] = registry.batches as unknown as LabelBatch[];

/** First match wins, so the default entry must stay last in the JSON. */
export function batchOf(stratum: string): LabelBatch {
  for (const b of BATCHES) {
    if (b.match.equals !== undefined && stratum === b.match.equals) return b;
    if (b.match.prefix !== undefined && stratum.startsWith(b.match.prefix)) return b;
    if (b.match.default) return b;
  }
  throw new Error(`no batch matches stratum "${stratum}" and no default is registered`);
}

/** The rows a model may be scored on. Everything else trains only. */
export function evalEligible(stratum: string): boolean {
  return batchOf(stratum).evalEligible;
}
