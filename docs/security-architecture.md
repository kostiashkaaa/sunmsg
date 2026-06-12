# Security & Architecture

This document describes the architecture of SUN Messenger and the security
controls built into it. It is written for contributors, auditors, and operators
who self-host the service.

> **Honest status note.** SUN Messenger is under active development. Where a
> control is partially implemented or in transition, this document says so
> explicitly. The end-to-end encryption stack in particular has two generations
> living side by side (see [End-to-End Encryption](#end-to-end-encryption)).

---

## 1. System architecture

### 1.1 Components

```
                    ┌─────────────────────────────────────────┐
   Browser  ─────▶  │  Flask app (gunicorn, multi-worker)      │
   (vanilla JS)     │   ├─ HTTP routes      (app/routes/)      │
        ▲           │   ├─ SocketIO handlers (app/sockets/)    │
        │           │   └─ Services         (app/services/)    │
        │ WebSocket  └───────┬──────────────┬──────────────────┘
        │                    │              │
        ▼                    ▼              ▼
   mediasoup SFU        PostgreSQL 16     Redis
   (voice/video)        (durable state)   (presence, rate
                                           limits, SocketIO
                                           message queue)
```

- **Flask + Flask-SocketIO** serve both the HTTP API and the real-time channel.
- **PostgreSQL 16** is the single source of durable truth. Schema and migrations
  are managed by a custom in-Python migration system (`app/db/migrations.py`).
- **Redis** backs three independent concerns: user presence, rate-limit
  counters, and the SocketIO message queue that lets multiple gunicorn workers
  broadcast to each other. In production all three are **required** — the app
  refuses to boot otherwise (see §2.1).
- **mediasoup** is a separate Node SFU (`server-mediasoup/`) used for voice and
  video calls.

### 1.2 Real-time message flow

```
client emits event
   → app/sockets/events/<handler>
      → rate-limit + authorization checks
         → service layer (business logic)
            → PostgreSQL write
               → broadcast to recipients via Redis message queue
```

The core handler lives in `app/sockets/message_handlers.py`. No client message
is broadcast before it has passed authorization and rate-limit checks.

### 1.3 Runtime modes

`manage.py` is the single entry point for every runtime mode:

| Command | Role |
|---|---|
| `python manage.py web` | HTTP + SocketIO server |
| `python manage.py scheduler` | APScheduler background jobs |
| `python manage.py moderation-worker` | async moderation report worker |
| `python manage.py maintenance` | apply schema migrations |
| `python manage.py security-check` | validate production security settings |

---

## 2. Production hardening

### 2.1 Fail-closed boot checks

`app/bootstrap/security.py` enforces invariants at startup. In production the app
**raises and refuses to start** if:

- `REDIS_URL`, `RATELIMIT_STORAGE_URI`, or `SOCKETIO_MESSAGE_QUEUE` are unset or
  do not point at Redis — preventing a silent fallback to in-process state that
  would break multi-worker correctness and rate limiting.
- `SECRET_KEY` is missing, shorter than 32 bytes, or matches a known weak default
  (`change-me`, etc.).
- `CORS_ORIGINS` is left as a wildcard.

`python manage.py security-check` runs the same validation on demand so operators
can verify a deployment before going live.

### 2.2 Content Security Policy

`app/bootstrap/csp.py` emits a per-response CSP with a per-request nonce for
scripts. Notable properties:

- `script-src 'self' 'nonce-…'` — no `unsafe-inline` for scripts.
- `frame-ancestors 'none'` by default (clickjacking protection); relaxed only for
  the explicit settings-embed flow.
- `connect-src` is allow-listed to `'self'`, the WebSocket origin, and a small set
  of named third-party APIs (weather/geocoding). `ws://` is permitted only outside
  production; production is `wss://` only.
- In production, `style-src 'unsafe-inline'` is expected to be **off**
  (`CSP_STYLE_UNSAFE_INLINE=false`); if it is somehow active, the app logs a
  warning rather than failing silently.

Behind a reverse proxy, `ProxyFix` is applied so client IPs and scheme are read
from the correct forwarded headers (important for rate limiting and HTTPS
enforcement).

---

## 3. Authentication

Authentication is session-based with multiple optional second factors.

- **Sessions** — server-side session cookies.
- **TOTP 2FA** — RFC 6238 time-based one-time passwords (`pyotp`). TOTP secrets
  and backup codes are stored through dedicated stores
  (`app/services/totp_secret_store.py`, `totp_backup_codes.py`) rather than inline
  in user rows.
- **WebAuthn / FIDO2** — passkey registration and assertion
  (`app/routes/auth/routes_passkeys.py`), allowing hardware-backed, phishing-
  resistant login.

Account lifecycle, session management, key transfer between devices, and key
rotation each have their own route modules under `app/routes/auth/`, keeping the
auth surface explicit and auditable.

---

## 4. End-to-End Encryption

This is the most important section to read carefully, because **two encryption
generations currently coexist** in the codebase.

### 4.1 Legacy stack (currently active)

The path that is wired into the live chat runtime today is RSA-based
(`static/crypto.js`, `app/services/crypto.py`):

- RSA-2048 key pairs per user; a symmetric AES key per message, RSA-wrapped to the
  recipient.
- Private keys never leave the browser in plaintext: on the client they are
  wrapped by a non-extractable AES-GCM device key held in IndexedDB
  (`static/device-key.js`).
- The server stores and relays only public keys and ciphertext.

**Known limitation:** RSA message wrapping does not provide forward secrecy or
post-compromise security. That is the motivation for the v3 stack below.

### 4.2 v3 stack (X3DH + Double Ratchet + MLS) — in progress

A modern stack is implemented in the client (`static/crypto-v2.js`,
`static/double-ratchet.js`, `static/mls-client.js`) with server-side key
management at `app/routes/crypto_v2_routes.py` (`/api/crypto/*`):

- **X3DH** for asynchronous initial key agreement (X25519 + Ed25519), with signed
  prekeys and one-time prekeys. One-time prekeys are claimed atomically so they
  are never handed to two parties.
- **Double Ratchet** for per-message forward secrecy in 1:1 chats.
- **MLS (RFC 9420)** key packages for group messaging.
- Key publication is protected by an Ed25519 challenge signature, so a user can
  only publish keys they hold the private half of.

**Current state — read before relying on this.** The v3 primitives are
implemented and unit-tested for the X3DH round trip, but the stack is **not yet
fully wired into the live send/receive path**: the chat runtime still falls back
to the legacy RSA path. A security audit (internal, 2026-05-28) catalogued the
remaining gaps, and the following hardening has already shipped:

- Messages whose signature cannot be verified against a *known* sender key are
  surfaced to the user with an explicit "unverified" marker rather than being
  shown as trusted (`UNVERIFIED_SIGNATURE_MARKER` in `static/crypto.js`).
- An unexpected downgrade from Double Ratchet/MLS back to RSA raises a visible
  "downgraded" status in the UI (`static/modules/e2ee-status-ui.js`) instead of
  failing silently.

Work still in progress before v3 can be made the default: aligning the
encrypt/runtime contract, verifying signed-prekey signatures on the initiator,
binding X3DH session setup to the first message, encrypting Double Ratchet session
state before it is persisted server-side, and rotating X25519/Ed25519 prekeys
(not just the RSA key).

> **Bottom line for operators and auditors:** treat the deployed E2E guarantee as
> *confidentiality against the server and passive network observers via RSA
> wrapping*, **not** as full Signal-style forward secrecy yet. The forward-secrecy
> stack exists in the tree and is being brought online incrementally.

---

## 5. Abuse resistance & rate limiting

Abuse protection is layered and account-age aware ("trust ramp"): brand-new
accounts get tighter limits that relax as the account demonstrates legitimate use
(confirmed contacts, inbound repliers).

- **HTTP rate limiting** via Flask-Limiter, backed by Redis
  (`RATELIMIT_STORAGE_URI`).
- **SocketIO rate limiting** (`app/sockets/rate_limit.py`) with separate limits
  for connection rate per IP, connections per user, global event rate, send burst,
  per-conversation send rate, media uploads, and messages to unknown recipients.
  New-account variants of each limit are stricter.
- **Trust-ramp signals** (`app/services/abuse_protection.py`,
  `app/routes/trust_limits.py`) gate sensitive actions — contact requests,
  starting public chats, group creation/mutation, avatar and media uploads — all
  tunable via `TRUST_RAMP_*` environment variables.

The relevant knobs are documented inline in `.env.example`.

---

## 6. Moderation

- An **async moderation worker** (`python manage.py moderation-worker`) processes
  abuse reports off the request path.
- **Role-based access control** governs who can act on reports
  (`python manage.py moderation-rbac --action list|grant|revoke`).
- Group-level authorization is centralized in
  `app/services/group_authorization.py` so membership and permission checks are not
  duplicated across handlers.

---

## 7. Data layer & integrity

- **Custom migration system** (`app/db/migrations.py`) applies ordered, in-Python
  migrations against the live schema via `python manage.py maintenance`.
- **Integrity verification** (`app/db/integrity.py`) can validate the database
  without migrating (`python manage.py maintenance --integrity-only`).
- **Backup/restore** is first-class: `--backup-dir` takes a `pg_dump` before
  migrating, and `--restore-from` restores one. Always back up before migrating in
  production.
- **Connection pooling** (`app/db/connection.py`) is bounded; the service logs a
  warning at >80% pool utilization and emits an error (plus a Sentry event) on
  exhaustion. Pool metrics are exposed at `/ready`.
- **SQL identifier safety** (`app/db/sql_ident.py`) centralizes quoting of dynamic
  identifiers such as the optional schema override.

---

## 8. Reporting a vulnerability

If you find a security issue, please report it privately to the maintainer rather
than opening a public issue. Include reproduction steps and the affected
component (route, socket handler, or client module) where possible.

---

*This document reflects the state of the codebase as of its last update and is
maintained alongside the code. When a security control changes, update this file
in the same change.*
