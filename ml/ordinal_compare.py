"""
Does treating the verdict as ordinal beat collapsing it to binary?

The label has a natural order - AUTO_DISMISS < MAYBE < GOOD_FIT < STRONG_FIT -
and the baseline throws two of its three boundaries away. A gate is a threshold
on a latent score, which is what an ordinal model estimates directly.

Against that: the reviewer's own reliability is worst exactly where the extra
levels live. Of ten jobs first called STRONG_FIT, zero came back STRONG_FIT, so
the STRONG/GOOD boundary is close to pure noise, and modelling it may just fit
that noise. Which effect wins is an empirical question.

Three scorers, identical features and identical folds, all scored on the same
binary task so the numbers are comparable:

  binary       one logistic regression on good vs not-good (the baseline)
  ridge        regression onto the 0-3 rank, score = predicted rank
  cumulative   three logistic regressions on P(y >= k), score = expected level

Usage: ml/.venv/bin/python ml/ordinal_compare.py data/train.jsonl
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.model_selection import StratifiedGroupKFold, cross_val_predict
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

sys.path.insert(0, str(Path(__file__).parent))
from groups import build_groups  # noqa: E402
from train_baseline import auc, recall_curve  # noqa: E402

RANK = {"AUTO_DISMISS": 0, "MAYBE": 1, "GOOD_FIT": 2, "STRONG_FIT": 3}


def features() -> ColumnTransformer:
    return ColumnTransformer([
        ("t", TfidfVectorizer(min_df=3, sublinear_tf=True, ngram_range=(1, 2)), "title"),
        ("b", TfidfVectorizer(min_df=3, sublinear_tf=True, max_features=60000, stop_words="english"), "text"),
        ("src", OneHotEncoder(handle_unknown="ignore"), ["source"]),
    ])


def main(path: str) -> None:
    rows = [json.loads(l) for l in Path(path).read_text().split("\n") if l.strip()]
    rows = [r for r in rows if r.get("text") and len(r["text"]) > 100 and r.get("label") in RANK]
    print(f"{len(rows)} rows")

    y_bin = np.array([r["good"] for r in rows])
    y_ord = np.array([RANK[r["label"]] for r in rows])
    for name, k in RANK.items():
        print(f"  {name:13s} {(y_ord == k).sum()}")

    df = pd.DataFrame({
        "title": [r["title"] for r in rows],
        "text": [r["text"] for r in rows],
        "source": [r["source"] for r in rows],
    })

    groups, _ = build_groups([r["company"] for r in rows], [r["title"] for r in rows], [r["text"] for r in rows])
    cv = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=0)
    splits = list(cv.split(np.zeros(len(y_bin)), y_bin, groups))

    scores = {}

    scores["binary"] = cross_val_predict(
        Pipeline([("f", features()), ("clf", LogisticRegression(max_iter=2000))]),
        df, y_bin, cv=splits, method="predict_proba")[:, 1]

    scores["ridge on rank"] = cross_val_predict(
        Pipeline([("f", features()), ("clf", Ridge(alpha=1.0))]),
        df, y_ord, cv=splits)

    # Cumulative link: P(y >= 1), P(y >= 2), P(y >= 3). Summing them gives the
    # expected level, which is a proper use of the ordering rather than three
    # unrelated one-vs-rest fits.
    cumulative = np.zeros(len(y_ord))
    for k in (1, 2, 3):
        cumulative += cross_val_predict(
            Pipeline([("f", features()), ("clf", LogisticRegression(max_iter=2000))]),
            df, (y_ord >= k).astype(int), cv=splits, method="predict_proba")[:, 1]
    scores["cumulative link"] = cumulative

    print(f"\n{'scorer':18s}{'AUC':>8}   recall at keep 10% / 20% / 30% / 50%")
    for name, s in scores.items():
        curve = dict(recall_curve(y_bin, s))
        pts = "  ".join(f"{100*curve[m]:5.1f}%" for m in (0.1, 0.2, 0.3, 0.5))
        print(f"{name:18s}{auc(y_bin, s):8.3f}   {pts}")

    # The ordering the binary target cannot express: do the top-ranked jobs skew
    # toward STRONG_FIT rather than merely GOOD_FIT?
    print("\nof the top 200 ranked, how many were STRONG_FIT:")
    for name, s in scores.items():
        top = np.argsort(-s)[:200]
        print(f"  {name:18s} {(y_ord[top] == 3).sum():3d} strong, {(y_ord[top] == 2).sum():3d} good")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "data/train.jsonl")
