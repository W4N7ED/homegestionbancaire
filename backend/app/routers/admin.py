from __future__ import annotations

import shutil
import sqlite3
import tempfile
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.background import BackgroundTask

from .. import __version__
from ..config import DATA_DIR, DATABASE_URL, PUBLIC_URL, SYNC_HOUR, UPLOAD_DIR
from ..db import get_db
from ..models import Account
from ..services.demo import seed_demo

router = APIRouter(prefix="/api/admin", tags=["administration"])


@router.get("/info")
def info():
    usage = shutil.disk_usage(DATA_DIR)
    uploads = sum(f.stat().st_size for f in UPLOAD_DIR.glob("*") if f.is_file())
    return {
        "version": __version__,
        "database": DATABASE_URL.split(":", 1)[0],
        "public_url": PUBLIC_URL,
        "sync_hour": SYNC_HOUR,
        "uploads_bytes": uploads,
        "disk_free_bytes": usage.free,
    }


@router.post("/demo")
def load_demo(db: Session = Depends(get_db)):
    if db.scalar(select(Account.id).limit(1)) is not None:
        raise HTTPException(409, "Des comptes existent déjà : la démo n'est chargeable que sur une base vide.")
    seed_demo(db)
    return {"ok": True}


@router.get("/backup")
def backup():
    """Sauvegarde à chaud de la base SQLite (API de backup SQLite, cohérente même en écriture)."""
    if not DATABASE_URL.startswith("sqlite"):
        raise HTTPException(400, "Sauvegarde intégrée disponible pour SQLite uniquement (utilisez pg_dump).")
    src_path = DATABASE_URL.split("///", 1)[1]
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    src = sqlite3.connect(src_path)
    dst = sqlite3.connect(tmp.name)
    with dst:
        src.backup(dst)
    src.close()
    dst.close()
    name = f"pactole-{datetime.now():%Y%m%d-%H%M}.db"
    return FileResponse(tmp.name, filename=name, media_type="application/octet-stream",
                        background=BackgroundTask(lambda: __import__("os").unlink(tmp.name)))
