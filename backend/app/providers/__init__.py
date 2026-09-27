from sqlalchemy.orm import Session

from .base import Provider, ProviderError
from .enablebanking import EnableBanking
from .gocardless import GoCardless

PROVIDERS: dict[str, type[Provider]] = {p.key: p for p in (EnableBanking, GoCardless)}


def get_provider(key: str, db: Session) -> Provider:
    cls = PROVIDERS.get(key)
    if not cls:
        raise ProviderError(f"Fournisseur inconnu : {key}")
    return cls(db)


__all__ = ["PROVIDERS", "Provider", "ProviderError", "get_provider"]
