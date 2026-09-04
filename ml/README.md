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
