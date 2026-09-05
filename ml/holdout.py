"""
The held-out evaluation. Touched once.

The first 280 rows Tim labelled are the development set and are contaminated:
roughly a dozen experiments were run against them - feature sets, thresholds,
ordinal versus binary, four classifier families - and every one of those choices
was made while looking at those labels. Cross-validation does not protect
against that.

These 200 were drawn from stored rejects afterwards, labelled without any of
them being seen, and never used for tuning. This is the only unbiased number in
the project.

Whatever it says, it stands. Tuning anything in response would spend the one
clean measurement available.

Usage: ml/.venv/bin/python ml/holdout.py
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


def read(p: str) -> list[dict]:
    return [json.loads(l) for l in Path(p).read_text().split("\n") if l.strip()]


def key(r: dict) -> str:
    return f"{(r.get('title') or '').strip().lower()}|{(r.get('company') or '').strip().lower()}"


def frame(rows: list[dict]) -> pd.DataFrame:
    return pd.DataFrame({
        "title": [r.get("title") or "" for r in rows],
        "text": [r.get("text") or "" for r in rows],
        "source": [r.get("source") or "" for r in rows],
    })


def main() -> None:
    labels = [r for r in read("data/labels.jsonl")
              if r.get("human_label") is not None and r.get("text")
              # Triage rows are the live candidate list ranked best-first, not a
              # random draw. Including them would put a deliberately skewed
              # sample into an evaluation that assumes one.
              and r.get("stratum") != "triage"]
    held = [r for r in labels if str(r.get("stratum", "")).startswith("reject|")]
    dev = [r for r in labels if not str(r.get("stratum", "")).startswith("reject|")]

    y = np.array([int(r["human_label"]) for r in held])
    w = np.array([1.0 / r["sampling_prob"] for r in held])
    print(f"held-out {len(held)} rows, {y.sum()} of them jobs Tim would consider")
    print(f"(trained on the corpus plus the {len(dev)}-row dev set, both excluded from these rows)\n")

    # Everything the labelled corpus can teach, with every held-out row removed.
    held_keys = {key(r) for r in held}
    train = [r for r in read("data/train.jsonl")
             if r.get("text") and len(r["text"]) > 100 and key(r) not in held_keys]
    print(f"training on {len(train)} corpus rows")

    pipe = Pipeline([
        ("f", ColumnTransformer([
            ("t", TfidfVectorizer(min_df=3, sublinear_tf=True, ngram_range=(1, 2)), "title"),
            ("b", TfidfVectorizer(min_df=3, sublinear_tf=True, max_features=60000, stop_words="english"), "text"),
            ("src", OneHotEncoder(handle_unknown="ignore"), ["source"]),
        ])),
        ("clf", LogisticRegression(max_iter=3000)),
    ])
    pipe.fit(frame(train), np.array([r["good"] for r in train]))

    rank = {"AUTO_DISMISS": 0, "MAYBE": 1, "GOOD_FIT": 2, "STRONG_FIT": 3}
    scores = {
        "LR model": pipe.predict_proba(frame(held))[:, 1],
        "regex score": np.array([float(r.get("regex_score") or 0) for r in held]),
        "AI reviewer": np.array(
            [rank[r["ai_suggestion"]] if r.get("ai_suggestion") in rank else -1 for r in held],
            dtype=float),
    }

    print(f"\n{'scorer':14s}{'AUC':>7}   recall at keep 10/20/30/50%")
    for name, s in scores.items():
        c = dict(recall_curve(y, s))
        print(f"{name:14s}{auc(y, s):>7.3f}   " + "  ".join(f"{100*c[m]:5.1f}%" for m in (0.1, 0.2, 0.3, 0.5)))

    print(f"\n{'scorer':14s}weighted recall at a 30% keep rate")
    for name, s in scores.items():
        order = np.argsort(-s)
        cum = np.cumsum(w[order])
        cut = cum <= 0.30 * w.sum()
        kept = w[order][cut & (y[order] == 1)].sum()
        print(f"{name:14s}{100*kept/w[y == 1].sum():>27.1f}%")

    # 28 positives is small. Say how small rather than implying precision.
    rng = np.random.default_rng(0)
    print(f"\n{'scorer':14s}95% interval on AUC (bootstrap, {len(held)} rows)")
    for name, s in scores.items():
        boots = []
        for _ in range(2000):
            idx = rng.integers(0, len(y), len(y))
            if len(np.unique(y[idx])) < 2:
                continue
            boots.append(auc(y[idx], s[idx]))
        lo, hi = np.percentile(boots, [2.5, 97.5])
        print(f"{name:14s}[{lo:.3f}, {hi:.3f}]")


if __name__ == "__main__":
    main()
