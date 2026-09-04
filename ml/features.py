"""
Structured features, extracted rather than counted.

TF-IDF can only say a term is present. It cannot compare 3 years against 10 -
both are the token "years" - and it cannot separate "fluent German required"
from "German is a plus", which is the difference between a job Tim can take and
one he cannot. Those distinctions decide the answer.

More importantly, a bag of words has no representation of the candidate. The
model gave `react` a large positive weight because Tim likes React: it memorised
his preferences as vocabulary rather than learning a match. Fit features are
relational - overlap between what a posting asks for and what he has - which is
the thing that would still mean something for a different person.
"""

from __future__ import annotations

import re

# From the stored profile. Grouped, because a posting matching three ML terms is
# a different signal from one matching three frontend terms.
STACKS = {
    "ml": ["pytorch", "tensorflow", "scikit-learn", "sklearn", "pandas", "numpy", "hugging face",
           "huggingface", "transformers", "embeddings", "sentence-transformers", "rag",
           "fine-tun", "quantiz", "llm", "machine learning", "deep learning", "mlops"],
    "frontend": ["react", "typescript", "javascript", "next.js", "nextjs", "sveltekit", "svelte",
                 "redux", "electron", "css", "tailwind", "vue"],
    "backend": ["node.js", "nodejs", "fastapi", "nestjs", "express", "graphql", "postgres",
                "postgresql", "prisma", "supabase", "python", "rest api"],
    "infra": ["docker", "ci/cd", "aws", "kubernetes", "terraform", "gcp"],
}

# Things Tim does not have, so a hard requirement is a real cost.
FOREIGN_STACK = ["java", ".net", "c#", "php", "ruby on rails", "golang", "scala", "kotlin",
                 "salesforce", "sap", "abap", "drupal", "wordpress", "sharepoint"]

# Domain and industry. Not "is this company good" but "is this the kind of work
# Tim wants" - mission alignment was in his profile long before any of this.
DOMAINS = {
    "ai_safety": ["ai safety", "alignment", "interpretability", "red team", "frontier model",
                  "responsible ai", "ai policy", "evals", "model evaluation"],
    "privacy": ["end-to-end encrypt", "e2ee", "zero-knowledge", "privacy-preserving",
                "secure messaging", "open source", "self-hosted", "gdpr-first"],
    "science": ["biotech", "bioinformatics", "genomic", "protein", "drug discovery",
                "pharmaceutical", "clinical", "chemistry", "laboratory", "molecul"],
    "adtech_gambling": ["adtech", "ad tech", "programmatic advertis", "gambling", "casino",
                        "betting", "igaming", "affiliate marketing"],
    "defence": ["defense contractor", "defence", "military", "weapons", "surveillance"],
    "fintech": ["fintech", "payments", "banking", "insurance", "trading", "wealth"],
    "ecommerce": ["e-commerce", "ecommerce", "retail", "marketplace", "logistics"],
}

# Who is posting. A large share of the corpus is agencies reposting other
# people's roles, and those expire fastest - two thirds of the short listings
# checked were already 404 or 410.
AGENCY = ["recruitment", "recruiting agency", "staffing", "headhunt", "personalberatung",
          "our client", "unser kunde", "on behalf of our client", "consultancy",
          "interim", "contract role", "umbrella", "ir35"]
AI_LAB = ["anthropic", "openai", "deepmind", "mistral", "cohere", "perplexity",
          "elevenlabs", "hugging face", "scale ai", "together ai", "fireworks"]

# Distance, as tiers rather than a flag. Berlin is home, Europe is a move within
# the same rules, the US needs no visa but is a continent away.
LOCATION_TIERS = [
    ("berlin", r"\bberlin\b"),
    ("germany", r"\b(germany|deutschland|munich|münchen|hamburg|frankfurt|cologne|köln|stuttgart|leipzig)\b"),
    ("europe", r"\b(netherlands|amsterdam|france|paris|spain|madrid|barcelona|portugal|lisbon|"
                r"ireland|dublin|sweden|stockholm|denmark|copenhagen|norway|oslo|finland|helsinki|"
                r"switzerland|zurich|zürich|austria|vienna|poland|warsaw|czech|prague|belgium|brussels|italy|milan)\b"),
    ("uk", r"\b(united kingdom|england|london|manchester|edinburgh|cambridge|oxford|bristol)\b"),
    ("usa", r"\b(united states|usa|california|new york|san francisco|seattle|boston|austin|texas|remote \(us\))\b"),
]

YEARS = re.compile(r"(\d{1,2})\s*\+?\s*(?:years|yrs|jahre|jahren|ans|anni)", re.I)
GERMAN_REQUIRED = re.compile(
    r"(fluent|native|verhandlungssicher|sehr gute|fliessend|fließend|c1|c2)[^.]{0,40}(german|deutsch)"
    r"|(german|deutsch)[^.]{0,40}(required|erforderlich|mandatory|voraussetzung|must)",
    re.I)
GERMAN_NICE = re.compile(r"(german|deutsch)[^.]{0,30}(a plus|nice to have|von vorteil|beneficial|advantage)", re.I)
PHD = re.compile(r"\b(ph\.?d|doctorate|promotion abgeschlossen)\b", re.I)
CLEARANCE = re.compile(r"(security clearance|sicherheitsüberprüfung|citizenship required)", re.I)
EQUITY = re.compile(r"\b(equity|stock options|rsus?)\b", re.I)


def _hits(text: str, terms: list[str]) -> int:
    low = text.lower()
    return sum(1 for t in terms if t in low)


def extract(title: str, text: str, location: str = "") -> dict[str, float]:
    """Numeric features for one posting. Cheap, deterministic, no model calls."""
    blob = f"{title}\n{text}"
    low = blob.lower()

    years = [int(m) for m in YEARS.findall(blob)]
    # The largest stated figure is the binding requirement; postings often list
    # a small number for a nice-to-have and a large one for the core ask.
    max_years = max(years) if years else 0

    f: dict[str, float] = {
        "years_required": min(max_years, 20),
        "years_over_6": max(0, min(max_years, 20) - 6),
        "german_required": 1.0 if GERMAN_REQUIRED.search(blob) else 0.0,
        "german_nice": 1.0 if GERMAN_NICE.search(blob) else 0.0,
        "phd": 1.0 if PHD.search(blob) else 0.0,
        "clearance": 1.0 if CLEARANCE.search(blob) else 0.0,
        "equity": 1.0 if EQUITY.search(blob) else 0.0,
        "posting_is_german": 1.0 if _hits(low, [" und ", " oder ", " wir ", " sie ", "aufgaben", "kenntnisse"]) >= 2 else 0.0,
        "remote": 1.0 if re.search(r"\b(remote|home office|hybrid)\b", low) else 0.0,
        "length": min(len(text), 20000) / 1000.0,
    }

    for name, terms in STACKS.items():
        f[f"stack_{name}"] = _hits(low, terms)
    f["stack_foreign"] = _hits(low, FOREIGN_STACK)

    # Relational: how much of the posting's stack Tim actually has.
    own = sum(f[f"stack_{n}"] for n in STACKS)
    f["stack_fit"] = own / (own + f["stack_foreign"] + 1)

    for name, terms in DOMAINS.items():
        f[f"domain_{name}"] = _hits(low, terms)

    f["agency_posting"] = 1.0 if _hits(low, AGENCY) else 0.0
    f["known_ai_lab"] = 1.0 if _hits(low, AI_LAB) else 0.0

    loc = (location or "").lower() + " " + low[:600]
    for name, pattern in LOCATION_TIERS:
        f[f"loc_{name}"] = 1.0 if re.search(pattern, loc, re.I) else 0.0
    f["loc_unknown"] = 0.0 if any(f[f"loc_{n}"] for n, _ in LOCATION_TIERS) else 1.0

    # Level, from the title only - the body says "senior" about the team.
    t = title.lower()
    f["title_junior"] = 1.0 if re.search(r"\b(junior|graduate|intern|working student|werkstudent)\b", t) else 0.0
    f["title_senior"] = 1.0 if re.search(r"\b(senior|sr\.?|lead|principal|staff)\b", t) else 0.0
    f["title_manager"] = 1.0 if re.search(r"\b(manager|head of|director|vp)\b", t) else 0.0

    return f


FEATURE_NAMES = sorted(extract("x", "x").keys())


def matrix(rows: list[dict]) -> list[list[float]]:
    out = []
    for r in rows:
        f = extract(r.get("title") or "", r.get("text") or "", r.get("location") or "")
        out.append([f[n] for n in FEATURE_NAMES])
    return out
