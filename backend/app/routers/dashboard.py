from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Account, Contract, Goal, Loan
from ..services import analytics
from ..services.fiscal import BAREME_LABEL, year_summary
from ..services.loans import loan_status
from ..services.schedule import monthly_equivalent, scheduled_items

router = APIRouter(prefix="/api", tags=["tableau de bord"])


@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db)):
    today = date.today()
    ms = analytics.month_start(today)
    prev_start = analytics.month_start(ms - timedelta(days=1))
    prev_same_day = min(today - timedelta(days=today.day), prev_start + timedelta(days=today.day - 1))
    loans = []
    for l in db.scalars(select(Loan)):
        st = loan_status(l)
        if not st["finished"]:
            loans.append({"id": l.id, "name": l.name, "lender": l.lender, "type": l.type, "principal": l.principal, **st})
    contracts = db.scalars(select(Contract).where(Contract.status == "active")).all()
    goals = []
    for g in db.scalars(select(Goal)):
        acc = db.get(Account, g.account_id) if g.account_id else None
        goals.append({"id": g.id, "name": g.name, "target": g.target, "current": acc.balance if acc else g.saved, "deadline": g.deadline, "color": g.color})
    spent_prev = sum(r["amount"] for r in analytics.category_spending(db, prev_start, prev_same_day))
    return {
        "today": today.isoformat(),
        "balances": analytics.balances(db),
        "accounts": [
            {"id": a.id, "name": a.name, "bank_name": a.bank_name, "type": a.type, "balance": a.balance,
             "currency": a.currency, "color": a.color, "connected": a.connection_id is not None, "balance_date": a.balance_date}
            for a in db.scalars(select(Account).where(Account.archived.is_(False)).order_by(Account.type, Account.name))
        ],
        "reste_a_vivre": analytics.reste_a_vivre(db, today),
        "monthly": analytics.monthly_flows(db, 12, today),
        "categories": analytics.category_spending(db, ms, today),
        "spent_prev_same_period": round(spent_prev, 2),
        "history": analytics.balance_history(db, 90, today),
        "forecast": analytics.forecast(db, 60, today=today),
        "upcoming": analytics.upcoming(db, 30, today),
        "loans": loans,
        "subscriptions": {
            "count": len(contracts),
            "monthly": round(sum(monthly_equivalent(c.amount, c.frequency) for c in contracts), 2),
            "yearly": round(sum(monthly_equivalent(c.amount, c.frequency) for c in contracts) * 12, 2),
        },
        "goals": goals,
        "alerts": analytics.alerts(db, today),
    }


@router.get("/reste-a-vivre")
def reste_a_vivre(db: Session = Depends(get_db)):
    return analytics.reste_a_vivre(db)


@router.get("/forecast")
def forecast(days: int = Query(90, ge=7, le=365), variable: bool = True, db: Session = Depends(get_db)):
    return analytics.forecast(db, days, include_variable=variable)


@router.get("/history")
def history(days: int = Query(90, ge=7, le=730), db: Session = Depends(get_db)):
    return analytics.balance_history(db, days)


@router.get("/calendar")
def calendar(date_from: date, date_to: date, db: Session = Depends(get_db)):
    if (date_to - date_from).days > 400:
        date_to = date_from + timedelta(days=400)
    return [i.as_dict() for i in scheduled_items(db, date_from, date_to)]


@router.get("/stats/categories")
def stats_categories(date_from: date, date_to: date, db: Session = Depends(get_db)):
    return analytics.category_spending(db, date_from, date_to)


@router.get("/stats/monthly")
def stats_monthly(months: int = Query(12, ge=1, le=60), db: Session = Depends(get_db)):
    return analytics.monthly_flows(db, months)


@router.get("/fiscal/{year}")
def fiscal(year: int, km_pro: float | None = None, vehicle_id: int | None = None, db: Session = Depends(get_db)):
    return {**year_summary(db, year, km_pro, vehicle_id), "bareme_label": BAREME_LABEL}
