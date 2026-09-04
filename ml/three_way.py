"""
All three scorers, the same rows, Tim's labels as truth.

Earlier comparisons were made across different populations: the regex score
exists for every row, a reviewer verdict only for the 63 the gate kept and
stored, and the model had scored none of them. Measuring the reviewer on the
subset the regex already liked is the range restriction that produced two wrong
answers earlier in the day.

The model is trained with every labelled row held out, matched on title and
company. The gate-rejected rows were never stored so were never in training
anyway; the gate-passed ones were, and scoring a model on its own training data
would flatter it.

Usage: ml/.venv/bin/python ml/three_way.py data/train.jsonl data/labels.jsonl
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

sys.path.insert(0, str(Path(__file__).parent))
from train_baseline import auc, recall_curve  # noqa: E402

GOOD = {"STRONG_FIT", "GOOD_FIT"}


def read(path: str) -> list[dict]:
    return [json.loads(l) for l in Path(path).read_text().split("\n") if l.strip()]


def key(r: dict) -> str:
    return f"{(r.get('title') or '').strip().lower()}|{(r.get('company') or '').strip().lower()}"


def main(train_path: str, labels_path: str) -> None:
    labels = [r for r in read(labels_path) if r.get("human_label") is not None and r.get("text")]
    print(f"{len(labels)} rows Tim labelled")

    held = {key(r) for r in labels}
    train = [r for r in read(train_path) if r.get("text") and len(r["text"]) > 100]
    kept = [r for r in train if key(r) not in held]
    print(f"training on {len(kept)} of {len(train)} corpus rows ({len(train)-len(kept)} held out as overlapping)")

    def frame(rows):
        return pd.DataFrame({
            "title": [r.get("title") or "" for r in rows],
            "text": [r.get("text") or "" for r in rows],
            "source": [r.get("source") or "" for r in rows],
        })

    pipe = Pipeline([
        ("f", ColumnTransformer([
            ("t", TfidfVectorizer(min_df=3, sublinear_tf=True, ngram_range=(1, 2)), "title"),
            ("b", TfidfVectorizer(min_df=3, sublinear_tf=True, max_features=60000, stop_words="english"), "text"),
            ("src", OneHotEncoder(handle_unknown="ignore"), ["source"]),
        ])),
        ("clf", LogisticRegression(max_iter=2000)),
    ])
    pipe.fit(frame(kept), np.array([r["good"] for r in kept]))

    y = np.array([int(r["human_label"]) for r in labels])
    w = np.array([1.0 / r["sampling_prob"] for r in labels])

    scores = {
        "LR model": pipe.predict_proba(frame(labels))[:, 1],
        "regex score": np.array([float(r.get("regex_score") or 0) for r in labels]),
    }

    # The reviewer is ordinal, so rank it rather than collapsing to a bit.
    rank = {"AUTO_DISMISS": 0, "MAYBE": 1, "GOOD_FIT": 2, "STRONG_FIT": 3}
    have_ai = [i for i, r in enumerate(labels) if r.get("ai_suggestion") in rank]
    print(f"reviewer verdicts available for {len(have_ai)} of {len(labels)}\n")
    if len(have_ai) == len(labels):
        scores["AI reviewer"] = np.array([rank[r["ai_suggestion"]] for r in labels], dtype=float)

    print(f"{'scorer':14s}{'AUC':>7}{'  recall at keep 10/20/30/50%':>34}")
    for name, s in scores.items():
        curve = dict(recall_curve(y, s))
        pts = "  ".join(f"{100*curve[m]:5.1f}%" for m in (0.1, 0.2, 0.3, 0.5))
        print(f"{name:14s}{auc(y, s):>7.3f}   {pts}")

    # Weighted back to the stream the strata were drawn from.
    print(f"\n{'scorer':14s}{'weighted recall at a 30% keep rate':>36}")
    for name, s in scores.items():
        order = np.argsort(-s)
        cum = np.cumsum(w[order])
        cut = cum <= 0.30 * w.sum()
        kept_pos = w[order][cut & (y[order] == 1)].sum()
        print(f"{name:14s}{100*kept_pos/w[y == 1].sum():>35.1f}%")

    # Where they disagree is where the choice actually matters.
    if "AI reviewer" in scores:
        m = scores["LR model"]
        a = scores["AI reviewer"]
        m_top = m >= np.quantile(m, 0.7)
        a_top = a >= 2
        print(f"\njobs Tim wants that only the model ranks highly: {int(((y == 1) & m_top & ~a_top).sum())}")
        print(f"jobs Tim wants that only the reviewer likes:     {int(((y == 1) & ~m_top & a_top).sum())}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "data/train.jsonl",
         sys.argv[2] if len(sys.argv) > 2 else "data/labels.jsonl")
