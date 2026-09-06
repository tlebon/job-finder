/**
 * What Tim tends to respond to, learned from his own labels.
 *
 * His idea: when writing "why this company", show the parts of the posting that
 * match the things he usually likes. The material for that already exists -
 * 480 hand labels, roughly 90 of them yes - so preference can be estimated
 * rather than guessed.
 *
 * A term's weight is the log-odds of appearing in a posting he wanted against
 * one he did not. That is deliberately not the same as "common in postings he
 * liked": "engineer" is in almost every yes, and in almost every no as well, so
 * it says nothing. What matters is the difference.
 *
 * This surfaces evidence, never an answer. The sentences are the posting's own
 * words, offered as raw material for him to write from.
 */

const STOP = new Set(
  ('a an the and or but if then than that this these those we our us you your they their it its is are was were be been being to of in on for with at by from as have has had do does did will would can could should ' +
   'not no nor so such very more most other another each any all some who whom which what when where how why also into over under about across ' +
   'role position job team company work working candidate applicant apply application hiring join looking').split(' ')
);

function terms(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}][\p{L}\p{N}+#.-]{2,}/gu) ?? [])
    // Trailing punctuation was left attached, so "platform." and "development."
    // counted as terms distinct from "platform" and "development" - splitting
    // each one's evidence across two entries.
    .map(t => t.replace(/[.\-]+$/, ''))
    .filter(t => t.length > 2 && !STOP.has(t));
}

export interface LabelledText { text: string; liked: boolean }

/**
 * Log-odds per term. Smoothed, because a term appearing in three yes-postings
 * and no no-postings would otherwise get an infinite weight and dominate.
 */
export function learnPreferences(labelled: LabelledText[], minDocs = 4, minShare = 0.08): Map<string, number> {
  const yes = new Map<string, number>();
  const no = new Map<string, number>();
  let nYes = 0, nNo = 0;

  for (const row of labelled) {
    const seen = new Set(terms(row.text));
    const target = row.liked ? yes : no;
    if (row.liked) nYes++; else nNo++;
    for (const t of seen) target.set(t, (target.get(t) ?? 0) + 1);
  }
  if (!nYes || !nNo) return new Map();

  const weights = new Map<string, number>();
  for (const t of new Set([...yes.keys(), ...no.keys()])) {
    const y = yes.get(t) ?? 0;
    const n = no.get(t) ?? 0;
    // Too rare to estimate. Without this the list fills with terms seen twice.
    if (y + n < minDocs) continue;

    // And too rare to be characteristic. A term appearing in three of ninety
    // liked postings can still carry a high log-odds if it appears in none of
    // the disliked ones, which is how "because", "ran" and "staying" ended up
    // marked as things Tim responds to. Being distinctive is not enough - it
    // also has to be common in what he likes.
    if (y / nYes < minShare) continue;

    const pYes = (y + 0.5) / (nYes + 1);
    const pNo = (n + 0.5) / (nNo + 1);
    weights.set(t, Math.log(pYes / pNo));
  }
  return weights;
}

export interface Highlight { sentence: string; score: number; matched: string[] }

/**
 * Sentences from a posting that carry what he tends to like.
 *
 * Scored by mean rather than sum, so a long sentence does not win simply by
 * containing more words - the same reason the ranking model caps its terms.
 */
export function highlight(text: string, weights: Map<string, number>, limit = 3): Highlight[] {
  const sentences = (text ?? '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map(s => s.trim())
    .filter(s => s.length > 40 && s.length < 400);

  return sentences
    .map(sentence => {
      const seen = [...new Set(terms(sentence))];
      const scored = seen
        .map(t => ({ t, w: weights.get(t) ?? 0 }))
        // 0.7 rather than 0.25: at the lower threshold a sentence qualified on
        // four barely-positive words, so the top highlight was scale-bragging
        // about Docker pulls and Fortune 50 logos. Roughly twice as likely in a
        // liked posting as a disliked one is the bar worth reporting.
        .filter(x => x.w > 0.7)
        .sort((a, b) => b.w - a.w);
      const score = scored.length ? scored.reduce((a, x) => a + x.w, 0) / Math.sqrt(seen.length) : 0;
      return { sentence, score, matched: scored.slice(0, 4).map(x => x.t) };
    })
    // Three matches, not two: with two, a sentence could qualify on a pair of
    // incidental words.
    .filter(h => h.score > 0 && h.matched.length >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
