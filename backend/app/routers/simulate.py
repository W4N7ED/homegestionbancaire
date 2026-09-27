from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db import get_db
from ..services.simulate import simulate_purchase

router = APIRouter(prefix="/api/simulate", tags=["simulateur"])


class Scenario(BaseModel):
    count: int = Field(ge=1, le=120)
    rate: float = Field(default=0, ge=0, le=30)  # TAEG annuel en %
    fees_pct: float = Field(default=0, ge=0, le=20)  # frais du paiement fractionné, en % du montant
    first_delay_months: int | None = Field(default=None, ge=0, le=12)
    label: str | None = None


class PurchaseIn(BaseModel):
    amount: float = Field(gt=0, le=10_000_000)
    purchase_date: date | None = None
    down_payment: float = Field(default=0, ge=0)
    include_variable: bool = True
    scenarios: list[Scenario] = Field(min_length=1, max_length=10)


@router.post("/purchase")
def purchase(payload: PurchaseIn, db: Session = Depends(get_db)):
    return simulate_purchase(
        db,
        payload.amount,
        [s.model_dump() for s in payload.scenarios],
        payload.purchase_date,
        payload.down_payment,
        payload.include_variable,
    )
