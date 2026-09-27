# syntax=docker/dockerfile:1

# ── Étape 1 : build du frontend React ─────────────────────────────────────────
FROM node:22-alpine AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ── Étape 2 : image d'exécution Python ───────────────────────────────────────
FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PACTOLE_DATA_DIR=/data \
    PACTOLE_STATIC_DIR=/app/static \
    TZ=Europe/Paris

RUN groupadd --system --gid 1000 pactole \
 && useradd --system --uid 1000 --gid pactole --home /app --shell /usr/sbin/nologin pactole

WORKDIR /app
COPY backend/requirements.txt .
RUN pip install -r requirements.txt
COPY backend/app ./app
COPY --from=frontend /build/dist ./static

RUN mkdir -p /data && chown -R pactole:pactole /data
USER pactole
VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/api/health', timeout=4).status == 200 else 1)"]

# Un seul worker : le planificateur de synchronisation tourne dans le processus.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--proxy-headers", "--forwarded-allow-ips", "*"]
