#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
LOCAL_ENV_FILE="$REPO_ROOT/deploy/.env.local"
if [ -f "$LOCAL_ENV_FILE" ]; then
  set -a
  # shellcheck source=/dev/null
  . "$LOCAL_ENV_FILE"
  set +a
fi

SSH_HOST="${SUN_DEPLOY_SSH_HOST:-92.113.150.115}"
SSH_PORT="${SUN_DEPLOY_SSH_PORT:-22}"
SSH_USER="${SUN_DEPLOY_SSH_USER:-root}"
SUN_DEPLOY_ALLOW_ROOT="${SUN_DEPLOY_ALLOW_ROOT:-1}"
DEPLOY_ENV="${1:-staging}"
case "$DEPLOY_ENV" in
  staging|production) ;;
  *)
    echo "Invalid environment: $DEPLOY_ENV (expected staging or production)" >&2
    exit 2
    ;;
esac
SSH_OPTS=(-p "$SSH_PORT" -o StrictHostKeyChecking=yes)
if [ -n "${SUN_DEPLOY_SSH_KEY:-}" ]; then
  SSH_OPTS+=(-i "$SUN_DEPLOY_SSH_KEY")
fi

SCP_OPTS=(-P "$SSH_PORT" -o StrictHostKeyChecking=yes)
if [ -n "${SUN_DEPLOY_SSH_KEY:-}" ]; then
  SCP_OPTS+=(-i "$SUN_DEPLOY_SSH_KEY")
fi

if [ "$SSH_USER" = "root" ] && [ "${SUN_DEPLOY_ALLOW_ROOT:-0}" != "1" ]; then
  echo "Refusing root deploy user. Set SUN_DEPLOY_ALLOW_ROOT=1 to explicitly allow root deploy." >&2
  exit 1
fi

USE_PUTTY_PASSWORD=0
if [ -n "${SUN_DEPLOY_SSH_PASSWORD:-}" ]; then
  if command -v plink.exe >/dev/null 2>&1 && command -v pscp.exe >/dev/null 2>&1; then
    USE_PUTTY_PASSWORD=1
  else
    echo "SUN_DEPLOY_SSH_PASSWORD is set, but plink.exe/pscp.exe were not found. Use SUN_DEPLOY_SSH_KEY instead." >&2
    exit 1
  fi
fi

run_ssh() {
  local remote_command="$1"

  if [ "$USE_PUTTY_PASSWORD" = "1" ]; then
    plink.exe -ssh -P "$SSH_PORT" -batch -pw "$SUN_DEPLOY_SSH_PASSWORD" "$SSH_USER@$SSH_HOST" "$remote_command"
    return
  fi

  ssh "${SSH_OPTS[@]}" "$SSH_USER@$SSH_HOST" "$remote_command"
}

upload_file() {
  local local_path="$1"
  local remote_path="$2"

  if [ "$USE_PUTTY_PASSWORD" = "1" ]; then
    if command -v cygpath >/dev/null 2>&1; then
      local_path="$(cygpath -w "$local_path")"
    fi
    pscp.exe -P "$SSH_PORT" -batch -pw "$SUN_DEPLOY_SSH_PASSWORD" "$local_path" "$SSH_USER@$SSH_HOST:$remote_path"
    return
  fi

  scp "${SCP_OPTS[@]}" "$local_path" "$SSH_USER@$SSH_HOST:$remote_path"
}

cd "$REPO_ROOT"
SHA=$(git rev-parse HEAD)
REMOTE_DEPLOY_SCRIPT="/srv/sunmessenger/shared/deploy_release.sh"
LOCAL_DEPLOY_SCRIPT="/tmp/deploy_release_${SHA}.sh"
LOCAL_ARCHIVE="/tmp/release_${SHA}.tar.gz"
REMOTE_ARTIFACT_DIR="/srv/sunmessenger/artifacts/$SHA"
trap 'rm -f "$LOCAL_DEPLOY_SCRIPT" "$LOCAL_ARCHIVE"' EXIT
echo "SHA: $SHA"

tr -d '\r' < deploy/scripts/deploy_release.sh > "$LOCAL_DEPLOY_SCRIPT"

echo "Building archive..."
tar -czf "$LOCAL_ARCHIVE" \
  --exclude=.git \
  --exclude=.github \
  --exclude=.venv \
  --exclude=.pytest_cache \
  --exclude=.ruff_cache \
  --exclude=.runtime \
  --exclude=.tmp_* \
  --exclude='storage/backups' \
  --exclude='storage/chat_media' \
  --exclude=release.tar.gz \
  .
echo "Archive built."

echo "Creating remote directories..."
run_ssh "mkdir -p '$REMOTE_ARTIFACT_DIR' /srv/sunmessenger/shared"

echo "Uploading archive..."
upload_file "$LOCAL_ARCHIVE" "$REMOTE_ARTIFACT_DIR/release.tar.gz"

echo "Uploading deploy script..."
upload_file "$LOCAL_DEPLOY_SCRIPT" "$REMOTE_DEPLOY_SCRIPT"

echo "Running deploy..."
run_ssh "chmod +x $REMOTE_DEPLOY_SCRIPT && $REMOTE_DEPLOY_SCRIPT $SHA $DEPLOY_ENV"

echo "DEPLOY DONE"
