from __future__ import annotations

import re

SUPPORTED_LANGUAGES = {'ru', 'en'}
DEFAULT_AUTH_LANGUAGE = 'en'
DEFAULT_PROFILE_LANGUAGE = 'ru'

# CIS countries where Russian is commonly used and should be preferred on auth pages.
CIS_RUSSIAN_COUNTRY_CODES = {
    'AM',  # Armenia
    'AZ',  # Azerbaijan
    'BY',  # Belarus
    'KG',  # Kyrgyzstan
    'KZ',  # Kazakhstan
    'MD',  # Moldova
    'RU',  # Russia
    'TJ',  # Tajikistan
    'TM',  # Turkmenistan
    'UZ',  # Uzbekistan
}

_COUNTRY_CODE_PATTERN = re.compile(r'^[A-Z]{2}$')
_COUNTRY_HEADER_CANDIDATES = (
    'CF-IPCountry',
    'CloudFront-Viewer-Country',
    'X-AppEngine-Country',
    'X-Country-Code',
    'X-Geo-Country',
    'X-Forwarded-Country',
)


def normalize_language(raw_value, *, default: str = DEFAULT_PROFILE_LANGUAGE) -> str:
    value = str(raw_value or '').strip().lower()
    if value in SUPPORTED_LANGUAGES:
        return value
    fallback = str(default or '').strip().lower()
    if fallback in SUPPORTED_LANGUAGES:
        return fallback
    return DEFAULT_PROFILE_LANGUAGE


def language_from_user_row(row, *, default: str = DEFAULT_PROFILE_LANGUAGE) -> str:
    if not row:
        return normalize_language(default)
    language_value = None
    if hasattr(row, 'keys') and 'language' in row.keys():
        language_value = row['language']
    return normalize_language(language_value, default=default)


def detect_request_country_code(req) -> str:
    for header_name in _COUNTRY_HEADER_CANDIDATES:
        raw_code = str(req.headers.get(header_name, '') or '').strip().upper()
        if _COUNTRY_CODE_PATTERN.fullmatch(raw_code):
            return raw_code
    return ''


def is_cis_russian_country(country_code: str) -> bool:
    code = str(country_code or '').strip().upper()
    return code in CIS_RUSSIAN_COUNTRY_CODES


def detect_auth_language(req) -> str:
    country_code = detect_request_country_code(req)
    if is_cis_russian_country(country_code):
        return 'ru'

    browser_language = req.accept_languages.best_match(['en', 'ru'])
    if browser_language in SUPPORTED_LANGUAGES:
        return browser_language

    return DEFAULT_AUTH_LANGUAGE
