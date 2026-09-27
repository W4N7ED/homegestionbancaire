"""Fabrique de routes CRUD génériques."""
from __future__ import annotations

from collections.abc import Callable

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .db import get_db
from .models import Document


def doc_counts(db: Session, owner_type: str) -> dict[int, int]:
    rows = db.execute(
        select(Document.owner_id, func.count()).where(Document.owner_type == owner_type).group_by(Document.owner_id)
    )
    return {oid: n for oid, n in rows if oid is not None}


def crud_router(
    model,
    schema_in: type[BaseModel],
    schema_out: type[BaseModel],
    prefix: str,
    order_by=None,
    enrich: Callable[[Session, list], list[dict]] | None = None,
    owner_type: str | None = None,
) -> APIRouter:
    router = APIRouter(prefix=prefix)

    def out(db: Session, objs: list) -> list[dict]:
        extra = enrich(db, objs) if enrich else [{} for _ in objs]
        docs = doc_counts(db, owner_type) if owner_type else {}
        res = []
        for obj, ext in zip(objs, extra):
            data = schema_out.model_validate(obj).model_dump()
            data.update(ext)
            if owner_type:
                data["documents"] = docs.get(obj.id, 0)
            res.append(schema_out.model_validate(data).model_dump())
        return res

    def get_or_404(db: Session, obj_id: int):
        obj = db.get(model, obj_id)
        if not obj:
            raise HTTPException(404, "Élément introuvable")
        return obj

    @router.get("")
    def list_items(db: Session = Depends(get_db)):
        q = select(model)
        if order_by is not None:
            q = q.order_by(*order_by) if isinstance(order_by, (list, tuple)) else q.order_by(order_by)
        return out(db, list(db.scalars(q)))

    @router.get("/{obj_id}")
    def get_item(obj_id: int, db: Session = Depends(get_db)):
        return out(db, [get_or_404(db, obj_id)])[0]

    @router.post("", status_code=201)
    def create_item(payload: schema_in, db: Session = Depends(get_db)):  # type: ignore[valid-type]
        obj = model(**payload.model_dump())
        db.add(obj)
        db.commit()
        db.refresh(obj)
        return out(db, [obj])[0]

    @router.put("/{obj_id}")
    def update_item(obj_id: int, payload: schema_in, db: Session = Depends(get_db)):  # type: ignore[valid-type]
        obj = get_or_404(db, obj_id)
        for k, v in payload.model_dump().items():
            setattr(obj, k, v)
        db.commit()
        db.refresh(obj)
        return out(db, [obj])[0]

    @router.delete("/{obj_id}", status_code=204)
    def delete_item(obj_id: int, db: Session = Depends(get_db)):
        obj = get_or_404(db, obj_id)
        if owner_type:
            # les justificatifs restent dans le coffre, détachés de l'élément supprimé
            db.query(Document).filter(Document.owner_type == owner_type, Document.owner_id == obj_id).update(
                {Document.owner_type: None, Document.owner_id: None}
            )
        db.delete(obj)
        db.commit()

    return router
