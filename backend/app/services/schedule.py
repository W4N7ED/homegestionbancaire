"""Échéancier : génère les occurrences des revenus/charges récurrents, contrats et crédits."""
from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date, timedelta

from dateutil.relativedelta import relativedelta
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Contract, Loan, Recurring
from .loans import loan_end_date, loan_payment

MONTH_STEP = {"monthly": 1, "bimonthly": 2, "quarterly": 3, "semiannual": 6, "yearly": 12}
PER_MONTH = {"weekly": 52 / 12, "monthly": 1, "bimonthly": 1 / 2, "quarterly": 1 / 3, "semiannual": 1 / 6, "yearly": 1 / 12}

# Types d'échéances considérés comme des sorties d'argent « charges fixes »
CHARGE_KINDS = {"expense", "direct_debit", "loan", "contract"}
SAVING_KINDS = {"transfer", "savings"}


def monthly_equivalent(amount: float, frequency: str) -> float:
    return amount * PER_MONTH.get(frequency, 1)


def occurrences(start: date, frequency: str, dfrom: date, dto: date, end: date | None = None) -> list[date]:
    """Dates d'occurrence d'une échéance dans [dfrom, dto]."""
    last = min(dto, end) if end else dto
    if last < start or last < dfrom:
        return []
    out: list[date] = []
    if frequency == "weekly":
        i = max(0, (dfrom - start).days // 7)
        d = start + timedelta(days=7 * i)
        while d <= last:
            if d >= dfrom:
                out.append(d)
            i += 1
            d = start + timedelta(days=7 * i)
        return out
    step = MONTH_STEP.get(frequency, 1)
    months_between = (dfrom.year - start.year) * 12 + dfrom.month - start.month
    i = max(0, months_between // step - 1)
    while True:
        d = start + relativedelta(months=step * i)
        if d > last:
            break
        if d >= dfrom:
            out.append(d)
        i += 1
    return out


@dataclass
class ScheduledItem:
    date: date
    name: str
    amount: float  # signé : >0 entrée, <0 sortie
    kind: str
    source: str  # recurring | contract | loan
    source_id: int
    account_id: int | None
    category_id: int | None = None

    def as_dict(self) -> dict:
        d = asdict(self)
        d["date"] = self.date.isoformat()
        return d


def scheduled_items(db: Session, dfrom: date, dto: date) -> list[ScheduledItem]:
    items: list[ScheduledItem] = []
    for r in db.scalars(select(Recurring).where(Recurring.active.is_(True))):
        sign = 1 if r.kind == "income" else -1
        for d in occurrences(r.start_date, r.frequency, dfrom, dto, r.end_date):
            items.append(ScheduledItem(d, r.name, sign * r.amount, r.kind, "recurring", r.id, r.account_id, r.category_id))
    for c in db.scalars(select(Contract).where(Contract.status == "active")):
        for d in occurrences(c.start_date, c.frequency, dfrom, dto, c.end_date):
            items.append(ScheduledItem(d, c.name, -c.amount, "contract", "contract", c.id, c.account_id))
    for loan in db.scalars(select(Loan)):
        pay = loan_payment(loan) + (loan.insurance_monthly or 0)
        for d in occurrences(loan.start_date, "monthly", dfrom, dto, loan_end_date(loan)):
            items.append(ScheduledItem(d, loan.name, -round(pay, 2), "loan", "loan", loan.id, loan.account_id))
    items.sort(key=lambda i: (i.date, i.amount))
    return items


def fixed_monthly_breakdown(db: Session, today: date | None = None) -> dict:
    """Montants mensualisés par nature d'échéance (actives à la date du jour)."""
    today = today or date.today()
    out = {"income": 0.0, "charges": 0.0, "savings": 0.0, "loans": 0.0, "contracts": 0.0, "recurring_expenses": 0.0}
    for r in db.scalars(select(Recurring).where(Recurring.active.is_(True))):
        if r.end_date and r.end_date < today:
            continue
        m = monthly_equivalent(r.amount, r.frequency)
        if r.kind == "income":
            out["income"] += m
        elif r.kind in SAVING_KINDS:
            out["savings"] += m
        else:
            out["recurring_expenses"] += m
    for c in db.scalars(select(Contract).where(Contract.status == "active")):
        if c.end_date and c.end_date < today:
            continue
        out["contracts"] += monthly_equivalent(c.amount, c.frequency)
    for loan in db.scalars(select(Loan)):
        if loan_end_date(loan) >= today and loan.start_date <= today + relativedelta(months=1):
            out["loans"] += loan_payment(loan) + (loan.insurance_monthly or 0)
    out["charges"] = out["recurring_expenses"] + out["contracts"] + out["loans"]
    return {k: round(v, 2) for k, v in out.items()}
