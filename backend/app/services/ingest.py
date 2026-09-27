"""Insertion dédupliquée de transactions (synchro bancaire ou import de fichier)."""
from __future__ import annotations

import hashlib
from collections import Counter
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Account, Recurring, Transaction
from .categorize import Categorizer, normalize, pattern_matches


@dataclass
class RawTx:
    date: date
    amount: float
    label: str
    counterparty: str | None = None
    external_id: str | None = None
    value_date: date | None = None
    currency: str = "EUR"
    status: str = "booked"
    extra: dict = field(default_factory=dict)


def _fingerprint(account_id: int, tx: RawTx, n: int) -> str:
    raw = f"{account_id}|{tx.date.isoformat()}|{tx.amount:.2f}|{normalize(tx.label)}|{n}"
    return "h:" + hashlib.sha1(raw.encode()).hexdigest()


class RecurringMatcher:
    def __init__(self, db: Session):
        self.patterns = [
            (r.match_pattern, r.id, r.kind)
            for r in db.scalars(select(Recurring).where(Recurring.active.is_(True)))
            if r.match_pattern
        ]

    def match(self, tx: Transaction) -> int | None:
        for pattern, rid, kind in self.patterns:
            if pattern_matches(pattern, tx.label, tx.counterparty) and (tx.amount > 0) == (kind == "income"):
                return rid
        return None


def ingest(db: Session, account: Account, rows: list[RawTx], source: str) -> dict:
    """Insère les transactions absentes. Retourne des compteurs."""
    categorizer = Categorizer(db)
    matcher = RecurringMatcher(db)
    existing = set(db.scalars(select(Transaction.external_id).where(Transaction.account_id == account.id)))
    seen: Counter[str] = Counter()
    inserted = updated = 0
    for raw in rows:
        ext = raw.external_id
        if not ext:
            base = f"{raw.date}|{raw.amount:.2f}|{normalize(raw.label)}"
            seen[base] += 1
            ext = _fingerprint(account.id, raw, seen[base])
        if ext in existing:
            # une opération "pending" peut passer "booked" : on met à jour le statut
            if raw.status == "booked":
                tx = db.scalar(
                    select(Transaction).where(Transaction.account_id == account.id, Transaction.external_id == ext)
                )
                if tx and tx.status != "booked":
                    tx.status, tx.date, tx.amount = "booked", raw.date, round(raw.amount, 2)
                    updated += 1
            continue
        tx = Transaction(
            account_id=account.id,
            external_id=ext[:160],
            date=raw.date,
            value_date=raw.value_date,
            amount=round(raw.amount, 2),
            currency=raw.currency or account.currency,
            label=(raw.label or raw.counterparty or "Opération")[:512],
            counterparty=(raw.counterparty or None) and raw.counterparty[:256],
            status=raw.status,
            source=source,
        )
        categorizer.apply(tx)
        tx.recurring_id = matcher.match(tx)
        db.add(tx)
        existing.add(ext)
        inserted += 1
    db.flush()
    return {"inserted": inserted, "updated": updated, "total": len(rows)}
