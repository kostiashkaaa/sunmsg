# iOS App Development Plan

This document maps the current Sunmsg web backend to a native iOS MVP. It is based on the existing Flask, Socket.IO, browser crypto, media, and push code in this repository.

## Goal

Build a native iOS app that can log in, load chats, send and receive encrypted messages in real time, recover after backgrounding, and later support media and push notifications.

The first iOS version should reuse the current backend behavior where possible. The main backend work is to expose browser bootstrap data as JSON, add APNs support, and make mobile sync explicit.

## Current Backend Fit

### Auth

The app currently uses Flask session cookies, a rotating `refresh_token` cookie, and CSRF protection.

Relevant endpoints:

- `POST /api/get_register_challenge`
- `POST /api/register_client`
- `POST /api/get_challenge`
- `POST /api/login_challenge`
- `POST /api/login_totp`
- `POST /api/refresh`
- `POST /api/logout`
- `GET /api/get_login_vault`
- `GET /api/session_devices`
- `POST /api/session_devices/revoke`
- `POST /api/session_devices/revoke_others`

Current login model:

- Registration generates an RSA-OAEP 2048 key pair in the client.
- The public key is stored on the server.
- The private key is encrypted into `login_vault` with the 24-word mnemonic.
- Login calls `/api/get_challenge`, decrypts the vault locally, signs the challenge with RSASSA-PKCS1-v1_5/SHA-256, then calls `/api/login_challenge`.
- TOTP is a second step via `/api/login_totp` when enabled.
- `/api/refresh` rotates the refresh cookie and returns a fresh CSRF token.

Mobile implications:

- `URLSession` can keep the same cookie model with shared `HTTPCookieStorage`.
- iOS needs a JSON way to get a CSRF token after login and app launch. Today the main source is the HTML meta tag in `templates/chat/_head.html`.
- Login/register success responses should either include `csrf_token`, or the app should immediately call a new mobile bootstrap endpoint that returns one.
- The private key should live in Keychain after the 24-word unlock. The mnemonic itself should not be persisted.

### Chat HTTP

Useful existing endpoints:

- `GET /get_contacts`
- `GET /get_chat_history?chat_id=...&limit=...&before_id=...&after_id=...`
- `GET /api/updates/state?chat_id=...`
- `GET /api/updates/difference?chat_id=...&from_pts=...&limit=...`
- `POST /mark_messages_read`
- `POST /delete_chat`
- `GET /search_users`
- `POST /send_request_by_username`
- `GET /get_dialog_requests`
- `POST /accept_request`
- `POST /decline_request`
- `GET /get_user_profile`
- `GET /api/chats/group/info`

The existing contacts payload already includes most of what iOS needs:

- chat id
- display name and username
- public key
- avatar URL
- unread count
- last message metadata
- group flags
- pinned and draft state
- block state

Gap:

- Contacts do not currently include per-chat `chat_pts`. For efficient app resume, add either chat update state to contacts or a new mobile sync endpoint.

### Socket.IO

Client to server events needed for MVP:

- `join`
- `leave`
- `send_message`
- `messages_seen`
- `typing`
- `stop_typing`

Useful post-MVP events:

- `edit_message`
- `delete_messages`
- `toggle_reaction`
- `pin_message`
- `unpin_message`
- `favorite_message`
- `unfavorite_message`
- `set_chat_auto_delete`

Server to client events needed for MVP:

- `receive_message`
- `message_sent`
- `messages_delivered`
- `messages_read`
- `group_messages_read`
- `partner_typing`
- `partner_stop_typing`
- `user_status`
- `chat_block_state`
- `chat_deleted`
- `chat_created`
- `group_chat_created`
- `group_members_added`
- `group_chat_updated`
- `group_members_updated`
- `dialog_request_updated`
- `new_dialog_request`

Connection details:

- Socket auth requires `{ csrf_token: ... }`.
- Mutating socket payloads also require `csrf_token`.
- Server joins each connection into rooms based on public key and `user_<id>`.
- Per-chat rooms are joined with the `join` event.

Important existing strength:

- Persisted socket events are wrapped with an envelope containing `event_id`, `event_type`, `server_ts`, `chat_id`, and `chat_pts`.
- `/api/updates/difference` can replay missed events after an app resumes from background.

### Media

Relevant endpoints:

- `POST /upload_chat_media`
- `GET /chat_media/<media_id>`
- `POST /upload_avatar`
- `GET /get_avatar`

Current flow:

1. Upload multipart media to `/upload_chat_media`.
2. Server returns a private media URL, MIME, type, name, and size.
3. Client sends a message over Socket.IO whose encrypted body references the media URL.

Media E2EE:

- Browser code encrypts media with AES-GCM before upload.
- The encrypted media key and metadata are put in the URL fragment.
- URL fragments are not sent to the server, so the server stores only encrypted bytes.

Mobile implications:

- iOS can reproduce this model with CryptoKit AES-GCM.
- The server can keep serving media through cookie auth.
- Use a native upload task for progress and cancellation.

### Push

Current push support is Web Push only:

- `GET /api/web_push/public_key`
- `POST /api/web_push/subscribe`
- `POST /api/web_push/unsubscribe`
- `app/services/web_push.py`
- `push_subscriptions` table

iOS native apps need APNs, not Web Push.

Required backend work:

- Add an `apns_device_tokens` table.
- Add `POST /api/mobile/push/register`.
- Add `POST /api/mobile/push/unregister`.
- Add APNs config: team id, key id, bundle id, private key path or secret.
- Send APNs from the same call sites that currently call `send_chat_message_push`.
- Push payload should include `chat_id`, `kind`, and optionally `message_id`, but never plaintext message content unless product policy changes.

### Crypto

MVP-compatible path:

- Implement the current v2 RSA hybrid encryption in Swift.
- AES-GCM encrypts the plaintext.
- RSA-OAEP/SHA-256 encrypts the AES key for recipient and sender.
- RSASSA-PKCS1-v1_5/SHA-256 signs the ciphertext payload.
- Message body sent to the server is the same JSON string the browser sends.

Use:

- `Security.framework` for RSA import, signing, verification, and RSA-OAEP.
- `CryptoKit` for AES-GCM and SHA-256.
- `Keychain` for private key and session-sensitive secrets.

v3 crypto note:

- The repo has X25519, Ed25519, Double Ratchet, and MLS endpoints and browser files.
- Treat v3 as post-MVP until the web implementation has dedicated compatibility tests and the exact payload shape is finalized.

## Backend Work To Add First

### 1. Mobile Bootstrap Endpoint

Add `GET /api/mobile/bootstrap`.

Response should include:

```json
{
  "success": true,
  "csrf_token": "...",
  "user": {
    "id": 123,
    "username": "alice",
    "display_name": "Alice",
    "public_key": "...",
    "avatar_url": "",
    "ui_language": "ru"
  },
  "session": {
    "auto_logout_seconds": 2592000,
    "expires_at": 1234567890
  },
  "socketio": {
    "path": "/socket.io",
    "transports": ["websocket", "polling"],
    "upgrade": true
  },
  "features": {
    "calls": false,
    "groups": true,
    "media": true,
    "push_apns": true
  },
  "contacts": [],
  "has_more_contacts": false
}
```

Implementation can reuse `fetch_chat_page_context`, `build_socketio_client_config`, and `generate_csrf`.

### 2. Mobile Sync Endpoint

Add `GET /api/mobile/sync?since=<cursor>`.

Minimum useful response:

- current user revision data
- contacts changed since cursor
- pending dialog requests
- per-chat latest `chat_pts`
- server time
- next cursor

If that is too much for the first cut, add `GET /api/mobile/chats/update-state` that returns all visible chat ids with their latest `chat_pts`.

### 3. APNs Device Token Support

Add:

- `POST /api/mobile/push/register`
- `POST /api/mobile/push/unregister`
- `app/services/apns.py`
- migration for `apns_device_tokens`

Suggested table fields:

- `id`
- `user_id`
- `device_token_hash`
- `device_token_encrypted` or `device_token`
- `environment`
- `bundle_id`
- `device_name`
- `app_version`
- `is_active`
- `created_at`
- `updated_at`
- `last_success_at`
- `last_failure_at`
- `failure_count`

### 4. Optional HTTP Send Fallback

Socket.IO is enough for the first prototype while the app is foregrounded. A later reliability improvement is:

- `POST /api/chats/<chat_id>/messages`

It should reuse the same persistence logic as `send_message`, accept the same encrypted payload, and return the same `message_sent` payload. This makes outbox retry easier when the app is reconnecting.

## iOS MVP Scope

### In Scope

- Registration with 24-word mnemonic and RSA key generation.
- Login with mnemonic, challenge signing, optional TOTP.
- Session refresh and logout.
- Chat list.
- Message history.
- Real-time receive and send.
- Delivery and read state.
- Basic typing indicator.
- Local SQLite cache.
- App resume sync using `chat_pts`.
- Image/file upload after core messaging works.
- APNs after foreground messaging works.

### Out Of Scope For First Version

- Calls.
- Spotify.
- Full moderation/admin consoles.
- Advanced group administration.
- WebAuthn/passkeys unless explicitly needed for App Store launch.
- v3 Double Ratchet/MLS as the default path.

## iOS Architecture

Recommended stack:

- SwiftUI for UI.
- URLSession with shared cookie storage for HTTP.
- Socket.IO-Client-Swift for realtime.
- Keychain for RSA private key and auth-sensitive state.
- CryptoKit plus Security.framework for encryption.
- SQLite or SwiftData for cached contacts, messages, and sync cursors.
- UserNotifications and APNs for push.

Suggested modules:

- `AuthClient`
- `SessionStore`
- `CryptoService`
- `ChatAPI`
- `RealtimeClient`
- `SyncEngine`
- `MessageStore`
- `MediaService`
- `PushRegistry`

## Milestones

### Phase 0: Backend Contracts

Deliverables:

- Add `/api/mobile/bootstrap`.
- Add all required auth response tests.
- Write a short API contract fixture for login, contacts, history, socket message payloads, and sync.

Exit criteria:

- A Swift client can log in and fetch bootstrap JSON without parsing HTML.

### Phase 1: iOS Read-Only Prototype

Deliverables:

- App shell.
- Login with 24 words.
- Bootstrap fetch.
- Contact list.
- Chat history screen.
- Local Keychain storage for the private key.

Exit criteria:

- A real account can open the app, log in, and read an existing chat.

### Phase 2: Foreground Messaging

Deliverables:

- Socket.IO connect with CSRF.
- Join selected chat.
- Send encrypted text messages.
- Receive `receive_message`.
- Handle `message_sent`, `messages_delivered`, and `messages_read`.
- Send `messages_seen`.

Exit criteria:

- iOS and web can exchange encrypted text messages in real time.

### Phase 3: Resume And Offline Sync

Deliverables:

- Store `chat_pts` per chat.
- On socket gap or app resume, call `/api/updates/difference`.
- Deduplicate by `event_id`.
- Persist messages and pending outbox state locally.

Exit criteria:

- App can be backgrounded, reopened, and catch up without duplicate messages.

### Phase 4: Media

Deliverables:

- Upload media through `/upload_chat_media`.
- Encrypt media bytes before upload.
- Send media message referencing returned URL plus fragment metadata.
- Download and decrypt media for display.

Exit criteria:

- iOS and web can exchange at least images and files.

### Phase 5: APNs

Deliverables:

- APNs token registration endpoints.
- APNs send service.
- Push handling opens the correct chat.
- Resume sync after notification tap.

Exit criteria:

- User receives a notification while the app is closed and lands on the right chat after tapping it.

## Main Risks

1. CSRF/bootstrap is browser-shaped today.
   Fix with `/api/mobile/bootstrap`.

2. Background realtime cannot be relied on in iOS.
   Use Socket.IO only in foreground, APNs plus sync in background.

3. Crypto compatibility must be exact.
   Write test vectors for RSA-OAEP, AES-GCM, challenge signatures, and message JSON before building too much UI.

4. v3 crypto is not the right MVP dependency.
   Start with the current v2 message format for web compatibility.

5. Push requires new server infrastructure.
   Web Push cannot be reused for native APNs.

## Recommended First Implementation Task

Start with the backend `GET /api/mobile/bootstrap` endpoint and tests.

That unlocks a native iOS prototype without scraping `/chat`, keeps the current session model, gives the app a CSRF token for HTTP and Socket.IO, and exposes the exact user and socket config that the browser already consumes.
