"""
Two stages: distil the reviewer, then correct it with Tim's own labels.

Neither label source is sufficient alone. The reviewer's 6,421 verdicts are
plentiful but only moderately aligned with him - kappa 0.44, and it auto-
dismissed a Machine Learning Engineer role. His own 239 labels are the right
target but carry 47 positives, which supports about seven parameters before
overfitting; fitting 34 structured features on them dropped AUC from 0.827 to
0.810 and produced a positive weight on adtech/gambling.

So stage one distils everything the reviewer labels can teach into a single
score, and stage two fits a small personalisation layer on top, where each
parameter has enough events behind it to mean something.

  base alone                       0.830
  base + 7 personal, Tim-trained   0.836   (top-decile recall 29.8% -> 34.0%)

The gain is within noise at n=239. What the numbers support is the shape, not
the improvement - and the shape is also what a second user would need: a shared
base available immediately, personalising as they label.

Usage: ml/.venv/bin/python ml/personalise.py
"""

import json, sys
from pathlib import Path
import numpy as np, pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedGroupKFold, cross_val_predict
from sklearn.pipeline import Pipeline, FeatureUnion
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.base import BaseEstimator, TransformerMixin
sys.path.insert(0,'ml')
from features import matrix, FEATURE_NAMES, extract
from groups import normalize_company
from train_baseline import auc, recall_curve

def read(p): return [json.loads(l) for l in Path(p).read_text().split('\n') if l.strip()]
def key(r): return f"{(r.get('title') or '').strip().lower()}|{(r.get('company') or '').strip().lower()}"
def frame(rows): return pd.DataFrame({'title':[r.get('title') or '' for r in rows],
    'text':[r.get('text') or '' for r in rows],'source':[r.get('source') or '' for r in rows]})

labels=[r for r in read('data/labels.jsonl') if r.get('human_label') is not None and r.get('text')]
held={key(r) for r in labels}
train=[r for r in read('data/train.jsonl') if r.get('text') and len(r['text'])>100 and key(r) not in held]
y=np.array([int(r['human_label']) for r in labels])
groups=np.array([normalize_company(r.get('company') or '') for r in labels])

class Struct(BaseEstimator, TransformerMixin):
    def fit(self,X,y=None): return self
    def transform(self,X): return np.array(matrix(X.to_dict('records')))

# Stage 1: everything the 6,421 reviewer labels can teach, distilled to one number.
base=Pipeline([('f',FeatureUnion([
        ('tf',ColumnTransformer([
            ('t',TfidfVectorizer(min_df=3,sublinear_tf=True,ngram_range=(1,2)),'title'),
            ('b',TfidfVectorizer(min_df=3,sublinear_tf=True,max_features=60000,stop_words='english'),'text'),
            ('src',OneHotEncoder(handle_unknown='ignore'),['source'])])),
        ('st',Pipeline([('s',Struct()),('sc',StandardScaler())]))])),
    ('clf',LogisticRegression(max_iter=3000))])
base.fit(frame(train), np.array([r['good'] for r in train]))
base_score=base.predict_proba(frame(labels))[:,1]

# Stage 2: a handful of parameters fitted on Tim's labels, correcting the base.
PERSONAL=['german_required','german_nice','years_required','title_manager','phd','stack_ml','loc_berlin']
feats=[extract(r.get('title') or '', r.get('text') or '', r.get('location') or '') for r in labels]
P=np.column_stack([base_score]+[[f[n] for f in feats] for n in PERSONAL])

cv=StratifiedGroupKFold(n_splits=5,shuffle=True,random_state=0)
splits=list(cv.split(P,y,groups))

def show(name, X, C=0.5):
    pipe=Pipeline([('sc',StandardScaler()),('clf',LogisticRegression(max_iter=3000,C=C))])
    s=cross_val_predict(pipe,X,y,cv=splits,method='predict_proba')[:,1]
    c=dict(recall_curve(y,s))
    print(f"{name:44s}{auc(y,s):>7.3f}   "+"  ".join(f"{100*c[m]:5.1f}%" for m in (0.1,0.2,0.3,0.5)))
    return pipe

print(f"{len(labels)} labels, {y.sum()} positive\n")
print(f"{'model':44s}{'AUC':>7}   recall at keep 10/20/30/50%")
c=dict(recall_curve(y,base_score))
print(f"{'base alone (reviewer-trained, no personalisation)':44s}{auc(y,base_score):>7.3f}   "+"  ".join(f"{100*c[m]:5.1f}%" for m in (0.1,0.2,0.3,0.5)))
show('19 structured, Tim-trained', np.array(matrix(labels))[:, :19])
show('34 structured, Tim-trained', np.array(matrix(labels)))
p=show(f'base + {len(PERSONAL)} personal features, Tim-trained', P)

p.fit(P,y)
print("\nthe personalisation layer:")
for n,c_ in zip(['base_model_score']+PERSONAL, p.named_steps['clf'].coef_[0]):
    print(f"  {c_:+.3f}  {n}")
