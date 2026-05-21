def quote_ident(value: str) -> str:
    return '"' + str(value or '').replace('"', '""') + '"'
