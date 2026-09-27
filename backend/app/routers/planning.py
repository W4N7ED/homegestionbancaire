"""Catégories, règles, échéances récurrentes, crédits, contrats et objectifs."""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..crud import crud_router
from ..db import get_db
from ..models import Account, Category, CategoryRule, Contract, Goal, Loan, Recurring, Transaction
from ..schemas import (
    CategoryIn,
    CategoryOut,
    ContractIn,
    ContractOut,
    GoalIn,
    GoalOut,
    LoanIn,
    LoanOut,
    RecurringIn,
    RecurringOut,
    RuleIn,
    RuleOut,
)
from ..services.categorize import pattern_matches
from ..services.detect import detect_recurring
from ..services.loans import amortization, loan_status
from ..services.schedule import monthly_equivalent, occurrences

today = date.today


def _next(start: date, freq: str, end: date | None) -> date | None:
    occ = occurrences(start, freq, today(), today() + timedelta(days=400), end)
    return occ[0] if occ else None


def _enrich_recurring(db: Session, items: list[Recurring]) -> list[dict]:
    return [{"monthly": round(monthly_equivalent(r.amount, r.frequency), 2), "next_date": _next(r.start_date, r.frequency, r.end_date)} for r in items]


def _enrich_contract(db: Session, items: list[Contract]) -> list[dict]:
    return [
        {
            "monthly": round(monthly_equivalent(c.amount, c.frequency), 2),
            "yearly": round(monthly_equivalent(c.amount, c.frequency) * 12, 2),
            "next_date": _next(c.start_date, c.frequency, c.end_date) if c.status == "active" else None,
        }
        for c in items
    ]


def _enrich_loan(db: Session, items: list[Loan]) -> list[dict]:
    return [{"status": loan_status(l)} for l in items]


def _enrich_goal(db: Session, items: list[Goal]) -> list[dict]:
    out = []
    for g in items:
        current = g.saved
        if g.account_id:
            acc = db.get(Account, g.account_id)
            current = acc.balance if acc else g.saved
        needed = None
        if g.deadline and g.deadline > today():
            months = max(1, (g.deadline.year - today().year) * 12 + g.deadline.month - today().month)
            needed = round(max(0.0, g.target - current) / months, 2)
        out.append({"current": round(current, 2), "monthly_needed": needed})
    return out


# --- Routes spécifiques (déclarées avant les routes CRUD génériques) -----------------

extra = APIRouter(tags=["planification"])


@extra.get("/api/recurring/detect")
def detect(db: Session = Depends(get_db)):
    return detect_recurring(db)


@extra.post("/api/recurring/{rec_id}/link")
def link_transactions(rec_id: int, db: Session = Depends(get_db)):
    """Rattache les opérations passées correspondant au motif de l'échéance."""
    rec = db.get(Recurring, rec_id)
    if not rec or not rec.match_pattern:
        raise HTTPException(400, "Échéance sans motif de rapprochement")
    n = 0
    for tx in db.scalars(select(Transaction).where(Transaction.recurring_id.is_(None))):
        if pattern_matches(rec.match_pattern, tx.label, tx.counterparty) and (tx.amount > 0) == (rec.kind == "income"):
            tx.recurring_id = rec.id
            if rec.category_id and not tx.category_id:
                tx.category_id = rec.category_id
            n += 1
    db.commit()
    return {"linked": n}


@extra.get("/api/loans/{loan_id}/schedule")
def loan_schedule(loan_id: int, db: Session = Depends(get_db)):
    loan = db.get(Loan, loan_id)
    if not loan:
        raise HTTPException(404, "Crédit introuvable")
    return {"status": loan_status(loan), "rows": amortization(loan)}


@extra.get("/api/categories/rules")
def list_rules(db: Session = Depends(get_db)):
    return [RuleOut.model_validate(r).model_dump() for r in db.scalars(select(CategoryRule).order_by(CategoryRule.priority, CategoryRule.pattern))]


@extra.post("/api/categories/rules", status_code=201)
def create_rule(payload: RuleIn, db: Session = Depends(get_db)):
    if not db.get(Category, payload.category_id):
        raise HTTPException(404, "Catégorie introuvable")
    rule = CategoryRule(**payload.model_dump())
    db.add(rule)
    db.commit()
    return RuleOut.model_validate(rule).model_dump()


@extra.delete("/api/categories/rules/{rule_id}", status_code=204)
def delete_rule(rule_id: int, db: Session = Depends(get_db)):
    rule = db.get(CategoryRule, rule_id)
    if rule:
        db.delete(rule)
        db.commit()


routers = [
    extra,
    crud_router(Category, CategoryIn, CategoryOut, "/api/categories", order_by=[Category.kind, Category.name]),
    crud_router(Recurring, RecurringIn, RecurringOut, "/api/recurring", order_by=[Recurring.kind, Recurring.name], enrich=_enrich_recurring),
    crud_router(Loan, LoanIn, LoanOut, "/api/loans", order_by=Loan.start_date, enrich=_enrich_loan, owner_type="loan"),
    crud_router(Contract, ContractIn, ContractOut, "/api/contracts", order_by=[Contract.status, Contract.category, Contract.name], enrich=_enrich_contract, owner_type="contract"),
    crud_router(Goal, GoalIn, GoalOut, "/api/goals", order_by=Goal.deadline, enrich=_enrich_goal),
]
