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


def _clamp_message_scale(value: float) -> float:
    return max(0.9, min(1.3, value))


def _normalize_updated_at(raw_value):
    if isinstance(raw_value, (int, float)) and not isinstance(raw_value, bool):
        raw_num = float(raw_value)
        if math.isfinite(raw_num) and raw_num > 0:
            if raw_num > 1e12:
                timestamp_seconds = raw_num / 1000.0
            elif raw_num > 1e9:
                timestamp_seconds = raw_num
            else:
                timestamp_seconds = None
            if timestamp_seconds:
                try:
                    dt = datetime.fromtimestamp(timestamp_seconds, tz=timezone.utc)
                    return dt.isoformat().replace('+00:00', 'Z')
                except (OverflowError, OSError, ValueError):
                    return None
        return None

    if not isinstance(raw_value, str):
        return None

    raw_text = raw_value.strip()
    if not raw_text or len(raw_text) > 64:
        return None

    try:
        as_number = float(raw_text)
    except (TypeError, ValueError):
        as_number = None

    if as_number is not None and math.isfinite(as_number) and as_number > 0:
        if as_number > 1e12:
            timestamp_seconds = as_number / 1000.0
        elif as_number > 1e9:
            timestamp_seconds = as_number
        else:
            timestamp_seconds = None
        if timestamp_seconds:
            try:
                dt = datetime.fromtimestamp(timestamp_seconds, tz=timezone.utc)
                return dt.isoformat().replace('+00:00', 'Z')
            except (OverflowError, OSError, ValueError):
                return None

    normalized_text = raw_text[:-1] + '+00:00' if raw_text.endswith('Z') else raw_text
    try:
        dt = datetime.fromisoformat(normalized_text)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')


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


def normalize_client_preferences(raw_value) -> dict:
    src = raw_value if isinstance(raw_value, dict) else {}
    normalized: dict = {}

    dark_mode = src.get('darkMode')
    if isinstance(dark_mode, bool):
        normalized['darkMode'] = dark_mode

    message_scale = src.get('messageScale')
    if isinstance(message_scale, (int, float)) and not isinstance(message_scale, bool):
        message_scale_num = float(message_scale)
        if math.isfinite(message_scale_num):
            normalized['messageScale'] = round(_clamp_message_scale(message_scale_num), 2)

    performance_mode = str(src.get('performanceMode') or '').strip().lower()
    if performance_mode in _PERFORMANCE_MODES:
        normalized['performanceMode'] = performance_mode

    motion_level = str(src.get('motionLevel') or '').strip().lower()
    if motion_level in _MOTION_LEVELS:
        normalized['motionLevel'] = motion_level

    send_shortcut = str(src.get('sendShortcut') or '').strip().lower()
    if send_shortcut in _SEND_SHORTCUT_MODES:
        normalized['sendShortcut'] = send_shortcut

    time_format = str(src.get('timeFormat') or '').strip().lower()
    if time_format in _TIME_FORMATS:
        normalized['timeFormat'] = time_format

    language = str(src.get('language') or '').strip().lower()
    if language in {'ru', 'en'}:
        normalized['language'] = language

    sidebar_weather_enabled = src.get('sidebarWeatherEnabled')
    if isinstance(sidebar_weather_enabled, bool):
        normalized['sidebarWeatherEnabled'] = sidebar_weather_enabled

    sidebar_weather_source = str(src.get('sidebarWeatherSource') or '').strip().lower()
    if sidebar_weather_source in _SIDEBAR_WEATHER_SOURCES:
        normalized['sidebarWeatherSource'] = sidebar_weather_source

    sidebar_weather_city = src.get('sidebarWeatherCity')
    if isinstance(sidebar_weather_city, str):
        city = ' '.join(sidebar_weather_city.strip().split())
        normalized['sidebarWeatherCity'] = city[:80]

    sidebar_weather_rotate = src.get('sidebarWeatherRotateSeconds')
    sidebar_weather_rotate_value = None
    if isinstance(sidebar_weather_rotate, bool):
        sidebar_weather_rotate_value = None
    elif isinstance(sidebar_weather_rotate, (int, float)):
        sidebar_weather_rotate_num = int(sidebar_weather_rotate)
        sidebar_weather_rotate_value = sidebar_weather_rotate_num
    elif isinstance(sidebar_weather_rotate, str):
        try:
            sidebar_weather_rotate_value = int(sidebar_weather_rotate.strip())
        except (TypeError, ValueError):
            sidebar_weather_rotate_value = None
    if sidebar_weather_rotate_value in _SIDEBAR_WEATHER_ROTATE_SECONDS:
        normalized['sidebarWeatherRotateSeconds'] = sidebar_weather_rotate_value

    sidebar_weather_metrics = src.get('sidebarWeatherMetrics')
    if isinstance(sidebar_weather_metrics, list):
        metrics: list[str] = []
        seen_metrics: set[str] = set()
        for raw_metric in sidebar_weather_metrics:
            metric = str(raw_metric or '').strip().lower()
            if metric in _SIDEBAR_WEATHER_METRICS and metric not in seen_metrics:
                metrics.append(metric)
                seen_metrics.add(metric)
        normalized['sidebarWeatherMetrics'] = metrics

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
