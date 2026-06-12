# Security Policy

SUN Messenger is a security-focused, end-to-end encrypted messenger. Security
reports are taken seriously and handled with priority.

## Supported versions

The project is under active development. Security fixes are applied to the latest
`main` and the most recent tagged release. There is no long-term support for older
tags at this time.

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues,
discussions, or pull requests.**

Instead, report privately through one of:

- **GitHub Security Advisories** — use the
  [private vulnerability reporting](https://github.com/kostiashkaaa/sunmsg/security/advisories/new)
  flow on this repository (preferred), or
- **Email** — `shulgakonstantinkrd@gmail.com`

Please include as much of the following as you can:

- A description of the vulnerability and its impact.
- The affected component — HTTP route (`app/routes/`), socket handler
  (`app/sockets/`), service (`app/services/`), or client module (`static/`).
- Step-by-step reproduction instructions, and a proof of concept if available.
- Any relevant configuration (e.g. dev vs. production, whether Redis was present).
- Your assessment of severity, if you have one.

## What to expect

- **Acknowledgement** of your report as soon as possible after it is received.
- An initial assessment and, where confirmed, a plan and rough timeline for a fix.
- Coordination with you on disclosure timing. Please give a reasonable window to
  ship a fix before any public disclosure.
- Credit for the report, if you would like it (let us know how you wish to be
  named).

## Scope

In scope:

- The Flask web application and its HTTP / SocketIO surface.
- The end-to-end encryption implementation (client `static/` and server
  `app/routes/crypto_v2_routes.py`, `app/services/crypto.py`).
- Authentication, session handling, 2FA/WebAuthn, and key management.
- Abuse-resistance / rate-limiting controls.
- The mediasoup call server (`server-mediasoup/`).

Out of scope:

- Vulnerabilities in third-party dependencies that are already publicly known —
  please report those upstream (though feel free to flag if the project pins a
  vulnerable version; `python manage.py pip-audit` is available).
- Issues that require a misconfigured deployment that contradicts the documented
  production guidance in [`docs/security-architecture.md`](docs/security-architecture.md)
  and [`docs/production-deployment.md`](docs/production-deployment.md)
  (e.g. running without Redis, with a weak `SECRET_KEY`, or with wildcard CORS —
  all of which the app already refuses or warns about at boot).
- Social engineering, physical attacks, and denial-of-service via raw traffic
  volume.

## Encryption status

Please read the
[End-to-End Encryption section](docs/security-architecture.md#4-end-to-end-encryption)
of the security architecture doc before reporting crypto issues. It documents
exactly which encryption stack is currently active and which parts of the modern
forward-secrecy stack are still being wired in, so reports can target the right
generation of the code.

---

Thank you for helping keep SUN Messenger and its users safe.
