"""Connexions Open Banking : configuration, consentement, synchronisation."""
from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import PUBLIC_URL
from ..db import get_db
from ..models import Account, BankConnection
from ..providers import PROVIDERS, ProviderError, get_provider
from ..security import current_user, get_setting, set_setting
from ..services.sync import sync_all, sync_connection

router = APIRouter(prefix="/api/banking", tags=["banques"])
CALLBACK_PATH = "/api/banking/callback"


class ConnectIn(BaseModel):
    provider: str
    institution_id: str
    institution_name: str
    country: str = "FR"


def _conn_out(db: Session, c: BankConnection) -> dict:
    return {
        "id": c.id,
        "provider": c.provider,
        "institution_id": c.institution_id,
        "institution_name": c.institution_name,
        "country": c.country,
        "status": c.status,
        "valid_until": c.valid_until,
        "last_sync": c.last_sync,
        "last_error": c.last_error,
        "created_at": c.created_at,
        "accounts": [
            {"id": a.id, "name": a.name, "iban": a.iban, "balance": a.balance}
            for a in db.scalars(select(Account).where(Account.connection_id == c.id))
        ],
    }


@router.get("/providers", dependencies=[Depends(current_user)])
def providers(db: Session = Depends(get_db)):
    out = []
    for key, cls in PROVIDERS.items():
        p = cls(db)
        out.append(
            {
                "key": key,
                "label": cls.label,
                "configured": p.configured(),
                "fields": [
                    {**f, "is_set": bool(get_setting(db, f["key"])),
                     "value": None if f.get("secret") else get_setting(db, f["key"])}
                    for f in cls.settings_fields
                ],
            }
        )
    return {"providers": out, "redirect_url": PUBLIC_URL + CALLBACK_PATH}


@router.put("/providers/{key}", dependencies=[Depends(current_user)])
def save_provider_settings(key: str, values: dict[str, str | None], db: Session = Depends(get_db)):
    cls = PROVIDERS.get(key)
    if not cls:
        raise HTTPException(404, "Fournisseur inconnu")
    fields = {f["key"]: f for f in cls.settings_fields}
    for k, v in values.items():
        if k not in fields:
            continue
        if v is None or v == "":
            continue  # champ laissé vide : on conserve la valeur existante
        set_setting(db, k, v.strip() + ("\n" if fields[k].get("multiline") else ""), secret=fields[k].get("secret", False))
    db.commit()
    return {"ok": True, "configured": cls(db).configured()}


@router.get("/institutions", dependencies=[Depends(current_user)])
def institutions(provider: str, country: str = "FR", q: str | None = None, db: Session = Depends(get_db)):
    try:
        items = get_provider(provider, db).institutions(country)
    except ProviderError as exc:
        raise HTTPException(400, str(exc))
    if q:
        items = [i for i in items if q.lower() in i["name"].lower()]
    return items


@router.post("/connect", dependencies=[Depends(current_user)])
def connect(payload: ConnectIn, db: Session = Depends(get_db)):
    state = secrets.token_urlsafe(24)
    try:
        start = get_provider(payload.provider, db).start(
            payload.institution_id, payload.country, PUBLIC_URL + CALLBACK_PATH, state
        )
    except ProviderError as exc:
        raise HTTPException(400, str(exc))
    conn = BankConnection(
        provider=payload.provider,
        institution_id=payload.institution_id,
        institution_name=payload.institution_name,
        country=payload.country,
        status="pending",
        state=state,
        external_ref=start.external_ref,
        valid_until=start.valid_until,
    )
    db.add(conn)
    db.commit()
    return {"url": start.url, "connection_id": conn.id}


@router.get("/callback")
def callback(request: Request, db: Session = Depends(get_db)):
    """Retour de la banque après consentement. Le paramètre `state` (ou `ref`) authentifie l'appel."""
    params = dict(request.query_params)
    state = params.get("state") or params.get("ref")
    conn = db.scalar(select(BankConnection).where(BankConnection.state == state)) if state else None
    if not conn or conn.status != "pending":
        return RedirectResponse("/banques?error=" + "Retour+bancaire+inconnu+ou+déjà+traité")
    try:
        remote_accounts = get_provider(conn.provider, db).complete(conn, params)
    except ProviderError as exc:
        conn.status = "error"
        conn.last_error = str(exc)
        db.commit()
        return RedirectResponse(f"/banques?error={conn.institution_name}+:+autorisation+échouée")
    conn.status = "linked"
    conn.state = secrets.token_urlsafe(24)  # usage unique
    for ra in remote_accounts:
        acc = db.scalar(
            select(Account).where(Account.external_id == ra.external_id)
        ) or (ra.iban and db.scalar(select(Account).where(Account.iban == ra.iban, Account.connection_id.is_(None))))
        if acc:
            acc.connection_id, acc.external_id = conn.id, ra.external_id
        else:
            db.add(
                Account(
                    connection_id=conn.id,
                    external_id=ra.external_id,
                    name=ra.name if ra.name != conn.institution_name else f"{conn.institution_name} {ra.currency}",
                    bank_name=conn.institution_name,
                    iban=ra.iban,
                    currency=ra.currency,
                    type="courant",
                )
            )
    db.commit()
    sync_connection(db, conn)
    return RedirectResponse(f"/banques?linked={conn.id}")


@router.get("/connections", dependencies=[Depends(current_user)])
def list_connections(db: Session = Depends(get_db)):
    return [_conn_out(db, c) for c in db.scalars(select(BankConnection).order_by(BankConnection.created_at.desc()))]


@router.post("/connections/{conn_id}/sync", dependencies=[Depends(current_user)])
def sync_one(conn_id: int, db: Session = Depends(get_db)):
    conn = db.get(BankConnection, conn_id)
    if not conn:
        raise HTTPException(404, "Connexion introuvable")
    return sync_connection(db, conn)


@router.post("/sync", dependencies=[Depends(current_user)])
def sync_everything():
    sync_all()
    return {"ok": True}


@router.delete("/connections/{conn_id}", status_code=204, dependencies=[Depends(current_user)])
def delete_connection(conn_id: int, db: Session = Depends(get_db)):
    """Supprime la connexion ; les comptes et leurs opérations sont conservés (compte manuel)."""
    conn = db.get(BankConnection, conn_id)
    if not conn:
        raise HTTPException(404, "Connexion introuvable")
    for acc in db.scalars(select(Account).where(Account.connection_id == conn_id)):
        acc.connection_id = None
    db.delete(conn)
    db.commit()
