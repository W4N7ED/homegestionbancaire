"""Interface commune des agrégateurs Open Banking (DSP2 / PSD2)."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy.orm import Session

from ..models import BankConnection
from ..services.ingest import RawTx


class ProviderError(RuntimeError):
    pass


@dataclass
class RemoteAccount:
    external_id: str
    name: str
    iban: str | None
    currency: str


@dataclass
class AuthStart:
    url: str
    external_ref: str | None = None
    valid_until: datetime | None = None


class Provider:
    key: str = ""
    label: str = ""
    settings_fields: list[dict] = []

    def __init__(self, db: Session):
        self.db = db

    def configured(self) -> bool:  # pragma: no cover - interface
        raise NotImplementedError

    def institutions(self, country: str) -> list[dict]:
        raise NotImplementedError

    def start(self, institution_id: str, country: str, redirect_url: str, state: str) -> AuthStart:
        raise NotImplementedError

    def complete(self, conn: BankConnection, params: dict) -> list[RemoteAccount]:
        raise NotImplementedError

    def balance(self, conn: BankConnection, account_id: str) -> float | None:
        raise NotImplementedError

    def transactions(self, conn: BankConnection, account_id: str, date_from: date) -> list[RawTx]:
        raise NotImplementedError
