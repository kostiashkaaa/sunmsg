def canonical_username(value) -> str:
    return str(value or '').strip().lower()
