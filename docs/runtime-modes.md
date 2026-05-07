# Runtime Modes

`SUN Messenger` now has three explicit runtime modes:

- `python manage.py web`
  Starts only the web application.
- `python manage.py scheduler`
  Starts only background scheduler jobs.
- `python manage.py maintenance`
  Applies schema migrations and one-time maintenance tasks.
- `python manage.py security-check`
  Validates production security settings (CORS, proxy/cookie hardening, Redis backing services, AV command, PostgreSQL backup tooling).

Legacy wrappers still exist only for compatibility:

- `python run_scheduler.py`
- `python run_maintenance.py`

Canonical entrypoint: use `python manage.py ...` for every runtime mode.

Recommended startup order on a fresh database or after schema changes:

1. `python manage.py maintenance`
2. `python manage.py web`
3. `python manage.py scheduler` if background jobs are needed
4. `python manage.py security-check --env production` before restarting web workers

Notes:

- Web startup no longer relies on implicit migrations by default.
- Testing config still enables startup migrations automatically for isolated test databases.
- In production, `web` must not start the scheduler or run migrations on startup.
- In production, do not use the embedded `socketio.run(...)` server. Run `wsgi:app` behind Gunicorn and a reverse proxy.
- `python manage.py maintenance` now performs integrity checks before and after migrations.
- `python manage.py maintenance --backup-dir /srv/sunmessenger/shared/backups` creates a `pg_dump --format=custom` backup before migrations.
- `python manage.py maintenance --restore-from <backup.dump> --no-backup --integrity-only` restores a PostgreSQL custom-format dump with `pg_restore`.
- `python manage.py maintenance --integrity-only` verifies the database without applying migrations.

See [production-deployment.md](./production-deployment.md) for the reference layout.
