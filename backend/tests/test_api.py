import os
import tempfile
from datetime import date

os.environ["PACTOLE_DATA_DIR"] = tempfile.mkdtemp(prefix="pactole-test-")
os.environ["PACTOLE_DISABLE_SCHEDULER"] = "1"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.services.importers import parse_amount, parse_file  # noqa: E402
from app.services.loans import compute_payment  # noqa: E402
from app.services.schedule import occurrences  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        r = c.post("/api/auth/setup", json={"username": "admin", "password": "motdepasse-solide"})
        assert r.status_code == 200, r.text
        yield c


def test_auth_required():
    with TestClient(app) as anon:
        assert anon.get("/api/dashboard").status_code == 401


def test_setup_only_once(client):
    assert client.post("/api/auth/setup", json={"username": "xx", "password": "12345678"}).status_code == 409


def test_demo_and_dashboard(client):
    assert client.post("/api/admin/demo").status_code == 200
    d = client.get("/api/dashboard").json()
    assert d["balances"]["liquid"] > 0
    rav = d["reste_a_vivre"]
    assert rav["income_monthly"] == 2950
    assert rav["charges_monthly"] > 1000
    assert 0 < rav["debt_ratio"] < 0.35
    assert len(d["monthly"]) == 12
    assert len(d["forecast"]["series"]) == 61
    assert d["upcoming"]
    assert any(a["title"].startswith("Résiliation Box Internet") for a in d["alerts"])
    assert len(d["loans"]) == 2


def test_transactions_and_rules(client):
    res = client.get("/api/transactions", params={"q": "carrefour"}).json()
    assert res["total"] > 0 and res["sum_out"] < 0
    acc = client.get("/api/accounts").json()[0]
    tx = client.post("/api/transactions", json={"account_id": acc["id"], "date": date.today().isoformat(), "amount": -12.5, "label": "MAGASIN INCONNU XYZ"}).json()
    assert tx["category_id"] is None
    cat = next(c for c in client.get("/api/categories").json() if c["name"] == "Shopping")
    patched = client.patch(f"/api/transactions/{tx['id']}", json={"category_id": cat["id"], "create_rule": True}).json()
    assert patched["category_id"] == cat["id"]
    assert any(r["pattern"] == "magasin inconnu xyz" for r in client.get("/api/categories/rules").json())
    assert client.get("/api/transactions/export.csv").status_code == 200


def test_revolut_csv_import(client):
    acc = client.post("/api/accounts", json={"name": "Revolut test", "type": "courant"}).json()
    csv_data = (
        "Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance\n"
        "CARD_PAYMENT,Current,2026-01-03 10:00:00,2026-01-04 09:00:00,Netflix,-13.49,0.00,EUR,COMPLETED,986.51\n"
        "TOPUP,Current,2026-01-05 10:00:00,2026-01-05 10:00:01,Top-Up by *1234,500.00,0.00,EUR,COMPLETED,1486.51\n"
        "CARD_PAYMENT,Current,2026-01-06 10:00:00,,Lidl,-20.00,0.00,EUR,REVERTED,\n"
        "TRANSFER,Savings,2026-01-06 10:00:00,2026-01-06 10:00:00,To pocket,100.00,0.00,EUR,COMPLETED,100\n"
    )
    r = client.post(f"/api/accounts/{acc['id']}/import", files={"file": ("revolut.csv", csv_data, "text/csv")}).json()
    assert r["format"] == "revolut" and r["inserted"] == 2 and r["balance"] == 1486.51
    again = client.post(f"/api/accounts/{acc['id']}/import", files={"file": ("revolut.csv", csv_data, "text/csv")}).json()
    assert again["inserted"] == 0


def test_generic_csv_parser():
    content = "Date;Libellé;Débit;Crédit\n03/02/2026;PRLV EDF;78,00;\n05/02/2026;VIR SALAIRE;;2 480,00\n".encode("cp1252")
    fmt, rows, _ = parse_file("releve.csv", content)
    assert fmt == "csv" and [r.amount for r in rows] == [-78.0, 2480.0]
    assert parse_amount("1.234,56 €") == 1234.56 and parse_amount("(12.00)") == -12.0


def test_ofx_parser():
    ofx = b"<OFX><BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260110<TRNAMT>-42.10<FITID>A1<NAME>CARREFOUR</STMTTRN></BANKTRANLIST><LEDGERBAL><BALAMT>1000.00</LEDGERBAL></OFX>"
    fmt, rows, bal = parse_file("x.ofx", ofx)
    assert fmt == "ofx" and rows[0].external_id == "A1" and bal == 1000.0


def test_detect_and_crud(client):
    assert isinstance(client.get("/api/recurring/detect").json(), list)
    loans = client.get("/api/loans").json()
    sched = client.get(f"/api/loans/{loans[0]['id']}/schedule").json()
    assert len(sched["rows"]) == loans[0]["duration_months"]
    assert sched["rows"][-1]["remaining"] == 0
    fuel = client.get("/api/fuel").json()
    assert any(f["consumption"] for f in fuel)
    assert client.get("/api/fuel/stats").json()["count"] > 0
    assert client.get("/api/payslips/summary").json()["years"]


def test_documents_and_fiscal(client):
    year = date.today().year
    slip = client.get("/api/payslips").json()[0]
    r = client.post("/api/documents", data={"doc_type": "fiche_paie", "owner_type": "payslip", "owner_id": str(slip["id"]), "year": str(year)},
                    files={"file": ("paie.pdf", b"%PDF-1.4 test", "application/pdf")})
    assert r.status_code == 201, r.text
    assert client.get("/api/payslips").json()[0]["documents"] == 1
    assert client.post("/api/documents", files={"file": ("x.exe", b"MZ", "application/x-msdownload")}).status_code == 415
    fiscal = client.get(f"/api/fiscal/{year}", params={"km_pro": 8000}).json()
    assert fiscal["km_estimate"]["amount"] == round(8000 * 0.357 + 1395, 2)
    z = client.get(f"/api/documents/fiscal/{year}.zip")
    assert z.status_code == 200 and z.content[:2] == b"PK"
    assert client.get("/api/admin/backup").status_code == 200


def test_schedule_math():
    assert occurrences(date(2026, 1, 31), "monthly", date(2026, 2, 1), date(2026, 4, 30)) == [date(2026, 2, 28), date(2026, 3, 31), date(2026, 4, 30)]
    assert occurrences(date(2026, 1, 1), "weekly", date(2026, 1, 10), date(2026, 1, 20)) == [date(2026, 1, 15)]
    assert round(compute_payment(15000, 4.9, 60), 2) == 282.38


def test_enablebanking_jwt(client):
    import jwt
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    from app.db import SessionLocal
    from app.providers.enablebanking import EnableBanking

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
    r = client.put("/api/banking/providers/enablebanking", json={"enablebanking_app_id": "app-123", "enablebanking_private_key": pem})
    assert r.json()["configured"] is True
    providers = client.get("/api/banking/providers").json()["providers"]
    eb = next(p for p in providers if p["key"] == "enablebanking")
    assert all(f["value"] is None for f in eb["fields"] if f["secret"])  # le secret ne ressort jamais
    with SessionLocal() as db:
        token = EnableBanking(db)._headers()["Authorization"].split()[1]
    assert jwt.get_unverified_header(token)["kid"] == "app-123"
    claims = jwt.decode(token, key.public_key(), algorithms=["RS256"], audience="api.enablebanking.com")
    assert claims["iss"] == "enablebanking.com"


def test_callback_rejects_unknown_state(client):
    r = client.get("/api/banking/callback?state=inconnu&code=x", follow_redirects=False)
    assert r.status_code in (302, 307) and "/banques?error=" in r.headers["location"]


def test_purchase_simulator(client):
    from app.services.simulate import installments

    rows = installments(1000, 4, 0, 2.2, date(2026, 10, 1))
    assert [r["date"] for r in rows] == ["2026-10-01", "2026-11-01", "2026-12-01", "2027-01-01"]
    assert round(sum(r["amount"] for r in rows), 2) == 1022.0  # 1000 € + 2,2 % de frais
    rows = installments(1000, 3, 0, 0, date(2026, 10, 1))
    assert round(sum(r["amount"] for r in rows), 2) == 1000.0  # arrondis absorbés par la dernière échéance

    res = client.post("/api/simulate/purchase", json={
        "amount": 1500,
        "scenarios": [{"count": 1}, {"count": 4, "fees_pct": 2.2}, {"count": 12, "rate": 5.9}, {"count": 24, "rate": 5.9}],
    }).json()
    by = {s["count"]: s for s in res["scenarios"]}
    assert by[1]["extra_cost"] == 0 and by[1]["installment"] == 1500
    assert by[4]["extra_cost"] == 33.0
    assert 0 < by[12]["extra_cost"] < by[24]["extra_cost"]
    assert by[24]["installment"] < by[12]["installment"] < by[4]["installment"]
    assert by[12]["first_date"] > res["purchase_date"]  # crédit : 1re échéance le mois suivant
    assert by[24]["debt_ratio_after"] > res["debt_ratio"]
    # le comptant fait plonger le solde plus bas que le 24x à court terme
    assert by[1]["lowest"]["balance"] <= by[24]["lowest"]["balance"]
    assert len(by[24]["series"]) == len(res["baseline"]["series"])
    assert res["recommended"] in {s["label"] for s in res["scenarios"]}


def test_crud_create_and_update(client):
    """Création / modification via les routes CRUD génériques (corps JSON)."""
    today = date.today().isoformat()
    cases = {
        "/api/recurring": {"name": "Salaire test", "kind": "income", "amount": 2072, "frequency": "monthly", "start_date": today, "end_date": None, "match_pattern": "paie", "active": True},
        "/api/contracts": {"name": "Box", "amount": 29.99, "frequency": "monthly", "start_date": today},
        "/api/loans": {"name": "Prêt", "principal": 5000, "rate": 3.5, "duration_months": 24, "start_date": today},
        "/api/payslips": {"employer": "Test SA", "period": "2020-01-01", "gross": 3000, "net_before_tax": 2350, "net_taxable": 2400, "net_paid": 2300},
        "/api/vehicles": {"name": "Clio", "fiscal_hp": 4},
        "/api/fuel": {"date": today, "station": "Total", "liters": 40, "total": 70},
        "/api/goals": {"name": "Vacances", "target": 2000},
        "/api/categories": {"name": "Animaux", "kind": "expense"},
    }
    for url, body in cases.items():
        r = client.post(url, json=body)
        assert r.status_code == 201, (url, r.text)
        item = r.json()
        r = client.put(f"{url}/{item['id']}", json={**body, "name": body.get("name", "x") + " 2"} if "name" in body else body)
        assert r.status_code == 200, (url, r.text)
    assert client.get("/api/fuel").json()[0]["price_per_liter"] == 1.75


def test_reste_a_vivre_includes_rent_transfers_and_loans(client):
    before = client.get("/api/reste-a-vivre").json()
    today = date.today().isoformat()
    r = client.post("/api/recurring", json={"name": "Loyer appartement", "kind": "transfer", "amount": 650, "frequency": "monthly", "start_date": today})
    assert r.status_code == 201
    after = client.get("/api/reste-a-vivre").json()
    # un loyer payé par virement permanent est une charge, pas de l'épargne
    assert round(after["charges_monthly"] - before["charges_monthly"], 2) == 650
    assert after["breakdown"]["savings"] == before["breakdown"]["savings"]
    assert round(before["reste_a_vivre"] - after["reste_a_vivre"], 2) == 650
    groups = {i["name"]: i["group"] for i in after["items"]}
    assert groups["Loyer appartement"] == "housing"
    assert any(i["source"] == "loan" for i in after["items"])
    assert any(i["source"] == "contract" for i in after["items"])
    b = after["breakdown"]
    assert round(b["housing"] + b["debits"] + b["contracts"] + sum(i["monthly"] for i in after["items"] if i["group"] == "loans"), 2) == after["charges_monthly"]
    assert "undeclared" in after and "reste_a_vivre_if_undeclared" in after
    client.delete(f"/api/recurring/{r.json()['id']}")
