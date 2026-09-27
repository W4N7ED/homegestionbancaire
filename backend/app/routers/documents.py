"""Coffre-fort de justificatifs (fiches de paie, tickets, contrats…) et dossier fiscal."""
from __future__ import annotations

import csv
import hashlib
import io
import mimetypes
import re
import uuid
import zipfile
from datetime import date

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import MAX_UPLOAD_MB, UPLOAD_DIR
from ..db import get_db
from ..models import Document, FuelReceipt, Payslip, Vehicle
from ..schemas import DocumentOut, DocumentPatch
from ..services.fiscal import year_summary

router = APIRouter(prefix="/api/documents", tags=["documents"])

ALLOWED = {
    "application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif",
    "text/plain", "text/csv", "application/zip",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/msword", "application/vnd.ms-excel", "application/vnd.oasis.opendocument.text",
}
OWNER_TYPES = {"payslip", "fuel", "contract", "loan", "transaction"}


def _safe_name(name: str) -> str:
    name = re.sub(r"[^\w.\- ]", "_", name).strip() or "document"
    return name[:180]


@router.get("")
def list_documents(
    doc_type: str | None = None,
    year: int | None = None,
    owner_type: str | None = None,
    owner_id: int | None = None,
    q: str | None = None,
    db: Session = Depends(get_db),
):
    stmt = select(Document).order_by(Document.created_at.desc())
    if doc_type:
        stmt = stmt.where(Document.doc_type == doc_type)
    if year:
        stmt = stmt.where(Document.year == year)
    if owner_type:
        stmt = stmt.where(Document.owner_type == owner_type)
    if owner_id:
        stmt = stmt.where(Document.owner_id == owner_id)
    if q:
        stmt = stmt.where(Document.title.ilike(f"%{q}%") | Document.filename.ilike(f"%{q}%"))
    return [DocumentOut.model_validate(d).model_dump() for d in db.scalars(stmt)]


@router.post("", status_code=201)
async def upload(
    file: UploadFile = File(...),
    title: str | None = Form(None),
    doc_type: str = Form("autre"),
    year: int | None = Form(None),
    owner_type: str | None = Form(None),
    owner_id: int | None = Form(None),
    notes: str | None = Form(None),
    db: Session = Depends(get_db),
):
    content = await file.read()
    if len(content) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, f"Fichier trop volumineux (max {MAX_UPLOAD_MB} Mo)")
    mime = file.content_type or mimetypes.guess_type(file.filename or "")[0] or "application/octet-stream"
    if mime not in ALLOWED:
        raise HTTPException(415, f"Type de fichier non accepté : {mime}")
    if owner_type and owner_type not in OWNER_TYPES:
        raise HTTPException(400, "Type de rattachement invalide")
    ext = mimetypes.guess_extension(mime) or ""
    stored = f"{uuid.uuid4().hex}{ext}"
    (UPLOAD_DIR / stored).write_bytes(content)
    doc = Document(
        title=title or file.filename or "Document",
        doc_type=doc_type,
        year=year or date.today().year,
        filename=_safe_name(file.filename or stored),
        stored_name=stored,
        mime=mime,
        size=len(content),
        sha256=hashlib.sha256(content).hexdigest(),
        owner_type=owner_type or None,
        owner_id=owner_id if owner_type else None,
        notes=notes,
    )
    db.add(doc)
    db.commit()
    return DocumentOut.model_validate(doc).model_dump()


@router.get("/fiscal/{year}.zip")
def fiscal_export(year: int, db: Session = Depends(get_db)):
    """Dossier fiscal annuel : synthèse CSV + tous les justificatifs de l'année."""
    buf = io.BytesIO()
    summary = year_summary(db, year)
    vehicles = {v.id: v.name for v in db.scalars(select(Vehicle))}
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        s = io.StringIO()
        w = csv.writer(s, delimiter=";")
        w.writerow(["Période", "Employeur", "Brut", "Net imposable", "PAS", "Net versé"])
        for p in db.scalars(select(Payslip).where(Payslip.period >= date(year, 1, 1), Payslip.period <= date(year, 12, 31)).order_by(Payslip.period)):
            w.writerow([p.period.strftime("%m/%Y"), p.employer, p.gross, p.net_taxable, p.income_tax, p.net_paid])
        w.writerow([])
        w.writerow(["Total", "", summary["payslips"]["gross"], summary["payslips"]["net_taxable"], summary["payslips"]["income_tax"], summary["payslips"]["net_paid"]])
        z.writestr(f"{year}/fiches_de_paie.csv", "﻿" + s.getvalue())

        s = io.StringIO()
        w = csv.writer(s, delimiter=";")
        w.writerow(["Date", "Véhicule", "Station", "Ville", "Carburant", "Litres", "Prix/L", "Total", "Km compteur", "Pro"])
        for r in db.scalars(select(FuelReceipt).where(FuelReceipt.date >= date(year, 1, 1), FuelReceipt.date <= date(year, 12, 31)).order_by(FuelReceipt.date)):
            w.writerow([r.date.strftime("%d/%m/%Y"), vehicles.get(r.vehicle_id, ""), r.station, r.city or "", r.fuel_type, r.liters, r.price_per_liter or "", r.total, r.odometer or "", "oui" if r.professional else "non"])
        w.writerow([])
        w.writerow(["Total", "", "", "", "", summary["fuel"]["liters"], "", summary["fuel"]["total"]])
        z.writestr(f"{year}/carburant.csv", "﻿" + s.getvalue())

        for d in db.scalars(select(Document).where(Document.year == year)):
            path = UPLOAD_DIR / d.stored_name
            if path.exists():
                z.write(path, f"{year}/justificatifs/{d.doc_type}/{d.id:05d}_{d.filename}")
    buf.seek(0)
    return StreamingResponse(
        buf, media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="pactole-dossier-fiscal-{year}.zip"'},
    )


@router.get("/{doc_id}/file")
def download(doc_id: int, download: bool = False, db: Session = Depends(get_db)):
    doc = db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "Document introuvable")
    path = UPLOAD_DIR / doc.stored_name
    if not path.exists():
        raise HTTPException(410, "Fichier absent du stockage")
    return FileResponse(
        path, media_type=doc.mime, filename=doc.filename,
        content_disposition_type="attachment" if download else "inline",
    )


@router.patch("/{doc_id}")
def patch_document(doc_id: int, payload: DocumentPatch, db: Session = Depends(get_db)):
    doc = db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "Document introuvable")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(doc, k, v)
    db.commit()
    return DocumentOut.model_validate(doc).model_dump()


@router.delete("/{doc_id}", status_code=204)
def delete_document(doc_id: int, db: Session = Depends(get_db)):
    doc = db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "Document introuvable")
    (UPLOAD_DIR / doc.stored_name).unlink(missing_ok=True)
    db.delete(doc)
    db.commit()
