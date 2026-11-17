#!/usr/bin/env bash
# setup.sh - one-shot setup for hosting the News Aggregator server on a
# fresh Google Cloud e2-micro VM (Debian 12 / Ubuntu 22.04+).
#
# Idempotent: re-running it is safe. It installs Docker if missing, opens
# ports 80/443, writes deploy/.env and starts the stack.
#
# Usage (from anywhere, as a user that can sudo):
#   ./deploy/gcp/setup.sh news.example.com
#   ./deploy/gcp/setup.sh                 # reuses DOMAIN from deploy/.env
#
# Non-interactive: pass the domain as $1 (or set DOMAIN=... in the env).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$REPO_ROOT/deploy/.env"
ENV_EXAMPLE="$REPO_ROOT/deploy/.env.example"

step() { echo "==> $*"; }
warn() { echo "!!  $*" >&2; }
die()  { echo "!!  $*" >&2; exit 1; }

if [ "$(id -u)" -ne 0 ]; then
  SUDO="sudo"
else
  SUDO=""
fi

# ---------------------------------------------------------------- compose cmd
# Prefer the v2 plugin ("docker compose"), fall back to the v1 binary.
compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    die "docker compose is not available; re-run this script after installing Docker"
  fi
}

# ------------------------------------------------------------------- domain
DOMAIN="${1:-${DOMAIN:-}}"
if [ -z "$DOMAIN" ] && [ -f "$ENV_FILE" ]; then
  DOMAIN="$(sed -n 's/^DOMAIN=//p' "$ENV_FILE" | tail -n1 | tr -d '"' )"
fi
if [ -z "$DOMAIN" ]; then
  echo "Usage: $0 <domain>" >&2
  echo "Example: $0 news.example.com" >&2
  die "no domain given and no DOMAIN found in deploy/.env"
fi
case "$DOMAIN" in
  *://*) die "pass a bare hostname, not a URL: $DOMAIN" ;;
esac

# ------------------------------------------------------------------- docker
if ! command -v docker >/dev/null 2>&1; then
  step "Installing Docker (not found)"
  if command -v apt-get >/dev/null 2>&1; then
    $SUDO apt-get update -y
    # Try Docker's official repo first; fall back to distro packages.
    if $SUDO apt-get install -y docker.io docker-compose-plugin 2>/dev/null; then
      step "Installed docker.io + compose plugin from the distribution"
    else
      step "Distribution packages unavailable, installing Docker CE from docker.com"
      $SUDO apt-get install -y ca-certificates curl gnupg
      $SUDO install -m 0755 -d /etc/apt/keyrings
      if [ ! -f /etc/apt/keyrings/docker.asc ]; then
        curl -fsSL https://download.docker.com/linux/debian/gpg | $SUDO tee /etc/apt/keyrings/docker.asc >/dev/null
        $SUDO chmod a+r /etc/apt/keyrings/docker.asc
      fi
      . /etc/os-release
      DOCKER_DISTRO="${ID:-debian}"
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${DOCKER_DISTRO} ${VERSION_CODENAME} stable" \
        | $SUDO tee /etc/apt/sources.list.d/docker.list >/dev/null
      $SUDO apt-get update -y
      $SUDO apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    fi
  else
    die "no apt-get found; install Docker manually, then re-run this script"
  fi
else
  step "Docker already installed ($(docker --version))"
fi

# Ensure the compose plugin is usable even if Docker was preinstalled.
if ! docker compose version >/dev/null 2>&1 && ! command -v docker-compose >/dev/null 2>&1; then
  step "Installing the Docker compose plugin"
  if command -v apt-get >/dev/null 2>&1; then
    $SUDO apt-get update -y
    $SUDO apt-get install -y docker-compose-plugin || $SUDO apt-get install -y docker-compose
  else
    warn "could not install docker compose; install it manually"
  fi
fi

step "Enabling and starting the Docker daemon"
$SUDO systemctl enable --now docker
# Let the invoking (non-root) user run docker without sudo.
if [ -n "${SUDO_USER:-}" ]; then
  $SUDO usermod -aG docker "$SUDO_USER" || true
  warn "added $SUDO_USER to the docker group; log out and back in for it to take effect"
fi

# --------------------------------------------------------------------- ports
step "Opening TCP ports 80 and 443"
if command -v ufw >/dev/null 2>&1; then
  $SUDO ufw allow 80/tcp  >/dev/null || warn "ufw allow 80 failed"
  $SUDO ufw allow 443/tcp >/dev/null || warn "ufw allow 443 failed"
  step "ufw rules updated"
else
  warn "ufw is not installed; make sure your cloud firewall allows TCP 80 and 443"
fi
warn "Google Cloud also needs an ingress rule allowing tcp:80,tcp:443 (see deploy/gcp/README.md)"

# ---------------------------------------------------------------- deploy env
step "Writing $ENV_FILE (DOMAIN=$DOMAIN)"
if [ ! -f "$ENV_FILE" ]; then
  cp "$ENV_EXAMPLE" "$ENV_FILE"
fi
# Replace or append the DOMAIN line without touching anything else.
if grep -q '^DOMAIN=' "$ENV_FILE"; then
  tmp="$(mktemp)"
  sed "s|^DOMAIN=.*|DOMAIN=$DOMAIN|" "$ENV_FILE" >"$tmp"
  mv "$tmp" "$ENV_FILE"
else
  printf 'DOMAIN=%s\n' "$DOMAIN" >>"$ENV_FILE"
fi

# Warn (do not block) if the DNS record is not in place yet: Caddy cannot get
# a certificate until the domain resolves to this machine.
if command -v getent >/dev/null 2>&1; then
  if getent hosts "$DOMAIN" >/dev/null 2>&1; then
    step "DNS resolves for $DOMAIN"
  else
    warn "$DOMAIN does not resolve yet. Create the A record now; Caddy will keep"
    warn "retrying the certificate in the background once it does."
  fi
fi

# ------------------------------------------------------------------- compose
step "Validating docker-compose.yml"
( cd "$REPO_ROOT" && compose config >/dev/null ) || die "docker compose config failed"

step "Building and starting the stack (docker compose up -d --build)"
( cd "$REPO_ROOT" && $SUDO docker compose up -d --build ) \
  || ( cd "$REPO_ROOT" && $SUDO docker-compose up -d --build ) \
  || die "docker compose up failed"

step "Container status"
( cd "$REPO_ROOT" && $SUDO docker compose ps ) || true

cat <<EOF

Done.
  Site:        https://$DOMAIN
  Healthcheck: https://$DOMAIN/health

First certificate request can take a few seconds. If /health fails with a TLS
error, the domain likely does not resolve here yet; fix DNS and Caddy retries
automatically. Logs: sudo docker compose logs -f caddy
EOF
