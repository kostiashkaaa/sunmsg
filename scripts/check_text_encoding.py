from __future__ import annotations

import os
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

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
    'pyproject.toml',
}

EXCLUDED_DIR_NAMES = {
    '.git',
    '.pytest_cache',
    '.ruff_cache',
    '.venv',
    '.manual_artifacts',
    '.visual_artifacts',
    '.runtime',
    '__pycache__',
    'output',
    'storage',
}

EXCLUDED_PREFIXES = (
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


def _contains_mojibake_markers(text: str) -> bool:
    return any(marker in text for marker in MOJIBAKE_MARKERS)


def _iter_text_sources() -> list[Path]:
    files: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [
            dirname
            for dirname in dirnames
            if dirname not in EXCLUDED_DIR_NAMES and not dirname.startswith('.tmp_')
        ]
        for filename in filenames:
            path = Path(dirpath) / filename
            rel = path.relative_to(ROOT)
            if rel.parts and rel.parts[0].startswith('.tmp_'):
                continue
            if path.name.startswith('.tmp_'):
                continue
            rel_posix = rel.as_posix()
            if any(rel_posix.startswith(prefix) for prefix in EXCLUDED_PREFIXES):
                continue
            if path.suffix.lower() in TEXT_SUFFIXES or path.name in TEXT_FILENAMES:
                files.append(path)
    return sorted(files, key=lambda p: p.relative_to(ROOT).as_posix())


def main() -> int:
    failed = False
    for path in _iter_text_sources():
        rel = path.relative_to(ROOT).as_posix()
        raw = path.read_bytes()

        if raw.startswith(b'\xef\xbb\xbf'):
            print(f'[encoding] {rel}: contains UTF-8 BOM (must be UTF-8 without BOM)')
            failed = True

        try:
            text = raw.decode('utf-8')
        except UnicodeDecodeError as exc:
            print(f'[encoding] {rel}: not valid UTF-8 ({exc})')
            failed = True
            continue

        if '\ufeff' in text:
            print(f'[encoding] {rel}: contains U+FEFF character')
            failed = True

        if '\uFFFD' in text:
            print(f'[encoding] {rel}: contains replacement characters (U+FFFD)')
            failed = True

        extra_cyr = _non_russian_cyrillic_chars(text)
        if extra_cyr:
            codepoints = ', '.join(hex(ord(ch)) for ch in extra_cyr)
            print(f'[encoding] {rel}: contains non-Russian Cyrillic chars: {codepoints}')
            failed = True

        if _contains_mojibake_markers(text):
            print(f'[encoding] {rel}: contains mojibake marker sequences')
            failed = True

    if failed:
        print('\nEncoding guard failed.')
        return 1

    print('Encoding guard passed.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
