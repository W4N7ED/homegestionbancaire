"""Calculs de crédit amortissable (échéances constantes)."""
from __future__ import annotations

from datetime import date

from dateutil.relativedelta import relativedelta

from ..models import Loan


def compute_payment(principal: float, annual_rate: float, months: int) -> float:
    if months <= 0:
        return 0.0
    r = annual_rate / 100 / 12
    if r == 0:
        return principal / months
    return principal * r / (1 - (1 + r) ** -months)


def loan_payment(loan: Loan) -> float:
    """Mensualité hors assurance."""
    if loan.monthly_payment:
        return loan.monthly_payment
    return round(compute_payment(loan.principal, loan.rate, loan.duration_months), 2)


def loan_end_date(loan: Loan) -> date:
    return loan.start_date + relativedelta(months=loan.duration_months - 1)


def amortization(loan: Loan) -> list[dict]:
    r = loan.rate / 100 / 12
    payment = loan_payment(loan)
    remaining = loan.principal
    rows = []
    for n in range(1, loan.duration_months + 1):
        interest = remaining * r
        capital = min(payment - interest, remaining)
        if n == loan.duration_months:
            capital = remaining
        remaining = max(0.0, remaining - capital)
        rows.append(
            {
                "n": n,
                "date": (loan.start_date + relativedelta(months=n - 1)).isoformat(),
                "payment": round(capital + interest, 2),
                "interest": round(interest, 2),
                "capital": round(capital, 2),
                "insurance": round(loan.insurance_monthly or 0, 2),
                "remaining": round(remaining, 2),
            }
        )
    return rows


def loan_status(loan: Loan, today: date | None = None) -> dict:
    today = today or date.today()
    rows = amortization(loan)
    paid = [row for row in rows if date.fromisoformat(row["date"]) <= today]
    remaining = paid[-1]["remaining"] if paid else loan.principal
    payment = loan_payment(loan)
    total_interest = sum(row["interest"] for row in rows)
    total_insurance = (loan.insurance_monthly or 0) * loan.duration_months
    next_row = next((row for row in rows if date.fromisoformat(row["date"]) > today), None)
    return {
        "payment": round(payment, 2),
        "payment_with_insurance": round(payment + (loan.insurance_monthly or 0), 2),
        "remaining_capital": round(remaining, 2),
        "paid_count": len(paid),
        "remaining_count": loan.duration_months - len(paid),
        "progress": round(len(paid) / loan.duration_months, 4) if loan.duration_months else 1,
        "end_date": loan_end_date(loan).isoformat(),
        "next_date": next_row["date"] if next_row else None,
        "total_interest": round(total_interest, 2),
        "total_cost": round(total_interest + total_insurance, 2),
        "interest_paid": round(sum(row["interest"] for row in paid), 2),
        "finished": len(paid) >= loan.duration_months,
    }
