#!/usr/bin/env bash
# One-time setup for a fresh Ubuntu 22.04/24.04 Contabo VPS: firewall, automatic security updates, fail2ban, then Coolify.
# Run it on the server as root:   ADMIN_IP=203.0.113.7 bash bootstrap-vps.sh
#   ADMIN_IP  your own public IP. Port 8000 (Coolify panel) and SSH are limited to it. Omit to leave SSH open to everyone (not recommended).
# Safe to re-run. It never disables SSH password login for you: do that yourself AFTER you have confirmed key login works.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run as root"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

apt-get update -y
apt-get install -y ufw fail2ban unattended-upgrades curl ca-certificates

# Firewall: SSH first (so enabling it cannot lock you out), then web, then the Coolify panel.
ufw default deny incoming; ufw default allow outgoing
if [ -n "${ADMIN_IP:-}" ]; then
  ufw allow from "$ADMIN_IP" to any port 22 proto tcp
  ufw allow from "$ADMIN_IP" to any port 8000 proto tcp
else
  echo "WARNING: ADMIN_IP not set: SSH is open to the internet and the Coolify panel (8000) is NOT opened. Use an SSH tunnel: ssh -L 8000:localhost:8000 root@<server>"
  ufw allow 22/tcp
fi
ufw allow 80/tcp; ufw allow 443/tcp
ufw --force enable

# NOTE: Docker-published ports bypass ufw. After Coolify is up, scan the server from another machine (nmap -Pn <ip>) and confirm only 80/443 (and 22/8000 from your IP) answer.

systemctl enable --now fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades

# Coolify (official installer: https://coolify.io/docs). Review it before piping to bash if you prefer.
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash

echo
echo "Done. Open  http://<server-ip>:8000  (from ADMIN_IP) and create the admin account IMMEDIATELY: the first visitor becomes admin."
echo "Then follow app-shell/DEPLOY.md section 3."
