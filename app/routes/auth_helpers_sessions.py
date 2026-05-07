import hashlib


def current_refresh_family_id(conn, raw_token: str | None):
    raw = str(raw_token or '').strip()
    if not raw:
        return None

    token_hash = hashlib.sha256(raw.encode('utf-8')).hexdigest()
    row = conn.execute(
        'SELECT family_id FROM refresh_tokens WHERE token_hash = ? LIMIT 1',
        (token_hash,),
    ).fetchone()
    if not row or not row['family_id']:
        return None
    return str(row['family_id'])
