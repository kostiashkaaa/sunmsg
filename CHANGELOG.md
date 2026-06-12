# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Pre-release development. What exists so far:

- Real-time messaging over SocketIO (WebSocket with polling fallback) with
  group chats, contacts, presence, typing indicators, reactions, and replies.
- Client-side encryption for direct messages and media (RSA-based legacy
  scheme); an X3DH + Double Ratchet + MLS stack is implemented and being wired
  in — see `docs/security-architecture.md`.
- Voice and video calls via a mediasoup SFU (`server-mediasoup/`).
- Session-based authentication with optional TOTP 2FA and WebAuthn/FIDO2.
- Moderation tooling: async report worker and role-based access control.
- Web push notifications (VAPID) and trust-ramp rate limiting.
- PostgreSQL 16 backend with a custom Python migration system, Redis for rate
  limiting, presence, and the SocketIO message queue.
- CI (lint, tests, dependency audits) and SSH-based staging/production deploys.
