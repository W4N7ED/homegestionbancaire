"""Connecteur Enable Banking (https://enablebanking.com).

Agrégateur DSP2 agréé, gratuit pour relier ses propres comptes (mode « restricted »).
Couvre Revolut ainsi que la plupart des banques françaises et européennes.

Configuration : créer une application sur le Control Panel Enable Banking, y déclarer
l'URL de retour `<PACTOLE_PUBLIC_URL>/api/banking/callback`, puis saisir dans Pactole
l'identifiant d'application (kid) et la clé privée RSA générée.
"""
from __future__ import annotations

import time
from datetime import date, datetime, timedelta, timezone

import httpx
import jwt

from ..models import BankConnection
from ..security import get_setting
from ..services.ingest import RawTx
from .base import AuthStart, Provider, ProviderError, RemoteAccount

API = "https://api.enablebanking.com"
_BALANCE_PREFERENCE = ["CLBD", "ITBD", "XPCD", "ITAV", "CLAV", "OPBD", "OTHR"]


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    except ValueError:
        return None


class EnableBanking(Provider):
    key = "enablebanking"
    label = "Enable Banking (Revolut, banques FR/UE)"
    settings_fields = [
        {"key": "enablebanking_app_id", "label": "Application ID (kid)", "secret": False},
        {"key": "enablebanking_private_key", "label": "Clé privée RSA (PEM)", "secret": True, "multiline": True},
    ]

    def _creds(self) -> tuple[str, str]:
        app_id = get_setting(self.db, "enablebanking_app_id")
        key = get_setting(self.db, "enablebanking_private_key")
        if not app_id or not key:
            raise ProviderError("Enable Banking n'est pas configuré (Paramètres → Connexions bancaires).")
        return app_id, key

    def configured(self) -> bool:
        return bool(get_setting(self.db, "enablebanking_app_id") and get_setting(self.db, "enablebanking_private_key"))

    def _headers(self) -> dict:
        app_id, key = self._creds()
        now = int(time.time())
        token = jwt.encode(
            {"iss": "enablebanking.com", "aud": "api.enablebanking.com", "iat": now, "exp": now + 3600},
            key,
            algorithm="RS256",
            headers={"kid": app_id},
        )
        return {"Authorization": f"Bearer {token}"}

    def _request(self, method: str, path: str, **kwargs) -> dict:
        try:
            r = httpx.request(method, API + path, headers=self._headers(), timeout=40, **kwargs)
        except httpx.HTTPError as exc:
            raise ProviderError(f"Enable Banking injoignable : {exc}") from exc
        if r.status_code >= 400:
            try:
                detail = r.json()
                msg = detail.get("message") or detail.get("error") or r.text
            except ValueError:
                msg = r.text
            raise ProviderError(f"Enable Banking {r.status_code} : {msg}")
        return r.json()

    def institutions(self, country: str) -> list[dict]:
        data = self._request("GET", "/aspsps", params={"country": country.upper()})
        out = []
        for a in data.get("aspsps", []):
            if "personal" not in (a.get("psu_types") or ["personal"]):
                continue
            out.append(
                {
                    "id": a["name"],
                    "name": a["name"],
                    "country": a.get("country", country),
                    "logo": a.get("logo"),
                    "max_days": (a.get("maximum_consent_validity") or 0) // 86400 or None,
                }
            )
        return sorted(out, key=lambda x: x["name"].lower())

    def start(self, institution_id: str, country: str, redirect_url: str, state: str) -> AuthStart:
        max_days = 180
        try:
            for a in self.institutions(country):
                if a["id"] == institution_id and a.get("max_days"):
                    max_days = min(max_days, a["max_days"])
        except ProviderError:
            pass
        valid_until = datetime.now(timezone.utc) + timedelta(days=max_days) - timedelta(minutes=5)
        data = self._request(
            "POST",
            "/auth",
            json={
                "access": {"valid_until": valid_until.isoformat()},
                "aspsp": {"name": institution_id, "country": country.upper()},
                "state": state,
                "redirect_url": redirect_url,
                "psu_type": "personal",
            },
        )
        return AuthStart(url=data["url"], external_ref=data.get("authorization_id"), valid_until=valid_until.replace(tzinfo=None))

    def complete(self, conn: BankConnection, params: dict) -> list[RemoteAccount]:
        code = params.get("code")
        if not code:
            raise ProviderError(params.get("error_description") or params.get("error") or "Autorisation refusée")
        data = self._request("POST", "/sessions", json={"code": code})
        conn.external_ref = data["session_id"]
        valid = _parse_dt((data.get("access") or {}).get("valid_until"))
        if valid:
            conn.valid_until = valid
        accounts = []
        for acc in data.get("accounts", []):
            if isinstance(acc, str):
                acc = {"uid": acc, **self._request("GET", f"/accounts/{acc}/details")}
            iban = (acc.get("account_id") or {}).get("iban")
            name = acc.get("name") or acc.get("product") or acc.get("details") or conn.institution_name
            accounts.append(RemoteAccount(acc["uid"], name, iban, acc.get("currency") or "EUR"))
        return accounts

    def balance(self, conn: BankConnection, account_id: str) -> float | None:
        data = self._request("GET", f"/accounts/{account_id}/balances")
        balances = data.get("balances") or []
        if not balances:
            return None
        balances.sort(
            key=lambda b: _BALANCE_PREFERENCE.index(b.get("balance_type"))
            if b.get("balance_type") in _BALANCE_PREFERENCE
            else 99
        )
        return float(balances[0]["balance_amount"]["amount"])

    def transactions(self, conn: BankConnection, account_id: str, date_from: date) -> list[RawTx]:
        out: list[RawTx] = []
        params: dict = {"date_from": date_from.isoformat()}
        for _ in range(200):  # garde-fou de pagination
            data = self._request("GET", f"/accounts/{account_id}/transactions", params=params)
            for t in data.get("transactions", []):
                amt = t.get("transaction_amount") or {}
                value = float(amt.get("amount", 0))
                debit = t.get("credit_debit_indicator") == "DBIT"
                value = -abs(value) if debit else abs(value)
                party = (t.get("creditor") if debit else t.get("debtor")) or {}
                remittance = " ".join(t.get("remittance_information") or [])
                d = t.get("booking_date") or t.get("transaction_date") or t.get("value_date")
                if not d:
                    continue
                pending = t.get("status") == "PDNG"
                out.append(
                    RawTx(
                        date=date.fromisoformat(d[:10]),
                        value_date=date.fromisoformat(t["value_date"][:10]) if t.get("value_date") else None,
                        amount=value,
                        label=remittance or party.get("name") or "",
                        counterparty=party.get("name"),
                        external_id=None if pending else (t.get("transaction_id") or t.get("entry_reference")),
                        currency=amt.get("currency", "EUR"),
                        status="pending" if pending else "booked",
                    )
                )
            key = data.get("continuation_key")
            if not key:
                break
            params = {"date_from": date_from.isoformat(), "continuation_key": key}
        return out
