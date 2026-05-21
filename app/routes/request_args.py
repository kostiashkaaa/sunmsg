from __future__ import annotations

from flask import jsonify


def parse_positive_optional_int(raw_value, *, field_name: str):
    value_raw = str(raw_value or '').strip()
    if not value_raw:
        return None, None
    try:
        value = int(value_raw)
    except (TypeError, ValueError):
        return None, (jsonify({'success': False, 'error': f'Invalid {field_name}.'}), 400)
    if value <= 0:
        return None, (jsonify({'success': False, 'error': f'Invalid {field_name}.'}), 400)
    return value, None
