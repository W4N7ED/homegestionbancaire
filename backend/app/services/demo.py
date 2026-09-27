"""Jeu de données de démonstration (profil fictif) pour découvrir l'application."""
from __future__ import annotations

import random
import uuid
from datetime import date, datetime, timedelta

from dateutil.relativedelta import relativedelta
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Account, Category, Contract, FuelReceipt, Goal, Loan, Payslip, Recurring, Transaction, Vehicle
from .categorize import Categorizer
from .ingest import RecurringMatcher


def _day(month_first: date, day: int) -> date:
    last = (month_first + relativedelta(months=1) - timedelta(days=1)).day
    return month_first.replace(day=min(day, last))


def seed_demo(db: Session, today: date | None = None) -> None:
    today = today or date.today()
    rnd = random.Random(42)
    first_month = today.replace(day=1) - relativedelta(months=6)

    main = Account(name="Revolut Courant", bank_name="Revolut", type="courant", currency="EUR", color="#2a78d6", iban="FR76 2823 3000 0100 0000 0000 000")
    livret = Account(name="Livret A", bank_name="Boursorama", type="epargne", balance=8450.0, color="#1baf7a")
    pocket = Account(name="Coffre Vacances", bank_name="Revolut", type="epargne", balance=1650.0, color="#eda100")
    db.add_all([main, livret, pocket])
    db.flush()

    cats = {c.name: c for c in db.scalars(select(Category))}
    for name, budget in (("Courses", 450), ("Restaurants & sorties", 150), ("Shopping", 120), ("Carburant", 220), ("Loisirs & voyages", 150)):
        if name in cats:
            cats[name].budget_monthly = budget

    salary_day, rent_day = 28, 5
    recurrings = [
        Recurring(name="Salaire ACME", kind="income", amount=2950.0, frequency="monthly", start_date=_day(first_month, salary_day), account_id=main.id, category_id=cats["Salaire"].id, match_pattern="acme", counterparty="ACME SAS"),
        Recurring(name="Loyer", kind="direct_debit", amount=820.0, frequency="monthly", start_date=_day(first_month, rent_day), account_id=main.id, category_id=cats["Logement"].id, match_pattern="foncia"),
        Recurring(name="Électricité EDF", kind="direct_debit", amount=78.0, frequency="monthly", start_date=_day(first_month, 10), account_id=main.id, category_id=cats["Énergie"].id, match_pattern="edf"),
        Recurring(name="Virement Livret A", kind="savings", amount=200.0, frequency="monthly", start_date=_day(first_month, 29), account_id=main.id, category_id=cats["Épargne"].id, match_pattern="livret"),
        Recurring(name="Taxe foncière / habitation", kind="expense", amount=640.0, frequency="yearly", start_date=date(today.year, 10, 15), account_id=main.id, category_id=cats["Impôts & taxes"].id),
    ]
    db.add_all(recurrings)

    contracts = [
        Contract(name="Forfait mobile", provider="Free Mobile", category="telecom", amount=19.99, frequency="monthly", start_date=_day(first_month - relativedelta(months=14), 3), match_pattern="free mobile", account_id=main.id),
        Contract(name="Box Internet", provider="SFR", category="telecom", amount=34.99, frequency="monthly", start_date=_day(first_month - relativedelta(months=11), 8), commitment_end=today + timedelta(days=24), notice_days=10, match_pattern="sfr", account_id=main.id, customer_number="0612345678"),
        Contract(name="Netflix Standard", provider="Netflix", category="streaming", amount=13.49, frequency="monthly", start_date=_day(first_month, 15), match_pattern="netflix", account_id=main.id),
        Contract(name="Spotify Premium", provider="Spotify", category="streaming", amount=11.12, frequency="monthly", start_date=_day(first_month, 20), match_pattern="spotify", account_id=main.id),
        Contract(name="Assurance auto", provider="MAIF", category="assurance", amount=52.30, frequency="monthly", start_date=_day(first_month, 12), match_pattern="maif", account_id=main.id, contract_number="AUTO-5521-88"),
        Contract(name="Salle de sport", provider="Basic-Fit", category="sport", amount=29.99, frequency="monthly", start_date=_day(first_month, 1), commitment_end=today + relativedelta(months=3), notice_days=30, match_pattern="basic fit", account_id=main.id),
        Contract(name="Assurance habitation", provider="Macif", category="assurance", amount=168.0, frequency="yearly", start_date=date(today.year - 1, 11, 2), match_pattern="macif", account_id=main.id),
    ]
    db.add_all(contracts)

    loans = [
        Loan(name="Crédit auto 308", lender="Cetelem", type="auto", principal=15000, rate=4.9, duration_months=60, start_date=_day(first_month - relativedelta(months=14), 6), insurance_monthly=8.5, match_pattern="cetelem", account_id=main.id),
        Loan(name="Prêt étudiant", lender="Crédit Agricole", type="etudiant", principal=6000, rate=0.9, duration_months=48, start_date=_day(today.replace(day=1) - relativedelta(months=46), 15), match_pattern="pret etudiant", account_id=main.id),
    ]
    db.add_all(loans)
    db.flush()

    rows: list[tuple[date, float, str]] = []
    m = first_month
    while m <= today:
        for d, amt, label in (
            (_day(m, salary_day), 2950.0, "VIR SEPA ACME SAS SALAIRE"),
            (_day(m, rent_day), -820.0, "PRLV SEPA FONCIA LOYER"),
            (_day(m, 10), -78.0, "PRLV SEPA EDF CLIENTS PARTICULIERS"),
            (_day(m, 3), -19.99, "PRLV SEPA FREE MOBILE"),
            (_day(m, 8), -34.99, "PRLV SEPA SFR BOX"),
            (_day(m, 15), -13.49, "NETFLIX.COM"),
            (_day(m, 20), -11.12, "SPOTIFY AB"),
            (_day(m, 12), -52.30, "PRLV SEPA MAIF ASSURANCE"),
            (_day(m, 1), -29.99, "BASIC FIT"),
            (_day(m, 6), -290.87, "PRLV SEPA CETELEM ECHEANCE PRET"),
            (_day(m, 15), -127.87, "PRLV SEPA CREDIT AGRICOLE PRET ETUDIANT"),
            (_day(m, 29), -200.0, "Transfer to Livret A"),
        ):
            rows.append((d, amt, label))
        # dépenses variables
        d = m
        while d < m + relativedelta(months=1):
            wd = d.weekday()
            if wd in (2, 5):
                shop = rnd.choice(["CARREFOUR MARKET", "LIDL", "E.LECLERC", "INTERMARCHE", "PICARD", "BIOCOOP"])
                rows.append((d, -round(rnd.uniform(28, 118), 2), shop))
            if wd == 4 and rnd.random() < 0.7:
                rows.append((d, -round(rnd.uniform(14, 48), 2), rnd.choice(["DELIVEROO", "LE PETIT BISTROT", "BURGER KING", "UBER EATS", "RESTAURANT SAKURA"])))
            if wd == 0 and rnd.random() < 0.25:
                rows.append((d, -round(rnd.uniform(12, 90), 2), rnd.choice(["AMAZON EU", "FNAC", "DECATHLON", "IKEA", "ACTION"])))
            if wd == 1 and rnd.random() < 0.2:
                rows.append((d, -round(rnd.uniform(6, 32), 2), "PHARMACIE DU CENTRE"))
            if rnd.random() < 0.05:
                rows.append((d, -round(rnd.uniform(18, 75), 2), rnd.choice(["SNCF CONNECT", "UGC CINE CITE", "STEAM PURCHASE", "PEAGE VINCI AUTOROUTES"])))
            d += timedelta(days=1)
        m += relativedelta(months=1)
    if date(today.year, 11, 2) <= today:
        rows.append((date(today.year, 11, 2), -168.0, "PRLV SEPA MACIF HABITATION"))

    vehicle = Vehicle(name="Peugeot 308 SW", plate="GH-512-KL", energy="gazole", fiscal_hp=5)
    db.add(vehicle)
    db.flush()
    odometer = 48210
    d = first_month + timedelta(days=4)
    while d <= today:
        price = round(rnd.uniform(1.62, 1.79), 3)
        liters = round(rnd.uniform(38, 47), 2)
        total = round(price * liters, 2)
        station = rnd.choice([("TOTALENERGIES", "Lyon"), ("ESSO EXPRESS", "Villeurbanne"), ("INTERMARCHE CARBU", "Bron"), ("E.LECLERC STATION", "Vénissieux")])
        odometer += int(liters / rnd.uniform(5.4, 6.2) * 100)
        db.add(FuelReceipt(vehicle_id=vehicle.id, date=d, station=station[0].title(), city=station[1], fuel_type="gazole", liters=liters, price_per_liter=price, total=total, odometer=odometer, full_tank=True, professional=rnd.random() < 0.3))
        rows.append((d, -total, f"{station[0]} {station[1].upper()}"))
        d += timedelta(days=rnd.randint(9, 13))

    rows = [r for r in rows if r[0] <= today]
    rows.sort()
    categorizer = Categorizer(db)
    matcher = RecurringMatcher(db)
    balance = 2350.0
    for d, amt, label in rows:
        tx = Transaction(account_id=main.id, external_id=f"demo:{uuid.uuid4().hex}", date=d, amount=amt, label=label, counterparty=label, source="import")
        categorizer.apply(tx)
        tx.recurring_id = matcher.match(tx)
        db.add(tx)
        balance += amt
    main.balance = round(balance, 2)
    for acc in (main, livret, pocket):
        acc.balance_date = datetime.utcnow()

    p = first_month - relativedelta(months=6)
    while p <= today.replace(day=1) - relativedelta(months=1):
        bonus = 1200.0 if p.month == 12 else 0.0
        db.add(Payslip(employer="ACME SAS", period=p, gross=3980 + bonus * 1.3, net_before_tax=3080 + bonus, net_taxable=3170 + bonus * 1.03, income_tax=130 + bonus * 0.047, net_paid=2950 + bonus * 0.953, hours=151.67, bonus=bonus))
        p += relativedelta(months=1)

    db.add_all([
        Goal(name="Voyage au Japon", target=4000, account_id=pocket.id, deadline=today + relativedelta(months=8), color="#eda100"),
        Goal(name="Épargne de précaution", target=12000, account_id=livret.id, deadline=today + relativedelta(months=18), color="#1baf7a"),
    ])
    db.commit()
