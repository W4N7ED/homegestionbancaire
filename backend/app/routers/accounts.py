from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import MAX_UPLOAD_MB
from ..db import get_db
from ..models import Account, BankConnection, Transaction
from ..schemas import AccountIn, AccountOut
from ..services.importers import ImportError_, parse_file
from ..services.ingest import ingest

router = APIRouter(prefix="/api/accounts", tags=["comptes"])


def _out(db: Session, accounts: list[Account]) -> list[dict]:
    counts = dict(db.execute(select(Transaction.account_id, func.count()).group_by(Transaction.account_id)).all())
    providers = {c.id: c.provider for c in db.scalars(select(BankConnection))}
    res = []
    for a in accounts:
        data = AccountOut.model_validate(a).model_dump()
        data["tx_count"] = counts.get(a.id, 0)
        data["provider"] = providers.get(a.connection_id) if a.connection_id else None
        res.append(data)
    return res


@router.get("")
def list_accounts(db: Session = Depends(get_db)):
    return _out(db, list(db.scalars(select(Account).order_by(Account.archived, Account.type, Account.name))))


@router.post("", status_code=201)
def create_account(payload: AccountIn, db: Session = Depends(get_db)):
    acc = Account(**payload.model_dump(), balance_date=datetime.utcnow())
    db.add(acc)
    db.commit()
    return _out(db, [acc])[0]


@router.put("/{account_id}")
def update_account(account_id: int, payload: AccountIn, db: Session = Depends(get_db)):
    acc = db.get(Account, account_id)
    if not acc:
        raise HTTPException(404, "Compte introuvable")
    data = payload.model_dump()
    if acc.connection_id:
        # le solde d'un compte synchronisé vient de la banque
        data.pop("balance")
        data.pop("iban")
    elif data["balance"] != acc.balance:
        acc.balance_date = datetime.utcnow()
    for k, v in data.items():
        setattr(acc, k, v)
    db.commit()
    return _out(db, [acc])[0]


@router.delete("/{account_id}", status_code=204)
def delete_account(account_id: int, db: Session = Depends(get_db)):
    acc = db.get(Account, account_id)
    if not acc:
        raise HTTPException(404, "Compte introuvable")
    db.delete(acc)
    db.commit()


@router.post("/{account_id}/import")
async def import_statement(account_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Import d'un relevé : CSV Revolut, CSV bancaire générique ou OFX."""
    acc = db.get(Account, account_id)
    if not acc:
        raise HTTPException(404, "Compte introuvable")
    content = await file.read()
    if len(content) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, "Fichier trop volumineux")
    try:
        fmt, rows, balance = parse_file(file.filename or "", content)
    except ImportError_ as exc:
        raise HTTPException(400, str(exc))
    if not rows:
        raise HTTPException(400, "Aucune opération reconnue dans ce fichier")
    stats = ingest(db, acc, rows, source="import")
    if balance is not None and not acc.connection_id:
        acc.balance = round(balance, 2)
        acc.balance_date = datetime.utcnow()
    db.commit()
    return {"format": fmt, **stats, "balance": balance}
