from __future__ import annotations

from collections import defaultdict

from app.services.user import get_safe_avatar_url

ALLOWED_REACTION_EMOJIS = (
    '\U0001F44D',      # 👍
    '\u2764\ufe0f',    # ❤️
    '\U0001F602',      # 😂
    '\U0001F62E',      # 😮
    '\U0001F622',      # 😢
    '\U0001F525',      # 🔥
    '\U0001F44F',      # 👏
    '\U0001F389',      # 🎉
    '\U0001F440',      # 👀
    '\U0001F60D',      # 😍
    '\U0001F929',      # 🤩
    '\U0001F631',      # 😱
    '\U0001F92F',      # 🤯
    '\U0001F914',      # 🤔
    '\U0001F44C',      # 👌
    '\U0001F44E',      # 👎
    '\U0001F60A',      # 😊
    '\U0001F60E',      # 😎
    '\U0001F973',      # 🥳
    '\U0001F923',      # 🤣
    '\U0001F92A',      # 🤪
    '\U0001F92C',      # 🤬
    '\U0001F634',      # 😴
    '\U0001F970',      # 🥰
    '\U0001F607',      # 😇
    '\U0001F91D',      # 🤝
    '\U0001F64F',      # 🙏
    '\U0001F4AA',      # 💪
    '\u2705',          # ✅
    '\u274c',          # ❌
    '\U0001F680',      # 🚀
    '\U0001F381',      # 🎁
)
_REACTION_EMOJI_RANK = {emoji: idx for idx, emoji in enumerate(ALLOWED_REACTION_EMOJIS)}
_REACTION_EMOJI_ALIASES = {}
for _emoji in ALLOWED_REACTION_EMOJIS:
    _normalized = str(_emoji).strip()
    if not _normalized:
        continue
    _REACTION_EMOJI_ALIASES[_normalized] = _normalized
    _REACTION_EMOJI_ALIASES[_normalized.replace('\ufe0f', '')] = _normalized
    _REACTION_EMOJI_ALIASES[_normalized.replace('\ufe0e', '')] = _normalized


def sanitize_reaction_emoji(value) -> str | None:
    emoji = str(value or '').strip()
    if not emoji:
        return None
    return _REACTION_EMOJI_ALIASES.get(emoji) or _REACTION_EMOJI_ALIASES.get(emoji.replace('\ufe0f', ''))


def _normalize_message_ids(message_ids) -> list[int]:
    normalized = []
    seen = set()
    for raw in message_ids or ():
        try:
            msg_id = int(raw)
        except (TypeError, ValueError):
            continue
        if msg_id <= 0 or msg_id in seen:
            continue
        seen.add(msg_id)
        normalized.append(msg_id)
    return normalized


def _normalize_viewer_id(viewer_user_id) -> int:
    try:
        value = int(viewer_user_id)
        if value > 0:
            return value
    except (TypeError, ValueError):
        pass
    return 0


def _build_reactor_payload(row, viewer_user_id: int) -> dict:
    reactor_user_id = int(row['user_id'])
    if viewer_user_id > 0 and reactor_user_id == viewer_user_id:
        safe_avatar_url = row['avatar_url']
    else:
        safe_avatar_url = get_safe_avatar_url(
            {
                'id': reactor_user_id,
                'avatar_url': row['avatar_url'],
                'avatar_visibility': row['avatar_visibility'],
                'is_contact': bool(row['is_contact']),
            },
            viewer_user_id,
        )

    return {
        'user_id': reactor_user_id,
        'public_key': row['public_key'],
        'display_name': row['display_name'],
        'username': row['username'],
        'avatar_url': safe_avatar_url,
    }


def fetch_reactions_map(conn, chat_id: str, message_ids, viewer_user_id: int) -> dict[int, list[dict]]:
    ids = _normalize_message_ids(message_ids)
    if not ids:
        return {}

    viewer_id = _normalize_viewer_id(viewer_user_id)
    placeholders = ', '.join('?' for _ in ids)
    rows = conn.execute(
        f'''
        SELECT mr.message_id,
               mr.emoji,
               mr.user_id,
               mr.created_at,
               u.public_key,
               u.display_name,
               u.username,
               u.avatar_url,
               u.avatar_visibility,
               CASE
                   WHEN mr.user_id = ? THEN 1
                   WHEN c.contact_id IS NOT NULL THEN 1
                   ELSE 0
               END AS is_contact
        FROM message_reactions mr
        JOIN users u ON u.id = mr.user_id
        LEFT JOIN contacts c ON c.user_id = ? AND c.contact_id = mr.user_id
        WHERE mr.chat_id = ?
          AND mr.message_id IN ({placeholders})
        ORDER BY mr.message_id ASC, mr.created_at ASC, mr.user_id ASC
        ''',
        (viewer_id, viewer_id, chat_id, *ids),
    ).fetchall()

    grouped: dict[int, dict[str, dict]] = defaultdict(dict)
    for row in rows:
        emoji = sanitize_reaction_emoji(row['emoji'])
        if not emoji:
            continue

        message_id = int(row['message_id'])
        msg_bucket = grouped[message_id]
        reaction_bucket = msg_bucket.get(emoji)
        if reaction_bucket is None:
            reaction_bucket = {
                'emoji': emoji,
                'count': 0,
                'reacted_by_me': False,
                'reactors': [],
            }
            msg_bucket[emoji] = reaction_bucket

        reaction_bucket['count'] += 1
        reactor_user_id = int(row['user_id'])
        if viewer_id > 0 and reactor_user_id == viewer_id:
            reaction_bucket['reacted_by_me'] = True
        reaction_bucket['reactors'].append(_build_reactor_payload(row, viewer_id))

    result: dict[int, list[dict]] = {}
    for message_id, emoji_buckets in grouped.items():
        result[message_id] = sorted(
            emoji_buckets.values(),
            key=lambda item: (
                -int(item['count'] or 0),
                _REACTION_EMOJI_RANK.get(item['emoji'], 999),
                item['emoji'],
            ),
        )
    return result

