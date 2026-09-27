"""Indicateurs du tableau de bord : soldes, reste à vivre, prévisionnel, alertes."""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta

from dateutil.relativedelta import relativedelta
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Account, BankConnection, Category, Contract, Loan, Payslip, Recurring, Transaction
from .categorize import pattern_matches
from .loans import loan_end_date, loan_status
from .schedule import ScheduledItem, fixed_monthly_breakdown, occurrences, scheduled_items

LIQUID_TYPES = ("courant", "especes")
SAVINGS_TYPES = ("epargne", "investissement")


def fr_eur(v: float) -> str:
    """Montant au format français : 1 234,56 €."""
    s = f"{v:,.2f}".replace(",", "\u202f").replace(".", ",")
    return f"{s} €"


def month_start(d: date) -> date:
    return d.replace(day=1)


def month_end(d: date) -> date:
    return month_start(d) + relativedelta(months=1) - timedelta(days=1)


def _accounts(db: Session, types: tuple[str, ...] | None = None) -> list[Account]:
    q = select(Account).where(Account.archived.is_(False), Account.include_in_total.is_(True))
    if types:
        q = q.where(Account.type.in_(types))
    return list(db.scalars(q))


def balances(db: Session) -> dict:
    accs = _accounts(db)
    liquid = sum(a.balance for a in accs if a.type in LIQUID_TYPES)
    savings = sum(a.balance for a in accs if a.type in SAVINGS_TYPES)
    debt = sum(loan_status(l)["remaining_capital"] for l in db.scalars(select(Loan)))
    return {
        "liquid": round(liquid, 2),
        "savings": round(savings, 2),
        "total": round(sum(a.balance for a in accs), 2),
        "debt": round(debt, 2),
        "net_worth": round(sum(a.balance for a in accs) - debt, 2),
    }


def _flows(db: Session, dfrom: date, dto: date, account_ids: list[int] | None = None) -> list[Transaction]:
    q = select(Transaction).where(
        Transaction.date >= dfrom, Transaction.date <= dto, Transaction.is_transfer.is_(False)
    )
    if account_ids is not None:
        q = q.where(Transaction.account_id.in_(account_ids))
    return list(db.scalars(q))


def monthly_flows(db: Session, months: int = 12, today: date | None = None) -> list[dict]:
    today = today or date.today()
    start = month_start(today) - relativedelta(months=months - 1)
    agg: dict[str, dict] = {}
    for i in range(months):
        m = start + relativedelta(months=i)
        agg[m.strftime("%Y-%m")] = {"month": m.strftime("%Y-%m"), "income": 0.0, "expense": 0.0}
    for tx in _flows(db, start, month_end(today)):
        row = agg.get(tx.date.strftime("%Y-%m"))
        if row is None:
            continue
        if tx.amount >= 0:
            row["income"] += tx.amount
        else:
            row["expense"] += -tx.amount
    out = []
    for row in agg.values():
        row["income"], row["expense"] = round(row["income"], 2), round(row["expense"], 2)
        row["net"] = round(row["income"] - row["expense"], 2)
        out.append(row)
    return out


def category_spending(db: Session, dfrom: date, dto: date) -> list[dict]:
    cats = {c.id: c for c in db.scalars(select(Category))}
    totals: dict[int | None, float] = defaultdict(float)
    for tx in _flows(db, dfrom, dto):
        if tx.amount < 0:
            totals[tx.category_id] += -tx.amount
    out = []
    for cid, value in totals.items():
        c = cats.get(cid) if cid else None
        out.append(
            {
                "category_id": cid,
                "name": c.name if c else "Non catégorisé",
                "color": c.color if c else "#898781",
                "icon": c.icon if c else "circle-help",
                "amount": round(value, 2),
                "budget": c.budget_monthly if c else None,
            }
        )
    out.sort(key=lambda r: -r["amount"])
    return out


def balance_history(db: Session, days: int = 90, today: date | None = None) -> list[dict]:
    """Reconstitue le solde liquide jour par jour à rebours depuis le solde actuel."""
    today = today or date.today()
    accs = _accounts(db, LIQUID_TYPES)
    ids = [a.id for a in accs]
    current = sum(a.balance for a in accs)
    start = today - timedelta(days=days)
    per_day: dict[date, float] = defaultdict(float)
    if ids:
        for tx in db.scalars(
            select(Transaction).where(
                Transaction.account_id.in_(ids), Transaction.date > start, Transaction.status == "booked"
            )
        ):
            per_day[tx.date] += tx.amount
    out = []
    bal = current
    # les opérations postérieures à aujourd'hui (rare) sont ignorées
    for i in range(days + 1):
        d = today - timedelta(days=i)
        out.append({"date": d.isoformat(), "balance": round(bal, 2)})
        bal -= per_day.get(d, 0.0)
    out.reverse()
    return out


def _is_paid(db: Session, item: ScheduledItem, today: date, cache: dict) -> bool:
    """Une échéance à venir est-elle déjà passée en banque (débit anticipé) ?"""
    key = (item.source, item.source_id)
    if key not in cache:
        model = {"recurring": Recurring, "contract": Contract, "loan": Loan}[item.source]
        obj = db.get(model, item.source_id)
        cache[key] = getattr(obj, "match_pattern", None)
    pattern = cache[key]
    window = item.date - timedelta(days=6)
    q = select(Transaction).where(Transaction.date >= window, Transaction.date <= today)
    if item.source == "recurring":
        linked = db.scalar(q.where(Transaction.recurring_id == item.source_id).limit(1))
        if linked:
            return True
    if not pattern:
        return False
    for tx in db.scalars(q):
        if (tx.amount > 0) == (item.amount > 0) and pattern_matches(pattern, tx.label, tx.counterparty):
            return True
    return False


def upcoming(db: Session, days: int = 30, today: date | None = None) -> list[dict]:
    today = today or date.today()
    cache: dict = {}
    out = []
    for item in scheduled_items(db, today, today + timedelta(days=days)):
        d = item.as_dict()
        d["paid"] = _is_paid(db, item, today, cache) if item.date <= today + timedelta(days=6) else False
        out.append(d)
    return out


def variable_daily_spend(db: Session, today: date | None = None) -> float:
    """Dépenses courantes (hors charges fixes) moyennes par jour sur 90 jours."""
    today = today or date.today()
    since = today - timedelta(days=90)
    txs = [t for t in _flows(db, since, today) if t.amount < 0 and t.recurring_id is None]
    if not txs:
        return 0.0
    first = min(t.date for t in txs)
    span = max(30, (today - first).days)
    patterns = [
        p
        for p in [*db.scalars(select(Contract.match_pattern)), *db.scalars(select(Loan.match_pattern))]
        if p
    ]
    total = sum(-t.amount for t in txs if not any(pattern_matches(p, t.label, t.counterparty) for p in patterns))
    return round(total / span, 2)


def forecast(db: Session, days: int = 60, include_variable: bool = True, today: date | None = None) -> dict:
    today = today or date.today()
    start_balance = sum(a.balance for a in _accounts(db, LIQUID_TYPES))
    daily_var = variable_daily_spend(db, today) if include_variable else 0.0
    cache: dict = {}
    items = [
        i
        for i in scheduled_items(db, today, today + timedelta(days=days))
        if not (i.date <= today + timedelta(days=6) and _is_paid(db, i, today, cache))
    ]
    by_day: dict[date, float] = defaultdict(float)
    for i in items:
        by_day[i.date] += i.amount
    series = []
    bal = start_balance
    lowest = (today.isoformat(), round(bal, 2))
    for n in range(days + 1):
        d = today + timedelta(days=n)
        bal += by_day.get(d, 0.0)
        if n > 0:
            bal -= daily_var
        series.append({"date": d.isoformat(), "balance": round(bal, 2)})
        if bal < lowest[1]:
            lowest = (d.isoformat(), round(bal, 2))
    return {
        "start_balance": round(start_balance, 2),
        "daily_variable": daily_var,
        "series": series,
        "lowest": {"date": lowest[0], "balance": lowest[1]},
        "end_balance": series[-1]["balance"],
    }


def monthly_income_estimate(db: Session, breakdown: dict, today: date) -> tuple[float, str]:
    if breakdown["income"] > 0:
        return breakdown["income"], "revenus récurrents"
    slips = db.scalars(select(Payslip).order_by(Payslip.period.desc()).limit(3)).all()
    if slips:
        return round(sum(s.net_paid for s in slips) / len(slips), 2), "moyenne des 3 dernières fiches de paie"
    flows = monthly_flows(db, 4, today)[:-1]
    incomes = [f["income"] for f in flows if f["income"] > 0]
    if incomes:
        return round(sum(incomes) / len(incomes), 2), "moyenne des revenus des 3 derniers mois"
    return 0.0, "aucun revenu renseigné"


def reste_a_vivre(db: Session, today: date | None = None) -> dict:
    today = today or date.today()
    b = fixed_monthly_breakdown(db, today)
    income, income_source = monthly_income_estimate(db, b, today)
    rav = income - b["charges"]
    liquid = sum(a.balance for a in _accounts(db, LIQUID_TYPES))

    # Horizon : prochaine entrée d'argent récurrente, sinon fin du mois
    next_income = None
    for r in db.scalars(select(Recurring).where(Recurring.active.is_(True), Recurring.kind == "income")):
        occ = occurrences(r.start_date, r.frequency, today + timedelta(days=1), today + timedelta(days=62), r.end_date)
        if occ and (next_income is None or occ[0] < next_income):
            next_income = occ[0]
    horizon = next_income or month_end(today)
    cache: dict = {}
    remaining = [
        i
        for i in scheduled_items(db, today, horizon - timedelta(days=1) if next_income else horizon)
        if i.amount < 0 and not _is_paid(db, i, today, cache)
    ]
    remaining_out = -sum(i.amount for i in remaining)
    available = liquid - remaining_out
    days_left = max(1, (horizon - today).days + (0 if next_income else 1))

    ms = month_start(today)
    month_tx = _flows(db, ms, today)
    return {
        "income_monthly": round(income, 2),
        "income_source": income_source,
        "charges_monthly": b["charges"],
        "breakdown": b,
        "reste_a_vivre": round(rav, 2),
        "reste_a_vivre_after_savings": round(rav - b["savings"], 2),
        "per_day": round(rav / 30.44, 2),
        "debt_ratio": round(b["loans"] / income, 4) if income else None,
        "charges_ratio": round(b["charges"] / income, 4) if income else None,
        "current": {
            "liquid": round(liquid, 2),
            "horizon": horizon.isoformat(),
            "horizon_reason": "prochain revenu" if next_income else "fin du mois",
            "remaining_charges": round(remaining_out, 2),
            "remaining_items": [i.as_dict() for i in remaining],
            "available": round(available, 2),
            "days_left": days_left,
            "per_day": round(available / days_left, 2),
            "month_income": round(sum(t.amount for t in month_tx if t.amount > 0), 2),
            "month_spent": round(-sum(t.amount for t in month_tx if t.amount < 0), 2),
        },
    }


def alerts(db: Session, today: date | None = None) -> list[dict]:
    today = today or date.today()
    out: list[dict] = []

    def add(level: str, title: str, detail: str, link: str) -> None:
        out.append({"level": level, "title": title, "detail": detail, "link": link})

    for conn in db.scalars(select(BankConnection)):
        if conn.status == "expired":
            add("critical", f"Connexion {conn.institution_name} expirée", "Renouvelez le consentement bancaire.", "/banques")
        elif conn.status == "error":
            add("serious", f"Synchro {conn.institution_name} en échec", conn.last_error or "", "/banques")
        elif conn.valid_until and conn.valid_until < datetime.utcnow() + timedelta(days=14):
            add("warning", f"Consentement {conn.institution_name} bientôt expiré",
                f"Expire le {conn.valid_until:%d/%m/%Y}.", "/banques")

    for c in db.scalars(select(Contract).where(Contract.status == "active", Contract.commitment_end.is_not(None))):
        deadline = c.commitment_end - timedelta(days=c.notice_days or 0)
        if today <= deadline <= today + timedelta(days=30):
            add("warning", f"Résiliation {c.name} : avant le {deadline:%d/%m/%Y}",
                f"Fin d'engagement le {c.commitment_end:%d/%m/%Y} (préavis {c.notice_days} j).", "/contrats")
        elif today <= c.commitment_end <= today + timedelta(days=60):
            add("info", f"Fin d'engagement {c.name}", f"Le {c.commitment_end:%d/%m/%Y}.", "/contrats")

    for loan in db.scalars(select(Loan)):
        end = loan_end_date(loan)
        if today <= end <= today + timedelta(days=62):
            add("good", f"Crédit {loan.name} bientôt remboursé", f"Dernière échéance le {end:%d/%m/%Y}.", "/credits")

    fc = forecast(db, 45, today=today)
    if fc["lowest"]["balance"] < 0:
        d = date.fromisoformat(fc["lowest"]["date"])
        add("critical", "Découvert prévisionnel",
            f"Solde estimé {fr_eur(fc['lowest']['balance'])} le {d:%d/%m/%Y}.", "/previsionnel")

    ms = month_start(today)
    for row in category_spending(db, ms, today):
        if row["budget"]:
            ratio = row["amount"] / row["budget"]
            if ratio >= 1:
                add("serious", f"Budget {row['name']} dépassé", f"{fr_eur(row['amount'])} / {fr_eur(row['budget'])}", "/budgets")
            elif ratio >= 0.85:
                add("warning", f"Budget {row['name']} bientôt atteint", f"{fr_eur(row['amount'])} / {fr_eur(row['budget'])}", "/budgets")

    uncategorized = db.query(Transaction).filter(Transaction.category_id.is_(None)).count()
    if uncategorized:
        add("info", f"{uncategorized} opération(s) non catégorisée(s)", "Ajoutez des règles pour les classer automatiquement.", "/operations?category=none")

    last_slip = db.scalar(select(Payslip.period).order_by(Payslip.period.desc()).limit(1))
    if last_slip and last_slip < month_start(today) - relativedelta(months=1) and today.day > 5:
        add("info", "Fiche de paie manquante", f"Dernière fiche : {last_slip:%m/%Y}.", "/paie")

    order = {"critical": 0, "serious": 1, "warning": 2, "info": 3, "good": 4}
    out.sort(key=lambda a: order[a["level"]])
    return out
