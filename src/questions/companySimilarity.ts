/**
 * Which companies resemble each other, for finding a prior answer worth reusing.
 *
 * The useful previous answer to "Why Langfuse?" is not another "why us" picked
 * at random - it is the one written for a company *like* Langfuse. Dev tools,
 * open source, small, Berlin. Proton is a closer neighbour than Perplexity even
 * though all three ask the same words.
 *
 * Deliberately TF-IDF rather than embeddings. Tim will have questions filed
 * against ten or twenty companies, and among twenty the arithmetic is trivial -
 * an encoder in the deploy would cost 23MB and a second inference path to rank
 * a list that fits on a screen. Company blurbs also share vocabulary in a way
 * short questions do not: two privacy companies both say "encryption" and
 * "open source", so the paraphrase problem that breaks TF-IDF on "Why Granola?"
 * versus "What draws you to us?" is much weaker here.
 *
 * Upgrade to embeddings when this visibly fails, not before.
 */

/**
 * The part of a posting that describes the company rather than the job.
 *
 * The exact half roleSection() throws away. For ranking, the "About us" blurb
 * is noise that says nothing about the role; for "why this company" it is the
 * only part that matters. Same text, opposite uses.
 */
export function companySection(description: string, limit = 2500): string {
  const text = (description ?? '').trim();
  if (!text) return '';

  // Everything before the requirements start. Failing that, the opening, which
  // is where companies introduce themselves.
  const marker = text.search(
    /(what you'?ll do|responsibilities|your role|the role|what we'?re looking for|requirements|qualifications|your profile|about the (job|role|position)|tech stack|you will)/i
  );
  // 80 characters, not 200: a blurb can be a single sentence, and requiring
  // more meant a short "About us" was discarded and the requirements returned
  // instead - the exact opposite of the intent.
  return (marker > 80 ? text.slice(0, marker) : text.slice(0, limit)).trim();
}

const STOP = new Set(
  ('a an the and or but if then than that this these those we our us you your they their it its is are was were be been being to of in on for with at by from as have has had do does did will would can could should our ' +
   'company team work working role position job opportunity candidate join looking hiring apply application new great strong excellent passionate ' +
   'employees people world global leading innovative mission driven fast paced growing').split(' ')
);

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}+#.-]{1,}/gu) ?? [])
    .filter(t => t.length > 2 && !STOP.has(t));
}

export interface Doc { id: string; text: string }

/**
 * Cosine similarity of every document to one target, highest first.
 *
 * IDF is computed over the documents given, which is the right corpus here:
 * "encryption" is distinctive among a handful of companies Tim has written for,
 * even though it is common across job postings generally.
 */
export function rankBySimilarity(target: Doc, others: Doc[]): { id: string; score: number }[] {
  if (!others.length) return [];

  const all = [target, ...others];
  const docs = all.map(d => tokens(d.text));

  const df = new Map<string, number>();
  for (const d of docs) {
    for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  }

  const vectors = docs.map(d => {
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);

    const v = new Map<string, number>();
    let norm = 0;
    for (const [t, n] of tf) {
      // Smoothed IDF, and it matters more here than anywhere else in the
      // project. Plain log(N/df) with a handful of documents drives shared
      // terms to exactly zero - with two documents, any word appearing in both
      // scores log(1) = 0, so the terms that prove two companies are alike are
      // the ones thrown away and every similarity comes out as 0. Smoothing
      // keeps them positive at any corpus size.
      //
      // Sublinear tf as elsewhere: repetition is not extra evidence.
      const w = (1 + Math.log(n)) * (Math.log((1 + all.length) / (1 + (df.get(t) ?? 0))) + 1);
      if (w <= 0) continue;
      v.set(t, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [t, w] of v) v.set(t, w / norm);
    return v;
  });

  const [a, ...rest] = vectors;
  return rest
    .map((b, i) => {
      let dot = 0;
      // Iterate the smaller side.
      const [small, large] = a.size < b.size ? [a, b] : [b, a];
      for (const [t, w] of small) dot += w * (large.get(t) ?? 0);
      return { id: others[i].id, score: dot };
    })
    .sort((x, y) => y.score - x.score);
}
