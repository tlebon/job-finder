"""
Grouping for the cross-validation split.

Splitting on company alone is not enough here. The same requisition arrives
under different company strings through different boards, gets reposted with a
new id, and agency listings share boilerplate across genuinely different
employers. Any of those puts near-identical text in both train and test, which
inflates the score without improving anything.

So groups are the connected components of a graph over three kinds of edge:
normalised company, normalised title-plus-company, and near-duplicate text.
Report how many rows move group relative to a company-only key - that number is
what a naive split would have leaked.
"""

from __future__ import annotations

import re
import unicodedata

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer

LEGAL_SUFFIX = re.compile(
    r"\b(gmbh|ag|ab|as|a/s|bv|b\.v\.|nv|inc|inc\.|llc|ltd|ltd\.|limited|plc|corp|"
    r"corporation|co|company|group|holdings?|technologies|technology|labs?|"
    r"software|solutions|services|international|pbc|sarl|s\.a\.|spa|oy|aps)\b",
    re.I,
)


def normalize_company(name: str) -> str:
    s = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode()
    s = LEGAL_SUFFIX.sub(" ", s.lower())
    s = re.sub(r"[^a-z0-9]+", "", s)
    return s or "unknown"


def normalize_title(title: str) -> str:
    s = (title or "").lower()
    # Gendered-posting markers and remote tags are noise for identity purposes.
    s = re.sub(r"\(m/w/[dx*]\)|\(all genders?\)|\(remote\)|\(f/m/d/x\)|\(m/f/d\)", " ", s)
    return re.sub(r"[^a-z0-9]+", "", s)


class _Union:
    def __init__(self, n: int) -> None:
        self.parent = list(range(n))

    def find(self, a: int) -> int:
        while self.parent[a] != a:
            self.parent[a] = self.parent[self.parent[a]]
            a = self.parent[a]
        return a

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[rb] = ra


def build_groups(companies, titles, texts, dup_threshold: float = 0.9):
    """Connected components over company, title+company, and near-duplicate text."""
    n = len(companies)
    uf = _Union(n)

    by_company: dict[str, int] = {}
    by_title: dict[str, int] = {}
    for i in range(n):
        c = normalize_company(companies[i])
        uf.union(by_company.setdefault(c, i), i)
        key = f"{normalize_title(titles[i])}|{c}"
        uf.union(by_title.setdefault(key, i), i)

    # Near-duplicate text. Blocked by first token so this stays O(n * block)
    # rather than quadratic over the whole corpus.
    vec = TfidfVectorizer(min_df=2, max_features=40000, stop_words="english")
    X = vec.fit_transform(texts)
    order = np.argsort([normalize_company(c) for c in companies])
    window = 40
    for a in range(len(order)):
        for b in range(a + 1, min(a + window, len(order))):
            i, j = order[a], order[b]
            if uf.find(i) == uf.find(j):
                continue
            if X[i].dot(X[j].T).toarray()[0, 0] >= dup_threshold:
                uf.union(i, j)

    groups = np.array([uf.find(i) for i in range(n)])
    company_only = np.array([normalize_company(c) for c in companies])
    merged = len(set(company_only)) - len(set(groups))
    return groups, merged
