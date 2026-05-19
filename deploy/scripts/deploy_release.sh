#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: deploy_release.sh <git-sha> [environment]" >&2
  exit 2
fi

SHA="$1"
TARGET_ENV="${2:-production}"
case "$TARGET_ENV" in
  staging|production) ;;
  *)
    echo "Invalid environment: $TARGET_ENV (expected staging or production)" >&2
    exit 2
    ;;
esac

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
ENV_FILE="$SHARED_DIR/.env"
SHARED_AVATARS_DIR="$SHARED_DIR/avatars"
SHARED_CHAT_MEDIA_DIR="$SHARED_DIR/chat_media"
APP_USER="sunmessenger"
APP_GROUP="sunmessenger"
KEEP_RELEASE_COUNT="${KEEP_RELEASE_COUNT:-5}"

if [[ ! -f "$ARTIFACT_FILE" ]]; then
  echo "Release archive not found: $ARTIFACT_FILE" >&2
  exit 3
fi

ensure_venv() {
  local venv_python="$VENV_BIN/python"

  if [[ ! -x "$venv_python" ]]; then
    python3 -m venv "$BASE_DIR/venv"
  fi

  if "$venv_python" -m pip --version >/dev/null 2>&1; then
    return
  fi

  # Recover broken virtualenvs created without pip.
  "$venv_python" -m ensurepip --upgrade >/dev/null 2>&1 || true

  if "$venv_python" -m pip --version >/dev/null 2>&1; then
    return
  fi

  rm -rf "$BASE_DIR/venv"
  python3 -m venv "$BASE_DIR/venv"

  if ! "$venv_python" -m pip --version >/dev/null 2>&1; then
    echo "Failed to initialize pip in $BASE_DIR/venv." >&2
    echo "Install python3-venv and python3-pip, then retry deploy." >&2
    exit 4
  fi
}

run_systemctl() {
  if [[ "$(id -u)" -eq 0 ]]; then
    systemctl "$@"
  else
    sudo systemctl "$@"
  fi
}

restart_web_service() {
  # The release symlink changes before this call; restart is required so
  # gunicorn's master process gets the new WorkingDirectory target.
  run_systemctl restart sunmessenger-web.service
}

systemd_unit_exists() {
  run_systemctl cat "$1" >/dev/null 2>&1
}

install_mediasoup_dependencies_if_enabled() {
  if [[ ! -d "$RELEASE_DIR/server-mediasoup" ]]; then
    return 0
  fi

  if ! systemd_unit_exists sun-mediasoup.service; then
    echo "Skipping mediasoup dependency install: sun-mediasoup.service is not installed."
    return 0
  fi

  if ! command -v npm >/dev/null 2>&1; then
    echo "npm is required because sun-mediasoup.service is installed." >&2
    echo "Install Node.js 18+ and npm on the server, then retry deploy." >&2
    exit 8
  fi

  if [[ -f "$RELEASE_DIR/server-mediasoup/package-lock.json" ]]; then
    npm --prefix "$RELEASE_DIR/server-mediasoup" ci --omit=dev --no-audit --no-fund
  else
    npm --prefix "$RELEASE_DIR/server-mediasoup" install --omit=dev --no-audit --no-fund
  fi
}

restart_mediasoup_service_if_present() {
  if systemd_unit_exists sun-mediasoup.service; then
    run_systemctl restart sun-mediasoup.service
  fi
}

reset_presence_state() {
  "$VENV_BIN/python" - <<'PY'
from app.config import load_environment
from app.database import get_db_connection
from app.services.presence import configure_presence

load_environment()
redis_client = configure_presence()
if redis_client is not None:
    keys = list(redis_client.scan_iter("presence:conn:*")) + list(redis_client.scan_iter("presence:act:*"))
    if keys:
        redis_client.delete(*keys)

conn = get_db_connection()
try:
    conn.execute(
        """
        UPDATE users
        SET is_online = 0,
            last_seen = COALESCE(
                last_seen,
                to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS')
            )
        WHERE is_online = 1
        """
    )
    conn.commit()
finally:
    conn.close()
PY
}

sync_avatar_storage() {
  mkdir -p "$SHARED_AVATARS_DIR"

  if [[ -L "$CURRENT_LINK" ]]; then
    local current_target
    current_target="$(readlink -f "$CURRENT_LINK" || true)"
    if [[ -n "$current_target" && -d "$current_target/static/avatars" ]]; then
      cp -a "$current_target/static/avatars/." "$SHARED_AVATARS_DIR/" || true
    fi
  fi

  if [[ -d "$RELEASE_DIR/static/avatars" ]]; then
    cp -a "$RELEASE_DIR/static/avatars/." "$SHARED_AVATARS_DIR/" || true
    rm -rf "$RELEASE_DIR/static/avatars"
  fi

  mkdir -p "$RELEASE_DIR/static"
  ln -sfn "$SHARED_AVATARS_DIR" "$RELEASE_DIR/static/avatars"

  if id "$APP_USER" >/dev/null 2>&1; then
    chown -R "$APP_USER:$APP_GROUP" "$SHARED_AVATARS_DIR" || true
  fi
}

sync_chat_media_storage() {
  mkdir -p "$SHARED_CHAT_MEDIA_DIR"

  if [[ -L "$CURRENT_LINK" ]]; then
    local current_target
    current_target="$(readlink -f "$CURRENT_LINK" || true)"
    if [[ -n "$current_target" && -d "$current_target/storage/chat_media" ]]; then
      cp -a "$current_target/storage/chat_media/." "$SHARED_CHAT_MEDIA_DIR/" || true
    fi
  fi

  if [[ -d "$RELEASE_DIR/storage/chat_media" ]]; then
    cp -a "$RELEASE_DIR/storage/chat_media/." "$SHARED_CHAT_MEDIA_DIR/" || true
    rm -rf "$RELEASE_DIR/storage/chat_media"
  fi

  mkdir -p "$RELEASE_DIR/storage"
  ln -sfn "$SHARED_CHAT_MEDIA_DIR" "$RELEASE_DIR/storage/chat_media"

  if id "$APP_USER" >/dev/null 2>&1; then
    chown -R "$APP_USER:$APP_GROUP" "$SHARED_CHAT_MEDIA_DIR" || true
  fi
}

verify_release_contents() {
  local required_paths=(
    "app/__init__.py"
    "wsgi.py"
    "manage.py"
    "requirements-production.txt"
    "templates/chat.html"
    "templates/error.html"
  )
  local missing=()
  local required_path

  for required_path in "${required_paths[@]}"; do
    if [[ ! -e "$RELEASE_DIR/$required_path" ]]; then
      missing+=("$required_path")
    fi
  done

  if [[ "${#missing[@]}" -gt 0 ]]; then
    echo "Release archive is incomplete; missing required path(s):" >&2
    printf ' - %s\n' "${missing[@]}" >&2
    rm -rf "$RELEASE_DIR"
    exit 6
  fi
}

cleanup_old_deploys() {
  local keep_count="$KEEP_RELEASE_COUNT"
  local -A keep=()
  local link_path target name release_path artifact_path

  if ! [[ "$keep_count" =~ ^[0-9]+$ ]] || [[ "$keep_count" -lt 1 ]]; then
    echo "Skip deploy cleanup: invalid KEEP_RELEASE_COUNT=$KEEP_RELEASE_COUNT" >&2
    return 0
  fi

  if [[ ! -d "$RELEASES_DIR" ]]; then
    return 0
  fi

  keep["$SHA"]=1

  for link_path in "$CURRENT_LINK" "$PREVIOUS_LINK"; do
    target="$(readlink -f "$link_path" 2>/dev/null || true)"
    if [[ -n "$target" && "$target" == "$RELEASES_DIR/"* && -d "$target" ]]; then
      keep["$(basename "$target")"]=1
    fi
  done

  while IFS= read -r name; do
    [[ -n "$name" ]] && keep["$name"]=1
  done < <(
    find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %f\n' \
      | sort -nr \
      | head -n "$keep_count" \
      | awk '{print $2}'
  )

  echo "Keeping ${#keep[@]} deploy release(s); pruning older releases and artifacts."

  while IFS= read -r release_path; do
    name="$(basename "$release_path")"
    if [[ -z "${keep[$name]+x}" ]]; then
      rm -rf -- "$release_path" || echo "Failed to remove old release: $release_path" >&2
    fi
  done < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -print)

  if [[ -d "$ARTIFACTS_DIR" ]]; then
    while IFS= read -r artifact_path; do
      name="$(basename "$artifact_path")"
      if [[ -z "${keep[$name]+x}" ]]; then
        rm -rf -- "$artifact_path" || echo "Failed to remove old artifact: $artifact_path" >&2
      fi
    done < <(find "$ARTIFACTS_DIR" -mindepth 1 -maxdepth 1 -type d -print)
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
    restart_web_service || true
    run_systemctl restart sunmessenger-scheduler.service || true
    restart_mediasoup_service_if_present || true
  fi
}
trap rollback ERR

mkdir -p "$RELEASES_DIR" "$ARTIFACTS_DIR/$SHA" "$BACKUP_DIR"
ensure_venv
"$VENV_BIN/python" -m pip install --upgrade pip
rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"
tar -xzf "$ARTIFACT_FILE" -C "$RELEASE_DIR"
verify_release_contents
sync_avatar_storage
sync_chat_media_storage

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Environment file not found: $ENV_FILE" >&2
  exit 5
fi
ln -sfn "$ENV_FILE" "$RELEASE_DIR/.env"

cd "$RELEASE_DIR"
"$VENV_BIN/python" -m pip install -r requirements-production.txt
install_mediasoup_dependencies_if_enabled
"$VENV_BIN/python" manage.py production-config-check --env production
"$VENV_BIN/python" manage.py security-check --env production
"$VENV_BIN/python" manage.py maintenance --env production --backup-dir "$BACKUP_DIR"

if [[ -L "$CURRENT_LINK" ]]; then
  ln -sfn "$(readlink -f "$CURRENT_LINK")" "$PREVIOUS_LINK"
fi
ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"

reset_presence_state
restart_web_service
run_systemctl restart sunmessenger-scheduler.service
restart_mediasoup_service_if_present

health_ok=0
for _ in $(seq 1 30); do
  if curl -fsS -H "Host: sun.445231.xyz" "http://127.0.0.1:8000/" >/dev/null; then
    health_ok=1
    break
  fi
  sleep 1
done

if [[ "$health_ok" -ne 1 ]]; then
  echo "Health check failed: http://127.0.0.1:8000/" >&2
  run_systemctl status sunmessenger-web.service --no-pager -l || true
  exit 7
fi

cleanup_old_deploys

echo "Deploy complete: sha=$SHA env=$TARGET_ENV"
