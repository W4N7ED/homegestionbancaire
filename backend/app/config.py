"""Configuration de Pactole, lue depuis les variables d'environnement."""
from __future__ import annotations

import os
import secrets
from pathlib import Path

DATA_DIR = Path(os.environ.get("PACTOLE_DATA_DIR", "/data"))
UPLOAD_DIR = DATA_DIR / "uploads"
DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

DATABASE_URL = os.environ.get("DATABASE_URL", f"sqlite:///{DATA_DIR / 'pactole.db'}")

# URL publique de l'application (utilisée pour le retour d'autorisation Open Banking).
PUBLIC_URL = os.environ.get("PACTOLE_PUBLIC_URL", "http://localhost:8080").rstrip("/")

# Heure (0-23, fuseau TZ du conteneur) de la synchronisation bancaire automatique.
SYNC_HOUR = int(os.environ.get("PACTOLE_SYNC_HOUR", "6"))

# Durée de validité de la session web, en heures.
SESSION_HOURS = int(os.environ.get("PACTOLE_SESSION_HOURS", "12"))

# Cookie "Secure" : à activer derrière un reverse-proxy HTTPS.
COOKIE_SECURE = os.environ.get("PACTOLE_COOKIE_SECURE", "false").lower() in ("1", "true", "yes")

# Taille maximale d'un justificatif téléversé (Mo).
MAX_UPLOAD_MB = int(os.environ.get("PACTOLE_MAX_UPLOAD_MB", "20"))

STATIC_DIR = Path(os.environ.get("PACTOLE_STATIC_DIR", Path(__file__).resolve().parent.parent / "static"))


def _load_secret() -> str:
    """Clé maîtresse : variable d'environnement, sinon générée et persistée dans /data."""
    env = os.environ.get("PACTOLE_SECRET_KEY")
    if env:
        return env
    path = DATA_DIR / "secret.key"
    if path.exists():
        return path.read_text().strip()
    key = secrets.token_urlsafe(48)
    path.write_text(key)
    path.chmod(0o600)
    return key


SECRET_KEY = _load_secret()
