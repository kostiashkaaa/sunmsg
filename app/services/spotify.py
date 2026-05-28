"""Spotify integration service.

Public surface
--------------
get_public_listening_status(conn, viewer_user_id, owner_user_id) -> dict | None
    Called by the profile route. Returns the owner's current track or None.

build_auth_url(client_id, redirect_uri, state) -> str
    Returns the Spotify OAuth authorization URL to redirect the user to.

exchange_code(client_id, client_secret, redirect_uri, code) -> dict
    Exchanges the OAuth code for access + refresh tokens.

save_tokens(conn, user_id, token_data) -> None
    Persists tokens in spotify_tokens.

revoke_tokens(conn, user_id) -> None
    Deletes tokens and clears the now-playing row.

get_connected_user_ids(conn) -> list[int]
    Returns all user_ids that have Spotify connected (for the scheduler).

poll_and_update(conn, user_id, client_id, client_secret) -> dict | None
    Fetches current playback from Spotify API, updates spotify_now_playing,
    and returns the public status payload for realtime broadcast.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import time
import urllib.error
import urllib.parse
import urllib.request

logger = logging.getLogger(__name__)

SPOTIFY_AUTH_BASE = 'https://accounts.spotify.com'
SPOTIFY_API_BASE = 'https://api.spotify.com/v1'
STALE_THRESHOLD_S = 60
_SCOPES = (
    'user-read-currently-playing user-read-playback-state '
    'user-library-modify user-library-read '
    'playlist-read-private playlist-modify-private playlist-modify-public '
    'user-modify-playback-state'
)

VALID_PRIVACY_VALUES = frozenset({'all', 'contacts', 'nobody'})


def _rollback_read_transaction(conn) -> None:
    try:
        conn.rollback()
    except Exception:  # noqa: BLE001
        logger.debug('Spotify read transaction rollback failed', exc_info=True)


# ---------------------------------------------------------------------------
# OAuth helpers
# ---------------------------------------------------------------------------

def build_auth_url(client_id: str, redirect_uri: str, state: str) -> str:
    params = {
        'client_id': client_id,
        'response_type': 'code',
        'redirect_uri': redirect_uri,
        'scope': _SCOPES,
        'state': state,
        'show_dialog': 'false',
    }
    return f'{SPOTIFY_AUTH_BASE}/authorize?' + urllib.parse.urlencode(params)


def exchange_code(client_id: str, client_secret: str, redirect_uri: str, code: str) -> dict:
    """Exchange OAuth code for tokens. Returns the raw token dict from Spotify."""
    data = urllib.parse.urlencode({
        'grant_type': 'authorization_code',
        'code': code,
        'redirect_uri': redirect_uri,
    }).encode()
    return _spotify_token_request(client_id, client_secret, data)


def _refresh_access_token(client_id: str, client_secret: str, refresh_token: str) -> dict:
    data = urllib.parse.urlencode({
        'grant_type': 'refresh_token',
        'refresh_token': refresh_token,
    }).encode()
    return _spotify_token_request(client_id, client_secret, data)


def _spotify_token_request(client_id: str, client_secret: str, body: bytes) -> dict:
    import base64
    import json

    credentials = base64.b64encode(f'{client_id}:{client_secret}'.encode()).decode()
    req = urllib.request.Request(
        f'{SPOTIFY_AUTH_BASE}/api/token',
        data=body,
        headers={
            'Authorization': f'Basic {credentials}',
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode())


# ---------------------------------------------------------------------------
# Token persistence
# ---------------------------------------------------------------------------

def save_tokens(conn, user_id: int, token_data: dict) -> None:
    """Upsert Spotify tokens for a user."""
    expires_in = int(token_data.get('expires_in') or 3600)
    expires_at = int(time.time()) + expires_in - 60
    refresh_token = token_data.get('refresh_token') or ''
    access_token = token_data.get('access_token', '')
    scope = token_data.get('scope') or ''

    cur = conn.cursor()
    if refresh_token:
        cur.execute(
            '''
            INSERT INTO spotify_tokens
                (user_id, access_token, refresh_token, scope, expires_at, updated_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT (user_id) DO UPDATE SET
                access_token = EXCLUDED.access_token,
                refresh_token = EXCLUDED.refresh_token,
                scope        = EXCLUDED.scope,
                expires_at   = EXCLUDED.expires_at,
                updated_at   = CURRENT_TIMESTAMP
            ''',
            (user_id, access_token, refresh_token, scope, expires_at),
        )
    else:
        cur.execute(
            '''
            INSERT INTO spotify_tokens
                (user_id, access_token, refresh_token, scope, expires_at, updated_at)
            VALUES (?, ?,
                COALESCE((SELECT refresh_token FROM spotify_tokens WHERE user_id = ?), ''),
                ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT (user_id) DO UPDATE SET
                access_token = EXCLUDED.access_token,
                scope        = EXCLUDED.scope,
                expires_at   = EXCLUDED.expires_at,
                updated_at   = CURRENT_TIMESTAMP
            ''',
            (user_id, access_token, user_id, scope, expires_at),
        )
    conn.commit()


def revoke_tokens(conn, user_id: int) -> None:
    """Remove Spotify connection for a user."""
    cur = conn.cursor()
    cur.execute('DELETE FROM spotify_tokens WHERE user_id = ?', (user_id,))
    cur.execute('DELETE FROM spotify_now_playing WHERE user_id = ?', (user_id,))
    conn.commit()


def is_connected(conn, user_id: int) -> bool:
    cur = conn.cursor()
    cur.execute(
        'SELECT 1 FROM spotify_tokens WHERE user_id = ? LIMIT 1',
        (user_id,),
    )
    return cur.fetchone() is not None


def get_connected_user_ids(conn) -> list[int]:
    cur = conn.cursor()
    cur.execute('SELECT user_id FROM spotify_tokens ORDER BY user_id')
    return [row['user_id'] for row in cur.fetchall()]


# ---------------------------------------------------------------------------
# Privacy settings
# ---------------------------------------------------------------------------

def get_privacy_settings(conn, user_id: int) -> dict:
    """Return spotify_privacy and hide_explicit for a user."""
    cur = conn.cursor()
    cur.execute(
        'SELECT spotify_privacy, hide_explicit FROM spotify_tokens WHERE user_id = ?',
        (user_id,),
    )
    row = cur.fetchone()
    if row is None:
        return {'spotify_privacy': 'contacts', 'hide_explicit': False}
    privacy = str(row['spotify_privacy'] or 'contacts')
    if privacy not in VALID_PRIVACY_VALUES:
        privacy = 'contacts'
    return {
        'spotify_privacy': privacy,
        'hide_explicit': bool(int(row['hide_explicit'] or 0)),
    }


def update_privacy_settings(conn, user_id: int, spotify_privacy: str, hide_explicit: bool) -> None:
    """Persist privacy settings for the Spotify integration."""
    if spotify_privacy not in VALID_PRIVACY_VALUES:
        spotify_privacy = 'contacts'
    cur = conn.cursor()
    cur.execute(
        '''
        UPDATE spotify_tokens
        SET spotify_privacy = ?, hide_explicit = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
        ''',
        (spotify_privacy, 1 if hide_explicit else 0, user_id),
    )
    conn.commit()


# ---------------------------------------------------------------------------
# Playback polling
# ---------------------------------------------------------------------------

def poll_and_update(conn, user_id: int, client_id: str, client_secret: str) -> dict | None:
    """Fetch current playback from Spotify and upsert spotify_now_playing."""
    cur = conn.cursor()
    cur.execute(
        'SELECT access_token, refresh_token, expires_at FROM spotify_tokens WHERE user_id = ?',
        (user_id,),
    )
    row = cur.fetchone()
    if row is None:
        _rollback_read_transaction(conn)
        return None

    access_token = row['access_token']
    refresh_token = row['refresh_token']
    expires_at = int(row['expires_at'] or 0)
    _rollback_read_transaction(conn)

    if time.time() >= expires_at:
        try:
            token_data = _refresh_access_token(client_id, client_secret, refresh_token)
            save_tokens(conn, user_id, token_data)
            access_token = token_data['access_token']
        except Exception:
            logger.warning('Spotify token refresh failed for user %s', user_id, exc_info=True)
            return None

    playback = _fetch_current_playback(access_token)
    _upsert_now_playing(conn, user_id, playback)
    return _query_cached_status(conn, user_id)


def _fetch_current_playback(access_token: str) -> dict | None:
    import json

    req = urllib.request.Request(
        f'{SPOTIFY_API_BASE}/me/player/currently-playing',
        headers={'Authorization': f'Bearer {access_token}'},
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            if resp.status == 204:
                return None
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            raise
        logger.debug('Spotify API error %s', exc.code)
        return None
    except Exception:
        logger.debug('Spotify API request failed', exc_info=True)
        return None


def _upsert_now_playing(conn, user_id: int, playback: dict | None) -> None:
    cur = conn.cursor()

    if not playback or not playback.get('is_playing'):
        cur.execute(
            '''
            INSERT INTO spotify_now_playing
                (user_id, is_playing, cached_at)
            VALUES (?, 0, ?)
            ON CONFLICT (user_id) DO UPDATE SET
                is_playing = 0,
                cached_at  = EXCLUDED.cached_at
            ''',
            (user_id, time.time()),
        )
        conn.commit()
        return

    item = playback.get('item') or {}
    track_name = str(item.get('name') or '')
    track_id = str(item.get('id') or '')
    is_explicit = 1 if item.get('explicit') else 0
    artists = item.get('artists') or []
    artist_name = ', '.join(a.get('name', '') for a in artists if a.get('name'))
    album = item.get('album') or {}
    album_name = str(album.get('name') or '')
    images = album.get('images') or []
    album_art_url = images[0].get('url', '') if images else ''
    external_urls = item.get('external_urls') or {}
    spotify_track_url = external_urls.get('spotify', '')
    progress_ms = int(playback.get('progress_ms') or 0)
    duration_ms = int(item.get('duration_ms') or 1)

    cur.execute(
        '''
        INSERT INTO spotify_now_playing
            (user_id, is_playing, track_name, artist_name, album_name,
             album_art_url, spotify_track_url, progress_ms, duration_ms,
             track_id, is_explicit, cached_at)
        VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (user_id) DO UPDATE SET
            is_playing        = 1,
            track_name        = EXCLUDED.track_name,
            artist_name       = EXCLUDED.artist_name,
            album_name        = EXCLUDED.album_name,
            album_art_url     = EXCLUDED.album_art_url,
            spotify_track_url = EXCLUDED.spotify_track_url,
            progress_ms       = EXCLUDED.progress_ms,
            duration_ms       = EXCLUDED.duration_ms,
            track_id          = EXCLUDED.track_id,
            is_explicit       = EXCLUDED.is_explicit,
            cached_at         = EXCLUDED.cached_at
        ''',
        (
            user_id, track_name, artist_name, album_name,
            album_art_url, spotify_track_url, progress_ms, duration_ms,
            track_id, is_explicit,
            time.time(),
        ),
    )
    conn.commit()


# ---------------------------------------------------------------------------
# Profile-facing status query
# ---------------------------------------------------------------------------

def _viewer_is_contact(conn, viewer_user_id: int, owner_user_id: int) -> bool:
    cur = conn.cursor()
    cur.execute(
        'SELECT 1 FROM contacts WHERE user_id = ? AND contact_id = ? LIMIT 1',
        (owner_user_id, viewer_user_id),
    )
    return cur.fetchone() is not None


def get_public_listening_status(conn, viewer_user_id: int, owner_user_id: int) -> dict | None:
    """Return the owner's current Spotify track or None.

    Respects privacy settings (all / contacts / nobody) and hide_explicit flag.
    Returns None when Spotify is not connected, nothing is playing, the cached
    snapshot is older than STALE_THRESHOLD_S, or the viewer is not allowed.
    """
    try:
        settings = get_privacy_settings(conn, owner_user_id)
        privacy = settings['spotify_privacy']
        hide_explicit = settings['hide_explicit']

        if privacy == 'nobody':
            return None
        if privacy == 'contacts' and viewer_user_id != owner_user_id:
            if not _viewer_is_contact(conn, viewer_user_id, owner_user_id):
                return None

        return _query_cached_status(conn, owner_user_id, hide_explicit=hide_explicit)
    except Exception:
        logger.debug('spotify status query failed for user %s', owner_user_id, exc_info=True)
        return None


def _query_cached_status(conn, owner_user_id: int, *, hide_explicit: bool = False) -> dict | None:
    cur = conn.cursor()
    cur.execute(
        '''
        SELECT track_name, artist_name, album_name,
               album_art_url, spotify_track_url,
               progress_ms, duration_ms, cached_at,
               track_id, is_explicit
        FROM   spotify_now_playing
        WHERE  user_id = ?
          AND  is_playing = 1
        LIMIT  1
        ''',
        (owner_user_id,),
    )
    row = cur.fetchone()
    if row is None:
        return None

    cached_at = row['cached_at']
    if cached_at is not None and (time.time() - float(cached_at)) > STALE_THRESHOLD_S:
        return None

    is_explicit = bool(int(row['is_explicit'] or 0))
    if hide_explicit and is_explicit:
        return None

    return {
        'is_playing': True,
        'track': row['track_name'] or '',
        'artist': row['artist_name'] or '',
        'album': row['album_name'] or '',
        'album_art_url': row['album_art_url'] or '',
        'spotify_url': row['spotify_track_url'] or '',
        'track_id': row['track_id'] or '',
        'is_explicit': is_explicit,
        'progress_ms': int(row['progress_ms'] or 0),
        'duration_ms': int(row['duration_ms'] or 1),
        'updated_at': int(float(cached_at)) if cached_at else 0,
    }


# ---------------------------------------------------------------------------
# Spotify API user actions (save, queue, playlist)
# ---------------------------------------------------------------------------

def _get_valid_token(conn, user_id: int, client_id: str, client_secret: str) -> str | None:
    """Return a fresh access token for user_id, refreshing if needed."""
    cur = conn.cursor()
    cur.execute(
        'SELECT access_token, refresh_token, expires_at FROM spotify_tokens WHERE user_id = ?',
        (user_id,),
    )
    row = cur.fetchone()
    if row is None:
        _rollback_read_transaction(conn)
        return None
    access_token = row['access_token']
    expires_at = int(row['expires_at'] or 0)
    _rollback_read_transaction(conn)
    if time.time() >= expires_at:
        try:
            token_data = _refresh_access_token(client_id, client_secret, row['refresh_token'])
            save_tokens(conn, user_id, token_data)
            access_token = token_data['access_token']
        except Exception:
            logger.warning('Token refresh failed for user %s', user_id, exc_info=True)
            return None
    return access_token


def _spotify_api_put(access_token: str, path: str, body: dict | None = None) -> int:
    import json
    data = json.dumps(body).encode() if body else b''
    req = urllib.request.Request(
        f'{SPOTIFY_API_BASE}{path}',
        data=data,
        headers={
            'Authorization': f'Bearer {access_token}',
            'Content-Type': 'application/json',
        },
        method='PUT',
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            return resp.status
    except urllib.error.HTTPError as exc:
        return exc.code


def _spotify_api_post(access_token: str, path: str, body: dict | None = None) -> int:
    import json
    data = json.dumps(body).encode() if body else b''
    req = urllib.request.Request(
        f'{SPOTIFY_API_BASE}{path}',
        data=data,
        headers={
            'Authorization': f'Bearer {access_token}',
            'Content-Type': 'application/json',
        },
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            return resp.status
    except urllib.error.HTTPError as exc:
        return exc.code


def _spotify_api_get_json(access_token: str, path: str) -> dict | None:
    import json
    req = urllib.request.Request(
        f'{SPOTIFY_API_BASE}{path}',
        headers={'Authorization': f'Bearer {access_token}'},
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            return json.loads(resp.read().decode())
    except Exception:
        return None


def save_track(conn, user_id: int, track_id: str, client_id: str, client_secret: str) -> bool:
    """Add track_id to the user's Spotify library. Returns True on success."""
    token = _get_valid_token(conn, user_id, client_id, client_secret)
    if not token or not track_id:
        return False
    status = _spotify_api_put(token, f'/me/tracks?ids={urllib.parse.quote(track_id)}')
    return status in (200, 201)


def add_to_queue(conn, user_id: int, track_id: str, client_id: str, client_secret: str) -> bool:
    """Add track_id to the user's Spotify playback queue. Returns True on success."""
    token = _get_valid_token(conn, user_id, client_id, client_secret)
    if not token or not track_id:
        return False
    uri = f'spotify:track:{track_id}'
    status = _spotify_api_post(token, f'/me/player/queue?uri={urllib.parse.quote(uri)}')
    return status in (200, 201, 204)


def get_user_playlists(conn, user_id: int, client_id: str, client_secret: str) -> list[dict]:
    """Return list of user's editable playlists [{id, name}]."""
    token = _get_valid_token(conn, user_id, client_id, client_secret)
    if not token:
        return []
    data = _spotify_api_get_json(token, '/me/playlists?limit=50')
    if not data:
        return []
    items = data.get('items') or []
    result = []
    for item in items:
        if not item:
            continue
        playlist_id = str(item.get('id') or '')
        name = str(item.get('name') or '')
        if playlist_id and name:
            result.append({'id': playlist_id, 'name': name})
    return result


def add_track_to_playlist(
    conn,
    user_id: int,
    track_id: str,
    playlist_id: str,
    client_id: str,
    client_secret: str,
) -> bool:
    """Add track_id to a playlist. Returns True on success."""
    token = _get_valid_token(conn, user_id, client_id, client_secret)
    if not token or not track_id or not playlist_id:
        return False
    uri = f'spotify:track:{track_id}'
    safe_pid = urllib.parse.quote(playlist_id, safe='')
    status = _spotify_api_post(token, f'/playlists/{safe_pid}/tracks', {'uris': [uri]})
    return status in (200, 201)


# ---------------------------------------------------------------------------
# State CSRF helper
# ---------------------------------------------------------------------------

def generate_oauth_state(secret_key: str, user_id: int) -> str:
    """Generate a HMAC-based state token for OAuth CSRF protection."""
    ts = str(int(time.time()))
    msg = f'{user_id}:{ts}'.encode()
    sig = hmac.new(secret_key.encode(), msg, hashlib.sha256).hexdigest()[:16]
    return f'{user_id}:{ts}:{sig}'


def verify_oauth_state(secret_key: str, state: str, max_age_s: int = 600) -> int | None:
    """Verify state token; returns user_id or None on failure."""
    try:
        parts = state.split(':')
        if len(parts) != 3:
            return None
        user_id_str, ts_str, sig = parts
        user_id = int(user_id_str)
        ts = int(ts_str)
        if time.time() - ts > max_age_s:
            return None
        msg = f'{user_id}:{ts}'.encode()
        expected = hmac.new(secret_key.encode(), msg, hashlib.sha256).hexdigest()[:16]
        if not hmac.compare_digest(sig, expected):
            return None
        return user_id
    except Exception:
        return None
