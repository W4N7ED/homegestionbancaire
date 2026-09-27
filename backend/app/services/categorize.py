"""Catégorisation automatique des transactions et jeu de catégories par défaut."""
from __future__ import annotations

import re
import unicodedata

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Category, CategoryRule, Transaction

# (nom, type, icône lucide, couleur, [motifs de libellé])
DEFAULT_CATEGORIES: list[tuple[str, str, str, str, list[str]]] = [
    ("Salaire", "income", "briefcase", "#008300", ["salaire", "virement salaire", "paie "]),
    ("Aides & allocations", "income", "hand-heart", "#1baf7a", ["caf ", "pole emploi", "france travail", "cpam", "ameli", "mutuelle rembt"]),
    ("Autres revenus", "income", "coins", "#199e70", ["remboursement", "interets", "dividende"]),
    ("Logement", "expense", "home", "#2a78d6", ["loyer", "syndic", "foncia", "nexity", "taxe fonciere"]),
    ("Énergie", "expense", "zap", "#eda100", ["edf", "engie", "totalenergies electricite", "ekwateur", "gaz de france", "veolia", "suez eau"]),
    ("Télécom & Internet", "expense", "wifi", "#4a3aa7", ["orange", "sfr", "bouygues", "free mobile", "free telecom", "sosh", "red by sfr"]),
    ("Carburant", "expense", "fuel", "#e34948", ["totalenergies", " total ", "esso", "shell", " bp ", "avia", "station", "carburant", "carbu"]),
    ("Courses", "expense", "shopping-cart", "#eb6834", ["carrefour", "leclerc", "auchan", "intermarche", "lidl", "aldi", "super u", "hyper u", "monoprix", "franprix", "casino", "picard", "netto", "grand frais", "biocoop"]),
    ("Restaurants & sorties", "expense", "utensils", "#e87ba4", ["restaurant", "mcdonald", "burger king", "kfc", "deliveroo", "uber eats", "just eat", "starbucks", "boulangerie", "bar ", "bistrot", "brasserie", "pizzeria", "sushi"]),
    ("Transports", "expense", "train-front", "#3987e5", ["sncf", "ratp", "navigo", "uber", "bolt", "blablacar", "peage", "vinci autoroute", "sanef", "aprr", "parking"]),
    ("Assurances", "expense", "shield", "#256abf", ["assurance", "maif", "macif", "matmut", "axa", "allianz", "groupama", "gmf", "mma", "direct assurance"]),
    ("Santé", "expense", "heart-pulse", "#d55181", ["pharmacie", "docteur", "medecin", "dentiste", "doctolib", "hopital", "laboratoire", "opticien", "mutuelle"]),
    ("Abonnements", "expense", "repeat", "#9085e9", ["netflix", "spotify", "disney", "canal+", "amazon prime", "deezer", "apple.com", "google storage", "youtube premium", "icloud", "chatgpt", "claude.ai", "anthropic"]),
    ("Shopping", "expense", "shopping-bag", "#d95926", ["amazon", "fnac", "darty", "cdiscount", "zalando", "decathlon", "ikea", "leroy merlin", "castorama", "action "]),
    ("Loisirs & voyages", "expense", "plane", "#c98500", ["airbnb", "booking", "air france", "easyjet", "ryanair", "cinema", "ugc", "pathe", "steam", "playstation", "basic fit", "fitness", "fnac spectacles"]),
    ("Impôts & taxes", "expense", "landmark", "#52514e", ["dgfip", "impot", "finances publiques", "tresor public", "urssaf", "amende"]),
    ("Crédits", "expense", "banknote", "#104281", ["pret ", "echeance pret", "credit immo", "cofidis", "cetelem", "sofinco", "franfinance", "oney"]),
    ("Banque & frais", "expense", "landmark", "#898781", ["frais", "cotisation carte", "commission", "agios", "revolut premium", "revolut metal", "revolut plus"]),
    ("Enfants & éducation", "expense", "graduation-cap", "#1c5cab", ["creche", "cantine", "ecole", "nounou", "pajemploi"]),
    ("Retraits", "expense", "wallet", "#898781", ["retrait", "dab ", "cash withdrawal", "atm"]),
    ("Épargne", "transfer", "piggy-bank", "#1baf7a", ["livret", "epargne", "savings", "vault", "coffre"]),
    ("Virements internes", "transfer", "arrow-left-right", "#898781", ["virement interne", "top-up", "topup", "rechargement", "transfer to", "transfer from"]),
    ("Divers", "expense", "tag", "#898781", []),
]


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", text.lower()).strip()


def seed_categories(db: Session) -> None:
    if db.scalar(select(Category.id).limit(1)) is not None:
        return
    for name, kind, icon, color, patterns in DEFAULT_CATEGORIES:
        cat = Category(name=name, kind=kind, icon=icon, color=color)
        db.add(cat)
        db.flush()
        for p in patterns:
            db.add(CategoryRule(pattern=p, category_id=cat.id, priority=100))
    db.commit()


class Categorizer:
    def __init__(self, db: Session):
        rules = db.scalars(select(CategoryRule).order_by(CategoryRule.priority, CategoryRule.id)).all()
        self.transfer_ids = {c.id for c in db.scalars(select(Category).where(Category.kind == "transfer"))}
        self.rules: list[tuple[re.Pattern | str, int]] = []
        for r in rules:
            if r.is_regex:
                try:
                    self.rules.append((re.compile(r.pattern, re.I), r.category_id))
                except re.error:
                    continue
            else:
                # un espace en début/fin de motif sert de délimiteur de mot : on le conserve
                lead = " " if r.pattern.startswith(" ") else ""
                trail = " " if r.pattern.endswith(" ") else ""
                self.rules.append((lead + normalize(r.pattern) + trail, r.category_id))

    def match(self, label: str, counterparty: str | None = None) -> int | None:
        text = " " + normalize(f"{label} {counterparty or ''}") + " "
        for pattern, cat_id in self.rules:
            if isinstance(pattern, str):
                if pattern and pattern in text:
                    return cat_id
            elif pattern.search(text):
                return cat_id
        return None

    def apply(self, tx: Transaction, force: bool = False) -> None:
        if tx.category_id and not force:
            return
        cat = self.match(tx.label, tx.counterparty)
        if cat:
            tx.category_id = cat
            tx.is_transfer = cat in self.transfer_ids


def pattern_matches(pattern: str | None, label: str, counterparty: str | None = None) -> bool:
    """Tous les mots du motif (normalisé) sont présents dans le libellé."""
    if not pattern:
        return False
    text = normalize(f"{label} {counterparty or ''}")
    tokens = normalize(pattern).split()
    return bool(tokens) and all(t in text for t in tokens)
