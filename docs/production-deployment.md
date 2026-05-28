# Production Deployment

Reference production layout for `SUN Messenger`:

- `nginx` as the reverse proxy and TLS terminator
- `gunicorn` serving `wsgi:app`
- `redis` for:
  - presence state
  - Flask-Limiter storage
  - Flask-SocketIO message queue
- separate processes for:
  - `web`
  - `scheduler`
  - `maintenance`
  - `sun-mediasoup` (optional SFU for server-routed calls)

## Environment

Production `.env` should explicitly keep these values:

```env
APP_ENV=production
APP_DEBUG=0
SECRET_KEY=replace-with-64-bytes-random-secret

DATABASE_URL=postgresql://sunmessenger:password@127.0.0.1:5432/sunmessenger
DATABASE_BACKUP_DIR=/srv/sunmessenger/shared/backups

REDIS_URL=redis://127.0.0.1:6379/0
RATELIMIT_STORAGE_URI=redis://127.0.0.1:6379/1
SOCKETIO_MESSAGE_QUEUE=redis://127.0.0.1:6379/2

SOCKETIO_CORS_ORIGINS=https://sunmessenger.ru,https://www.sunmessenger.ru
LOG_FORMAT=json
METRICS_TOKEN=<prometheus-bearer-token>
REDIS_QUEUE_METRIC_KEYS=sunmessenger:queue:*

RUN_MIGRATIONS_ON_STARTUP=0
START_SCHEDULER_IN_WEB=0
ALLOW_EMBEDDED_WEB_SERVER=0
ALLOW_UNSAFE_WERKZEUG=0
FORCE_HTTPS=1
SESSION_COOKIE_SECURE=1

PROXY_FIX_X_FOR=1
PROXY_FIX_X_PROTO=1

CHAT_MEDIA_AV_SCAN_ENABLED=1
CHAT_MEDIA_AV_FAIL_CLOSED=1
CHAT_MEDIA_AV_TIMEOUT_SECONDS=20
CHAT_MEDIA_AV_COMMAND=clamdscan --fdpass --no-summary {path} || clamscan --no-summary --infected --stdout {path}
CHAT_MEDIA_AV_SCAN_EXTENSIONS=zip,rar,7z
WEB_PUSH_ENABLED=1
WEB_PUSH_VAPID_PUBLIC_KEY=<base64url-public-key>
WEB_PUSH_VAPID_PRIVATE_KEY=<base64url-private-key>
WEB_PUSH_VAPID_SUBJECT=mailto:ops@sunmessenger.ru
```

If `RATELIMIT_STORAGE_URI` or `SOCKETIO_MESSAGE_QUEUE` are omitted, the app now derives them from `REDIS_URL`. Separate Redis DB numbers are still preferable in production.

Install and expose these system tools before running production maintenance:

```bash
sudo apt-get install -y postgresql-client clamav clamav-daemon
which pg_dump pg_restore clamdscan clamscan
```

If they are not on `PATH`, set `PG_DUMP_PATH`, `PG_RESTORE_PATH`, or `CHAT_MEDIA_AV_COMMAND` with absolute executable paths.

## Roles

Run each role independently:

1. `/srv/sunmessenger/current/.venv/bin/python manage.py maintenance`
2. `/srv/sunmessenger/current/.venv/bin/gunicorn --worker-class gthread --workers 2 --threads 8 --bind 127.0.0.1:8000 wsgi:app`
3. `/srv/sunmessenger/current/.venv/bin/python manage.py scheduler`

The web role now refuses to start in production through the embedded `socketio.run(...)` server unless `ALLOW_EMBEDDED_WEB_SERVER=1` is set explicitly.

Each deploy creates a release-local `.venv` under `/srv/sunmessenger/releases/<sha>/.venv`. Rolling back the `current` symlink therefore rolls back both code and Python dependencies.

## Observability

`/ready` checks PostgreSQL and Redis before traffic is considered safe. `/metrics` exports Prometheus text for:

- HTTP request counts, 5xx rate inputs, and handler latency.
- Socket.IO event counts and handler latency.
- Redis up/keyspace/pubsub/optional queue lengths from `REDIS_QUEUE_METRIC_KEYS`.
- DB pool saturation and moderation job backlog.

Set `METRICS_TOKEN` and scrape with `Authorization: Bearer <token>`. Reference alert rules live in `deploy/prometheus/sunmessenger-alerts.yml`.

## Maintenance Operations

Recommended commands:

1. `python manage.py security-check --env production`
2. `python manage.py maintenance --env production --backup-dir /srv/sunmessenger/shared/backups`
3. `python manage.py maintenance --env production --integrity-only`

`maintenance` creates a `pg_dump --format=custom` backup before migrations when `DATABASE_BACKUP_DIR` or `--backup-dir` is set. Restore uses `pg_restore`:

```bash
python manage.py maintenance --env production --restore-from /srv/sunmessenger/shared/backups/<backup>.dump --no-backup --integrity-only
```

`security-check` validates production fail-fast constraints, Redis-backed realtime settings, AV command availability, and PostgreSQL backup tooling when `DATABASE_BACKUP_DIR` is configured.

## Optional mediasoup SFU

The mediasoup Node service runs from the same release symlink as the Flask app:

1. Install Node.js 18+ and npm on the server.
2. Copy `deploy/env.mediasoup.example` to `/srv/sunmessenger/shared/.env.mediasoup`.
3. Set a strong `MEDIASOUP_API_SECRET` and the public `MEDIASOUP_ANNOUNCED_IP`.
4. Open the configured UDP RTP range, default `40000-49999`.
5. Install and enable `deploy/systemd/sun-mediasoup.service`.

When `sun-mediasoup.service` is installed, `deploy_release.sh` installs `server-mediasoup` npm dependencies for the new release and restarts the service after the `current` symlink is switched.

## Reference Files

Sample deployment files:

- [nginx config](../deploy/nginx/sunmessenger.conf)
- [web systemd unit](../deploy/systemd/sunmessenger-web.service)
- [scheduler systemd unit](../deploy/systemd/sunmessenger-scheduler.service)
- [maintenance systemd unit](../deploy/systemd/sunmessenger-maintenance.service)
- [mediasoup systemd unit](../deploy/systemd/sun-mediasoup.service)
- [PostgreSQL migration plan](./postgresql-migration-plan.md)
