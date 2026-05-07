from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]

# Validate first-party text files where mojibake can leak into code, UI, and docs.
TEXT_SUFFIXES = {
    '.py',
    '.js',
    '.css',
    '.html',
    '.md',
    '.txt',
    '.json',
    '.ini',
    '.yml',
    '.yaml',
    '.conf',
    '.service',
    '.xml',
    '.svg',
    '.webmanifest',
}

TEXT_FILENAMES = {
    '.env',
    '.env.example',
    '.gitignore',
    'pytest.ini',
}

EXCLUDED_DIR_NAMES = {
    '.git',
    '.pytest_cache',
    '.ruff_cache',
    '.venv',
    '.manual_artifacts',
    '.visual_artifacts',
    '__pycache__',
    'storage',
}

EXCLUDED_PREFIXES = (
    'static/chat.js',
    'static/vendor/fonts/',
    'static/vendor/bootstrap-icons/fonts/',
)

MOJIBAKE_MARKER_ESCAPES = (
    '\\u0432\\u201d',
    '\\u0432\\u2022',
    '\\u0432\\u2020',
)
MOJIBAKE_MARKERS = tuple(
    bytes(token, 'ascii').decode('unicode_escape') for token in MOJIBAKE_MARKER_ESCAPES
)


def _non_russian_cyrillic_chars(text: str) -> list[str]:
    # Russian alphabet + Ё/ё.
    russian_codes = set(range(0x410, 0x430)) | set(range(0x430, 0x450)) | {0x401, 0x451}
    extra = {
        ch
        for ch in text
        if 0x0400 <= ord(ch) <= 0x04FF and ord(ch) not in russian_codes
    }
    return sorted(extra)


def _iter_text_sources() -> list[Path]:
    files: list[Path] = []
    for path in ROOT.rglob('*'):
        if not path.is_file():
            continue
        rel = path.relative_to(ROOT)
        if rel.parts and rel.parts[0].startswith('.tmp_'):
            continue
        if path.name.startswith('.tmp_'):
            continue
        if any(part in EXCLUDED_DIR_NAMES for part in rel.parts):
            continue
        rel_posix = rel.as_posix()
        if any(rel_posix.startswith(prefix) for prefix in EXCLUDED_PREFIXES):
            continue
        if path.suffix.lower() in TEXT_SUFFIXES or path.name in TEXT_FILENAMES:
            files.append(path)
    return sorted(files, key=lambda p: p.relative_to(ROOT).as_posix())


TEXT_SOURCES = _iter_text_sources()


@pytest.mark.parametrize('path', TEXT_SOURCES, ids=lambda p: p.relative_to(ROOT).as_posix())
def test_project_text_files_have_clean_utf8_text(path: Path):
    raw = path.read_bytes()
    assert not raw.startswith(b'\xef\xbb\xbf'), f'{path} contains UTF-8 BOM.'

    text = raw.decode('utf-8')
    assert '\ufeff' not in text, f'{path} contains U+FEFF.'

    assert '\uFFFD' not in text, f'{path} contains replacement characters (U+FFFD).'

    extra_cyr = _non_russian_cyrillic_chars(text)
    assert not extra_cyr, (
        f'{path} contains non-Russian Cyrillic symbols typical for mojibake: '
        f'{[hex(ord(ch)) for ch in extra_cyr]}'
    )

    assert not any(marker in text for marker in MOJIBAKE_MARKERS), (
        f'{path} contains known mojibake marker sequences.'
    )
