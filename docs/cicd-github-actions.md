# CI/CD with GitHub Actions

This project uses two workflows:

- `.github/workflows/ci.yml`
- `.github/workflows/deploy.yml`

## CI

CI runs on pull requests and pushes to `main`:

1. install `requirements-dev.txt`
2. run `ruff check .`
3. run `pytest -q`
4. run `python manage.py pip-audit --requirements requirements-production.txt`

## CD

Deploy runs on:

- push to `main` (staging)
- tag `v*` (production)
- manual `workflow_dispatch`

The workflow:

1. builds `release.tar.gz`
2. uploads archive to `/srv/sunmessenger/artifacts/<sha>/release.tar.gz`
3. uploads `deploy/scripts/deploy_release.sh` to `/srv/sunmessenger/shared/deploy_release.sh`
4. runs deploy script over SSH

## Required GitHub Secrets

Add repository secrets:

- `SSH_HOST`
- `SSH_USER`
- `SSH_KEY`
- `SSH_PORT` (optional, defaults to `22`)

## One-time server preparation

Run once on server:

```bash
sudo mkdir -p /srv/sunmessenger/{releases,artifacts,shared/backups}
sudo chown -R sunmessenger:sunmessenger /srv/sunmessenger
```

Ensure services exist and are enabled:

- `sunmessenger-web.service`
- `sunmessenger-scheduler.service`

Ensure production dependencies are installed and available in `PATH`:

- `pg_dump`
- `pg_restore`
- `clamscan`

## Release flow

For regular updates:

```bash
git push origin main
```

For production release:

```bash
git tag v1.0.1
git push origin v1.0.1
```
