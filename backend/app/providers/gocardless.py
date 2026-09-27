"""Connecteur GoCardless Bank Account Data (ex-Nordigen).

GoCardless n'accepte plus de nouvelles inscriptions : ce connecteur sert aux
utilisateurs qui disposent déjà d'un couple secret_id / secret_key.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta

import httpx

from ..models import BankConnection
from ..security import get_setting
from ..services.ingest import RawTx
from .base import AuthStart, Provider, ProviderError, RemoteAccount

API = "https://bankaccountdata.gocardless.com/api/v2"
_BALANCE_PREFERENCE = ["closingBooked", "interimBooked", "expected", "interimAvailable", "openingBooked"]


class GoCardless(Provider):
    key = "gocardless"
    label = "GoCardless Bank Account Data (comptes existants)"
    settings_fields = [
        {"key": "gocardless_secret_id", "label": "Secret ID", "secret": True},
        {"key": "gocardless_secret_key", "label": "Secret Key", "secret": True},
    ]
    _token: tuple[str, datetime] | None = None

    def configured(self) -> bool:
        return bool(get_setting(self.db, "gocardless_secret_id") and get_setting(self.db, "gocardless_secret_key"))

    def _access_token(self) -> str:
        cached = GoCardless._token
        if cached and cached[1] > datetime.utcnow():
            return cached[0]
        sid = get_setting(self.db, "gocardless_secret_id")
        skey = get_setting(self.db, "gocardless_secret_key")
        if not sid or not skey:
            raise ProviderError("GoCardless n'est pas configuré (Paramètres → Connexions bancaires).")
        r = httpx.post(f"{API}/token/new/", json={"secret_id": sid, "secret_key": skey}, timeout=30)
        if r.status_code >= 400:
            raise ProviderError(f"GoCardless : authentification refusée ({r.status_code})")
        data = r.json()
        GoCardless._token = (data["access"], datetime.utcnow() + timedelta(seconds=int(data.get("access_expires", 3600)) - 60))
        return data["access"]

    def _request(self, method: str, path: str, **kwargs):
        try:
            r = httpx.request(
                method, API + path, headers={"Authorization": f"Bearer {self._access_token()}"}, timeout=40, **kwargs
            )
        except httpx.HTTPError as exc:
            raise ProviderError(f"GoCardless injoignable : {exc}") from exc
        if r.status_code >= 400:
            try:
                d = r.json()
                msg = d.get("detail") or d.get("summary") or r.text
            except ValueError:
                msg = r.text
            raise ProviderError(f"GoCardless {r.status_code} : {msg}")
        return r.json()

    def institutions(self, country: str) -> list[dict]:
        data = self._request("GET", "/institutions/", params={"country": country.lower()})
        return [
            {
                "id": i["id"],
                "name": i["name"],
                "country": country.upper(),
                "logo": i.get("logo"),
                "max_days": int(i.get("max_access_valid_for_days") or 90),
                "history_days": int(i.get("transaction_total_days") or 90),
            }
            for i in data
        ]

    def start(self, institution_id: str, country: str, redirect_url: str, state: str) -> AuthStart:
        inst = next((i for i in self.institutions(country) if i["id"] == institution_id), None)
        max_days = inst["max_days"] if inst else 90
        history = inst["history_days"] if inst else 90
        agreement = self._request(
            "POST",
            "/agreements/enduser/",
            json={
                "institution_id": institution_id,
                "max_historical_days": history,
                "access_valid_for_days": max_days,
                "access_scope": ["balances", "details", "transactions"],
            },
        )
        req = self._request(
            "POST",
            "/requisitions/",
            json={
                "redirect": redirect_url,
                "institution_id": institution_id,
                "reference": state,
                "agreement": agreement["id"],
                "user_language": "FR",
            },
        )
        return AuthStart(url=req["link"], external_ref=req["id"], valid_until=datetime.utcnow() + timedelta(days=max_days))

    def complete(self, conn: BankConnection, params: dict) -> list[RemoteAccount]:
        if params.get("error"):
            raise ProviderError(params.get("details") or params["error"])
        req = self._request("GET", f"/requisitions/{conn.external_ref}/")
        if req.get("status") not in ("LN",):
            raise ProviderError(f"Autorisation non finalisée (statut {req.get('status')})")
        out = []
        for acc_id in req.get("accounts", []):
            details = self._request("GET", f"/accounts/{acc_id}/details/").get("account", {})
            name = details.get("name") or details.get("product") or details.get("displayName") or conn.institution_name
            out.append(RemoteAccount(acc_id, name, details.get("iban"), details.get("currency") or "EUR"))
        return out

    def balance(self, conn: BankConnection, account_id: str) -> float | None:
        balances = self._request("GET", f"/accounts/{account_id}/balances/").get("balances") or []
        if not balances:
            return None
        balances.sort(
            key=lambda b: _BALANCE_PREFERENCE.index(b.get("balanceType"))
            if b.get("balanceType") in _BALANCE_PREFERENCE
            else 99
        )
        return float(balances[0]["balanceAmount"]["amount"])

    def transactions(self, conn: BankConnection, account_id: str, date_from: date) -> list[RawTx]:
        data = self._request(
            "GET", f"/accounts/{account_id}/transactions/", params={"date_from": date_from.isoformat()}
        ).get("transactions", {})
        out: list[RawTx] = []
        for status, rows in (("booked", data.get("booked", [])), ("pending", data.get("pending", []))):
            for t in rows:
                d = t.get("bookingDate") or t.get("valueDate")
                if not d:
                    continue
                amt = t.get("transactionAmount") or {}
                value = float(amt.get("amount", 0))
                party = t.get("creditorName") if value < 0 else t.get("debtorName")
                remittance = t.get("remittanceInformationUnstructured") or " ".join(
                    t.get("remittanceInformationUnstructuredArray") or []
                )
                out.append(
                    RawTx(
                        date=date.fromisoformat(d[:10]),
                        value_date=date.fromisoformat(t["valueDate"][:10]) if t.get("valueDate") else None,
                        amount=value,
                        label=remittance or party or t.get("additionalInformation") or "",
                        counterparty=party,
                        external_id=None
                        if status == "pending"
                        else (t.get("transactionId") or t.get("internalTransactionId")),
                        currency=amt.get("currency", "EUR"),
                        status=status,
                    )
                )
        return out
