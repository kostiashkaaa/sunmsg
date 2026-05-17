#!/usr/bin/env bash
# deploy/coturn/install.sh
# Install and configure coturn TURN/STUN server for SUNmessenger P2P calls.
#
# Usage:
#   sudo bash deploy/coturn/install.sh <domain> <public_ip> <turn_secret>
#
# Example:
#   sudo bash deploy/coturn/install.sh sunmessenger.ru 1.2.3.4 mysecret123
#
# After running, set in your Flask .env:
#   TURN_SECRET=<same secret>
#   TURN_SERVER_URLS=turn:<domain>:3478?transport=udp,turn:<domain>:3478?transport=tcp,turns:<domain>:5349?transport=tcp

set -euo pipefail

DOMAIN="${1:?Usage: $0 <domain> <public_ip> <turn_secret>}"
PUBLIC_IP="${2:?Usage: $0 <domain> <public_ip> <turn_secret>}"
TURN_SECRET="${3:?Usage: $0 <domain> <public_ip> <turn_secret>}"

CONF_SRC="$(dirname "$0")/turnserver.conf"
CONF_DEST="/etc/turnserver.conf"
CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"
LOG_DIR="/var/log/coturn"

echo "==> Installing coturn..."
apt-get update -q
apt-get install -y coturn

echo "==> Enabling coturn daemon..."
sed -i 's/^#*TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn

echo "==> Writing config to ${CONF_DEST}..."
sed \
    -e "s|YOUR_DOMAIN|${DOMAIN}|g" \
    -e "s|YOUR_PUBLIC_IP|${PUBLIC_IP}|g" \
    -e "s|CHANGE_ME_STRONG_SECRET_HERE|${TURN_SECRET}|g" \
    "${CONF_SRC}" > "${CONF_DEST}"

echo "==> Creating log directory..."
mkdir -p "${LOG_DIR}"
chown -R turnserver:turnserver "${LOG_DIR}" 2>/dev/null || true

# Open required ports in UFW if present
if command -v ufw &>/dev/null; then
    echo "==> Opening firewall ports (ufw)..."
    ufw allow 3478/tcp
    ufw allow 3478/udp
    ufw allow 5349/tcp
    ufw allow 5349/udp
    ufw allow 40000:49999/udp
fi

echo "==> Enabling and starting coturn..."
systemctl enable coturn
systemctl restart coturn
systemctl status coturn --no-pager

echo ""
echo "Done. Add to Flask .env:"
echo "  TURN_SECRET=${TURN_SECRET}"
echo "  TURN_SERVER_URLS=turn:${DOMAIN}:3478?transport=udp,turn:${DOMAIN}:3478?transport=tcp,turns:${DOMAIN}:5349?transport=tcp"
echo "  TURN_CREDENTIAL_TTL_SECONDS=3600"
echo ""
echo "Make sure TLS certificate exists at: ${CERT_DIR}"
echo "  certbot certonly --standalone -d ${DOMAIN}"
