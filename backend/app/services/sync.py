"""Synchronisation des comptes reliés via Open Banking."""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import SessionLocal
from ..models import Account, BankConnection, Transaction
from ..providers import ProviderError, get_provider
from .ingest import ingest

log = logging.getLogger("pactole.sync")

FIRST_SYNC_DAYS = 730  # la banque renvoie ce qu'elle peut (souvent 90 j à 2 ans)


def sync_connection(db: Session, conn: BankConnection) -> dict:
    if conn.status not in ("linked", "error"):
        return {"skipped": True, "reason": conn.status}
    if conn.valid_until and conn.valid_until < datetime.utcnow():
        conn.status = "expired"
        conn.last_error = "Consentement DSP2 expiré : renouvelez la connexion."
        db.commit()
        return {"skipped": True, "reason": "expired"}
    provider = get_provider(conn.provider, db)
    result = {"accounts": 0, "inserted": 0}
    try:
        for account in db.scalars(select(Account).where(Account.connection_id == conn.id, Account.archived.is_(False))):
            last = db.scalar(
                select(func.max(Transaction.date)).where(
                    Transaction.account_id == account.id, Transaction.source == "bank"
                )
            )
            date_from = (last - timedelta(days=10)) if last else date.today() - timedelta(days=FIRST_SYNC_DAYS)
            txs = provider.transactions(conn, account.external_id, date_from)
            # les opérations en attente sont remplacées à chaque synchro
            db.query(Transaction).filter(
                Transaction.account_id == account.id, Transaction.status == "pending", Transaction.source == "bank"
            ).delete()
            stats = ingest(db, account, txs, source="bank")
            bal = provider.balance(conn, account.external_id)
            if bal is not None:
                account.balance = round(bal, 2)
                account.balance_date = datetime.utcnow()
            result["accounts"] += 1
            result["inserted"] += stats["inserted"]
        conn.status = "linked"
        conn.last_error = None
        conn.last_sync = datetime.utcnow()
        db.commit()
    except ProviderError as exc:
        db.rollback()
        conn.status = "error"
        conn.last_error = str(exc)[:1000]
        db.commit()
        log.warning("Synchro %s (%s) en échec : %s", conn.id, conn.institution_name, exc)
        result["error"] = str(exc)
    return result


def sync_all() -> None:
    db = SessionLocal()
    try:
        for conn in db.scalars(select(BankConnection).where(BankConnection.status.in_(("linked", "error")))).all():
            res = sync_connection(db, conn)
            log.info("Synchro %s : %s", conn.institution_name, res)
    finally:
        db.close()
