from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import COOKIE_SECURE, SESSION_HOURS
from ..db import get_db
from ..models import User
from ..schemas import Credentials, PasswordChange
from ..security import (
    COOKIE_NAME,
    check_rate_limit,
    create_session_token,
    current_user,
    hash_password,
    reset_rate_limit,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _set_cookie(response: Response, user: User) -> None:
    response.set_cookie(
        COOKIE_NAME,
        create_session_token(user),
        max_age=SESSION_HOURS * 3600,
        httponly=True,
        samesite="lax",
        secure=COOKIE_SECURE,
        path="/",
    )


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@router.get("/status")
def status(request: Request, db: Session = Depends(get_db)):
    setup_required = db.scalar(select(User.id).limit(1)) is None
    try:
        user = current_user(request, db)
        return {"setup_required": setup_required, "authenticated": True, "username": user.username}
    except HTTPException:
        return {"setup_required": setup_required, "authenticated": False, "username": None}


@router.post("/setup")
def setup(payload: Credentials, response: Response, db: Session = Depends(get_db)):
    """Création du compte administrateur au premier lancement uniquement."""
    if db.scalar(select(User.id).limit(1)) is not None:
        raise HTTPException(409, "L'application est déjà initialisée")
    user = User(username=payload.username, password_hash=hash_password(payload.password))
    db.add(user)
    db.commit()
    _set_cookie(response, user)
    return {"username": user.username}


@router.post("/login")
def login(payload: Credentials, request: Request, response: Response, db: Session = Depends(get_db)):
    ip = _client_ip(request)
    check_rate_limit(ip)
    user = db.scalar(select(User).where(User.username == payload.username))
    if not user or not verify_password(user.password_hash, payload.password):
        raise HTTPException(401, "Identifiants invalides")
    reset_rate_limit(ip)
    _set_cookie(response, user)
    return {"username": user.username}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


@router.post("/password")
def change_password(payload: PasswordChange, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not verify_password(user.password_hash, payload.current_password):
        raise HTTPException(400, "Mot de passe actuel incorrect")
    user.password_hash = hash_password(payload.new_password)
    db.merge(user)
    db.commit()
    return {"ok": True}
