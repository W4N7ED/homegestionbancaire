"""Simulateur d'achat : comptant, paiement en plusieurs fois (3x, 4x…) ou crédit (12, 24 mois…).

Pour chaque scénario on calcule l'échéancier, le coût total, l'effet sur le reste à vivre
et le taux d'endettement, puis on projette le solde des comptes courants avec l'achat.
"""
from __future__ import annotations

from datetime import date, timedelta

from dateutil.relativedelta import relativedelta
from sqlalchemy.orm import Session

from . import analytics
from .loans import compute_payment

MAX_DAYS = 1130  # ~37 mois de projection au maximum
DEBT_LIMIT = 0.35  # recommandation HCSF


def installments(financed: float, count: int, rate: float, fees_pct: float, first: date) -> list[dict]:
    """Échéancier : mensualités constantes, frais ajoutés à la 1re échéance, arrondi au centime."""
    payment = round(compute_payment(financed, rate, count), 2)
    fees = round(financed * fees_pct / 100, 2)
    rows = []
    remaining = financed
    r = rate / 100 / 12
    for i in range(count):
        interest = round(remaining * r, 2)
        amount = payment
        if i == count - 1:  # la dernière échéance solde le capital restant (écarts d'arrondi)
            amount = round(remaining + interest, 2)
        remaining = round(remaining + interest - amount, 2)
        rows.append({
            "n": i + 1,
            "date": (first + relativedelta(months=i)).isoformat(),
            "amount": round(amount + (fees if i == 0 else 0), 2),
            "interest": interest,
            "fees": fees if i == 0 else 0.0,
        })
    return rows


def simulate_purchase(
    db: Session,
    amount: float,
    scenarios: list[dict],
    purchase_date: date | None = None,
    down_payment: float = 0.0,
    include_variable: bool = True,
    today: date | None = None,
) -> dict:
    today = today or date.today()
    purchase_date = max(purchase_date or today, today)
    down_payment = min(max(down_payment, 0.0), amount)
    financed = round(amount - down_payment, 2)

    rav = analytics.reste_a_vivre(db, today)
    income = rav["income_monthly"]
    loans_monthly = rav["breakdown"]["loans"]

    plans = []
    for sc in scenarios:
        count = max(1, int(sc.get("count", 1)))
        rate = float(sc.get("rate") or 0.0) if count > 1 else 0.0
        fees_pct = float(sc.get("fees_pct") or 0.0) if count > 1 else 0.0
        delay = sc.get("first_delay_months")
        if delay is None:
            delay = 0 if count <= 4 else 1  # paiement fractionné : 1re échéance à l'achat
        first = purchase_date + relativedelta(months=int(delay))
        rows = installments(financed, count, rate, fees_pct, first) if financed > 0 else []
        plans.append({"count": count, "rate": rate, "fees_pct": fees_pct, "first": first, "rows": rows,
                      "label": sc.get("label") or ("Comptant" if count == 1 else f"{count} fois")})

    last_dates = [date.fromisoformat(p["rows"][-1]["date"]) for p in plans if p["rows"]] + [purchase_date]
    days = min(MAX_DAYS, max(90, (max(last_dates) - today).days + 45))
    start, daily_var, by_day = analytics.forecast_inputs(db, days, include_variable, today)
    baseline = analytics.project(start, daily_var, by_day, today, days)

    results = []
    for p in plans:
        extra: dict[date, float] = {}
        if down_payment:
            extra[purchase_date] = extra.get(purchase_date, 0.0) - down_payment
        for row in p["rows"]:
            d = date.fromisoformat(row["date"])
            extra[d] = extra.get(d, 0.0) - row["amount"]
        proj = analytics.project(start, daily_var, by_day, today, days, extra)

        total_paid = round(down_payment + sum(r["amount"] for r in p["rows"]), 2)
        monthly = p["rows"][0]["amount"] - p["rows"][0]["fees"] if p["count"] > 1 and p["rows"] else 0.0
        debt_ratio = (loans_monthly + monthly) / income if income else None
        rav_after = rav["reste_a_vivre"] - monthly

        warnings = []
        if proj["first_negative"]:
            warnings.append({"level": "critical", "text": f"Découvert prévu le {date.fromisoformat(proj['first_negative']):%d/%m/%Y}"})
        elif proj["lowest"]["balance"] < max(150.0, income * 0.1):
            warnings.append({"level": "warning", "text": f"Solde bas : {analytics.fr_eur(proj['lowest']['balance'])} au plus bas"})
        if debt_ratio is not None and p["count"] > 1 and debt_ratio > DEBT_LIMIT:
            warnings.append({"level": "critical", "text": f"Endettement {debt_ratio * 100:.1f} % (> 35 %)"})
        if p["count"] > 1 and rav_after < 0:
            warnings.append({"level": "critical", "text": "Reste à vivre négatif pendant le remboursement"})
        verdict = "risky" if any(w["level"] == "critical" for w in warnings) else ("tight" if warnings else "ok")

        results.append({
            "label": p["label"],
            "count": p["count"],
            "rate": p["rate"],
            "fees_pct": p["fees_pct"],
            "first_date": p["first"].isoformat(),
            "last_date": p["rows"][-1]["date"] if p["rows"] else purchase_date.isoformat(),
            "installment": round(monthly if p["count"] > 1 else financed, 2),
            "first_installment": p["rows"][0]["amount"] if p["rows"] else 0.0,
            "total_paid": total_paid,
            "extra_cost": round(total_paid - amount, 2),
            "reste_a_vivre_after": round(rav_after, 2),
            "debt_ratio_after": round(debt_ratio, 4) if debt_ratio is not None else None,
            "lowest": proj["lowest"],
            "first_negative": proj["first_negative"],
            "end_balance": proj["end_balance"],
            "verdict": verdict,
            "warnings": warnings,
            "schedule": p["rows"],
            "series": proj["series"],
        })

    # recommandation : le moins cher parmi les scénarios sans risque, sinon le moins risqué
    safe = [r for r in results if r["verdict"] == "ok"] or [r for r in results if r["verdict"] == "tight"]
    pick = min(safe, key=lambda r: (r["extra_cost"], r["count"])) if safe else max(results, key=lambda r: r["lowest"]["balance"], default=None)

    return {
        "amount": amount,
        "down_payment": down_payment,
        "financed": financed,
        "purchase_date": purchase_date.isoformat(),
        "days": days,
        "income_monthly": income,
        "reste_a_vivre": rav["reste_a_vivre"],
        "debt_ratio": rav["debt_ratio"],
        "available_now": rav["current"]["available"],
        "baseline": {k: baseline[k] for k in ("series", "lowest", "end_balance", "first_negative", "daily_variable")},
        "scenarios": results,
        "recommended": pick["label"] if pick else None,
    }
