# PostgreSQL Runtime Notes

Status: PostgreSQL is the application runtime database.

The production runtime is configured with:

- `DATABASE_URL=postgresql://...`
- `DATABASE_BACKUP_DIR=/srv/sunmessenger/shared/backups`

`DATABASE_PATH` remains only as a per-test isolation key: tests pass a `tmp_path` filename and the harness in `tests/_pg_test_db.py` maps it to a dedicated PostgreSQL schema. Do not use it as a production deployment setting.

## Maintenance

Use the canonical runtime entrypoint:

```bash
python manage.py security-check --env production
python manage.py maintenance --env production --backup-dir /srv/sunmessenger/shared/backups
python manage.py maintenance --env production --integrity-only
```

`maintenance` creates a PostgreSQL custom-format backup through `pg_dump --format=custom` before migrations when `DATABASE_BACKUP_DIR` or `--backup-dir` is configured.

Restore uses `pg_restore`:

```bash
python manage.py maintenance --env production --restore-from /srv/sunmessenger/shared/backups/<backup>.dump --no-backup --integrity-only
```

## Required System Tools

The production host must expose:

- `pg_dump`
- `pg_restore`
- `clamscan`

If they are not on `PATH`, set `PG_DUMP_PATH`, `PG_RESTORE_PATH`, or `CHAT_MEDIA_AV_COMMAND` with absolute executable paths.

## Remaining Hardening

1. Add connection pooling before serious Socket.IO load.
2. Decide WAL retention/RPO policy outside the app-level dump backup.
3. Drop the legacy SQLite-to-PostgreSQL cutover notes from release docs once no SQLite deployment remains.
