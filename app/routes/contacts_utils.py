import json
from datetime import datetime, timedelta

from app.services.locale import normalize_language

ENCRYPTED_PREVIEW_LOADING_TOKEN = '__SUN_ENCRYPTED_LOADING__'


def is_encrypted_message_payload(value) -> bool:
    return isinstance(value, str) and value.strip().startswith('{') and 'encrypted_message' in value


def _format_call_duration(seconds) -> str:
    try:
        total = max(0, int(seconds or 0))
    except (TypeError, ValueError):
        total = 0
    minutes, secs = divmod(total, 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f'{hours:02d}:{minutes:02d}:{secs:02d}'
    return f'{minutes:02d}:{secs:02d}'


def _build_initial_call_payload_preview(raw_message, *, language: str = 'ru') -> str | None:
    if not isinstance(raw_message, str):
        return None
    normalized = raw_message.strip()
    if not normalized.startswith('{') or '"__suncall"' not in normalized:
        return None
    try:
        payload = json.loads(normalized)
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict) or not payload.get('__suncall'):
        return None

    resolved_language = normalize_language(language, default='ru')
    is_video = payload.get('call_type') == 'video'
    if resolved_language == 'en':
        call_label = 'Video call' if is_video else 'Call'
    else:
        call_label = 'Видеозвонок' if is_video else 'Звонок'

    status = str(payload.get('status') or '').strip()
    if status == 'ended':
        duration = _format_call_duration(payload.get('duration_sec'))
        status_text = duration if duration != '00:00' else ('Ended' if resolved_language == 'en' else 'Завершён')
    elif status == 'cancelled':
        status_text = 'Cancelled' if resolved_language == 'en' else 'Отменён'
    elif status == 'rejected':
        status_text = 'Declined' if resolved_language == 'en' else 'Отклонён'
    elif status == 'failed':
        status_text = 'Failed' if resolved_language == 'en' else 'Сбой соединения'
    else:
        status_text = 'Missed' if resolved_language == 'en' else 'Пропущен'
    return f'{call_label} · {status_text}'


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

    return ENCRYPTED_PREVIEW_LOADING_TOKEN


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
    call_preview = _build_initial_call_payload_preview(raw_message, language=resolved_language)
    if call_preview:
        return call_preview
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
