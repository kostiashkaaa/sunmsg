from __future__ import annotations

import json
import math
from datetime import datetime, timezone

MAX_CLIENT_PREFERENCES_JSON_LENGTH = 512_000
_MAX_INTERFACE_THEME_STORE_JSON_LENGTH = 32_000
_MAX_CHAT_APPEARANCE_STORE_JSON_LENGTH = 460_000
_PERFORMANCE_MODES = {'auto', 'full', 'lite'}
_MOTION_LEVELS = {'auto', 'full', 'balanced', 'lite'}
_SEND_SHORTCUT_MODES = {'enter', 'ctrl_enter'}
_TIME_FORMATS = {'24h', '12h'}
_INTERFACE_SURFACE_MODES = {'glass', 'solid'}
_SIDEBAR_WEATHER_SOURCES = {'auto', 'city'}
_SIDEBAR_WEATHER_ROTATE_SECONDS = {30, 60}
_SIDEBAR_WEATHER_METRICS = {
    'temperature',
    'feels_like',
    'humidity',
    'wind',
    'precip',
    'uv',
    'aqi',
    'pressure',
    'sun_cycle',
}
_CHAT_FOLDER_INCLUDES = {'all', 'direct', 'groups', 'unread', 'pinned'}
_MAX_CHAT_FOLDERS = 24
_MAX_CHAT_FOLDER_TITLE_LENGTH = 32
_MAX_CHAT_FOLDER_CHAT_IDS = 250


def _clamp_message_scale(value: float) -> float:
    return max(0.9, min(1.3, value))


def _to_utc_iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')


def _normalize_timestamp_number(raw_num: float):
    if not (math.isfinite(raw_num) and raw_num > 0):
        return None
    if raw_num > 1e12:
        timestamp_seconds = raw_num / 1000.0
    elif raw_num > 1e9:
        timestamp_seconds = raw_num
    else:
        return None
    try:
        dt = datetime.fromtimestamp(timestamp_seconds, tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None
    return _to_utc_iso(dt)


def _normalize_updated_at(raw_value):
    if isinstance(raw_value, (int, float)) and not isinstance(raw_value, bool):
        return _normalize_timestamp_number(float(raw_value))

    if not isinstance(raw_value, str):
        return None

    raw_text = raw_value.strip()
    if not raw_text or len(raw_text) > 64:
        return None

    try:
        as_number = float(raw_text)
    except (TypeError, ValueError):
        as_number = None

    if as_number is not None:
        as_epoch = _normalize_timestamp_number(as_number)
        if as_epoch is not None:
            return as_epoch

    normalized_text = raw_text[:-1] + '+00:00' if raw_text.endswith('Z') else raw_text
    try:
        dt = datetime.fromisoformat(normalized_text)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return _to_utc_iso(dt)


def _normalize_json_object(raw_value, *, max_json_length: int):
    if not isinstance(raw_value, dict):
        return None
    try:
        packed = json.dumps(raw_value, ensure_ascii=False, separators=(',', ':'))
    except (TypeError, ValueError):
        return None
    if len(packed) > max_json_length:
        return None
    try:
        parsed = json.loads(packed)
    except (TypeError, ValueError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _normalize_choice_value(src: dict, *, key: str, allowed: set[str]):
    value = str(src.get(key) or '').strip().lower()
    return value if value in allowed else None


def _normalize_language(src: dict):
    language = str(src.get('language') or '').strip().lower()
    return language if language in {'ru', 'en'} else None


def _normalize_sidebar_weather_city(raw_value):
    if not isinstance(raw_value, str):
        return None
    return ' '.join(raw_value.strip().split())[:80]


def _normalize_sidebar_weather_rotate_seconds(raw_value):
    if isinstance(raw_value, bool):
        return None
    if isinstance(raw_value, (int, float)):
        rotate_value = int(raw_value)
    elif isinstance(raw_value, str):
        try:
            rotate_value = int(raw_value.strip())
        except (TypeError, ValueError):
            return None
    else:
        return None
    return rotate_value if rotate_value in _SIDEBAR_WEATHER_ROTATE_SECONDS else None


def _normalize_sidebar_weather_metrics(raw_value):
    if not isinstance(raw_value, list):
        return None
    metrics: list[str] = []
    seen_metrics: set[str] = set()
    for raw_metric in raw_value:
        metric = str(raw_metric or '').strip().lower()
        if metric in _SIDEBAR_WEATHER_METRICS and metric not in seen_metrics:
            metrics.append(metric)
            seen_metrics.add(metric)
    return metrics


def _normalize_chat_folder_title(raw_value):
    if not isinstance(raw_value, str):
        return None
    title = ' '.join(raw_value.strip().split())
    if not title:
        return None
    return title[:_MAX_CHAT_FOLDER_TITLE_LENGTH]


def _normalize_chat_folder_id(raw_value, fallback_index: int) -> str:
    raw = str(raw_value or '').strip().lower()
    safe = ''.join(
        ch for ch in raw if ch.isascii() and (ch.isalnum() or ch in {'_', '-'})
    )[:48]
    return safe or f'folder_{fallback_index + 1}'


def _normalize_chat_folder_ids(raw_value):
    if not isinstance(raw_value, list):
        return []
    values: list[str] = []
    seen: set[str] = set()
    for raw_chat_id in raw_value:
        chat_id = str(raw_chat_id or '').strip()
        if not chat_id or chat_id in seen:
            continue
        values.append(chat_id)
        seen.add(chat_id)
        if len(values) >= _MAX_CHAT_FOLDER_CHAT_IDS:
            break
    return values


def _normalize_chat_folder_order(raw_value, fallback_index: int):
    if isinstance(raw_value, bool):
        return fallback_index
    if isinstance(raw_value, (int, float)) and math.isfinite(float(raw_value)):
        return int(raw_value)
    if isinstance(raw_value, str):
        try:
            parsed = int(raw_value.strip())
        except (TypeError, ValueError):
            return fallback_index
        return parsed
    return fallback_index


def _normalize_chat_folders(raw_value):
    if not isinstance(raw_value, list):
        return None
    folders: list[dict] = []
    seen_ids = {'all', 'direct', 'groups', 'unread', 'pinned'}
    for index, raw_folder in enumerate(raw_value):
        if len(folders) >= _MAX_CHAT_FOLDERS:
            break
        if not isinstance(raw_folder, dict):
            continue
        title = _normalize_chat_folder_title(raw_folder.get('title'))
        if title is None:
            continue
        folder_id = _normalize_chat_folder_id(raw_folder.get('id'), index)
        if folder_id in seen_ids:
            continue
        include = str(raw_folder.get('include') or '').strip().lower()
        folders.append(
            {
                'id': folder_id,
                'title': title,
                'include': include if include in _CHAT_FOLDER_INCLUDES else 'all',
                'included_chat_ids': _normalize_chat_folder_ids(
                    raw_folder.get('included_chat_ids')
                ),
                'excluded_chat_ids': _normalize_chat_folder_ids(
                    raw_folder.get('excluded_chat_ids')
                ),
                'order': _normalize_chat_folder_order(raw_folder.get('order'), index),
            }
        )
        seen_ids.add(folder_id)
    return sorted(folders, key=lambda folder: (folder['order'], folder['title']))


def _normalize_base_preferences(src: dict) -> dict:
    normalized: dict = {}

    dark_mode = src.get('darkMode')
    if isinstance(dark_mode, bool):
        normalized['darkMode'] = dark_mode

    message_scale = src.get('messageScale')
    if isinstance(message_scale, (int, float)) and not isinstance(message_scale, bool):
        message_scale_num = float(message_scale)
        if math.isfinite(message_scale_num):
            normalized['messageScale'] = round(_clamp_message_scale(message_scale_num), 2)

    performance_mode = _normalize_choice_value(
        src,
        key='performanceMode',
        allowed=_PERFORMANCE_MODES,
    )
    if performance_mode is not None:
        normalized['performanceMode'] = performance_mode

    motion_level = _normalize_choice_value(src, key='motionLevel', allowed=_MOTION_LEVELS)
    if motion_level is not None:
        normalized['motionLevel'] = motion_level

    send_shortcut = _normalize_choice_value(
        src,
        key='sendShortcut',
        allowed=_SEND_SHORTCUT_MODES,
    )
    if send_shortcut is not None:
        normalized['sendShortcut'] = send_shortcut

    time_format = _normalize_choice_value(src, key='timeFormat', allowed=_TIME_FORMATS)
    if time_format is not None:
        normalized['timeFormat'] = time_format

    interface_surface_mode = _normalize_choice_value(
        src,
        key='interfaceSurfaceMode',
        allowed=_INTERFACE_SURFACE_MODES,
    )
    if interface_surface_mode is not None:
        normalized['interfaceSurfaceMode'] = interface_surface_mode

    language = _normalize_language(src)
    if language is not None:
        normalized['language'] = language

    return normalized


def _normalize_sidebar_weather_preferences(src: dict) -> dict:
    normalized: dict = {}

    sidebar_weather_enabled = src.get('sidebarWeatherEnabled')
    if isinstance(sidebar_weather_enabled, bool):
        normalized['sidebarWeatherEnabled'] = sidebar_weather_enabled

    sidebar_weather_source = _normalize_choice_value(
        src,
        key='sidebarWeatherSource',
        allowed=_SIDEBAR_WEATHER_SOURCES,
    )
    if sidebar_weather_source is not None:
        normalized['sidebarWeatherSource'] = sidebar_weather_source

    sidebar_weather_city = _normalize_sidebar_weather_city(src.get('sidebarWeatherCity'))
    if sidebar_weather_city is not None:
        normalized['sidebarWeatherCity'] = sidebar_weather_city

    sidebar_weather_rotate = _normalize_sidebar_weather_rotate_seconds(
        src.get('sidebarWeatherRotateSeconds')
    )
    if sidebar_weather_rotate is not None:
        normalized['sidebarWeatherRotateSeconds'] = sidebar_weather_rotate

    sidebar_weather_metrics = _normalize_sidebar_weather_metrics(src.get('sidebarWeatherMetrics'))
    if sidebar_weather_metrics is not None:
        normalized['sidebarWeatherMetrics'] = sidebar_weather_metrics

    return normalized


def _normalize_extended_preferences(src: dict) -> dict:
    normalized: dict = {}

    interface_theme_store = _normalize_json_object(
        src.get('interfaceThemeStore'),
        max_json_length=_MAX_INTERFACE_THEME_STORE_JSON_LENGTH,
    )
    if interface_theme_store is not None:
        normalized['interfaceThemeStore'] = interface_theme_store

    chat_appearance_store = _normalize_json_object(
        src.get('chatAppearanceStore'),
        max_json_length=_MAX_CHAT_APPEARANCE_STORE_JSON_LENGTH,
    )
    if chat_appearance_store is not None:
        normalized['chatAppearanceStore'] = chat_appearance_store

    updated_at = _normalize_updated_at(src.get('updatedAt'))
    if updated_at:
        normalized['updatedAt'] = updated_at

    return normalized


def _normalize_chat_preferences(src: dict) -> dict:
    normalized: dict = {}
    chat_folders = _normalize_chat_folders(src.get('chatFolders'))
    if chat_folders is not None:
        normalized['chatFolders'] = chat_folders
    return normalized


def normalize_client_preferences(raw_value) -> dict:
    src = raw_value if isinstance(raw_value, dict) else {}
    normalized: dict = {}
    normalized.update(_normalize_base_preferences(src))
    normalized.update(_normalize_sidebar_weather_preferences(src))
    normalized.update(_normalize_chat_preferences(src))
    normalized.update(_normalize_extended_preferences(src))
    return normalized


def client_preferences_from_db(raw_value) -> dict:
    if isinstance(raw_value, dict):
        return normalize_client_preferences(raw_value)
    raw = str(raw_value or '').strip()
    if not raw:
        return {}
    if len(raw) > MAX_CLIENT_PREFERENCES_JSON_LENGTH:
        return {}
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        return {}
    return normalize_client_preferences(parsed)


def client_preferences_to_json(raw_value) -> str:
    normalized = normalize_client_preferences(raw_value)
    packed = json.dumps(normalized, ensure_ascii=False, separators=(',', ':'))
    if len(packed) > MAX_CLIENT_PREFERENCES_JSON_LENGTH:
        return '{}'
    return packed
