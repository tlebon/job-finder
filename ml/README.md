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

**A perfect ranker scores about 0.72 AUC here, not 1.0.** The labels come from
an LLM reviewer that agrees with its own earlier verdict half the time, with 20%
crossing the good/not-good line (`src/eval-reviewer-consistency.ts`). Against
labels that noisy the achievable ceiling is roughly 0.72, so a model at 0.70 has
essentially finished and reaching for a transformer at that point is fitting
noise. The regex gate's 0.567 is about 30% of the available headroom - weak, not
worthless.

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
