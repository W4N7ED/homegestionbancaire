from __future__ import annotations

import csv
import io
import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Account, Category, CategoryRule, Transaction
from ..schemas import BulkCategorize, TransactionIn, TransactionOut, TransactionPatch
from ..services.categorize import Categorizer
from ..services.detect import group_key

router = APIRouter(prefix="/api/transactions", tags=["opérations"])


def _filtered(
    account_id: int | None,
    category: str | None,
    q: str | None,
    date_from: date | None,
    date_to: date | None,
    kind: str | None,
    recurring_id: int | None = None,
):
    stmt = select(Transaction)
    if account_id:
        stmt = stmt.where(Transaction.account_id == account_id)
    if category == "none":
        stmt = stmt.where(Transaction.category_id.is_(None))
    elif category:
        stmt = stmt.where(Transaction.category_id == int(category))
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Transaction.label.ilike(like), Transaction.counterparty.ilike(like), Transaction.notes.ilike(like)))
    if date_from:
        stmt = stmt.where(Transaction.date >= date_from)
    if date_to:
        stmt = stmt.where(Transaction.date <= date_to)
    if kind == "income":
        stmt = stmt.where(Transaction.amount > 0)
    elif kind == "expense":
        stmt = stmt.where(Transaction.amount < 0)
    elif kind == "transfer":
        stmt = stmt.where(Transaction.is_transfer.is_(True))
    if recurring_id:
        stmt = stmt.where(Transaction.recurring_id == recurring_id)
    return stmt


@router.get("")
def list_transactions(
    account_id: int | None = None,
    category: str | None = None,
    q: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    kind: str | None = None,
    recurring_id: int | None = None,
    limit: int = Query(100, le=1000),
    offset: int = 0,
    db: Session = Depends(get_db),
):
    stmt = _filtered(account_id, category, q, date_from, date_to, kind, recurring_id)
    sub = stmt.subquery()
    total, sum_in, sum_out = db.execute(
        select(
            func.count(),
            func.coalesce(func.sum(case((sub.c.amount > 0, sub.c.amount), else_=0)), 0),
            func.coalesce(func.sum(case((sub.c.amount < 0, sub.c.amount), else_=0)), 0),
        ).select_from(sub)
    ).one()
    items = db.scalars(stmt.order_by(Transaction.date.desc(), Transaction.id.desc()).limit(limit).offset(offset)).all()
    return {
        "items": [TransactionOut.model_validate(t).model_dump() for t in items],
        "total": total,
        "sum_in": round(sum_in or 0, 2),
        "sum_out": round(sum_out or 0, 2),
    }


@router.get("/export.csv")
def export_csv(
    account_id: int | None = None,
    category: str | None = None,
    q: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    kind: str | None = None,
    db: Session = Depends(get_db),
):
    cats = {c.id: c.name for c in db.scalars(select(Category))}
    accs = {a.id: a.name for a in db.scalars(select(Account))}
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";")
    w.writerow(["Date", "Compte", "Libellé", "Tiers", "Catégorie", "Montant", "Devise", "Statut", "Notes"])
    stmt = _filtered(account_id, category, q, date_from, date_to, kind).order_by(Transaction.date)
    for t in db.scalars(stmt):
        w.writerow([
            t.date.isoformat(), accs.get(t.account_id, ""), t.label, t.counterparty or "",
            cats.get(t.category_id, ""), f"{t.amount:.2f}".replace(".", ","), t.currency, t.status, t.notes or "",
        ])
    data = "﻿" + buf.getvalue()
    return StreamingResponse(
        iter([data]), media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="operations.csv"'},
    )


@router.post("", status_code=201)
def create_transaction(payload: TransactionIn, db: Session = Depends(get_db)):
    acc = db.get(Account, payload.account_id)
    if not acc:
        raise HTTPException(404, "Compte introuvable")
    tx = Transaction(**payload.model_dump(), external_id=f"m:{uuid.uuid4().hex}", source="manual")
    if not tx.category_id:
        Categorizer(db).apply(tx)
    db.add(tx)
    if not acc.connection_id:
        acc.balance = round(acc.balance + tx.amount, 2)
    db.commit()
    return TransactionOut.model_validate(tx).model_dump()


@router.patch("/{tx_id}")
def patch_transaction(tx_id: int, payload: TransactionPatch, db: Session = Depends(get_db)):
    tx = db.get(Transaction, tx_id)
    if not tx:
        raise HTTPException(404, "Opération introuvable")
    data = payload.model_dump(exclude_unset=True)
    create_rule = data.pop("create_rule", False)
    for k, v in data.items():
        setattr(tx, k, v)
    if "category_id" in data and "is_transfer" not in data:
        cat = db.get(Category, tx.category_id) if tx.category_id else None
        tx.is_transfer = bool(cat and cat.kind == "transfer")
    applied = 0
    if create_rule and tx.category_id:
        pattern = group_key(tx.label, tx.counterparty) or tx.label.lower()[:60]
        db.add(CategoryRule(pattern=pattern, category_id=tx.category_id, priority=10))
        db.flush()
        # applique la nouvelle règle aux opérations non catégorisées
        cat_engine = Categorizer(db)
        for other in db.scalars(select(Transaction).where(Transaction.category_id.is_(None))):
            cat_engine.apply(other)
            applied += other.category_id is not None
    db.commit()
    return {**TransactionOut.model_validate(tx).model_dump(), "rule_applied": applied}


@router.delete("/{tx_id}", status_code=204)
def delete_transaction(tx_id: int, db: Session = Depends(get_db)):
    tx = db.get(Transaction, tx_id)
    if not tx:
        raise HTTPException(404, "Opération introuvable")
    acc = db.get(Account, tx.account_id)
    if acc and not acc.connection_id and tx.source == "manual":
        acc.balance = round(acc.balance - tx.amount, 2)
    db.delete(tx)
    db.commit()


@router.post("/bulk-categorize")
def bulk_categorize(payload: BulkCategorize, db: Session = Depends(get_db)):
    cat = db.get(Category, payload.category_id) if payload.category_id else None
    n = 0
    for tx in db.scalars(select(Transaction).where(Transaction.id.in_(payload.ids))):
        tx.category_id = payload.category_id
        tx.is_transfer = bool(cat and cat.kind == "transfer")
        n += 1
    db.commit()
    return {"updated": n}


@router.post("/recategorize")
def recategorize(force: bool = False, db: Session = Depends(get_db)):
    """Applique les règles aux opérations non catégorisées (ou à toutes si force)."""
    engine = Categorizer(db)
    n = 0
    stmt = select(Transaction) if force else select(Transaction).where(Transaction.category_id.is_(None))
    for tx in db.scalars(stmt):
        before = tx.category_id
        engine.apply(tx, force=force)
        n += tx.category_id != before
    db.commit()
    return {"updated": n}
