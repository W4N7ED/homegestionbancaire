# homegestionbancaire

**Pactole** — gestion de comptes bancaires **auto-hébergée**, en conteneur Docker : tableau de bord,
reste à vivre, prévisionnel, crédits, prélèvements, abonnements, fiches de paie,
tickets de carburant et dossier fiscal. Connexion **Revolut** en lecture seule via
Open Banking (DSP2).

## Fonctionnalités

| Domaine | Ce que fait Pactole |
|---|---|
| **Tableau de bord** | Reste à vivre jusqu'à la prochaine paie, soldes, épargne, charges fixes, capital restant dû, courbe du solde (90 j réels + 60 j prévus), revenus/dépenses sur 12 mois, dépenses par catégorie vs budget, prochaines échéances, alertes |
| **Reste à vivre** | Revenus − (prélèvements + abonnements + crédits), charges annuelles mensualisées, reste à vivre après épargne, **taux d'endettement** (seuil HCSF 35 %) |
| **Prévisionnel** | Projection du solde à 30 j / 3 mois / 6 mois / 1 an à partir des échéances connues et des dépenses courantes moyennes ; détection du découvert |
| **Échéancier** | Calendrier mensuel de toutes les entrées/sorties prévues |
| **Comptes & opérations** | Comptes synchronisés ou manuels, recherche, filtres, catégorisation automatique par règles (« mémoriser ce choix »), catégorisation en masse, export CSV |
| **Import de relevés** | CSV Revolut (le compte courant est isolé des coffres), CSV des banques françaises (`;`, virgule décimale, Windows-1252), OFX/QFX ; dédoublonnage à chaque réimport |
| **Revenus & prélèvements** | Salaires, loyer, prélèvements, virements permanents, épargne programmée (hebdo → annuel) ; **détection automatique** des opérations récurrentes |
| **Contrats & abonnements** | Box, mobile, énergie, assurances, streaming… fin d'engagement, préavis, alerte « résilier avant le … », justificatifs joints |
| **Crédits** | Immobilier, auto, conso… mensualité calculée, assurance emprunteur, tableau d'amortissement, capital restant dû, coût total |
| **Budgets & objectifs** | Plafond mensuel par catégorie avec moyenne 3 mois ; objectifs d'épargne liés à un compte avec effort mensuel nécessaire |
| **Fiches de paie** | Brut, net imposable, PAS, net versé, primes, congés ; cumuls annuels ; PDF joint |
| **Carburant** | Tickets par véhicule, prix au litre, consommation plein à plein, part professionnelle, photo du ticket |
| **Coffre-fort** | Tous les justificatifs (PDF, photos, bureautique) classés par type et année |
| **Impôts** | Cumul net imposable (case 1AJ), mois manquants, frais réels vs forfait 10 % avec **barème kilométrique**, export ZIP du **dossier fiscal** annuel (CSV + justificatifs) pour un éventuel contrôle |

Interface en français, thème clair/sombre (suit le système), utilisable sur mobile.

## Démarrage rapide

```bash
git clone https://github.com/W4N7ED/homegestionbancaire.git
cd homegestionbancaire
cp .env.example .env          # ajustez PACTOLE_PUBLIC_URL au minimum
docker compose up -d --build
```

Ouvrez `http://<hôte>:8080`, créez le compte administrateur, puis soit reliez Revolut,
soit importez un relevé, soit cliquez sur **Charger la démo** pour explorer avec un
profil fictif (ou `PACTOLE_DEMO=true` dans `.env` au premier démarrage).

Avec PostgreSQL plutôt que SQLite : renseignez `POSTGRES_PASSWORD` et `DATABASE_URL`
dans `.env`, puis `docker compose --profile postgres up -d --build`.

## Relier Revolut

Revolut ne propose pas d'API publique pour les comptes particuliers ; l'accès passe par
un agrégateur agréé DSP2. Pactole s'appuie sur **Enable Banking**, gratuit pour relier
ses propres comptes. (GoCardless Bank Account Data, ex-Nordigen, est aussi supporté mais
[n'accepte plus de nouvelles inscriptions](https://bankaccountdata.gocardless.com/new-signups-disabled).)

1. Créez un compte sur [enablebanking.com](https://enablebanking.com), puis une application
   en environnement **Production**.
2. Déclarez l'URL de redirection : `<PACTOLE_PUBLIC_URL>/api/banking/callback`
   (exactement la valeur affichée dans *Connexions bancaires*).
3. Récupérez le fichier `.pem` de la clé privée générée, et activez l'application en
   reliant vos propres comptes (mode « restricted », sans contrat).
4. Dans Pactole : *Connexions bancaires → Enable Banking → Identifiants*, collez
   l'Application ID et la clé privée (stockée chiffrée).
5. *Relier une banque* → Revolut → *Autoriser* : vous validez dans l'application Revolut,
   puis revenez sur Pactole ; les comptes et jusqu'à deux ans d'historique sont importés.

Synchronisation automatique chaque jour à `PACTOLE_SYNC_HOUR` (bouton *Synchroniser* pour
forcer). Le consentement DSP2 expire après 180 jours maximum : une alerte prévient
14 jours avant, et le bouton *Renouveler* relance l'autorisation.

Sans agrégateur, l'**import CSV** Revolut fonctionne toujours : application Revolut →
compte → Relevé → Excel/CSV → *Comptes → Importer*.

## Mise en production (reverse-proxy HTTPS)

Exposez Pactole derrière HTTPS et activez `PACTOLE_COOKIE_SECURE=true`. Exemple Caddy :

```caddyfile
pactole.mondomaine.fr {
    reverse_proxy 127.0.0.1:8080
}
```

Nginx :

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 25m;
}
```

Pour un usage purement local, un accès via VPN (WireGuard, Tailscale) évite d'exposer
l'application sur Internet ; l'URL de retour bancaire peut alors pointer vers l'adresse
du VPN.

## Sauvegarde

Tout l'état vit dans le volume `/data` :

| Fichier | Contenu |
|---|---|
| `pactole.db` | base SQLite |
| `uploads/` | justificatifs |
| `secret.key` | clé maîtresse (sessions + chiffrement des identifiants bancaires), si `PACTOLE_SECRET_KEY` n'est pas défini |

```bash
docker run --rm -v homegestionbancaire_pactole-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/pactole-$(date +%F).tgz -C /data .
```

*Paramètres → Télécharger une sauvegarde* produit aussi une copie cohérente de la base à
chaud (API de backup SQLite). Sans `secret.key`, les identifiants bancaires enregistrés ne
sont plus déchiffrables : il suffit alors de les ressaisir.

## Sécurité

- Compte administrateur unique créé au premier lancement, mot de passe haché **Argon2id**,
  limitation à 8 tentatives de connexion / 5 min par IP.
- Session par cookie `HttpOnly`, `SameSite=Lax`, signé (HS256), `Secure` en option.
- Identifiants Open Banking chiffrés en base (Fernet, clé dérivée de la clé maîtresse),
  jamais renvoyés par l'API.
- Accès bancaire **en lecture seule** (AIS DSP2) : aucun paiement ne peut être initié.
- Conteneur non-root (uid 1000), système de fichiers en lecture seule, `no-new-privileges`,
  healthcheck.
- Justificatifs : liste blanche de types MIME, taille plafonnée, noms de fichiers aléatoires.

## Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `PACTOLE_PUBLIC_URL` | `http://localhost:8080` | URL d'accès, sert d'URL de retour Open Banking |
| `PACTOLE_SECRET_KEY` | générée dans `/data/secret.key` | clé maîtresse |
| `PACTOLE_COOKIE_SECURE` | `false` | cookie `Secure` (HTTPS) |
| `PACTOLE_SYNC_HOUR` | `6` | heure de synchronisation quotidienne |
| `PACTOLE_SESSION_HOURS` | `12` | durée de session |
| `PACTOLE_MAX_UPLOAD_MB` | `20` | taille max d'un justificatif |
| `PACTOLE_DEMO` | `false` | données fictives au premier démarrage |
| `DATABASE_URL` | SQLite dans `/data` | ex. `postgresql+psycopg://…` |
| `TZ` | `Europe/Paris` | fuseau horaire |

## Architecture

```
homegestionbancaire/
├── Dockerfile            build multi-étapes : Node (frontend) → Python slim
├── docker-compose.yml
├── backend/              FastAPI + SQLAlchemy 2 + APScheduler
│   ├── app/
│   │   ├── providers/    connecteurs Open Banking (Enable Banking, GoCardless)
│   │   ├── services/     échéancier, crédits, reste à vivre, prévisionnel,
│   │   │                 détection des récurrences, imports, fiscalité, synchro
│   │   └── routers/      API REST (/api/docs pour l'OpenAPI)
│   └── tests/
└── frontend/             React 19 + TypeScript + Vite + Tailwind 4 + Recharts
```

Un seul processus uvicorn sert l'API et l'interface ; le planificateur de synchronisation
tourne dans ce processus (ne pas lancer plusieurs workers).

## Développement

```bash
# API
cd backend && python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt pytest
PACTOLE_DATA_DIR=./data PACTOLE_DEMO=true uvicorn app.main:app --reload --port 8000
pytest

# Interface (proxy /api → :8000)
cd frontend && npm install && npm run dev
```

## Limites connues

- Barème kilométrique et plafonds du forfait 10 % : valeurs des revenus 2024, à vérifier
  chaque année (`backend/app/services/fiscal.py`).
- Montants multi-devises affichés dans leur devise mais additionnés sans conversion.
- Schéma de base créé automatiquement ; pas encore de migrations Alembic.
