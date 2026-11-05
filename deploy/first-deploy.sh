#!/usr/bin/env bash
# First-time deploy of MAPIMS EFS on the VPS. Run from the repo root:
#   bash deploy/first-deploy.sh
# Safe to re-run: it never overwrites an existing backend/.env and never resets users.
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE=backend/.env
PORTS=(1010 2010 3010)

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }
rand() { head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "$1"; }

say "Checking tools"
command -v docker >/dev/null || die "docker is not installed"
docker compose version >/dev/null 2>&1 || die "docker compose plugin is missing"
command -v curl >/dev/null || die "curl is not installed"

say "Checking host ports ${PORTS[*]} are free (skipped if this stack is already running)"
if ! docker ps --format '{{.Names}}' | grep -q '^mapims_efs_'; then
  for p in "${PORTS[@]}"; do
    if ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${p}$"; then
      die "port $p is already in use. Pick another slot and edit docker-compose.yml and nginx/efs.mapims.edu.in.conf."
    fi
  done
fi

say "Preparing $ENV_FILE"
CREATED_ENV=0
if [ -f "$ENV_FILE" ]; then
  echo "$ENV_FILE already exists - keeping it."
else
  cp backend/.env.example "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  CREATED_ENV=1
  set_kv() { # set_kv KEY VALUE  (replace the line if present, else append)
    if grep -qE "^#?\s*$1=" "$ENV_FILE"; then
      sed -i -E "s|^#?\s*$1=.*|$1=$2|" "$ENV_FILE"
    else
      echo "$1=$2" >> "$ENV_FILE"
    fi
  }
  set_kv JWT_SECRET "$(rand 64)"
  set_kv SEED_ADMIN_USERNAME admin
  set_kv SEED_ADMIN_PASSWORD "$(rand 16)"
  set_kv SEED_SUPERADMIN_USERNAME superadmin
  set_kv SEED_SUPERADMIN_PASSWORD "$(rand 16)"
  set_kv TRUST_PROXY_HOPS 2
  set_kv OPENROUTER_HTTP_REFERER "https://efs.mapims.edu.in"
  set_kv FEEDBACK_CORS_ORIGINS "https://efs.mapims.edu.in"
  echo "Generated JWT_SECRET and admin passwords."
  echo "Add your API keys now if you have them (AI sentiment and voice need them):"
  read -r -p "  OPENROUTER_API_KEY (Enter to skip): " k1 || true
  [ -n "${k1:-}" ] && set_kv OPENROUTER_API_KEY "$k1"
  read -r -p "  SARVAM_API_KEY     (Enter to skip): " k2 || true
  [ -n "${k2:-}" ] && set_kv SARVAM_API_KEY "$k2"
fi
grep -qE '^JWT_SECRET=.+' "$ENV_FILE" || die "JWT_SECRET is empty in $ENV_FILE"
grep -qE '^SEED_ADMIN_PASSWORD=.+' "$ENV_FILE" || die "SEED_ADMIN_PASSWORD is empty in $ENV_FILE"
grep -qE '^SEED_SUPERADMIN_PASSWORD=.+' "$ENV_FILE" || die "SEED_SUPERADMIN_PASSWORD is empty in $ENV_FILE"

say "Building and starting the stack (first build takes a few minutes)"
docker compose up -d --build

say "Waiting for the API to answer"
ok=0
for i in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:2010/api/health >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
[ "$ok" = 1 ] || { docker compose logs --tail=60 backend; die "API did not become healthy"; }
curl -fsS http://127.0.0.1:2010/api/health; echo

say "Loading departments and the Admin and Super Admin accounts (idempotent)"
docker compose exec -T backend npm run seed
docker compose exec -T backend npm run seed-superadmin

say "Checking the website through the frontend container"
curl -fsS -o /dev/null -w "frontend HTTP %{http_code}\n" http://127.0.0.1:1010/
curl -fsS http://127.0.0.1:1010/api/health; echo

say "Stack is up"
docker compose ps
if [ "$CREATED_ENV" = 1 ]; then
  echo
  echo "Sign-in details are in $ENV_FILE (SEED_ADMIN_* and SEED_SUPERADMIN_*). Save them in your password"
  echo "manager, then sign in and change them under your account."
fi
cat <<'NEXT'

Remaining steps (need root):
  1. DNS: point efs.mapims.edu.in at this server's IP.
  2. sudo cp nginx/efs.mapims.edu.in.conf /etc/nginx/sites-available/efs.mapims.edu.in
     sudo ln -s /etc/nginx/sites-available/efs.mapims.edu.in /etc/nginx/sites-enabled/
     sudo nginx -t && sudo systemctl reload nginx
  3. HTTPS (the microphone and offline mode need it):
     sudo certbot --nginx -d efs.mapims.edu.in
  4. Open https://efs.mapims.edu.in
NEXT
