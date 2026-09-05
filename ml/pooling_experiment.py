"""
How to turn many chunk vectors into features without destroying the signal.

The first attempt took the chunk nearest the mean - the most typical paragraph -
which is pooling, and the worst kind: it selects the average chunk and discards
the outliers, which are the informative ones. It scored 0.711 as a standalone
feature and I read that as confirming an argument about pooling. It was
confirming a bad implementation. Tim caught it.

Measured over 480 labels, 90 positives, grouped CV:

  TF-IDF only                             0.823   recall at 50% keep 86.7%
  + medoid chunk (the mistake)            0.829                      91.1%
  + per-dimension max over chunks         0.838                      93.3%
  + chunk topics, max per topic (k=40)    0.835                      88.9%
  + chunk topics (k=80)                   0.833                      86.7%

Per-dimension max wins, and "do not pool" was the wrong lesson. Max IS pooling.
The problem was averaging. Max asks whether ANY chunk strongly expresses a
dimension, which is the property IDF gives TF-IDF - one mention of a rare thing
survives. Mean and medoid ask what a posting is typically about, and bury it.

Chunk topics - clustering chunks and scoring max-per-topic, the more principled
late-interaction construction - did not beat plain per-dimension max. All within
noise of each other, so there is no case for the complexity.

Usage: ml/.venv/bin/python ml/pooling_experiment.py
"""

import json, sys
from pathlib import Path
import numpy as np, pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedGroupKFold, cross_val_predict
from sklearn.pipeline import Pipeline, FeatureUnion
from sklearn.preprocessing import OneHotEncoder
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.cluster import KMeans
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

df=pd.DataFrame({'title':[r.get('title') or '' for r in rows],
                 'text':[r.get('text') or '' for r in rows],
                 'source':[r.get('source') or '' for r in rows],
                 'idx':np.arange(len(rows))})

def tfidf():
    return ColumnTransformer([
        ('t',TfidfVectorizer(min_df=3,sublinear_tf=True,ngram_range=(1,2)),'title'),
        ('b',TfidfVectorizer(min_df=3,sublinear_tf=True,max_features=60000,stop_words='english'),'text'),
        ('src',OneHotEncoder(handle_unknown='ignore'),['source'])])

class Medoid(BaseEstimator, TransformerMixin):
    """What I did before: the chunk nearest the mean. Pooling, and the bad kind."""
    def fit(self,X,y=None): return self
    def transform(self,X):
        out=np.zeros((len(X),chunks.shape[1]))
        for j,i in enumerate(X['idx'].to_numpy()):
            m=chunks[owner==i]
            if len(m): out[j]=m[np.argmax(m@m.mean(axis=0))]
        return out

class MaxDim(BaseEstimator, TransformerMixin):
    """Per-dimension max across chunks. Keeps peaks instead of the centre."""
    def fit(self,X,y=None): return self
    def transform(self,X):
        out=np.zeros((len(X),chunks.shape[1]))
        for j,i in enumerate(X['idx'].to_numpy()):
            m=chunks[owner==i]
            if len(m): out[j]=m.max(axis=0)
        return out

class ChunkTopics(BaseEstimator, TransformerMixin):
    """
    Cluster the chunks, then score each posting by its best chunk per topic.
    No collapsing to one vector: a single strong paragraph survives.
    Topics are fitted inside the fold so nothing leaks.
    """
    def __init__(self,k=40): self.k=k
    def fit(self,X,y=None):
        keep=np.isin(owner, X['idx'].to_numpy())
        self.km_=KMeans(n_clusters=self.k,n_init=10,random_state=0).fit(chunks[keep])
        return self
    def transform(self,X):
        C=self.km_.cluster_centers_
        C=C/ (np.linalg.norm(C,axis=1,keepdims=True)+1e-9)
        out=np.zeros((len(X),self.k))
        for j,i in enumerate(X['idx'].to_numpy()):
            m=chunks[owner==i]
            if len(m): out[j]=(m@C.T).max(axis=0)
        return out

def run(name,F):
    s=cross_val_predict(Pipeline([('f',F),('clf',LogisticRegression(max_iter=3000))]),df,y,cv=splits,method='predict_proba')[:,1]
    c=dict(recall_curve(y,s))
    print(f"{name:44s}{auc(y,s):>7.3f}   "+"  ".join(f"{100*c[m]:5.1f}%" for m in (0.1,0.2,0.3,0.5)))

print(f"480 labels, {y.sum()} positives, grouped CV")
print(f"\n{'body representation':44s}{'AUC':>7}   recall at keep 10/20/30/50%")
run('TF-IDF only (no body embedding)', tfidf())
run('+ medoid chunk  (what I did - pooled)', FeatureUnion([('tf',tfidf()),('e',Medoid())]))
run('+ per-dimension max over chunks', FeatureUnion([('tf',tfidf()),('e',MaxDim())]))
run('+ chunk topics, max per topic (k=40)', FeatureUnion([('tf',tfidf()),('e',ChunkTopics(40))]))
run('+ chunk topics (k=80)', FeatureUnion([('tf',tfidf()),('e',ChunkTopics(80))]))
