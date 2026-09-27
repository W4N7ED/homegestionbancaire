"""Point d'entrée FastAPI de Pactole."""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import Depends, FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from . import __version__
from .config import STATIC_DIR, SYNC_HOUR
from .db import Base, SessionLocal, engine
from .models import Account
from .routers import accounts, admin, auth, banking, dashboard, documents, planning, records, simulate, transactions
from .security import current_user
from .services.categorize import seed_categories
from .services.sync import sync_all

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("pactole")
scheduler = BackgroundScheduler()


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        seed_categories(db)
        if os.environ.get("PACTOLE_DEMO", "").lower() in ("1", "true", "yes") and db.scalar(select(Account.id).limit(1)) is None:
            from .services.demo import seed_demo

            seed_demo(db)
            log.info("Données de démonstration chargées")
    if os.environ.get("PACTOLE_DISABLE_SCHEDULER", "").lower() not in ("1", "true", "yes"):
        scheduler.add_job(sync_all, "cron", hour=SYNC_HOUR, minute=7, id="bank-sync", replace_existing=True)
        scheduler.start()
        log.info("Synchronisation bancaire planifiée chaque jour à %02d:07", SYNC_HOUR)
    yield
    if scheduler.running:
        scheduler.shutdown(wait=False)


app = FastAPI(title="Pactole", version=__version__, lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json")

protected = [Depends(current_user)]
app.include_router(auth.router)
app.include_router(banking.router)  # gère lui-même l'authentification (callback public)
for r in (accounts.router, transactions.router, simulate.router, documents.router, dashboard.router, admin.router, *planning.routers, *records.routers):
    app.include_router(r, dependencies=protected)


@app.exception_handler(IntegrityError)
async def integrity_error(_: Request, exc: IntegrityError):
    return JSONResponse({"detail": "Cet élément existe déjà ou référence un élément inexistant."}, status_code=409)


@app.get("/api/health", include_in_schema=False)
def health():
    return {"status": "ok", "version": __version__}


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    return response


# --- Frontend (SPA) -------------------------------------------------------------------
if (STATIC_DIR / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        candidate = (STATIC_DIR / path).resolve()
        if path and candidate.is_file() and STATIC_DIR.resolve() in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-cache"})
