"""Synthèse fiscale annuelle : revenus (fiches de paie), carburant, frais kilométriques."""
from __future__ import annotations

from collections import defaultdict
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Document, FuelReceipt, Payslip, Vehicle

# Barème kilométrique voitures (impots.gouv.fr) : (a, b, c) par tranche de distance d
#   d <= 5 000 km : d * a  |  5 001-20 000 km : d * b + c  |  > 20 000 km : d * e
# Valeurs du barème publié pour les revenus 2024 (reconduit pour 2025) — à vérifier chaque année.
BAREME_KM = {
    3: (0.529, 0.316, 1065, 0.370),
    4: (0.606, 0.340, 1330, 0.407),
    5: (0.636, 0.357, 1395, 0.427),
    6: (0.665, 0.374, 1457, 0.447),
    7: (0.697, 0.394, 1515, 0.470),
}
BAREME_LABEL = "Barème kilométrique 2024-2025 (voitures) — vérifiez les montants sur impots.gouv.fr"


def bareme_km(distance: float, fiscal_hp: int, electric: bool = False) -> float:
    hp = min(max(fiscal_hp, 3), 7)
    a, b, c, e = BAREME_KM[hp]
    if distance <= 5000:
        value = distance * a
    elif distance <= 20000:
        value = distance * b + c
    else:
        value = distance * e
    if electric:
        value *= 1.2  # majoration de 20 % pour les véhicules 100 % électriques
    return round(value, 2)


def year_summary(db: Session, year: int, km_pro: float | None = None, vehicle_id: int | None = None) -> dict:
    start, end = date(year, 1, 1), date(year, 12, 31)
    slips = db.scalars(select(Payslip).where(Payslip.period >= start, Payslip.period <= end).order_by(Payslip.period)).all()
    employers: dict[str, dict] = defaultdict(lambda: {"gross": 0.0, "net_taxable": 0.0, "income_tax": 0.0, "net_paid": 0.0, "count": 0})
    for s in slips:
        e = employers[s.employer]
        e["gross"] += s.gross
        e["net_taxable"] += s.net_taxable
        e["income_tax"] += s.income_tax
        e["net_paid"] += s.net_paid
        e["count"] += 1

    receipts = db.scalars(select(FuelReceipt).where(FuelReceipt.date >= start, FuelReceipt.date <= end)).all()
    vehicles = {v.id: v for v in db.scalars(select(Vehicle))}
    per_vehicle: dict[int | None, dict] = defaultdict(lambda: {"total": 0.0, "liters": 0.0, "count": 0, "odo": []})
    for r in receipts:
        pv = per_vehicle[r.vehicle_id]
        pv["total"] += r.total
        pv["liters"] += r.liters
        pv["count"] += 1
        if r.odometer:
            pv["odo"].append(r.odometer)
    fuel_rows = []
    for vid, pv in per_vehicle.items():
        v = vehicles.get(vid) if vid else None
        km = (max(pv["odo"]) - min(pv["odo"])) if len(pv["odo"]) >= 2 else None
        fuel_rows.append(
            {
                "vehicle_id": vid,
                "vehicle": v.name if v else "Sans véhicule",
                "total": round(pv["total"], 2),
                "liters": round(pv["liters"], 2),
                "count": pv["count"],
                "km": km,
            }
        )

    docs = db.scalars(select(Document).where(Document.year == year)).all()
    doc_counts: dict[str, int] = defaultdict(int)
    for d in docs:
        doc_counts[d.doc_type] += 1

    km_estimate = None
    if km_pro:
        v = vehicles.get(vehicle_id) if vehicle_id else next(iter(vehicles.values()), None)
        hp = v.fiscal_hp if v else 5
        km_estimate = {
            "km": km_pro,
            "fiscal_hp": hp,
            "vehicle": v.name if v else None,
            "amount": bareme_km(km_pro, hp, bool(v and v.electric)),
            "label": BAREME_LABEL,
        }

    net_taxable = sum(s.net_taxable for s in slips)
    return {
        "year": year,
        "payslips": {
            "count": len(slips),
            "gross": round(sum(s.gross for s in slips), 2),
            "net_taxable": round(net_taxable, 2),
            "income_tax": round(sum(s.income_tax for s in slips), 2),
            "net_paid": round(sum(s.net_paid for s in slips), 2),
            "months": sorted({s.period.month for s in slips}),
            "employers": [{"employer": k, **{kk: round(vv, 2) for kk, vv in v.items()}} for k, v in employers.items()],
            # déduction forfaitaire de 10 % (plafonnée), pour comparer aux frais réels
            "forfait_10": round(min(max(net_taxable * 0.10, 504), 14426), 2) if net_taxable else 0,
        },
        "fuel": {
            "total": round(sum(r.total for r in receipts), 2),
            "professional": round(sum(r.total for r in receipts if r.professional), 2),
            "liters": round(sum(r.liters for r in receipts), 2),
            "count": len(receipts),
            "vehicles": fuel_rows,
        },
        "documents": dict(doc_counts),
        "documents_total": len(docs),
        "km_estimate": km_estimate,
    }
