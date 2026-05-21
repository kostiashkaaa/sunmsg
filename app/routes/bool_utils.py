def coerce_bool_flag(value, *, default: bool = True) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return int(value) != 0
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {'1', 'true', 't', 'yes', 'on'}:
            return True
        if normalized in {'0', 'false', 'f', 'no', 'off'}:
            return False
    return bool(default)
