#!/usr/bin/env bash
set -e

SSH_HOST="${SUN_DEPLOY_SSH_HOST:?Set SUN_DEPLOY_SSH_HOST}"
SSH_PORT="${SUN_DEPLOY_SSH_PORT:-22}"
SSH_USER="${SUN_DEPLOY_SSH_USER:?Set SUN_DEPLOY_SSH_USER}"
DEPLOY_ENV="${1:-staging}"
SSH_OPTS=(-p "$SSH_PORT" -o StrictHostKeyChecking=yes)
if [ -n "${SUN_DEPLOY_SSH_KEY:-}" ]; then
  SSH_OPTS+=(-i "$SUN_DEPLOY_SSH_KEY")
fi

if [ "$SSH_USER" = "root" ] && [ "${SUN_DEPLOY_ALLOW_ROOT:-0}" != "1" ]; then
  echo "Refusing root deploy user. Set SUN_DEPLOY_ALLOW_ROOT=1 to explicitly allow root deploy." >&2
  exit 1
fi

cd /d/SUNmessenger
SHA=$(git rev-parse HEAD)
REMOTE_DEPLOY_SCRIPT="/srv/sunmessenger/shared/deploy_release.sh"
LOCAL_DEPLOY_SCRIPT="/tmp/deploy_release_${SHA}.sh"
trap 'rm -f "$LOCAL_DEPLOY_SCRIPT"' EXIT
echo "SHA: $SHA"

tr -d '\r' < deploy/scripts/deploy_release.sh > "$LOCAL_DEPLOY_SCRIPT"

echo "Building archive..."
tar -czf /tmp/release.tar.gz \
  --exclude=.git \
  --exclude=.github \
  --exclude=.venv \
  --exclude=.pytest_cache \
  --exclude=.ruff_cache \
  --exclude=.runtime \
  --exclude='storage/backups' \
  --exclude='storage/chat_media' \
  --exclude=release.tar.gz \
  .
echo "Archive built."

echo "Creating remote directory..."
ssh "${SSH_OPTS[@]}" "$SSH_USER@$SSH_HOST" "mkdir -p /srv/sunmessenger/artifacts/$SHA"

SCP_OPTS=(-P "$SSH_PORT" -o StrictHostKeyChecking=yes)
if [ -n "${SUN_DEPLOY_SSH_KEY:-}" ]; then
  SCP_OPTS+=(-i "$SUN_DEPLOY_SSH_KEY")
fi

echo "Uploading archive..."
scp "${SCP_OPTS[@]}" /tmp/release.tar.gz "$SSH_USER@$SSH_HOST:/srv/sunmessenger/artifacts/$SHA/release.tar.gz"

echo "Uploading deploy script..."
scp "${SCP_OPTS[@]}" "$LOCAL_DEPLOY_SCRIPT" "$SSH_USER@$SSH_HOST:$REMOTE_DEPLOY_SCRIPT"

echo "Running deploy..."
ssh "${SSH_OPTS[@]}" "$SSH_USER@$SSH_HOST" \
  "chmod +x $REMOTE_DEPLOY_SCRIPT && $REMOTE_DEPLOY_SCRIPT $SHA $DEPLOY_ENV"

echo "DEPLOY DONE"
