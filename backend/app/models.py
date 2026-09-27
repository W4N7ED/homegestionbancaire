"""Modèle de données de Pactole.

Montants : float arrondis à 2 décimales à l'écriture. Signe des transactions :
négatif = débit, positif = crédit. Les montants des charges récurrentes, contrats
et crédits sont toujours positifs, le sens étant porté par `kind`.
"""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class User(TimestampMixin, Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))


class Setting(Base):
    """Paramètres clé/valeur. Les valeurs sensibles sont chiffrées (Fernet)."""

    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")
    encrypted: Mapped[bool] = mapped_column(Boolean, default=False)


class BankConnection(TimestampMixin, Base):
    __tablename__ = "bank_connections"
    id: Mapped[int] = mapped_column(primary_key=True)
    provider: Mapped[str] = mapped_column(String(32))  # enablebanking | gocardless
    institution_id: Mapped[str] = mapped_column(String(128))
    institution_name: Mapped[str] = mapped_column(String(128))
    country: Mapped[str] = mapped_column(String(2), default="FR")
    # pending -> linked -> expired | error
    status: Mapped[str] = mapped_column(String(16), default="pending")
    state: Mapped[str] = mapped_column(String(64), index=True)  # anti-CSRF du retour OAuth
    external_ref: Mapped[str | None] = mapped_column(String(128))  # session_id / requisition_id
    valid_until: Mapped[datetime | None] = mapped_column(DateTime)
    last_sync: Mapped[datetime | None] = mapped_column(DateTime)
    last_error: Mapped[str | None] = mapped_column(Text)

    accounts: Mapped[list[Account]] = relationship(back_populates="connection")


class Account(TimestampMixin, Base):
    __tablename__ = "accounts"
    id: Mapped[int] = mapped_column(primary_key=True)
    connection_id: Mapped[int | None] = mapped_column(ForeignKey("bank_connections.id", ondelete="SET NULL"))
    external_id: Mapped[str | None] = mapped_column(String(128), index=True)
    name: Mapped[str] = mapped_column(String(128))
    bank_name: Mapped[str] = mapped_column(String(128), default="")
    # courant | epargne | credit | especes | investissement
    type: Mapped[str] = mapped_column(String(16), default="courant")
    iban: Mapped[str | None] = mapped_column(String(64))
    currency: Mapped[str] = mapped_column(String(3), default="EUR")
    balance: Mapped[float] = mapped_column(Float, default=0.0)
    balance_date: Mapped[datetime | None] = mapped_column(DateTime)
    color: Mapped[str] = mapped_column(String(9), default="#2a78d6")
    include_in_total: Mapped[bool] = mapped_column(Boolean, default=True)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)

    connection: Mapped[BankConnection | None] = relationship(back_populates="accounts")


class Category(Base):
    __tablename__ = "categories"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(64), unique=True)
    kind: Mapped[str] = mapped_column(String(16), default="expense")  # expense | income | transfer
    icon: Mapped[str] = mapped_column(String(32), default="tag")
    color: Mapped[str] = mapped_column(String(9), default="#898781")
    budget_monthly: Mapped[float | None] = mapped_column(Float)


class CategoryRule(Base):
    """Règle de catégorisation automatique : si le libellé contient `pattern`."""

    __tablename__ = "category_rules"
    id: Mapped[int] = mapped_column(primary_key=True)
    pattern: Mapped[str] = mapped_column(String(128))
    is_regex: Mapped[bool] = mapped_column(Boolean, default=False)
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id", ondelete="CASCADE"))
    priority: Mapped[int] = mapped_column(Integer, default=100)


class Transaction(TimestampMixin, Base):
    __tablename__ = "transactions"
    __table_args__ = (UniqueConstraint("account_id", "external_id", name="uq_tx_account_external"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    external_id: Mapped[str] = mapped_column(String(160))
    date: Mapped[date] = mapped_column(Date, index=True)
    value_date: Mapped[date | None] = mapped_column(Date)
    amount: Mapped[float] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String(3), default="EUR")
    label: Mapped[str] = mapped_column(String(512))
    counterparty: Mapped[str | None] = mapped_column(String(256))
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id", ondelete="SET NULL"), index=True)
    recurring_id: Mapped[int | None] = mapped_column(ForeignKey("recurrings.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(16), default="booked")  # booked | pending
    is_transfer: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(16), default="manual")  # manual | bank | import


class Recurring(TimestampMixin, Base):
    """Échéance récurrente : revenu, dépense, prélèvement ou virement permanent."""

    __tablename__ = "recurrings"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    # income | expense | direct_debit | transfer | savings
    kind: Mapped[str] = mapped_column(String(16), default="expense")
    amount: Mapped[float] = mapped_column(Float)
    # weekly | monthly | bimonthly | quarterly | semiannual | yearly
    frequency: Mapped[str] = mapped_column(String(16), default="monthly")
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id", ondelete="SET NULL"))
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id", ondelete="SET NULL"))
    counterparty: Mapped[str | None] = mapped_column(String(128))
    match_pattern: Mapped[str | None] = mapped_column(String(128))  # rapprochement auto des transactions
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    notes: Mapped[str | None] = mapped_column(Text)


class Loan(TimestampMixin, Base):
    __tablename__ = "loans"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    lender: Mapped[str] = mapped_column(String(128), default="")
    # immobilier | consommation | auto | etudiant | renouvelable | travaux | autre
    type: Mapped[str] = mapped_column(String(16), default="consommation")
    principal: Mapped[float] = mapped_column(Float)
    rate: Mapped[float] = mapped_column(Float, default=0.0)  # TAEG / taux nominal annuel en %
    duration_months: Mapped[int] = mapped_column(Integer)
    start_date: Mapped[date] = mapped_column(Date)  # date de la 1re échéance
    monthly_payment: Mapped[float | None] = mapped_column(Float)  # si vide : calculée
    insurance_monthly: Mapped[float] = mapped_column(Float, default=0.0)
    account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id", ondelete="SET NULL"))
    match_pattern: Mapped[str | None] = mapped_column(String(128))
    notes: Mapped[str | None] = mapped_column(Text)


class Contract(TimestampMixin, Base):
    """Contrat / abonnement : énergie, télécom, assurance, streaming, salle de sport…"""

    __tablename__ = "contracts"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    provider: Mapped[str] = mapped_column(String(128), default="")
    category: Mapped[str] = mapped_column(String(32), default="autre")
    amount: Mapped[float] = mapped_column(Float)
    frequency: Mapped[str] = mapped_column(String(16), default="monthly")
    start_date: Mapped[date] = mapped_column(Date)
    commitment_end: Mapped[date | None] = mapped_column(Date)
    notice_days: Mapped[int] = mapped_column(Integer, default=0)
    auto_renew: Mapped[bool] = mapped_column(Boolean, default=True)
    contract_number: Mapped[str | None] = mapped_column(String(128))
    customer_number: Mapped[str | None] = mapped_column(String(128))
    contact: Mapped[str | None] = mapped_column(String(256))
    account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id", ondelete="SET NULL"))
    match_pattern: Mapped[str | None] = mapped_column(String(128))
    status: Mapped[str] = mapped_column(String(16), default="active")  # active | cancelled
    end_date: Mapped[date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(Text)


class Payslip(TimestampMixin, Base):
    __tablename__ = "payslips"
    __table_args__ = (UniqueConstraint("employer", "period", name="uq_payslip_period"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    employer: Mapped[str] = mapped_column(String(128))
    period: Mapped[date] = mapped_column(Date)  # 1er jour du mois concerné
    gross: Mapped[float] = mapped_column(Float)
    net_before_tax: Mapped[float] = mapped_column(Float)
    net_taxable: Mapped[float] = mapped_column(Float)
    income_tax: Mapped[float] = mapped_column(Float, default=0.0)  # prélèvement à la source
    net_paid: Mapped[float] = mapped_column(Float)
    hours: Mapped[float | None] = mapped_column(Float)
    bonus: Mapped[float] = mapped_column(Float, default=0.0)
    paid_leave_balance: Mapped[float | None] = mapped_column(Float)
    notes: Mapped[str | None] = mapped_column(Text)


class Vehicle(TimestampMixin, Base):
    __tablename__ = "vehicles"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    plate: Mapped[str | None] = mapped_column(String(16))
    energy: Mapped[str] = mapped_column(String(16), default="gazole")  # gazole | sp95 | sp98 | e85 | gpl | electrique | hybride
    fiscal_hp: Mapped[int] = mapped_column(Integer, default=5)  # puissance fiscale (CV)
    electric: Mapped[bool] = mapped_column(Boolean, default=False)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)


class FuelReceipt(TimestampMixin, Base):
    __tablename__ = "fuel_receipts"
    id: Mapped[int] = mapped_column(primary_key=True)
    vehicle_id: Mapped[int | None] = mapped_column(ForeignKey("vehicles.id", ondelete="SET NULL"))
    date: Mapped[date] = mapped_column(Date, index=True)
    station: Mapped[str] = mapped_column(String(128), default="")
    city: Mapped[str | None] = mapped_column(String(128))
    fuel_type: Mapped[str] = mapped_column(String(16), default="gazole")
    liters: Mapped[float] = mapped_column(Float)
    price_per_liter: Mapped[float | None] = mapped_column(Float)
    total: Mapped[float] = mapped_column(Float)
    odometer: Mapped[int | None] = mapped_column(Integer)
    full_tank: Mapped[bool] = mapped_column(Boolean, default=True)
    professional: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str | None] = mapped_column(Text)


class Goal(TimestampMixin, Base):
    __tablename__ = "goals"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    target: Mapped[float] = mapped_column(Float)
    saved: Mapped[float] = mapped_column(Float, default=0.0)
    account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id", ondelete="SET NULL"))
    deadline: Mapped[date | None] = mapped_column(Date)
    color: Mapped[str] = mapped_column(String(9), default="#1baf7a")


class Document(TimestampMixin, Base):
    """Justificatif stocké dans /data/uploads, éventuellement rattaché à une entité."""

    __tablename__ = "documents"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(256))
    # fiche_paie | ticket_carburant | contrat | facture | impots | banque | assurance | autre
    doc_type: Mapped[str] = mapped_column(String(32), default="autre")
    year: Mapped[int | None] = mapped_column(Integer, index=True)
    filename: Mapped[str] = mapped_column(String(256))
    stored_name: Mapped[str] = mapped_column(String(128), unique=True)
    mime: Mapped[str] = mapped_column(String(128), default="application/octet-stream")
    size: Mapped[int] = mapped_column(Integer, default=0)
    sha256: Mapped[str] = mapped_column(String(64))
    # payslip | fuel | contract | loan | transaction | None
    owner_type: Mapped[str | None] = mapped_column(String(16), index=True)
    owner_id: Mapped[int | None] = mapped_column(Integer, index=True)
    notes: Mapped[str | None] = mapped_column(Text)
