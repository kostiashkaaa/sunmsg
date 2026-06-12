# SUN Messenger

Self-hosted, real-time messenger with end-to-end encryption, voice/video calls,
and moderation tooling. Built on Flask + SocketIO with a PostgreSQL backend and a
no-build-step vanilla-JS frontend.

> **Status:** active development. The web app and background services are
> functional; a native iOS client is in progress (see `docs/`).

## Features

- **Real-time messaging** over SocketIO (WebSocket with polling fallback)
- **End-to-end encryption** for direct messages and media
- **Voice & video calls** via a mediasoup SFU (`server-mediasoup/`)
- **Group chats**, contacts, presence, typing indicators, reactions, replies
- **Authentication** — session-based with optional TOTP 2FA and WebAuthn/FIDO2
- **Moderation** — async report worker and role-based access control (RBAC)
- **Web push** notifications (VAPID)
- **Trust-ramp rate limiting** — graduated limits for new accounts to curb abuse
- **Self-hostable** — Docker-free deploy script over SSH, PostgreSQL migrations included

## Stack

| Layer | Technology |
|---|---|
| Backend | Flask 3.1, Flask-SocketIO 5.6, APScheduler |
| Database | PostgreSQL 16 (custom Python migration system) |
| Cache / queue | Redis (rate limiting, presence, SocketIO message queue) |
| Realtime media | mediasoup SFU (Node) |
| Frontend | Vanilla JS + Jinja2 templates (no bundler) |
| Auth | Sessions, TOTP, WebAuthn/FIDO2 |

## Quick start

### Requirements

- Python 3.11+
- PostgreSQL 16
- Redis (optional in dev, **required** in production for multi-worker deploys)
- Node.js (only for the mediasoup call server)

### Setup

```bash
# 1. Create a virtualenv and install dependencies
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# 2. Configure environment
cp .env.example .env             # then edit DATABASE_URL, SECRET_KEY, etc.

# 3. Apply database migrations
python manage.py maintenance

# 4. Run the web server
python manage.py web
```

### Background services

```bash
python manage.py scheduler          # background scheduler jobs
python manage.py moderation-worker  # async moderation report worker
```

## Configuration

All configuration is via environment variables loaded from `.env`
(see [`.env.example`](.env.example)). Key groups:

- `DATABASE_URL` / `TEST_DATABASE_URL` — PostgreSQL connections
- `REDIS_URL` — Redis connection
- `SECRET_KEY`, `FORCE_HTTPS`, `CORS_ORIGINS` — security
- `SOCKETIO_*` — WebSocket tuning
- `VAPID_*` — web push keys

Run `python manage.py security-check` to validate production security settings.

## Testing

```bash
pytest -q          # full test suite
ruff check .       # lint
```

Test database setup lives in `tests/_pg_test_db.py`; fixtures in
`tests/conftest.py`.

## Project layout

```
app/
  routes/      HTTP blueprint endpoints (auth, contacts, chat, moderation)
  sockets/     SocketIO event handlers (message_handlers.py is the core)
  services/    Business logic (chat history, media, presence, moderation)
  db/          Schema, migrations, connection pooling, integrity checks
static/        Frontend JS/CSS (loaded directly, no build step)
templates/     Jinja2 templates (chat.html is the main app shell)
server-mediasoup/  Node SFU for voice/video calls
docs/          Architecture, deployment, and migration notes
```

## Deployment

See [`docs/production-deployment.md`](docs/production-deployment.md). In short:

- **Staging** auto-deploys on push to `main` (GitHub Actions)
- **Production** deploys on `v*` git tags
- The deploy builds `release.tar.gz` and runs it over SSH; migrations run as
  part of the deploy

## Security

See [`docs/security-architecture.md`](docs/security-architecture.md) for the
full security model: authentication (sessions, TOTP, WebAuthn), end-to-end
encryption (and its current transition state), CSP, fail-closed production boot
checks, abuse-resistant rate limiting, and the data-integrity layer.

To report a vulnerability, please contact the maintainer privately rather than
opening a public issue.

## License

[MIT](LICENSE)
