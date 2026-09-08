"""
Which labelling epoch a row came from.

Reads src/labels/batches.json, the same registry the TypeScript side uses, so
holdout.py and three_way.py cannot drift from the app's idea of which rows are
scoreable. See that file for what each batch is and why.
"""

import json
from pathlib import Path

_REGISTRY = json.loads((Path(__file__).resolve().parent.parent
                        / "src" / "labels" / "batches.json").read_text())
BATCHES = _REGISTRY["batches"]


def batch_of(stratum):
    """First match wins; the default entry is last in the JSON."""
    for b in BATCHES:
        m = b["match"]
        if "equals" in m and stratum == m["equals"]:
            return b
        if "prefix" in m and str(stratum).startswith(m["prefix"]):
            return b
        if m.get("default"):
            return b
    raise KeyError(f'no batch matches stratum "{stratum}"')


def eval_eligible(stratum):
    """True for rows a model may be scored on. Everything else trains only."""
    return batch_of(stratum)["evalEligible"]
