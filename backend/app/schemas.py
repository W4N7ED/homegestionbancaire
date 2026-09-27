"""Schémas d'entrée/sortie de l'API."""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Frequency = Literal["weekly", "monthly", "bimonthly", "quarterly", "semiannual", "yearly"]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --- Auth ---------------------------------------------------------------------------

class Credentials(BaseModel):
    username: str = Field(min_length=2, max_length=64)
    password: str = Field(min_length=8, max_length=256)


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=256)


# --- Comptes ------------------------------------------------------------------------

class AccountIn(BaseModel):
    name: str
    bank_name: str = ""
    type: Literal["courant", "epargne", "credit", "especes", "investissement"] = "courant"
    iban: str | None = None
    currency: str = "EUR"
    balance: float = 0.0
    color: str = "#2a78d6"
    include_in_total: bool = True
    archived: bool = False


class AccountOut(AccountIn, ORM):
    id: int
    connection_id: int | None
    balance_date: datetime | None
    provider: str | None = None
    tx_count: int = 0


# --- Catégories & règles ------------------------------------------------------------

class CategoryIn(BaseModel):
    name: str
    kind: Literal["expense", "income", "transfer"] = "expense"
    icon: str = "tag"
    color: str = "#898781"
    budget_monthly: float | None = None


class CategoryOut(CategoryIn, ORM):
    id: int


class RuleIn(BaseModel):
    pattern: str = Field(min_length=2)
    is_regex: bool = False
    category_id: int
    priority: int = 50


class RuleOut(RuleIn, ORM):
    id: int


# --- Transactions -------------------------------------------------------------------

class TransactionIn(BaseModel):
    account_id: int
    date: date
    amount: float
    label: str
    counterparty: str | None = None
    category_id: int | None = None
    notes: str | None = None
    is_transfer: bool = False


class TransactionPatch(BaseModel):
    category_id: int | None = None
    notes: str | None = None
    is_transfer: bool | None = None
    label: str | None = None
    create_rule: bool = False  # mémoriser : créer une règle à partir du libellé


class TransactionOut(ORM):
    id: int
    account_id: int
    date: date
    value_date: date | None
    amount: float
    currency: str
    label: str
    counterparty: str | None
    category_id: int | None
    recurring_id: int | None
    status: str
    is_transfer: bool
    notes: str | None
    source: str


class BulkCategorize(BaseModel):
    ids: list[int]
    category_id: int | None


# --- Échéances récurrentes ----------------------------------------------------------

class RecurringIn(BaseModel):
    name: str
    kind: Literal["income", "expense", "direct_debit", "transfer", "savings"] = "expense"
    amount: float = Field(ge=0)
    frequency: Frequency = "monthly"
    start_date: date
    end_date: date | None = None
    account_id: int | None = None
    category_id: int | None = None
    counterparty: str | None = None
    match_pattern: str | None = None
    active: bool = True
    notes: str | None = None


class RecurringOut(RecurringIn, ORM):
    id: int
    monthly: float = 0
    next_date: date | None = None


# --- Crédits ------------------------------------------------------------------------

class LoanIn(BaseModel):
    name: str
    lender: str = ""
    type: Literal["immobilier", "consommation", "auto", "etudiant", "renouvelable", "travaux", "autre"] = "consommation"
    principal: float = Field(gt=0)
    rate: float = Field(ge=0, default=0)
    duration_months: int = Field(gt=0)
    start_date: date
    monthly_payment: float | None = None
    insurance_monthly: float = 0
    account_id: int | None = None
    match_pattern: str | None = None
    notes: str | None = None


class LoanOut(LoanIn, ORM):
    id: int
    status: dict = {}


# --- Contrats & abonnements --------------------------------------------------------

class ContractIn(BaseModel):
    name: str
    provider: str = ""
    category: str = "autre"
    amount: float = Field(ge=0)
    frequency: Frequency = "monthly"
    start_date: date
    commitment_end: date | None = None
    notice_days: int = 0
    auto_renew: bool = True
    contract_number: str | None = None
    customer_number: str | None = None
    contact: str | None = None
    account_id: int | None = None
    match_pattern: str | None = None
    status: Literal["active", "cancelled"] = "active"
    end_date: date | None = None
    notes: str | None = None


class ContractOut(ContractIn, ORM):
    id: int
    monthly: float = 0
    yearly: float = 0
    next_date: date | None = None
    documents: int = 0


# --- Fiches de paie -----------------------------------------------------------------

class PayslipIn(BaseModel):
    employer: str
    period: date
    gross: float
    net_before_tax: float
    net_taxable: float
    income_tax: float = 0
    net_paid: float
    hours: float | None = None
    bonus: float = 0
    paid_leave_balance: float | None = None
    notes: str | None = None


class PayslipOut(PayslipIn, ORM):
    id: int
    documents: int = 0


# --- Véhicules & carburant ----------------------------------------------------------

class VehicleIn(BaseModel):
    name: str
    plate: str | None = None
    energy: str = "gazole"
    fiscal_hp: int = Field(default=5, ge=1, le=50)
    electric: bool = False
    archived: bool = False


class VehicleOut(VehicleIn, ORM):
    id: int


class FuelIn(BaseModel):
    vehicle_id: int | None = None
    date: date
    station: str = ""
    city: str | None = None
    fuel_type: str = "gazole"
    liters: float = Field(gt=0)
    price_per_liter: float | None = None
    total: float = Field(gt=0)
    odometer: int | None = None
    full_tank: bool = True
    professional: bool = False
    notes: str | None = None

    @model_validator(mode="after")
    def _price(self):
        if not self.price_per_liter and self.liters:
            self.price_per_liter = round(self.total / self.liters, 3)
        return self


class FuelOut(FuelIn, ORM):
    id: int
    consumption: float | None = None  # L/100 km depuis le plein précédent
    documents: int = 0


# --- Objectifs ----------------------------------------------------------------------

class GoalIn(BaseModel):
    name: str
    target: float = Field(gt=0)
    saved: float = 0
    account_id: int | None = None
    deadline: date | None = None
    color: str = "#1baf7a"


class GoalOut(GoalIn, ORM):
    id: int
    current: float = 0
    monthly_needed: float | None = None


# --- Documents ----------------------------------------------------------------------

class DocumentOut(ORM):
    id: int
    title: str
    doc_type: str
    year: int | None
    filename: str
    mime: str
    size: int
    owner_type: str | None
    owner_id: int | None
    notes: str | None
    created_at: datetime


class DocumentPatch(BaseModel):
    title: str | None = None
    doc_type: str | None = None
    year: int | None = None
    notes: str | None = None
    owner_type: str | None = None
    owner_id: int | None = None
