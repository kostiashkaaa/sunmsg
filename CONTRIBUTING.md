# Contributing to SUN Messenger

Thanks for your interest in contributing! SUN Messenger is a security-focused,
self-hostable messenger, so contributions are held to a high bar for correctness
and security — but the project is glad to have help.

This guide covers how to get a development environment running, the conventions
the codebase follows, and what to expect from review.

---

## Code of conduct

Be respectful and constructive. Assume good faith. Harassment of any kind is not
welcome.

---

## Getting started

### Prerequisites

- Python 3.11+
- PostgreSQL 16
- Redis (optional in development, required to exercise multi-worker / rate-limit
  behavior)
- Node.js (only if you touch the mediasoup call server in `server-mediasoup/`)

### Set up a dev environment

```bash
# Clone and enter the repo
git clone https://github.com/kostiashkaaa/sunmsg.git
cd sunmsg

# Create a virtualenv and install dependencies
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
pip install -r requirements-dev.txt

# Configure environment
cp .env.example .env               # edit DATABASE_URL, SECRET_KEY, etc.

# Apply migrations and run
python manage.py maintenance
python manage.py web
```

For the different runtime modes (scheduler, moderation worker, maintenance), see
[`docs/runtime-modes.md`](docs/runtime-modes.md).

---

## Development workflow

1. **Open an issue first** for anything non-trivial, so the approach can be
   discussed before you write code. For security-sensitive changes, see
   [SECURITY.md](SECURITY.md) — do **not** open a public issue for a vulnerability.
2. **Create a branch** off `main`.
3. **Make focused changes.** One logical change per pull request. Keep diffs small
   and reviewable.
4. **Add or update tests** for the behavior you change (see below).
5. **Run the checks** locally (see below) before pushing.
6. **Open a pull request** with a clear description of what changed and why.

> Note: `main` auto-deploys to staging via GitHub Actions, and `v*` tags deploy to
> production. Treat `main` as always-releasable.

---

## Testing & linting

All of these must pass before a PR is merged:

```bash
pytest -q                  # full test suite
pytest -q tests/test_auth_http.py   # a single file, while iterating
ruff check .               # lint
```

- Tests live in `tests/`; configuration is in `pytest.ini`.
- The test database is PostgreSQL — setup lives in `tests/_pg_test_db.py`, and
  fixtures in `tests/conftest.py`.
- A `.pre-commit-config.yaml` is provided; install it with `pre-commit install` to
  run lint checks automatically on commit.

If you change anything in the security or encryption surface, **add a test that
demonstrates the new behavior**. Crypto-related tests live alongside the rest of
the suite (e.g. `tests/test_crypto_js_runtime.py`,
`tests/test_crypto_v2_js_runtime.py`).

---

## Code conventions

- **Backend** is Flask. HTTP endpoints live in `app/routes/`, real-time handlers
  in `app/sockets/`, and business logic in `app/services/`. Keep route/handler
  code thin and push logic into services.
- **Frontend** is vanilla JavaScript with Jinja2 templates — **there is no build
  step**. Assets in `static/` are served directly. Don't introduce a bundler or a
  transpile step without discussion.
- **Match the surrounding style.** Mirror the naming, structure, and comment
  density of the file you are editing rather than imposing a new style.
- **Database changes go through migrations** (`app/db/migrations.py`), never by
  editing the live schema by hand. Take a backup before migrating in production.
- **Security checks should fail closed.** New configuration that affects security
  should be validated at boot where appropriate (see `app/bootstrap/security.py`)
  rather than failing silently at runtime.

---

## Pull request checklist

Before requesting review, confirm:

- [ ] `pytest -q` passes
- [ ] `ruff check .` is clean
- [ ] New/changed behavior is covered by tests
- [ ] Security-sensitive changes are called out explicitly in the PR description
- [ ] The change is focused (one logical change)
- [ ] Docs are updated if behavior or configuration changed
      (`README.md`, `docs/`, `.env.example`)

---

## Architecture & security context

Before working on auth, encryption, rate limiting, or the data layer, please read
[`docs/security-architecture.md`](docs/security-architecture.md). It explains the
threat model and the current state of the end-to-end encryption migration, which
is essential context for not regressing a security property by accident.

---

Thank you for helping make SUN Messenger better and safer.
