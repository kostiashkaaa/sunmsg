import logging
import mimetypes
from zipfile import BadZipFile, ZipFile

from app.routes.username_utils import canonical_username as canonical_username

logger = logging.getLogger(__name__)

# Image extensions where we can run a deep Pillow.verify() pass. SVG is
# intentionally excluded: it is parsed as XML, not raster, and we never
# accept it via uploads (see _IMAGE_EXTENSIONS_BLOCKLIST).
#
# HEIC/HEIF/AVIF would require pillow-heif (a separate native dependency);
# without it Pillow raises UnidentifiedImageError on valid files, producing
# false negatives. We rely on magic-bytes alone for those — install
# pillow-heif and add it here if needed in the future.
_PILLOW_VERIFIABLE_EXTENSIONS = {
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp',
}

# Extensions we refuse to accept as images even if a caller mis-declares them
# as image MIME. SVG can carry inline <script> and event handlers; allowing
# it as an avatar or chat-media file opens stored XSS. Everything in this
# set is rejected at validate_image_payload() and at validate_magic().
_IMAGE_EXTENSIONS_BLOCKLIST = frozenset({'svg', 'svgz', 'xml', 'html', 'htm'})

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
    # NB: 'svg' intentionally absent — SVG uploads are rejected
    # at validate_magic()/validate_image_payload() (XSS via inline <script>).
    'sunenc': 'application/octet-stream',
}

_ALLOWED_MIME_BY_EXTENSION = {
    'png': {'image/png'},
    'jpg': {'image/jpeg'},
    'jpeg': {'image/jpeg'},
    'gif': {'image/gif'},
    'webp': {'image/webp'},
    'bmp': {'image/bmp', 'image/x-ms-bmp'},
    'heic': {'image/heic', 'image/heif'},
    'heif': {'image/heif', 'image/heic'},
    'avif': {'image/avif'},
    'mp4': {'video/mp4', 'audio/mp4'},
    'webm': {'video/webm', 'audio/webm'},
    'mov': {'video/quicktime'},
    'm4v': {'video/mp4', 'video/x-m4v'},
    'avi': {'video/x-msvideo', 'video/avi'},
    'mkv': {'video/x-matroska', 'video/matroska'},
    'mpeg': {'video/mpeg', 'audio/mpeg'},
    'mpg': {'video/mpeg', 'audio/mpeg'},
    '3gp': {'video/3gpp', 'audio/3gpp'},
    'ogg': {'audio/ogg', 'video/ogg', 'application/ogg'},
    'wav': {'audio/wav', 'audio/x-wav'},
    'mp3': {'audio/mpeg', 'audio/mp3'},
    'm4a': {'audio/mp4', 'audio/x-m4a'},
    'aac': {'audio/aac', 'audio/aacp'},
    'opus': {'audio/ogg', 'audio/opus'},
    'pdf': {'application/pdf'},
    'doc': {'application/msword'},
    'docx': {'application/vnd.openxmlformats-officedocument.wordprocessingml.document'},
    'txt': {'text/plain'},
    'csv': {'text/csv', 'application/csv'},
    'zip': {'application/zip', 'application/x-zip-compressed'},
    'rar': {'application/vnd.rar', 'application/x-rar-compressed'},
    '7z': {'application/x-7z-compressed'},
    'xlsx': {'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},
    'sunenc': {'application/octet-stream'},
}


def allowed_file(filename, *, allowed_extensions) -> bool:
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in allowed_extensions


def validate_magic(file_obj, ext, *, magic_bytes_map) -> bool:
    normalized_ext = str(ext or '').strip().lower()
    if normalized_ext in _IMAGE_EXTENSIONS_BLOCKLIST:
        return False
    checks = magic_bytes_map.get(normalized_ext, [])
    if not checks:
        return False
    required_size = max((offset + len(magic) for offset, magic in checks), default=0)
    header = file_obj.read(max(64, required_size))
    file_obj.seek(0)
    if not all(header[offset:offset + len(magic)] == magic for offset, magic in checks):
        return False
    if normalized_ext in _PILLOW_VERIFIABLE_EXTENSIONS:
        return validate_image_payload(file_obj)
    return True


def validate_image_payload(file_obj) -> bool:
    """
    Deep image validation via Pillow.verify(). Catches files that have a
    correct magic header but a broken payload (truncated, malicious polyglots,
    decompression bombs). Pillow is required in production; in dev it may be
    missing — degrade to magic-only.

    The stream is consumed and rewound to position 0 on both success and
    failure paths.
    """
    try:
        from PIL import Image, UnidentifiedImageError
    except ImportError:
        # Pillow missing → keep dev/test envs working with magic-only checks.
        logger.warning(
            'Pillow not installed; skipping deep image validation. '
            'Install Pillow for production-grade upload safety.'
        )
        try:
            file_obj.seek(0)
        except (OSError, ValueError):
            pass
        return True

    pos = 0
    try:
        pos = file_obj.tell()
    except (OSError, ValueError):
        pos = 0
    try:
        file_obj.seek(0)
        with Image.open(file_obj) as image:
            image.verify()
        return True
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError) as exc:
        logger.info('Image payload rejected by Pillow.verify: %s', exc)
        return False
    finally:
        try:
            file_obj.seek(pos)
        except (OSError, ValueError):
            try:
                file_obj.seek(0)
            except (OSError, ValueError):
                pass


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
    normalized_ext = str(ext or '').strip().lower()
    if normalized_ext in _IMAGE_EXTENSIONS_BLOCKLIST:
        return False
    rules = chat_media_magic_rules.get(normalized_ext)
    if rules:
        head = read_stream_head(uploaded.stream, size=8192)
        if not matches_magic_rules(head, rules):
            return False

    if normalized_ext in {'txt', 'csv'}:
        return validate_text_like_payload(uploaded.stream)
    if normalized_ext == 'docx':
        return validate_openxml_package(uploaded.stream, 'word/')
    if normalized_ext == 'xlsx':
        return validate_openxml_package(uploaded.stream, 'xl/')

    if normalized_ext in _PILLOW_VERIFIABLE_EXTENSIONS:
        if not validate_image_payload(uploaded.stream):
            return False

    return normalized_ext in chat_media_magic_rules


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
    uploaded = (uploaded_mime or '').strip().lower()
    allowed = _ALLOWED_MIME_BY_EXTENSION.get(ext, set())
    if uploaded and uploaded != 'application/octet-stream' and uploaded in allowed:
        return uploaded
    mime = _detect_or_guess_mime(None, filename, ext)
    if allowed and mime not in allowed:
        return sorted(allowed)[0]
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
