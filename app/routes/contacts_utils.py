import json
from datetime import datetime, timedelta

from app.services.locale import normalize_language

ENCRYPTED_PREVIEW_LOADING_TOKEN = '__SUN_ENCRYPTED_LOADING__'


def is_encrypted_message_payload(value) -> bool:
    return isinstance(value, str) and value.strip().startswith('{') and 'encrypted_message' in value


def _build_initial_file_payload_preview(raw_message) -> str | None:
    if not isinstance(raw_message, str):
        return None
    normalized = raw_message.strip()
    if not normalized.startswith('{') or '"__sunfile"' not in normalized:
        return None
    try:
        payload = json.loads(normalized)
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict) or not payload.get('__sunfile'):
        return None

    caption = str(payload.get('caption') or '').strip()
    if caption:
        return caption

    mime = str(payload.get('mime') or '').strip().lower()
    name = str(payload.get('name') or '').strip()
    if mime.startswith('image/'):
        return '[photo]'
    if mime.startswith('video/'):
        return '[video]'
    if mime.startswith('audio/'):
        return '[voice]'
    if name:
        return f'[file] {name}'
    return '[file]'


def format_sidebar_time(timestamp, *, language: str = 'ru'):
    resolved_language = normalize_language(language, default='ru')
    if not timestamp:
        return ''

    raw = str(timestamp).strip()
    if not raw:
        return ''

    normalized = raw.replace(' ', 'T')
    if normalized.endswith('Z'):
        normalized = f"{normalized[:-1]}+00:00"

    try:
        dt = datetime.fromisoformat(normalized)
    except ValueError:
        return ''

    now = datetime.now(dt.tzinfo) if dt.tzinfo else datetime.now()
    today = now.date()
    dt_date = dt.date()
    yesterday = today - timedelta(days=1)

    if dt_date == today:
        return dt.strftime('%H:%M')
    if dt_date == yesterday:
        return 'Yesterday' if resolved_language == 'en' else 'Вчера'
    if dt.year == now.year:
        return dt.strftime('%d.%m')
    return dt.strftime('%d.%m.%Y')


def build_initial_last_message_preview(
    raw_message,
    *,
    blocked_by_me: bool,
    blocked_me: bool,
    language: str = 'ru',
) -> str:
    resolved_language = normalize_language(language, default='ru')
    if blocked_by_me:
        return '🚫 You blocked this user' if resolved_language == 'en' else '🚫 Вы заблокировали пользователя'
    if blocked_me:
        return '🚫 You are blocked' if resolved_language == 'en' else '🚫 Вы заблокированы'
    if is_encrypted_message_payload(raw_message):
        return ENCRYPTED_PREVIEW_LOADING_TOKEN
    file_preview = _build_initial_file_payload_preview(raw_message)
    if file_preview:
        return file_preview
    return raw_message or ''


def parse_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def like_pattern(value: str) -> str:
    escaped = str(value or '').replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
    return f'%{escaped}%'


def canonical_username(value) -> str:
    return str(value or '').strip().lower()
