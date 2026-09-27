"""Fiches de paie, véhicules et tickets de carburant."""
from __future__ import annotations

from collections import defaultdict
from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..crud import crud_router
from ..db import get_db
from ..models import FuelReceipt, Payslip, Vehicle
from ..schemas import FuelIn, FuelOut, PayslipIn, PayslipOut, VehicleIn, VehicleOut


def _consumptions(db: Session) -> dict[int, float]:
    """Consommation L/100 km, méthode du plein à plein, par ticket."""
    out: dict[int, float] = {}
    by_vehicle: dict[int | None, list[FuelReceipt]] = defaultdict(list)
    for r in db.scalars(select(FuelReceipt).order_by(FuelReceipt.date, FuelReceipt.id)):
        by_vehicle[r.vehicle_id].append(r)
    for receipts in by_vehicle.values():
        last_full: FuelReceipt | None = None
        liters_since = 0.0
        for r in receipts:
            liters_since += r.liters
            if r.full_tank and r.odometer:
                if last_full and last_full.odometer and r.odometer > last_full.odometer:
                    out[r.id] = round(liters_since / (r.odometer - last_full.odometer) * 100, 2)
                last_full, liters_since = r, 0.0
    return out


def _enrich_fuel(db: Session, items: list[FuelReceipt]) -> list[dict]:
    cons = _consumptions(db)
    return [{"consumption": cons.get(r.id)} for r in items]


extra = APIRouter(tags=["dossiers"])


@extra.get("/api/payslips/summary")
def payslip_summary(db: Session = Depends(get_db)):
    """Cumuls annuels + évolution mensuelle du net."""
    years: dict[int, dict] = defaultdict(lambda: {"gross": 0.0, "net_taxable": 0.0, "net_paid": 0.0, "income_tax": 0.0, "count": 0})
    series = []
    for s in db.scalars(select(Payslip).order_by(Payslip.period)):
        y = years[s.period.year]
        y["gross"] += s.gross
        y["net_taxable"] += s.net_taxable
        y["net_paid"] += s.net_paid
        y["income_tax"] += s.income_tax
        y["count"] += 1
        series.append({"period": s.period.strftime("%Y-%m"), "net_paid": s.net_paid, "gross": s.gross, "employer": s.employer})
    return {
        "years": [{"year": k, **{kk: round(vv, 2) for kk, vv in v.items()}} for k, v in sorted(years.items(), reverse=True)],
        "series": series,
    }


@extra.get("/api/fuel/stats")
def fuel_stats(year: int | None = None, db: Session = Depends(get_db)):
    year = year or date.today().year
    receipts = db.scalars(
        select(FuelReceipt).where(FuelReceipt.date >= date(year, 1, 1), FuelReceipt.date <= date(year, 12, 31))
    ).all()
    cons = _consumptions(db)
    months = [{"month": f"{year}-{m:02d}", "total": 0.0, "liters": 0.0} for m in range(1, 13)]
    for r in receipts:
        months[r.date.month - 1]["total"] += r.total
        months[r.date.month - 1]["liters"] += r.liters
    for m in months:
        m["total"], m["liters"] = round(m["total"], 2), round(m["liters"], 2)
    liters = sum(r.liters for r in receipts)
    total = sum(r.total for r in receipts)
    values = [cons[r.id] for r in receipts if r.id in cons]
    return {
        "year": year,
        "total": round(total, 2),
        "liters": round(liters, 2),
        "count": len(receipts),
        "avg_price": round(total / liters, 3) if liters else None,
        "avg_consumption": round(sum(values) / len(values), 2) if values else None,
        "professional": round(sum(r.total for r in receipts if r.professional), 2),
        "months": months,
    }


routers = [
    extra,
    crud_router(Payslip, PayslipIn, PayslipOut, "/api/payslips", order_by=Payslip.period.desc(), owner_type="payslip"),
    crud_router(Vehicle, VehicleIn, VehicleOut, "/api/vehicles", order_by=Vehicle.name),
    crud_router(FuelReceipt, FuelIn, FuelOut, "/api/fuel", order_by=FuelReceipt.date.desc(), enrich=_enrich_fuel, owner_type="fuel"),
]
