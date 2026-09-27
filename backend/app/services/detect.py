"""Détection automatique des opérations récurrentes (prélèvements, abonnements, salaires)."""
from __future__ import annotations

import re
from collections import Counter, defaultdict
from datetime import date, timedelta
from statistics import median

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Contract, Loan, Recurring, Transaction
from .categorize import normalize
from .schedule import MONTH_STEP

# (fréquence, intervalle min, intervalle max en jours)
_BANDS = [
    ("weekly", 6, 8),
    ("monthly", 26, 35),
    ("bimonthly", 55, 66),
    ("quarterly", 84, 98),
    ("semiannual", 170, 195),
    ("yearly", 350, 380),
]
_NOISE = re.compile(r"\b(prlv|prelevement|sepa|carte|cb|vir|virement|inst|recu|emis|de|du|la|le|des|paiement|payment|to|from|x?\d[\w/.-]*)\b")


def group_key(label: str, counterparty: str | None) -> str:
    text = normalize(counterparty or label)
    text = _NOISE.sub(" ", text)
    words = [w for w in re.split(r"[^a-z0-9+&.']+", text) if len(w) > 1]
    return " ".join(words[:3])


def detect_recurring(db: Session, today: date | None = None) -> list[dict]:
    today = today or date.today()
    since = today - timedelta(days=400)
    txs = db.scalars(
        select(Transaction).where(
            Transaction.date >= since, Transaction.is_transfer.is_(False), Transaction.status == "booked"
        )
    ).all()
    known = [
        normalize(p)
        for p in [
            *db.scalars(select(Recurring.match_pattern)),
            *db.scalars(select(Contract.match_pattern)),
            *db.scalars(select(Loan.match_pattern)),
        ]
        if p
    ]
    groups: dict[tuple[str, bool], list[Transaction]] = defaultdict(list)
    for tx in txs:
        key = group_key(tx.label, tx.counterparty)
        if key:
            groups[(key, tx.amount > 0)].append(tx)

    suggestions = []
    for (key, is_income), items in groups.items():
        if any(k in key or key in k for k in known):
            continue
        # une seule opération par jour et par groupe
        by_day = {}
        for tx in sorted(items, key=lambda t: t.date):
            by_day.setdefault(tx.date, tx)
        items = list(by_day.values())
        if len(items) < 2:
            continue
        dates = [t.date for t in items]
        intervals = [(b - a).days for a, b in zip(dates, dates[1:])]
        med = median(intervals)
        freq = next((f for f, lo, hi in _BANDS if lo <= med <= hi), None)
        if not freq:
            continue
        min_count = 2 if freq in ("yearly", "semiannual") else 3
        if len(items) < min_count:
            continue
        in_band = [i for i in intervals if any(lo <= i <= hi for f, lo, hi in _BANDS if f == freq)]
        if len(in_band) < max(1, int(len(intervals) * 0.7)):
            continue
        amounts = [abs(t.amount) for t in items]
        amount = median(amounts)
        spread = max(abs(a - amount) for a in amounts) / amount if amount else 1
        if spread > 0.25:
            continue
        last = dates[-1]
        step_days = 7 if freq == "weekly" else 30.44 * MONTH_STEP[freq]
        # l'opération doit être toujours "vivante"
        if (today - last).days > step_days * 1.6:
            continue
        cats = Counter(t.category_id for t in items if t.category_id)
        suggestions.append(
            {
                "key": key,
                "name": key.title(),
                "kind": "income" if is_income else "direct_debit",
                "amount": round(amounts[-1], 2),
                "median_amount": round(amount, 2),
                "variable": spread > 0.02,
                "frequency": freq,
                "occurrences": len(items),
                "first_date": dates[0].isoformat(),
                "last_date": last.isoformat(),
                "start_date": last.isoformat(),
                "account_id": items[-1].account_id,
                "category_id": cats.most_common(1)[0][0] if cats else None,
                "match_pattern": key,
                "sample_label": items[-1].label,
            }
        )
    suggestions.sort(key=lambda s: -s["median_amount"])
    return suggestions
