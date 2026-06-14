#!/usr/bin/env bash
# deploy.sh — install or update the Project Tracker on a bare metal Linux server.
#
# First-time setup:
#   1. Clone the repo:   sudo git clone <repo-url> /opt/project-tracker
#   2. Copy env file:    sudo cp /opt/project-tracker/backend/.env.example \
#                                /opt/project-tracker/backend/.env
#                        # then edit .env and fill in all values
#   3. Fix permissions:  sudo chown -R www-data:www-data /opt/project-tracker
#   4. Install service:  sudo cp /opt/project-tracker/deploy/project-tracker.service \
#                                /etc/systemd/system/
#                        sudo systemctl daemon-reload
#                        sudo systemctl enable project-tracker
#   5. Install nginx:    sudo cp /opt/project-tracker/deploy/nginx.conf \
#                                /etc/nginx/sites-available/project-tracker
#                        sudo ln -sf /etc/nginx/sites-available/project-tracker \
#                                    /etc/nginx/sites-enabled/project-tracker
#                        sudo rm -f /etc/nginx/sites-enabled/default
#   6. Run this script:  sudo bash /opt/project-tracker/deploy/deploy.sh
#
# Subsequent updates: just run this script again — it pulls, rebuilds, restarts.

set -euo pipefail

APP_DIR="/opt/project-tracker"
SERVICE="project-tracker"

echo "▶ Pulling latest code..."
git -C "$APP_DIR" pull

echo "▶ Installing Python dependencies..."
cd "$APP_DIR/backend"
python3 -m venv .venv
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q -r requirements.txt

echo "▶ Building frontend..."
cd "$APP_DIR/web"
npm ci --silent
npm run build

echo "▶ Setting permissions..."
chown -R www-data:www-data "$APP_DIR"

echo "▶ Validating nginx config..."
nginx -t

echo "▶ Reloading nginx..."
systemctl reload nginx

echo "▶ Restarting application..."
systemctl restart "$SERVICE"
sleep 2
systemctl status "$SERVICE" --no-pager -l

echo ""
echo "✓ Deployment complete."
