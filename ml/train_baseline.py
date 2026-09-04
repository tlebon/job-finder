"""
First-pass gate: TF-IDF + logistic regression, and the baselines it has to beat.

Read the numbers with two caps in mind.

The labels come from an LLM reviewer that agrees with its own earlier verdict on
50% of re-reviews, with 20% crossing the good/not-good line. Against labels that
noisy, a *perfect* ranker scores roughly 0.72 AUC, not 1.0. So 0.72 here is the
ceiling, not a mediocre result, and a model at 0.70 has essentially finished.

And every labelled row survived the regex gate, so this measures re-ranking
within an already-filtered pool. Production recall is (gate recall) x (this),
and the first term is only measurable against the human-labelled pre-gate set.

Usage: python3 ml/train_baseline.py data/train.jsonl
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from sklearn.compose import ColumnTransformer
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedGroupKFold, cross_val_predict
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

sys.path.insert(0, str(Path(__file__).parent))
from groups import build_groups  # noqa: E402

FOLDS = 5
SEED = 0


def load(path: str):
    rows = [json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()]
    rows = [r for r in rows if r.get("text") and len(r["text"]) > 100]
    print(f"{len(rows)} rows with usable text")
    if len(rows) < 200:
        # Fail loudly. sklearn's downstream error for an empty corpus is
        # "empty vocabulary; perhaps the documents only contain stop words",
        # which sends you looking at the vectoriser rather than the export.
        raise SystemExit(
            f"Only {len(rows)} usable rows - the export is probably empty or "
            "pointed at the stale local database. Export from production."
        )
    return rows


def auc(y, scores) -> float:
    """Ranking AUC with ties at half, computed directly so ties are explicit."""
    pos = scores[y == 1]
    neg = scores[y == 0]
    if not len(pos) or not len(neg):
        return float("nan")
    order = np.argsort(np.concatenate([pos, neg]), kind="mergesort")
    ranks = np.empty(len(order), dtype=float)
    ranks[order] = np.arange(1, len(order) + 1)
    # Average ranks over ties so ties score 0.5, matching the TS evaluation.
    vals = np.concatenate([pos, neg])
    for v in np.unique(vals):
        m = vals == v
        if m.sum() > 1:
            ranks[m] = ranks[m].mean()
    r_pos = ranks[: len(pos)].sum()
    return (r_pos - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg))


def recall_curve(y, scores, marks=(0.05, 0.1, 0.15, 0.2, 0.3, 0.5)):
    """Recall retained at each keep-rate. The shape a budget decision needs."""
    order = np.argsort(-scores, kind="mergesort")
    y_sorted = y[order]
    total_pos = y.sum()
    out = []
    for m in marks:
        k = max(1, int(round(m * len(y))))
        out.append((m, y_sorted[:k].sum() / total_pos))
    return out


def evaluate(name, y, scores, groups, show_curve=True):
    a = auc(y, scores)
    print(f"\n--- {name} ---")
    print(f"  AUC {a:.3f}")
    if show_curve:
        print("  keep    recall")
        for m, r in recall_curve(y, scores):
            print(f"  {int(m*100):3d}%   {100*r:5.1f}%")
    # Cluster bootstrap over groups: row-wise resampling would be ~2x too narrow
    # with 310 postings under one employer.
    rng = np.random.default_rng(SEED)
    uniq = np.unique(groups)
    boots = []
    for _ in range(200):
        pick = rng.choice(uniq, size=len(uniq), replace=True)
        idx = np.concatenate([np.flatnonzero(groups == g) for g in pick])
        if len(np.unique(y[idx])) < 2:
            continue
        boots.append(auc(y[idx], scores[idx]))
    if boots:
        lo, hi = np.percentile(boots, [2.5, 97.5])
        print(f"  95% CI (cluster bootstrap over companies): [{lo:.3f}, {hi:.3f}]")
    return a


def main(path: str) -> None:
    rows = load(path)
    y = np.array([r["good"] for r in rows])
    print(f"positive rate {100*y.mean():.1f}%")

    groups, merged = build_groups(
        [r["company"] for r in rows], [r["title"] for r in rows], [r["text"] for r in rows]
    )
    print(f"{len(np.unique(groups))} groups (company-only key merged a further {merged})")

    cv = StratifiedGroupKFold(n_splits=FOLDS, shuffle=True, random_state=SEED)
    splits = list(cv.split(np.zeros(len(y)), y, groups))

    import pandas as pd

    df = pd.DataFrame({
        "title": [r["title"] for r in rows],
        "text": [r["text"] for r in rows],
        "source": [r["source"] for r in rows],
        "length": [len(r["text"]) for r in rows],
    })

    def run(name, features, show_curve=True):
        pipe = Pipeline([
            ("features", features),
            ("clf", LogisticRegression(max_iter=2000, C=1.0)),
        ])
        scores = cross_val_predict(pipe, df, y, cv=splits, method="predict_proba")[:, 1]
        evaluate(name, y, scores, groups, show_curve)
        return scores

    # The real baseline: source alone. 80,000 Hours runs 69% good and RemoteOK
    # 10%, so five one-hot features already carry a lot. A text model that
    # barely beats this has learned a lookup table for job boards.
    run("source only (no text at all)",
        ColumnTransformer([("src", OneHotEncoder(handle_unknown="ignore"), ["source"])]),
        show_curve=False)

    run("description length only",
        ColumnTransformer([("len", "passthrough", ["length"])]), show_curve=False)

    run("title only",
        ColumnTransformer([("t", TfidfVectorizer(min_df=3, sublinear_tf=True, ngram_range=(1, 2)), "title")]),
        show_curve=False)

    # Title separately from body: the title is the highest signal-per-token
    # field and would otherwise be drowned by 6,000 characters of requirements.
    text_features = ColumnTransformer([
        ("t", TfidfVectorizer(min_df=3, sublinear_tf=True, ngram_range=(1, 2)), "title"),
        ("b", TfidfVectorizer(min_df=3, sublinear_tf=True, max_features=60000, stop_words="english"), "text"),
    ])
    run("title + body, source withheld", text_features)

    run("title + body + source", ColumnTransformer([
        ("t", TfidfVectorizer(min_df=3, sublinear_tf=True, ngram_range=(1, 2)), "title"),
        ("b", TfidfVectorizer(min_df=3, sublinear_tf=True, max_features=60000, stop_words="english"), "text"),
        ("src", OneHotEncoder(handle_unknown="ignore"), ["source"]),
    ]))

    # The regex gate, on identical rows and the same definition of positive.
    regex = np.array([r["regex_score"] if r["regex_score"] is not None else np.nan for r in rows], dtype=float)
    ok = ~np.isnan(regex)
    if ok.sum() > 100:
        print(f"\n(regex baseline on the {ok.sum()} rows with a recoverable base score)")
        evaluate("regex score", y[ok], regex[ok], groups[ok], show_curve=True)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "data/train.jsonl")
