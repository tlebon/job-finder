"""
Fit the shipping model and export it as JSON for the TypeScript scorer.

Deliberately TF-IDF and source only. The structured features in features.py are
worth about +0.02, but shipping them means a second implementation in
TypeScript, and two copies of an extractor drift silently - production has no
labels, so nothing would catch it. They go in once this path is proven.

Exports everything needed to reproduce a score exactly, plus a golden fixture of
200 rows with Python-computed scores. The TypeScript test asserts agreement to
1e-6. Without that fixture a tokenisation mismatch degrades production quietly
and forever.

Usage: ml/.venv/bin/python ml/export_model.py data/train.jsonl web/public/model.json
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


def main(train_path: str, out_path: str) -> None:
    rows = [json.loads(l) for l in Path(train_path).read_text().split("\n") if l.strip()]
    rows = [r for r in rows if r.get("text") and len(r["text"]) > 100]
    print(f"fitting on {len(rows)} rows")

    df = pd.DataFrame({
        "title": [r.get("title") or "" for r in rows],
        "text": [r.get("text") or "" for r in rows],
        "source": [r.get("source") or "" for r in rows],
    })
    y = np.array([r["good"] for r in rows])

    pipe = Pipeline([
        ("f", ColumnTransformer([
            ("t", TfidfVectorizer(min_df=3, sublinear_tf=True, ngram_range=(1, 2)), "title"),
            ("b", TfidfVectorizer(min_df=3, sublinear_tf=True, max_features=60000, stop_words="english"), "text"),
            ("src", OneHotEncoder(handle_unknown="ignore"), ["source"]),
        ])),
        ("clf", LogisticRegression(max_iter=3000)),
    ])
    pipe.fit(df, y)

    ct = pipe.named_steps["f"]
    title_vec: TfidfVectorizer = ct.named_transformers_["t"]
    body_vec: TfidfVectorizer = ct.named_transformers_["b"]
    src_enc: OneHotEncoder = ct.named_transformers_["src"]
    coef = pipe.named_steps["clf"].coef_[0]

    n_title = len(title_vec.vocabulary_)
    n_body = len(body_vec.vocabulary_)

    model = {
        "version": 1,
        "note": "Scores agreement with the AI reviewer, not correctness. See ml/README.md.",
        # Stop words need no export: they were dropped at fit time, so they are
        # simply absent from the vocabulary and a lookup misses.
        "title": {
            "vocabulary": {t: int(i) for t, i in title_vec.vocabulary_.items()},
            "idf": [float(x) for x in title_vec.idf_],
            "ngram_max": 2,
        },
        "body": {
            "vocabulary": {t: int(i) for t, i in body_vec.vocabulary_.items()},
            "idf": [float(x) for x in body_vec.idf_],
            "ngram_max": 1,
        },
        "sources": [str(c) for c in src_enc.categories_[0]],
        "offsets": {"title": 0, "body": n_title, "source": n_title + n_body},
        "coef": [float(x) for x in coef],
        "intercept": float(pipe.named_steps["clf"].intercept_[0]),
    }

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    Path(out_path).write_text(json.dumps(model))
    size = Path(out_path).stat().st_size
    print(f"wrote {out_path}  {size/1_000_000:.1f} MB  ({n_title} title + {n_body} body + {len(model['sources'])} source dims)")

    # Golden fixture. Any tokenisation difference in the TypeScript port shows
    # up here rather than silently in production.
    sample = rows[:: max(1, len(rows) // 200)][:200]
    sdf = pd.DataFrame({
        "title": [r.get("title") or "" for r in sample],
        "text": [r.get("text") or "" for r in sample],
        "source": [r.get("source") or "" for r in sample],
    })
    scores = pipe.predict_proba(sdf)[:, 1]
    fixture = [{"title": r.get("title") or "", "text": r.get("text") or "",
                "source": r.get("source") or "", "score": float(s)}
               for r, s in zip(sample, scores)]
    fixture_path = Path("src/model/fixture.json")
    fixture_path.parent.mkdir(parents=True, exist_ok=True)
    fixture_path.write_text(json.dumps(fixture))
    print(f"wrote {fixture_path}  {len(fixture)} rows")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "data/train.jsonl",
         sys.argv[2] if len(sys.argv) > 2 else "web/public/model.json")
