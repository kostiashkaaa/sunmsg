import mimetypes
from zipfile import BadZipFile, ZipFile

_FORCED_MIME_BY_EXTENSION = {
    'ogg': 'audio/ogg',
    'wav': 'audio/wav',
    'mp3': 'audio/mpeg',
    'm4a': 'audio/mp4',
    'aac': 'audio/aac',
    'opus': 'audio/ogg',
    'heic': 'image/heic',
    'heif': 'image/heif',
    'avif': 'image/avif',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'svg': 'image/svg+xml',
}


def allowed_file(filename, *, allowed_extensions) -> bool:
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in allowed_extensions


def validate_magic(file_obj, ext, *, magic_bytes_map) -> bool:
    checks = magic_bytes_map.get(ext, [])
    if not checks:
        return False
    required_size = max((offset + len(magic) for offset, magic in checks), default=0)
    header = file_obj.read(max(64, required_size))
    file_obj.seek(0)
    return all(header[offset:offset + len(magic)] == magic for offset, magic in checks)


def read_stream_head(stream, size=8192):
    pos = stream.tell()
    try:
        stream.seek(0)
        return stream.read(size)
    finally:
        stream.seek(pos)


def matches_magic_rules(header: bytes, rules) -> bool:
    if not rules:
        return False
    for rule in rules:
        if all(header[offset:offset + len(signature)] == signature for offset, signature in rule):
            return True
    return False


def validate_openxml_package(stream, folder_prefix: str) -> bool:
    pos = stream.tell()
    try:
        stream.seek(0)
        with ZipFile(stream) as archive:
            names = archive.namelist()
            if '[Content_Types].xml' not in names:
                return False
            return any(name.startswith(folder_prefix) for name in names)
    except (BadZipFile, OSError, ValueError):
        return False
    finally:
        stream.seek(pos)


def validate_text_like_payload(stream) -> bool:
    probe = read_stream_head(stream, size=8192)
    return b'\x00' not in probe


def validate_chat_media_content(uploaded, ext: str, *, chat_media_magic_rules) -> bool:
    rules = chat_media_magic_rules.get(ext)
    if rules:
        head = read_stream_head(uploaded.stream, size=8192)
        if not matches_magic_rules(head, rules):
            return False

    if ext in {'txt', 'csv'}:
        return validate_text_like_payload(uploaded.stream)
    if ext == 'docx':
        return validate_openxml_package(uploaded.stream, 'word/')
    if ext == 'xlsx':
        return validate_openxml_package(uploaded.stream, 'xl/')

    return ext in chat_media_magic_rules


def detect_chat_media_type(mime_type: str) -> str:
    mime = (mime_type or '').lower()
    if mime.startswith('image/'):
        return 'image'
    if mime.startswith('video/'):
        return 'video'
    if mime.startswith('audio/'):
        return 'audio'
    return 'file'


def _detect_or_guess_mime(uploaded_mime: str | None, filename: str, ext: str) -> str:
    mime = (uploaded_mime or '').strip().lower()
    if mime and mime != 'application/octet-stream':
        return mime
    guessed, _ = mimetypes.guess_type(filename or f'file.{ext}')
    return (guessed or '').lower()


def normalize_chat_media_mime(uploaded_mime: str | None, filename: str, ext: str) -> str:
    forced_mime = _FORCED_MIME_BY_EXTENSION.get(ext)
    if forced_mime:
        return forced_mime
    mime = _detect_or_guess_mime(uploaded_mime, filename, ext)
    return mime or 'application/octet-stream'


def serialize_block_state(state):
    state = state or {}
    blocked_by_me = bool(state.get('blocked_by_me'))
    blocked_me = bool(state.get('blocked_me'))
    return {
        'is_blocked': blocked_by_me or blocked_me,
        'blocked_by_me': blocked_by_me,
        'blocked_me': blocked_me,
    }


def canonical_username(value) -> str:
    return str(value or '').strip().lower()
