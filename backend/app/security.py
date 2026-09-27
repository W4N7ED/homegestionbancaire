"""Authentification (cookie de session JWT) et chiffrement des secrets."""
from __future__ import annotations

import base64
import hashlib
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from cryptography.fernet import Fernet, InvalidToken
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from .config import SECRET_KEY, SESSION_HOURS
from .db import get_db
from .models import Setting, User

COOKIE_NAME = "pactole_session"
_hasher = PasswordHasher()
_fernet = Fernet(base64.urlsafe_b64encode(hashlib.sha256(("fernet:" + SECRET_KEY).encode()).digest()))
_jwt_key = hashlib.sha256(("jwt:" + SECRET_KEY).encode()).hexdigest()


# --- Mots de passe -----------------------------------------------------------------

def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except VerifyMismatchError:
        return False
    except Exception:
        return False


# --- Anti brute-force : 8 tentatives / 5 min par IP --------------------------------

_attempts: dict[str, deque[float]] = defaultdict(deque)


def check_rate_limit(ip: str, limit: int = 8, window: int = 300) -> None:
    now = time.monotonic()
    q = _attempts[ip]
    while q and now - q[0] > window:
        q.popleft()
    if len(q) >= limit:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Trop de tentatives, réessayez dans quelques minutes.")
    q.append(now)


def reset_rate_limit(ip: str) -> None:
    _attempts.pop(ip, None)


# --- Session -----------------------------------------------------------------------

def create_session_token(user: User) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": str(user.id), "name": user.username, "iat": now, "exp": now + timedelta(hours=SESSION_HOURS)}
    return jwt.encode(payload, _jwt_key, algorithm="HS256")


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Non authentifié")
    try:
        payload = jwt.decode(token, _jwt_key, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expirée")
    user = db.get(User, int(payload["sub"]))
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Utilisateur inconnu")
    return user


# --- Secrets chiffrés --------------------------------------------------------------

def encrypt(value: str) -> str:
    return _fernet.encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    try:
        return _fernet.decrypt(value.encode()).decode()
    except InvalidToken:
        raise RuntimeError("Impossible de déchiffrer un secret : la clé PACTOLE_SECRET_KEY a-t-elle changé ?")


def get_setting(db: Session, key: str, default: str | None = None) -> str | None:
    row = db.get(Setting, key)
    if row is None:
        return default
    return decrypt(row.value) if row.encrypted else row.value


def set_setting(db: Session, key: str, value: str | None, secret: bool = False) -> None:
    row = db.get(Setting, key)
    if value is None:
        if row:
            db.delete(row)
        return
    stored = encrypt(value) if secret else value
    if row:
        row.value, row.encrypted = stored, secret
    else:
        db.add(Setting(key=key, value=stored, encrypted=secret))
