#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: deploy_release.sh <git-sha> [environment]" >&2
  exit 2
fi

SHA="$1"
TARGET_ENV="${2:-production}"

BASE_DIR="/srv/sunmessenger"
RELEASES_DIR="$BASE_DIR/releases"
ARTIFACTS_DIR="$BASE_DIR/artifacts"
SHARED_DIR="$BASE_DIR/shared"
CURRENT_LINK="$BASE_DIR/current"
PREVIOUS_LINK="$BASE_DIR/previous"
VENV_BIN="$BASE_DIR/venv/bin"

RELEASE_DIR="$RELEASES_DIR/$SHA"
ARTIFACT_FILE="$ARTIFACTS_DIR/$SHA/release.tar.gz"
BACKUP_DIR="$SHARED_DIR/backups"

if [[ ! -f "$ARTIFACT_FILE" ]]; then
  echo "Release archive not found: $ARTIFACT_FILE" >&2
  exit 3
fi

run_systemctl() {
  if [[ "$(id -u)" -eq 0 ]]; then
    systemctl "$@"
  else
    sudo systemctl "$@"
  fi
}

old_target=""
if [[ -L "$CURRENT_LINK" ]]; then
  old_target="$(readlink -f "$CURRENT_LINK" || true)"
fi

rollback() {
  if [[ -n "$old_target" && -d "$old_target" ]]; then
    echo "Rollback to previous release: $old_target"
    ln -sfn "$old_target" "$CURRENT_LINK"
    run_systemctl restart sunmessenger-web.service || true
    run_systemctl restart sunmessenger-scheduler.service || true
  fi
}
trap rollback ERR

mkdir -p "$RELEASES_DIR" "$ARTIFACTS_DIR/$SHA" "$BACKUP_DIR"
rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"
tar -xzf "$ARTIFACT_FILE" -C "$RELEASE_DIR"

cd "$RELEASE_DIR"
"$VENV_BIN/pip" install -r requirements-production.txt
"$VENV_BIN/python" manage.py production-config-check --env production
"$VENV_BIN/python" manage.py security-check --env production
"$VENV_BIN/python" manage.py maintenance --env production --backup-dir "$BACKUP_DIR"

if [[ -L "$CURRENT_LINK" ]]; then
  ln -sfn "$(readlink -f "$CURRENT_LINK")" "$PREVIOUS_LINK"
fi
ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"

run_systemctl restart sunmessenger-web.service
run_systemctl restart sunmessenger-scheduler.service

curl -fsS -H "Host: sun.445231.xyz" "http://127.0.0.1:8000/" >/dev/null

echo "Deploy complete: sha=$SHA env=$TARGET_ENV"
