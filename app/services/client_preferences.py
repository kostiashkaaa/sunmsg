from __future__ import annotations

import json
import math

MAX_CLIENT_PREFERENCES_JSON_LENGTH = 512_000
_MAX_INTERFACE_THEME_STORE_JSON_LENGTH = 32_000
_MAX_CHAT_APPEARANCE_STORE_JSON_LENGTH = 460_000
_PERFORMANCE_MODES = {'auto', 'full', 'lite'}
_MOTION_LEVELS = {'auto', 'full', 'balanced', 'lite'}


def _clamp_message_scale(value: float) -> float:
    return max(0.9, min(1.3, value))


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
