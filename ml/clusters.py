"""
Cluster the postings, then let Tim's labels grade the clusters.

His idea, and a better one than hand-written reference phrases: those just move
the enumeration problem, guessing which concepts matter the way stack_ml guesses
which keywords matter, with the same blind spots.

The clustering is unsupervised and finds whatever structure is in the text. The
labels never touch it - they only score the result afterwards, so a cluster with
a high yes-rate is a discovery rather than something built in. Cluster ID then
becomes a feature the model weights itself, and a cluster that turns out to be
junk simply gets a low weight.

The real risk is not that it fails to organise but that it organises on the
wrong thing - posting language, or source, or company size, rather than the kind
of work. That is measurable, so this prints what actually landed in each cluster
rather than only the rates.

Usage: ml/.venv/bin/python ml/clusters.py [k]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from sklearn.cluster import KMeans

sys.path.insert(0, str(Path(__file__).parent))
from embed import embed_rows  # noqa: E402


def main(k: int = 8) -> None:
    rows = [json.loads(l) for l in Path("data/labels.jsonl").read_text().split("\n") if l.strip()]
    rows = [r for r in rows if r.get("human_label") is not None and r.get("text")]
    y = np.array([int(r["human_label"]) for r in rows])
    print(f"{len(rows)} labelled postings, {y.sum()} of them jobs Tim would consider "
          f"({100*y.mean():.0f}% base rate)\n")

    titles, chunks, owner = embed_rows(rows, "labels")

    # Max over chunks rather than mean: a single strong paragraph in a long
    # posting should survive, and averaging is what buries it.
    body = np.zeros_like(titles)
    for i in range(len(rows)):
        mine = chunks[owner == i]
        body[i] = mine[np.argmax(mine @ mine.mean(axis=0))] if len(mine) else 0

    X = np.hstack([titles, body])
    X /= np.linalg.norm(X, axis=1, keepdims=True) + 1e-9

    km = KMeans(n_clusters=k, n_init=10, random_state=0).fit(X)
    labels = km.labels_

    print(f"{'cluster':>8}{'size':>7}{'yes':>6}{'rate':>7}   what is actually in it")
    order = sorted(range(k), key=lambda c: -(y[labels == c].mean() if (labels == c).any() else 0))
    for c in order:
        m = labels == c
        if not m.any():
            continue
        rate = y[m].mean()
        # Titles nearest the centre, as a description of the cluster.
        idx = np.flatnonzero(m)
        near = idx[np.argsort(-(X[idx] @ km.cluster_centers_[c]))][:3]
        sample = "; ".join((rows[i].get("title") or "")[:34] for i in near)
        print(f"{c:>8}{m.sum():>7}{y[m].sum():>6}{100*rate:>6.0f}%   {sample}")

    # Does the clustering track the label, or something incidental?
    print("\nsanity - does it track anything other than the work?")
    for field in ("source",):
        vals = [r.get(field) or "" for r in rows]
        uniq = sorted(set(vals))
        print(f"  {field}: ", end="")
        for c in order[:4]:
            m = labels == c
            top = max(uniq, key=lambda v: sum(1 for i in np.flatnonzero(m) if vals[i] == v))
            share = sum(1 for i in np.flatnonzero(m) if vals[i] == top) / max(1, m.sum())
            print(f"c{c}={top}({100*share:.0f}%) ", end="")
        print()


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 8)
