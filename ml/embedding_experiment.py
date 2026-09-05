"""
Do embeddings beat TF-IDF for ranking postings?

Tim's idea, and the right shape: rather than hand-writing reference phrases -
which only moves the enumeration problem - cluster the postings and let his
labels grade the clusters afterwards.

Measured on his 480 labels, 90 positives, 5-fold grouped CV:

  TF-IDF title+body+source        0.823
  embedding: title only           0.785
  embedding: body only            0.711
  embedding: title + body         0.806
  TF-IDF + embeddings             0.842    <- recall at 50% keep: 86.7 -> 91.1
  TF-IDF + embeddings + clusters  0.842

Neither representation dominates and together they beat either, which is what
complementary features look like: TF-IDF catches the rare literal term through
IDF weighting, embeddings catch the paraphrase that shares no vocabulary.

Body embeddings are the weakest single feature, and that is the pooling problem
being visible: max-over-chunks still loses the one mention of PyTorch in 6,000
characters that IDF weights heavily.

Clusters add nothing on top of embeddings - they are a lossy summary of the same
space. They earn their place as a diagnostic instead; see ml/clusters.py.

At 90 positives +0.019 sits inside the noise, and shipping it needs the encoder
at inference (~23MB, a second parity-tested path). Parked until more labels
settle whether the gain is real.

Usage: ml/.venv/bin/python ml/embedding_experiment.py
"""

import json, sys
from pathlib import Path
import numpy as np, pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedGroupKFold, cross_val_predict
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder
sys.path.insert(0,'ml')
from embed import embed_rows
from groups import normalize_company
from train_baseline import auc, recall_curve

rows=[json.loads(l) for l in Path('data/labels.jsonl').read_text().split('\n') if l.strip()]
rows=[r for r in rows if r.get('human_label') is not None and r.get('text')]
y=np.array([int(r['human_label']) for r in rows])
groups=np.array([normalize_company(r.get('company') or '') for r in rows])
splits=list(StratifiedGroupKFold(n_splits=5,shuffle=True,random_state=0).split(np.zeros(len(y)),y,groups))

titles, chunks, owner = embed_rows(rows,'labels')
body=np.zeros_like(titles)
for i in range(len(rows)):
    mine=chunks[owner==i]
    body[i]=mine[np.argmax(mine@mine.mean(axis=0))] if len(mine) else 0

df=pd.DataFrame({'title':[r.get('title') or '' for r in rows],
                 'text':[r.get('text') or '' for r in rows],
                 'source':[r.get('source') or '' for r in rows]})

def tfidf():
    return ColumnTransformer([
        ('t',TfidfVectorizer(min_df=3,sublinear_tf=True,ngram_range=(1,2)),'title'),
        ('b',TfidfVectorizer(min_df=3,sublinear_tf=True,max_features=60000,stop_words='english'),'text'),
        ('src',OneHotEncoder(handle_unknown='ignore'),['source'])])

def run(name, X, C=1.0):
    if isinstance(X, np.ndarray):
        s=cross_val_predict(Pipeline([('clf',LogisticRegression(max_iter=3000,C=C))]),X,y,cv=splits,method='predict_proba')[:,1]
    else:
        s=cross_val_predict(Pipeline([('f',X),('clf',LogisticRegression(max_iter=3000,C=C))]),df,y,cv=splits,method='predict_proba')[:,1]
    c=dict(recall_curve(y,s))
    print(f"{name:38s}{auc(y,s):>7.3f}   "+"  ".join(f"{100*c[m]:5.1f}%" for m in (0.1,0.2,0.3,0.5)))
    return s

print(f"trained on Tim's 480 labels, 5-fold grouped CV, {y.sum()} positives")
print(f"\n{'features':38s}{'AUC':>7}   recall at keep 10/20/30/50%")
run('TF-IDF title+body+source', tfidf())
run('embedding: title only', titles)
run('embedding: body only (max chunk)', body)
run('embedding: title + body', np.hstack([titles,body]))

from sklearn.pipeline import FeatureUnion
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.cluster import KMeans
from sklearn.decomposition import TruncatedSVD

class Dense(BaseEstimator, TransformerMixin):
    """Precomputed vectors, indexed by row position carried in the frame."""
    def __init__(self, M): self.M = M
    def fit(self, X, y=None): return self
    def transform(self, X): return self.M[X['idx'].to_numpy()]

df['idx'] = np.arange(len(rows))
emb = np.hstack([titles, body])

print()
run('TF-IDF + embeddings', FeatureUnion([('tf', tfidf()), ('emb', Dense(emb))]))

# Cluster id as a feature, fitted inside the fold so the assignment cannot leak.
class Clusters(BaseEstimator, TransformerMixin):
    def __init__(self, M, k=8): self.M, self.k = M, k
    def fit(self, X, y=None):
        self.km_ = KMeans(n_clusters=self.k, n_init=10, random_state=0).fit(self.M[X['idx'].to_numpy()])
        return self
    def transform(self, X):
        d = self.km_.transform(self.M[X['idx'].to_numpy()])
        return np.exp(-d)  # soft membership, not a hard one-hot

run('TF-IDF + cluster membership', FeatureUnion([('tf', tfidf()), ('cl', Clusters(emb))]))
run('TF-IDF + embeddings + clusters', FeatureUnion([
    ('tf', tfidf()), ('emb', Dense(emb)), ('cl', Clusters(emb))]))
