# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Running the App
```bash
python manage.py web          # Start the web server
python manage.py scheduler    # Run background scheduler jobs
python manage.py maintenance  # Apply schema migrations
```

### Testing & Linting
```bash
pytest -q                     # Run full test suite
pytest -q tests/test_auth_http.py  # Run a single test file
ruff check .                  # Lint
```

### Database Maintenance
```bash
python manage.py maintenance --backup-dir <path>          # Backup + migrate
python manage.py maintenance --restore-from <backup.dump> # Restore pg_dump
python manage.py maintenance --integrity-only             # Verify DB without migrating
```

### Other CLI Subcommands
```bash
python manage.py security-check          # Validate production security settings
python manage.py moderation-worker       # Run async moderation report worker
python manage.py moderation-rbac --action list|grant|revoke --user-id <id> --role <role>
python manage.py pip-audit               # Audit production dependencies
```

### Pytest Configuration
- Config: `pyproject.toml` (`[tool.pytest.ini_options]`) — tests live in `tests/`, flags: `-ra -p no:asyncio -p no:anyio`
- Test DB setup: `tests/_pg_test_db.py`, fixtures in `tests/conftest.py`

## Architecture

### Stack
- **Backend**: Flask 3.1, Flask-SocketIO 5.6 (real-time), APScheduler (background jobs)
- **Database**: PostgreSQL 16 with a custom Python migration system (`app/db/migrations.py`)
- **Cache / Queue**: Redis — used for rate limiting, user presence, and SocketIO message queue
- **Auth**: Session-based with optional TOTP 2FA and WebAuthn/FIDO2
- **Frontend**: Vanilla JS + Jinja2 templates (no build step — assets are plain `.js`/`.css`)

### Key Entry Points
| File | Purpose |
|---|---|
| `manage.py` | CLI entry point for all runtime modes |
| `wsgi.py` | WSGI entry for gunicorn |
| `app/__init__.py` | Flask app factory |
| `app/config.py` | All configuration classes (Dev / Testing / Production) |
| `app/extensions.py` | Flask extension initialization (Limiter, SocketIO) |

### Backend Layout
- **`app/routes/`** — HTTP blueprint endpoints (auth, contacts, chat, moderation, support)
- **`app/sockets/`** — SocketIO event handlers; `message_handlers.py` is the core (~70 KB)
- **`app/services/`** — Business logic modules (chat history, media, presence, moderation worker, scheduler runtime, etc.)
- **`app/db/`** — Database layer: `schema.py` (table definitions), `migrations.py`, `connection.py` (pooling), `integrity.py`

### Frontend Layout
Static assets in `static/` are loaded directly — no bundler:
- `bootstrap.js` — App initialization and early boot
- `chat-runtime.js` — Core chat logic (~157 KB, the main frontend file)
- `chat-appearance.js` — Theming
- `i18n-runtime.js` — Localization runtime
- `crypto.js` — Client-side encryption helpers

Templates in `templates/` are Jinja2. `chat.html` is the main app shell; `_client_preferences_early_boot.html` injects user preferences before first paint.

### Real-Time Model
SocketIO events flow: client → `app/sockets/events/` handler → service layer → DB → broadcast back. The SocketIO message queue (Redis) is required in production for multi-worker deployments; without it, the app falls back to in-process threading mode (warned at startup).

### Database Migrations
Migrations are applied by `python manage.py maintenance`. The migration system is in `app/db/migrations.py` and runs in-order Python functions against the live schema. Always take a backup before migrating in production (`--backup-dir`).

### Configuration
Environment variables are loaded via `.env` (see `.env.example`). Key groups:
- `DATABASE_URL` / `TEST_DATABASE_URL` — PostgreSQL connections
- `REDIS_URL` — Redis connection
- `SECRET_KEY`, `FORCE_HTTPS`, `CORS_ORIGINS` — Security
- `SOCKETIO_*` — WebSocket tuning (async mode, timeouts, buffer sizes)
- `VAPID_*` — Web push notification keys

### Deployment
- **Staging**: auto-deploys on push to `main` via GitHub Actions (`.github/workflows/deploy.yml`)
- **Production**: deploys on `v*` git tags
- The deploy script builds `release.tar.gz` and runs it on the server over SSH; migrations run as part of the deploy
- Required secrets: `SSH_HOST`, `SSH_USER`, `SSH_KEY`
