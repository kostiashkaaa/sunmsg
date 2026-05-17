#!/usr/bin/env bash
set -e

SSH_HOST="${SUN_DEPLOY_SSH_HOST:?Set SUN_DEPLOY_SSH_HOST}"
SSH_PORT="${SUN_DEPLOY_SSH_PORT:-22}"
SSH_USER="${SUN_DEPLOY_SSH_USER:?Set SUN_DEPLOY_SSH_USER}"
DEPLOY_ENV="${1:-staging}"
SSH_OPTS=(-p "$SSH_PORT" -o StrictHostKeyChecking=yes)

if [ "$SSH_USER" = "root" ]; then
  echo "Refusing root deploy user. Set SUN_DEPLOY_SSH_USER to an unprivileged deploy account." >&2
  exit 1
fi

cd /d/SUNmessenger
SHA=$(git rev-parse HEAD)
echo "SHA: $SHA"

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

echo "Uploading archive..."
scp -P "$SSH_PORT" -o StrictHostKeyChecking=yes /tmp/release.tar.gz "$SSH_USER@$SSH_HOST:/srv/sunmessenger/artifacts/$SHA/release.tar.gz"

echo "Uploading deploy script..."
scp -P "$SSH_PORT" -o StrictHostKeyChecking=yes deploy/scripts/deploy_release.sh "$SSH_USER@$SSH_HOST:/srv/sunmessenger/shared/deploy_release.sh"

echo "Running deploy..."
ssh "${SSH_OPTS[@]}" "$SSH_USER@$SSH_HOST" \
  "chmod +x /srv/sunmessenger/shared/deploy_release.sh && /srv/sunmessenger/shared/deploy_release.sh $SHA $DEPLOY_ENV"

echo "DEPLOY DONE"
