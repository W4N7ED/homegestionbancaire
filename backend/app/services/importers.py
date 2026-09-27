"""Lecture des relevés : CSV Revolut, CSV générique (banques françaises) et OFX."""
from __future__ import annotations

import csv
import io
import re
from collections import Counter
from datetime import date, datetime

from .categorize import normalize
from .ingest import RawTx


class ImportError_(ValueError):
    pass


def decode(content: bytes) -> str:
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return content.decode(enc)
        except UnicodeDecodeError:
            continue
    raise ImportError_("Encodage du fichier non reconnu")


def parse_amount(value: str | None) -> float | None:
    if value is None:
        return None
    s = str(value).strip().replace(" ", "").replace(" ", "").replace(" ", "")
    s = re.sub(r"[€$£A-Za-z]", "", s)
    if not s or s in ("-", "+"):
        return None
    neg = s.startswith("(") and s.endswith(")")
    s = s.strip("()")
    if "," in s and "." in s:
        # le dernier séparateur est le séparateur décimal
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        v = float(s)
    except ValueError:
        return None
    return -v if neg else v


_DATE_FORMATS = ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%d/%m/%y", "%Y/%m/%d", "%Y%m%d")


def parse_date(value: str | None) -> date | None:
    if not value:
        return None
    s = value.strip()
    s = s.split("T")[0].split(" ")[0]
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _find(headers: list[str], *candidates: str) -> int | None:
    norm = [normalize(h) for h in headers]
    for cand in candidates:
        for i, h in enumerate(norm):
            if h == cand:
                return i
    for cand in candidates:
        for i, h in enumerate(norm):
            if cand in h:
                return i
    return None


def _reader(text: str) -> list[list[str]]:
    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=";,\t|")
        delim = dialect.delimiter
    except csv.Error:
        delim = ";" if sample.count(";") > sample.count(",") else ","
    return [row for row in csv.reader(io.StringIO(text), delimiter=delim) if any(c.strip() for c in row)]


def is_revolut(headers: list[str]) -> bool:
    n = {normalize(h) for h in headers}
    return ("started date" in n or "date de debut" in n) and ("product" in n or "produit" in n)


def parse_revolut(rows: list[list[str]]) -> tuple[list[RawTx], float | None]:
    h = rows[0]
    i_type = _find(h, "type")
    i_date = _find(h, "completed date", "date de fin", "date d'achevement")
    i_start = _find(h, "started date", "date de debut")
    i_desc = _find(h, "description")
    i_amount = _find(h, "amount", "montant")
    i_fee = _find(h, "fee", "frais")
    i_cur = _find(h, "currency", "devise")
    i_state = _find(h, "state", "etat")
    i_bal = _find(h, "balance", "solde")
    i_prod = _find(h, "product", "produit")
    # un export peut mêler compte courant et coffres/épargne : on garde le produit majoritaire
    products = Counter(r[i_prod] for r in rows[1:] if i_prod is not None and i_prod < len(r))
    main_product = products.most_common(1)[0][0] if products else None
    out: list[RawTx] = []
    last_balance = None
    for row in rows[1:]:
        get = lambda i: row[i] if i is not None and i < len(row) else None  # noqa: E731
        if main_product is not None and get(i_prod) != main_product:
            continue
        state = normalize(get(i_state) or "")
        if state in ("reverted", "declined", "failed", "annule", "refuse", "echoue", "rembourse"):
            continue
        d = parse_date(get(i_date)) or parse_date(get(i_start))
        amount = parse_amount(get(i_amount))
        if d is None or amount is None:
            continue
        fee = parse_amount(get(i_fee)) or 0.0
        pending = state in ("pending", "en attente")
        label = (get(i_desc) or "").strip()
        out.append(
            RawTx(
                date=d,
                amount=amount - abs(fee),
                label=label,
                counterparty=label,
                currency=(get(i_cur) or "EUR").strip()[:3],
                status="pending" if pending else "booked",
                extra={"type": get(i_type), "started": get(i_start)},
            )
        )
        bal = parse_amount(get(i_bal))
        if bal is not None and not pending:
            last_balance = bal
    return out, last_balance


def parse_generic(rows: list[list[str]]) -> list[RawTx]:
    # certaines banques placent des lignes d'en-tête avant le tableau : on cherche la ligne titre
    header_idx = 0
    for idx, row in enumerate(rows[:15]):
        n = " ".join(normalize(c) for c in row)
        if "date" in n and ("montant" in n or "amount" in n or "debit" in n or "credit" in n):
            header_idx = idx
            break
    h = rows[header_idx]
    i_date = _find(h, "date operation", "date de comptabilisation", "date", "booking date")
    i_vdate = _find(h, "date de valeur", "value date")
    i_label = _find(h, "libelle", "label", "description", "detail", "intitule", "memo")
    i_amount = _find(h, "montant", "amount", "valeur")
    i_debit = _find(h, "debit")
    i_credit = _find(h, "credit")
    i_cp = _find(h, "beneficiaire", "tiers", "counterparty", "payee")
    if i_date is None or (i_amount is None and i_debit is None and i_credit is None):
        raise ImportError_("Colonnes « date » et « montant » (ou débit/crédit) introuvables")
    out: list[RawTx] = []
    for row in rows[header_idx + 1 :]:
        get = lambda i: row[i] if i is not None and i < len(row) else None  # noqa: E731
        d = parse_date(get(i_date))
        if d is None:
            continue
        if i_amount is not None and i_amount not in (i_debit, i_credit):
            amount = parse_amount(get(i_amount))
        else:
            deb = parse_amount(get(i_debit)) or 0.0
            cred = parse_amount(get(i_credit)) or 0.0
            amount = cred - abs(deb)
        if amount is None:
            continue
        out.append(
            RawTx(
                date=d,
                value_date=parse_date(get(i_vdate)),
                amount=amount,
                label=(get(i_label) or "").strip(),
                counterparty=(get(i_cp) or None),
            )
        )
    return out


def parse_ofx(text: str) -> tuple[list[RawTx], float | None]:
    out: list[RawTx] = []

    def tag(block: str, name: str) -> str | None:
        m = re.search(rf"<{name}>([^<\r\n]*)", block, re.I)
        return m.group(1).strip() if m else None

    for block in re.findall(r"<STMTTRN>(.*?)(?:</STMTTRN>|(?=<STMTTRN>)|</BANKTRANLIST>)", text, re.S | re.I):
        d = parse_date((tag(block, "DTPOSTED") or "")[:8])
        amount = parse_amount(tag(block, "TRNAMT"))
        if d is None or amount is None:
            continue
        name = tag(block, "NAME") or ""
        memo = tag(block, "MEMO") or ""
        label = f"{name} {memo}".strip() if memo and memo not in name else name
        out.append(RawTx(date=d, amount=amount, label=label, counterparty=name or None, external_id=tag(block, "FITID")))
    bal = None
    m = re.search(r"<LEDGERBAL>.*?<BALAMT>([^<\r\n]+)", text, re.S | re.I)
    if m:
        bal = parse_amount(m.group(1))
    return out, bal


def parse_file(filename: str, content: bytes) -> tuple[str, list[RawTx], float | None]:
    """Retourne (format détecté, transactions, solde final éventuel)."""
    text = decode(content)
    if filename.lower().endswith((".ofx", ".qfx")) or "<OFX>" in text[:2000].upper():
        rows, bal = parse_ofx(text)
        return "ofx", rows, bal
    rows = _reader(text)
    if not rows:
        raise ImportError_("Fichier vide")
    if is_revolut(rows[0]):
        txs, bal = parse_revolut(rows)
        return "revolut", txs, bal
    return "csv", parse_generic(rows), None
