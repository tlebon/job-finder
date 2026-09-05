"""
Embeddings for postings, cached to disk.

Two representations, because the right one depends on the text length.

Titles get one vector each. Five to ten words is a comfortable single pass, no
truncation and nothing lost to pooling - and titles are where TF-IDF's
vocabulary problem actually bites, since "MTS, Inference" and "Machine Learning
Engineer" share no words at all.

Bodies are chunked rather than pooled whole. MiniLM handles a few hundred
tokens; a 6,000-character posting is roughly 1,500, so embedding it directly
would silently keep the first third - which the enrichment work showed is mostly
company boilerplate. Chunking also avoids averaging a single mention of PyTorch
into insignificance across 1,500 tokens, which is the failure mode that makes
mean-pooled document vectors worse than TF-IDF for spotting rare terms.

Usage: ml/.venv/bin/python ml/embed.py data/train.jsonl
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import numpy as np

MODEL = "sentence-transformers/all-MiniLM-L6-v2"
CACHE = Path("data/embeddings")
CHUNK_CHARS = 900
MAX_CHUNKS = 8


def chunk(text: str) -> list[str]:
    """Split on blank lines, then pack into chunks under the token limit."""
    paras = [p.strip() for p in (text or "").split("\n") if p.strip()]
    out, current = [], ""
    for p in paras:
        if len(current) + len(p) + 1 <= CHUNK_CHARS:
            current = f"{current}\n{p}" if current else p
        else:
            if current:
                out.append(current)
            current = p[:CHUNK_CHARS]
        if len(out) >= MAX_CHUNKS:
            break
    if current and len(out) < MAX_CHUNKS:
        out.append(current)
    return out or [(text or "")[:CHUNK_CHARS]]


def _key(name: str, texts: list[str]) -> Path:
    h = hashlib.sha1("\x00".join(texts).encode()).hexdigest()[:16]
    return CACHE / f"{name}-{h}.npy"


def encode(name: str, texts: list[str], model=None) -> np.ndarray:
    """Encode, caching by content hash so re-runs are free."""
    CACHE.mkdir(parents=True, exist_ok=True)
    path = _key(name, texts)
    if path.exists():
        return np.load(path)

    from sentence_transformers import SentenceTransformer
    model = model or SentenceTransformer(MODEL)
    vecs = model.encode(texts, batch_size=64, show_progress_bar=True,
                        normalize_embeddings=True)
    np.save(path, vecs)
    return vecs


def embed_rows(rows: list[dict], name: str):
    """Title vectors, and body chunk vectors with an index back to each row."""
    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer(MODEL)

    titles = encode(f"{name}-titles", [r.get("title") or "" for r in rows], model)

    chunks, owner = [], []
    for i, r in enumerate(rows):
        for c in chunk(r.get("text") or ""):
            chunks.append(c)
            owner.append(i)
    bodies = encode(f"{name}-chunks", chunks, model)
    return titles, bodies, np.array(owner)


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "data/train.jsonl"
    rows = [json.loads(l) for l in Path(path).read_text().split("\n") if l.strip()]
    rows = [r for r in rows if r.get("text") and len(r["text"]) > 100]
    t, b, o = embed_rows(rows, Path(path).stem)
    print(f"{len(rows)} rows -> titles {t.shape}, body chunks {b.shape} "
          f"({b.shape[0]/len(rows):.1f} chunks each)")
