# First-pass gate model

Distil the LLM reviewer into a cheap local ranker, so the expensive review is
spent on the jobs most likely to matter.

## Setup

```
python3 -m venv ml/.venv
ml/.venv/bin/pip install scikit-learn pandas numpy
```

## Getting the data

The exporter runs against the production database, not the local one - the local
`jobs.db` stops around Dec 2025.

```
railway ssh ... "cd /app && npx tsx src/export-training-data.ts" > data/train.jsonl
ml/.venv/bin/python ml/train_baseline.py data/train.jsonl
```

## The labelling epochs

`label_sample` is three batches drawn under three different rules, and the only
thing that ever distinguished them was the shape of the `stratum` string. They
are now named in `src/labels/batches.json`, which `src/labels/batches.ts` and
`ml/batches.py` both read, so `holdout.py`, `three_way.py`,
`eval-gate-vs-human.ts` and the labelling UI cannot disagree about which rows
may be scored on.

| batch | n | labelled | base rate | selection | use |
|---|---|---|---|---|---|
| source-stratified | 280 | 280 | 0.221 | probability | dev set, contaminated |
| rejects-holdout | 200 | 200 | 0.140 | probability | the one clean measurement |
| triage-active | 300 | 9 | 0.778 | ranked, best first | training only |

The base rates are the reason this needed writing down. Triage runs 4x the
others because it is the top of the model's own ranking, and it decays as the
queue descends. `/label` withholds each row's score, verdict and source, but
that only makes it blind per item - a labeller working a queue where nearly
everything is a yes has still been told something. Calling that batch "blind"
was wrong; it is `blind: "partial"` in the registry, and the UI now names the
batch it is serving rather than leaving the skew unlabelled.

Adding a batch means adding an entry, not editing four call sites. First match
wins, so the default entry stays last.

## Tim's own decisions

A third stream, separate from both the corpus and the labelling set:

```
curl -H "Authorization: Bearer $EXPORT_TOKEN" \
  'https://job-finder-production-6560.up.railway.app/api/export/training?set=decisions' \
  > data/decisions.jsonl
```

Every row is a status Tim set himself in the UI (`status_source = 'user'`).
An application costs him an hour, so it is revealed preference rather than an
opinion about relevance - stronger evidence than a label saying "this looks
good".

`decision` is 1 for APPLIED, INTERVIEW, REJECTED and APPROVED, 0 for NOT_FIT.
REJECTED and INTERVIEW are positives because both mean he applied; only the
company changed its mind afterwards, which says nothing about what he wanted.
`applied` separates the four he committed to from a shortlist he did not, so
the two can be weighted differently rather than having the distinction
flattened at export time. `applied_date` is written once, on the first status
implying an application went out, and never overwritten.

**These train. They never evaluate.** Two reasons, and neither is what
"leakage" usually means.

*Range restriction.* They are the top of the model's own ranking - the
candidates page sorts by AI ranking and he applies to what he sees. Restricting
the sample to that band removes the variance AUC is made of.
`src/eval-range-restriction.ts` measures it on the labels we have: same model,
same 480 rows, 0.782 over the full sample and 0.519 over the top 20%. There is
also no denominator - good roles the gate discarded never reach the UI, so
recall cannot be computed from this set at all.

*Circularity.* He made every one of them while looking
at the score, the reviewer's verdict and the badges, which `/api/label`
deliberately withholds for exactly this reason. Rank high, get seen first, get
applied to, become a positive label, rank higher - the metric can climb while
the thing it stands for does not move. Every row carries `blind: false` and
`eval_eligible: false`; `holdout.py` keeps reading `data/labels.jsonl`.

**Where leakage *is* the right word: adding these to training.** Decisions are
drawn from the `jobs` table, and 249 of the 489 labelled rows share an exact
`title|company` with a row in `jobs` (413 share a company, the unit `groups.py`
folds on). Over half the holdout sits in the pool decisions come from, so
`personalise.py` must apply the same `key(r) not in held` filter it already
applies to `train.jsonl`. That guard does not exist yet - the export is built,
the consumption is not.

Bias in training costs a worse model, which is recoverable and visible the
moment you evaluate honestly. Bias in evaluation costs the ability to tell.
That asymmetry is the whole argument for keeping the streams apart.

Unlike the corpus export, this one applies no `ai_suggestion` or description
length filter. A job he applied to that the reviewer never saw is exactly the
row worth keeping.

**As of 8 Sep 2026 the stream is empty.** `status_source` was added after the
UI had already been in use, so no decision carries provenance yet: production
has 0 rows with `status_source = 'user'`. Of the 2,268 NOT_FIT rows with no
source, 2,246 are `AUTO_DISMISS` and so were the reviewer's, leaving 22 that
were plausibly his - 15 of them reviewer/human disagreements (13 STRONG_FIT and
2 MAYBE marked NOT_FIT), all lead, EM or full-stack roles at German non-AI
companies. That is the shape of the ml/llm preference, and it is worth
confirming by hand rather than inferring provenance and shipping the guess as
data.

## Reading the numbers

**The labels are noisy, but less damagingly than the raw flip rate suggests.**
They come from an LLM reviewer that agrees with its own earlier verdict half the
time, with 20% crossing the good/not-good line
(`src/eval-reviewer-consistency.ts`).

An earlier version of this file claimed that capped a perfect ranker at about
0.72 AUC. That was wrong, and the measured 0.863 disproves it. The estimate
assumed flips were spread uniformly across the ranking; they are not. They
concentrate on genuinely borderline jobs sitting in the middle, where a flip
costs almost no AUC. Noise at the decision boundary is far more benign than
noise everywhere, so there is no useful analytic ceiling here - measure instead
of predicting one.

**Every labelled row survived the regex gate.** `filterJobs` discards the rest
before storage, so this measures re-ranking inside an already-filtered pool.
Production recall is (gate recall) x (this), and the first term is only
measurable against the human-labelled pre-gate sample - `/label` in the web app,
scored by `src/eval-gate-vs-human.ts`. That set is the scoreboard; these labels
are only the training signal.

## What the script reports

Baselines first, because the interesting question is what the *text* adds:

- **source only** - five one-hot features. 80,000 Hours runs 69% good and
  RemoteOK 10%, so this is the real bar. A text model that barely beats it has
  learned a lookup table for job boards.
- **description length only** - if this predicts, there is a data artefact.
- **title only**, then **title + body with source withheld** - the honest test of
  whether the posting text carries role signal.
- **title + body + source** - what would actually ship.
- **the regex gate**, on the same rows and the same definition of positive.

Each reports AUC, a recall-versus-keep-rate curve, and a 95% interval from a
cluster bootstrap over companies. The curve matters more than the AUC: the gate
keeps a top slice, so only the ordering near that cut counts, and reporting the
whole curve avoids picking a threshold on the test data.

## Results, 6,523 rows

    source only            0.582  [0.548, 0.615]
    description length     0.587  [0.566, 0.611]
    title only             0.822  [0.801, 0.840]
    title + body           0.858  [0.844, 0.869]
    title + body + source  0.863  [0.851, 0.875]
    regex gate             0.572  [0.526, 0.652]

    keep      model    regex
     10%      31.4%    12.8%
     20%      55.3%    24.6%
     30%      71.9%    34.3%
     50%      92.9%    57.3%

Most of the signal is the title: body text adds 0.036 and source 0.005. That
matters for shipping - a title-only model is small and trivial to export.

Neither number describes production. Both are agreement with the reviewer, over
rows that all survived the gate.

## Splitting

`groups.py` builds connected components over normalised company, normalised
title-plus-company, and near-duplicate text, then splits with
`StratifiedGroupKFold`. Company alone is not enough: the same requisition
arrives under different company strings from different boards, gets reposted
with new ids, and agency listings share boilerplate across unrelated employers.
The script prints how many additional rows the text and title edges merged -
that is what a company-only split would have leaked.

## Deployment

TF-IDF and logistic regression export as JSON - vocabulary, idf, coefficients -
and score in TypeScript as a dot product, so Python stays out of the Railway
deploy.

That does **not** extend to sentence-transformer embeddings, which need the
encoder at inference (onnxruntime-node or transformers.js with a quantised
MiniLM, ~23MB). Decide that before building it, not after.

If the TF-IDF model ships, the export must reproduce sklearn's preprocessing
exactly - lowercasing, accent stripping, and the default token pattern
`(?u)\b\w\w+\b`, which drops single characters. A naive `split(/\W+/)` will not
match, and production has no labels, so nothing will catch the drift. Ship a
golden fixture: 200 rows with Python-computed scores and a test asserting the
TypeScript scorer reproduces them.
