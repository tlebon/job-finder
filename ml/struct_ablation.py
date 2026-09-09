"""
Do the structured features earn their place in the shipped model?

export_model.py held them back on a claimed +0.02, which was never measured
against Tim's labels - only against reviewer agreement, which is the thing the
base model is fitted to and so cannot arbitrate.

Scored on the source-stratified batch only. That batch is already contaminated
(ml/holdout.py), which is exactly why it is the right place to make a choice:
choosing between two variants on the rejects holdout would spend the one clean
measurement in the project on a question this size.

Usage: ml/.venv/bin/python ml/struct_ablation.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.compose import ColumnTransformer
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.pipeline import FeatureUnion, Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

sys.path.insert(0, "ml")
from batches import batch_of, eval_eligible  # noqa: E402
from features import matrix  # noqa: E402


def read(p):
    return [json.loads(l) for l in Path(p).read_text().split("\n") if l.strip()]


def key(r):
    return f"{(r.get('title') or '').strip().lower()}|{(r.get('company') or '').strip().lower()}"


class Struct(BaseEstimator, TransformerMixin):
    def fit(self, X, y=None):
        return self

    def transform(self, X):
        return np.array(matrix(X.to_dict("records")), dtype=float)


def frame(rows):
    return pd.DataFrame({
        "title": [r.get("title") or "" for r in rows],
        "text": [r.get("text") or "" for r in rows],
        "source": [r.get("source") or "" for r in rows],
        "location": [r.get("location") or "" for r in rows],
    })


def tfidf_block():
    return ColumnTransformer([
        ("t", TfidfVectorizer(min_df=3, sublinear_tf=True, ngram_range=(1, 2)), "title"),
        ("b", TfidfVectorizer(min_df=3, sublinear_tf=True, max_features=60000,
                              stop_words="english"), "text"),
        ("src", OneHotEncoder(handle_unknown="ignore"), ["source"]),
    ])


def main():
    labels = [r for r in read("data/labels.jsonl")
              if r.get("human_label") is not None and r.get("text")
              and eval_eligible(r.get("stratum", ""))]
    dev = [r for r in labels if batch_of(r.get("stratum", ""))["id"] == "source-stratified"]
    held = {key(r) for r in labels}

    train = [r for r in read("data/train.jsonl")
             if r.get("text") and len(r["text"]) > 100 and key(r) not in held]

    print(f"train {len(train)} rows (holdout keys excluded), dev {len(dev)} rows, "
          f"{sum(int(r['human_label']) for r in dev)} positives\n")

    Xtr, ytr = frame(train), np.array([r["good"] for r in train])
    Xdev, ydev = frame(dev), np.array([int(r["human_label"]) for r in dev])

    variants = {
        "tfidf + source (shipped today)": Pipeline([
            ("f", tfidf_block()), ("clf", LogisticRegression(max_iter=3000))]),
        "tfidf + source + structured  ": Pipeline([
            ("f", FeatureUnion([
                ("tf", tfidf_block()),
                ("struct", Pipeline([("x", Struct()), ("s", StandardScaler())])),
            ])),
            ("clf", LogisticRegression(max_iter=3000))]),
    }

    for name, pipe in variants.items():
        pipe.fit(Xtr, ytr)
        p = pipe.predict_proba(Xdev)[:, 1]
        order = np.argsort(-p)
        top = int(ydev[order[:50]].sum()) / max(1, int(ydev.sum()))
        print(f"  {name}   dev AUC {roc_auc_score(ydev, p):.3f}   top-50 recall {100*top:.1f}%")


if __name__ == "__main__":
    main()
