#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# potcount — one-shot VPS setup (Ubuntu/Debian).
#
# Installs Node + Caddy, runs the app as a systemd service, and serves it over
# HTTPS on your domain with an auto-renewing Let's Encrypt certificate.
#
# Usage (run from the project root, as root):
#     sudo bash deploy/setup.sh your-domain.com [linux-user]
#
#   your-domain.com  the domain you bought at TransIP (DNS must point here first)
#   linux-user       user the app runs as (default: the user who ran sudo)
# ---------------------------------------------------------------------------
set -euo pipefail

DOMAIN="${1:-}"
APP_USER="${2:-${SUDO_USER:-root}}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-3000}"

if [[ -z "$DOMAIN" ]]; then
  echo "Usage: sudo bash deploy/setup.sh your-domain.com [linux-user]" >&2
  exit 1
fi
if [[ "$EUID" -ne 0 ]]; then
  echo "Please run with sudo/root." >&2
  exit 1
fi

echo "==> Domain:   $DOMAIN"
echo "==> App dir:  $APP_DIR"
echo "==> Run as:   $APP_USER"
echo "==> Port:     $PORT (behind Caddy)"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y

# --- Node.js 20 LTS --------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo "==> Installing Node.js 20 LTS"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  echo "==> Node already installed: $(node -v)"
fi

# --- Caddy (reverse proxy + automatic HTTPS) -------------------------------
if ! command -v caddy >/dev/null 2>&1; then
  echo "==> Installing Caddy"
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
else
  echo "==> Caddy already installed"
fi

# --- Open the firewall (if ufw is active) ----------------------------------
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  echo "==> Allowing 80/443 through ufw"
  ufw allow 80/tcp  >/dev/null || true
  ufw allow 443/tcp >/dev/null || true
fi

# --- Make sure data/ exists and is owned (and only readable) by the app user --
# The session secret and PIN hashes live here — keep them off other local users.
mkdir -p "$APP_DIR/data"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR/data"
chmod 700 "$APP_DIR/data"
[ -f "$APP_DIR/data/.session-secret" ] && chmod 600 "$APP_DIR/data/.session-secret"
[ -f "$APP_DIR/data/users.json" ] && chmod 600 "$APP_DIR/data/users.json"

# --- systemd service -------------------------------------------------------
echo "==> Writing /etc/systemd/system/potcount.service"
cat > /etc/systemd/system/potcount.service <<EOF
[Unit]
Description=potcount
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=COOKIE_SECURE=1
# To enable Google sign-in later, add your client id and 'systemctl restart potcount':
# Environment=GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
ExecStart=$(command -v node) server/index.js
Restart=always
RestartSec=3
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now potcount
systemctl restart potcount

# --- Caddy site config -----------------------------------------------------
echo "==> Writing /etc/caddy/Caddyfile"
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN, www.$DOMAIN {
    encode zstd gzip
    reverse_proxy localhost:$PORT
}
EOF

systemctl reload caddy || systemctl restart caddy

echo
echo "============================================================"
echo " Done. Once DNS for $DOMAIN points to this server, open:"
echo "     https://$DOMAIN"
echo
echo " Useful commands:"
echo "   systemctl status potcount      # app status"
echo "   journalctl -u potcount -f       # live app logs"
echo "   systemctl restart potcount      # after pulling new code"
echo "   journalctl -u caddy -f            # HTTPS / cert logs"
echo "============================================================"
