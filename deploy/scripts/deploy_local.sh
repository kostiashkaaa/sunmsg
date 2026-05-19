#!/usr/bin/env bash
set -Eeuo pipefail

SSH_HOST="${SUN_DEPLOY_SSH_HOST:?Set SUN_DEPLOY_SSH_HOST}"
SSH_PORT="${SUN_DEPLOY_SSH_PORT:-22}"
SSH_USER="${SUN_DEPLOY_SSH_USER:?Set SUN_DEPLOY_SSH_USER}"
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

if [ "$SSH_USER" = "root" ] && [ "${SUN_DEPLOY_ALLOW_ROOT:-0}" != "1" ]; then
  echo "Refusing root deploy user. Set SUN_DEPLOY_ALLOW_ROOT=1 to explicitly allow root deploy." >&2
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
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
ssh "${SSH_OPTS[@]}" "$SSH_USER@$SSH_HOST" "mkdir -p '$REMOTE_ARTIFACT_DIR' /srv/sunmessenger/shared"

SCP_OPTS=(-P "$SSH_PORT" -o StrictHostKeyChecking=yes)
if [ -n "${SUN_DEPLOY_SSH_KEY:-}" ]; then
  SCP_OPTS+=(-i "$SUN_DEPLOY_SSH_KEY")
fi

echo "Uploading archive..."
scp "${SCP_OPTS[@]}" "$LOCAL_ARCHIVE" "$SSH_USER@$SSH_HOST:$REMOTE_ARTIFACT_DIR/release.tar.gz"

echo "Uploading deploy script..."
scp "${SCP_OPTS[@]}" "$LOCAL_DEPLOY_SCRIPT" "$SSH_USER@$SSH_HOST:$REMOTE_DEPLOY_SCRIPT"

echo "Running deploy..."
ssh "${SSH_OPTS[@]}" "$SSH_USER@$SSH_HOST" \
  "chmod +x $REMOTE_DEPLOY_SCRIPT && $REMOTE_DEPLOY_SCRIPT $SHA $DEPLOY_ENV"

echo "DEPLOY DONE"
