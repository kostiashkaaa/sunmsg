from __future__ import annotations

import ipaddress
import http.client
import re
import socket
import ssl
import threading
import time
from html.parser import HTMLParser
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse, urlunparse

from flask import Response, jsonify, request, session

from app.services.link_preview_cache_store import (
    load_persisted_link_preview,
    persist_link_preview_payload,
)
from app.services.link_preview_prewarm import schedule_link_preview_prewarm

_LINK_PREVIEW_TIMEOUT_SECONDS = 4.0
_LINK_PREVIEW_MAX_HTML_BYTES = 1_200_000
_LINK_PREVIEW_CACHE_TTL_SECONDS = 60 * 30
_LINK_PREVIEW_EMPTY_META_CACHE_TTL_SECONDS = 45
_LINK_PREVIEW_CACHE_SCHEMA_VERSION = 7
_LINK_PREVIEW_MAX_IMAGE_BYTES = 6 * 1024 * 1024
_LINK_PREVIEW_IMAGE_META_TIMEOUT_SECONDS = 3.0
_LINK_PREVIEW_IMAGE_META_MAX_BYTES = 256 * 1024
_LINK_PREVIEW_MAX_REDIRECTS = 4
_LINK_PREVIEW_URL_PATTERN = re.compile(r"\bhttps?://[^\s<>\"'`]+|\bwww\.[^\s<>\"'`]+", re.IGNORECASE)
_LINK_PREVIEW_BOT_USER_AGENT = (
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
)
_LINK_PREVIEW_CHALLENGE_PATH_RE = re.compile(r'(?:^|/)(?:showcaptcha|captcha|cian-captcha)(?:/|$)', re.IGNORECASE)
_LINK_PREVIEW_COMPACT_MAX_WIDTH = 760
_LINK_PREVIEW_COMPACT_MAX_HEIGHT = 420
_LINK_PREVIEW_COMPACT_MAX_ASPECT_RATIO = 1.15

_LINK_PREVIEW_CACHE = {}
_LINK_PREVIEW_CACHE_LOCK = threading.Lock()
_LINK_PREVIEW_CACHE_MAX_ENTRIES = 4096
_LINK_PREVIEW_HOST_BUDGET = {}
_LINK_PREVIEW_HOST_BUDGET_LOCK = threading.Lock()
_LINK_PREVIEW_HOST_BUDGET_WINDOW_SECONDS = 60.0
_LINK_PREVIEW_HOST_BUDGET_MAX_FETCHES = 30
_LINK_PREVIEW_HOST_BUDGET_MAX_HOSTS = 2048


class _MetaPreviewParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self._in_title = False
        self._title_parts: list[str] = []
        self.meta: dict[str, str] = {}
        self.icon_links: list[dict[str, str]] = []

    def handle_starttag(self, tag, attrs):
        tag_name = str(tag or '').lower()
        if tag_name == 'title':
            self._in_title = True
            return
        if tag_name == 'link':
            attrs_map = {str(k or '').lower(): str(v or '').strip() for k, v in attrs}
            rel_value = str(attrs_map.get('rel') or '').strip()
            href_value = str(attrs_map.get('href') or '').strip()
            if rel_value and href_value:
                self.icon_links.append({
                    'rel': rel_value,
                    'href': href_value,
                    'sizes': str(attrs_map.get('sizes') or '').strip(),
                    'type': str(attrs_map.get('type') or '').strip().lower(),
                })
            return
        if tag_name != 'meta':
            return

        attrs_map = {str(k or '').lower(): str(v or '').strip() for k, v in attrs}
        content = attrs_map.get('content')
        if not content:
            return

        key_property = attrs_map.get('property', '').strip().lower()
        key_name = attrs_map.get('name', '').strip().lower()
        if key_property and key_property not in self.meta:
            self.meta[key_property] = content
        if key_name and key_name not in self.meta:
            self.meta[key_name] = content

    def handle_endtag(self, tag):
        if str(tag or '').lower() == 'title':
            self._in_title = False

    def handle_data(self, data):
        if self._in_title and data:
            self._title_parts.append(data)

    @property
    def title(self) -> str:
        return ' '.join(part.strip() for part in self._title_parts if part and part.strip()).strip()


def _trim_value(value: str, *, max_len: int) -> str:
    raw = str(value or '')
    normalized = re.sub(r'[\u200e\u200f\u202a-\u202e\u2066-\u2069]', '', raw)
    normalized = ' '.join(normalized.split()).strip()
    if len(normalized) <= max_len:
        return normalized
    return normalized[:max_len].rstrip() + '…'


def _normalize_asset_url(raw_url: str, *, base_url: str) -> str:
    candidate = str(raw_url or '').strip()
    if not candidate:
        return ''
    try:
        parsed = urlparse(urljoin(base_url, candidate))
    except Exception:
        return ''
    if parsed.scheme not in {'http', 'https'}:
        return ''
    parsed = parsed._replace(fragment='')
    return urlunparse(parsed)


def _to_positive_int(value) -> int | None:
    try:
        number = int(str(value or '').strip())
    except (TypeError, ValueError):
        return None
    if number <= 0:
        return None
    return number


def _extract_png_dimensions(data: bytes, mime: str) -> tuple[int | None, int | None] | None:
    if not (mime == 'image/png' or data.startswith(b'\x89PNG\r\n\x1a\n')):
        return None
    if len(data) < 24:
        return None, None
    width = int.from_bytes(data[16:20], 'big', signed=False)
    height = int.from_bytes(data[20:24], 'big', signed=False)
    return _to_positive_int(width), _to_positive_int(height)


def _extract_gif_dimensions(data: bytes, mime: str) -> tuple[int | None, int | None] | None:
    if not (mime == 'image/gif' or data.startswith((b'GIF87a', b'GIF89a'))):
        return None
    width = int.from_bytes(data[6:8], 'little', signed=False)
    height = int.from_bytes(data[8:10], 'little', signed=False)
    return _to_positive_int(width), _to_positive_int(height)


def _extract_webp_dimensions(data: bytes, mime: str) -> tuple[int | None, int | None] | None:
    if not (mime == 'image/webp' or (data.startswith(b'RIFF') and len(data) >= 16 and data[8:12] == b'WEBP')):
        return None
    if len(data) >= 30 and data[12:16] == b'VP8X':
        width_minus_1 = int.from_bytes(data[24:27], 'little', signed=False)
        height_minus_1 = int.from_bytes(data[27:30], 'little', signed=False)
        return _to_positive_int(width_minus_1 + 1), _to_positive_int(height_minus_1 + 1)
    if len(data) >= 25 and data[12:16] == b'VP8L':
        bits = int.from_bytes(data[21:25], 'little', signed=False)
        width = (bits & 0x3FFF) + 1
        height = ((bits >> 14) & 0x3FFF) + 1
        return _to_positive_int(width), _to_positive_int(height)
    if len(data) >= 30 and data[12:16] == b'VP8 ':
        width = int.from_bytes(data[26:28], 'little', signed=False) & 0x3FFF
        height = int.from_bytes(data[28:30], 'little', signed=False) & 0x3FFF
        return _to_positive_int(width), _to_positive_int(height)
    return None, None


def _extract_jpeg_dimensions(data: bytes, mime: str) -> tuple[int | None, int | None] | None:
    if not (mime in {'image/jpeg', 'image/jpg'} or data.startswith(b'\xff\xd8')):
        return None
    idx = 2
    data_len = len(data)
    while idx + 8 < data_len:
        if data[idx] != 0xFF:
            idx += 1
            continue
        marker = data[idx + 1]
        idx += 2
        if marker in {0xD8, 0xD9}:
            continue
        if idx + 2 > data_len:
            break
        segment_len = int.from_bytes(data[idx:idx + 2], 'big', signed=False)
        if segment_len < 2 or idx + segment_len > data_len:
            break
        if marker in {
            0xC0, 0xC1, 0xC2, 0xC3,
            0xC5, 0xC6, 0xC7,
            0xC9, 0xCA, 0xCB,
            0xCD, 0xCE, 0xCF,
        } and segment_len >= 7:
            height = int.from_bytes(data[idx + 3:idx + 5], 'big', signed=False)
            width = int.from_bytes(data[idx + 5:idx + 7], 'big', signed=False)
            return _to_positive_int(width), _to_positive_int(height)
        idx += segment_len
    return None, None


def _extract_image_dimensions_from_bytes(image_bytes: bytes, mime_type: str) -> tuple[int | None, int | None]:
    data = bytes(image_bytes or b'')
    if len(data) < 10:
        return None, None
    mime = str(mime_type or '').strip().lower()

    for extractor in (
        _extract_png_dimensions,
        _extract_gif_dimensions,
        _extract_webp_dimensions,
        _extract_jpeg_dimensions,
    ):
        extracted = extractor(data, mime)
        if extracted is not None:
            return extracted
    return None, None


def _fetch_remote_image_dimensions(image_url: str) -> tuple[int | None, int | None]:
    safe_url = str(image_url or '').strip()
    if not safe_url or not _is_allowed_preview_url(safe_url):
        return None, None

    request_headers = {
        'User-Agent': 'SUNMessengerLinkPreview/1.0',
        'Accept': 'image/*,*/*;q=0.1',
    }
    conn, response, _resolved_url = _open_public_preview_response(
        safe_url,
        headers=request_headers,
        timeout=_LINK_PREVIEW_IMAGE_META_TIMEOUT_SECONDS,
    )
    try:
        content_type_header = str(response.headers.get('Content-Type') or '').strip().lower()
        mime_type = content_type_header.split(';', 1)[0].strip()
        if not mime_type.startswith('image/'):
            return None, None
        data = response.read(_LINK_PREVIEW_IMAGE_META_MAX_BYTES)
        return _extract_image_dimensions_from_bytes(data, mime_type)
    finally:
        conn.close()


def _choose_preview_image_geometry(meta: dict, image_url: str) -> tuple[int | None, int | None]:
    width = (
        _to_positive_int(meta.get('og:image:width'))
        or _to_positive_int(meta.get('twitter:image:width'))
    )
    height = (
        _to_positive_int(meta.get('og:image:height'))
        or _to_positive_int(meta.get('twitter:image:height'))
    )
    if width and height:
        return width, height

    if not image_url:
        return None, None

    try:
        remote_width, remote_height = _fetch_remote_image_dimensions(image_url)
        return remote_width, remote_height
    except (HTTPError, URLError, TimeoutError, OSError, ValueError):
        return None, None


def _compute_preview_layout(width: int | None, height: int | None, image_url: str) -> tuple[str, str]:
    if not image_url:
        return 'none', ''
    if not width or not height:
        return 'full', '1.7778'

    ratio = max(0.56, min(2.4, float(width) / float(height)))
    ratio_value = f'{ratio:.4f}'
    if ratio <= _LINK_PREVIEW_COMPACT_MAX_ASPECT_RATIO:
        return 'compact', ratio_value
    if width <= _LINK_PREVIEW_COMPACT_MAX_WIDTH and height <= _LINK_PREVIEW_COMPACT_MAX_HEIGHT:
        return 'compact', ratio_value
    return 'full', ratio_value


def _icon_size_score(raw_sizes: str) -> int:
    sizes_value = str(raw_sizes or '').strip().lower()
    if not sizes_value:
        return 0
    max_area = 0
    for token in sizes_value.split():
        token = token.strip()
        if not token:
            continue
        if token == 'any':
            max_area = max(max_area, 4_194_304)
            continue
        if 'x' not in token:
            continue
        left, right = token.split('x', 1)
        try:
            width = int(left.strip())
            height = int(right.strip())
        except (TypeError, ValueError):
            continue
        if width <= 0 or height <= 0:
            continue
        max_area = max(max_area, width * height)
    return max_area


def _icon_rel_priority(raw_rel: str) -> int:
    rel_parts = set(str(raw_rel or '').strip().lower().split())
    if not rel_parts:
        return 0
    if 'apple-touch-icon' in rel_parts:
        return 380
    if 'apple-touch-icon-precomposed' in rel_parts:
        return 360
    if 'icon' in rel_parts:
        return 320
    if 'shortcut' in rel_parts and 'icon' in rel_parts:
        return 300
    if 'mask-icon' in rel_parts:
        return 220
    return 0


def _icon_type_bonus(raw_type: str, href_value: str) -> int:
    mime_type = str(raw_type or '').strip().lower()
    href_lower = str(href_value or '').strip().lower()
    if 'png' in mime_type or href_lower.endswith('.png'):
        return 80
    if 'webp' in mime_type or href_lower.endswith('.webp'):
        return 60
    if 'svg' in mime_type or href_lower.endswith('.svg'):
        return 40
    if 'x-icon' in mime_type or 'vnd.microsoft.icon' in mime_type or href_lower.endswith('.ico'):
        return 20
    return 0


def _select_best_icon_url(icon_links: list[dict[str, str]], *, base_url: str) -> str:
    best_score: tuple[int, int, int] | None = None
    best_url = ''
    for item in icon_links:
        rel_value = str((item or {}).get('rel') or '').strip()
        href_value = str((item or {}).get('href') or '').strip()
        if not rel_value or not href_value:
            continue
        rel_priority = _icon_rel_priority(rel_value)
        if rel_priority <= 0:
            continue

        normalized_url = _normalize_asset_url(href_value, base_url=base_url)
        if not normalized_url:
            continue

        size_score = _icon_size_score((item or {}).get('sizes') or '')
        type_bonus = _icon_type_bonus((item or {}).get('type') or '', href_value)
        score = (rel_priority, size_score, type_bonus)
        if best_score is None or score > best_score:
            best_score = score
            best_url = normalized_url
    return best_url


def _extract_first_url(value: str) -> str:
    raw = str(value or '').strip()
    if not raw:
        return ''
    match = _LINK_PREVIEW_URL_PATTERN.search(raw)
    if not match:
        return ''
    return match.group(0).rstrip('),.;:!?]')


def _normalize_preview_url(raw_url: str) -> str:
    candidate = _extract_first_url(raw_url)
    if not candidate:
        return ''
    if candidate.lower().startswith('www.'):
        candidate = f'https://{candidate}'

    try:
        parsed = urlparse(candidate)
    except Exception:
        return ''

    scheme = str(parsed.scheme or '').lower()
    if scheme not in {'http', 'https'}:
        return ''
    if parsed.username or parsed.password:
        return ''
    hostname = str(parsed.hostname or '').strip().lower()
    if not hostname:
        return ''

    cleaned = parsed._replace(fragment='')
    return urlunparse(cleaned)


def _normalize_absolute_preview_url(raw_url: str) -> str:
    try:
        parsed = urlparse(str(raw_url or '').strip())
    except Exception:
        return ''

    scheme = str(parsed.scheme or '').lower()
    if scheme not in {'http', 'https'}:
        return ''
    if parsed.username or parsed.password:
        return ''
    hostname = str(parsed.hostname or '').strip().lower()
    if not hostname:
        return ''

    return urlunparse(parsed._replace(fragment=''))


def _is_public_preview_ip(ip_obj) -> bool:
    return not (
        ip_obj.is_private
        or ip_obj.is_loopback
        or ip_obj.is_link_local
        or ip_obj.is_multicast
        or ip_obj.is_reserved
        or ip_obj.is_unspecified
    )


def _is_allowed_preview_hostname(hostname: str) -> bool:
    raw_host = str(hostname or '').strip().rstrip('.').lower()
    if not raw_host:
        return False

    if raw_host in {'localhost', 'localhost.localdomain'}:
        return False
    if raw_host.endswith('.local'):
        return False

    try:
        ip_obj = ipaddress.ip_address(raw_host)
    except ValueError:
        # Domain names are checked by _is_allowed_preview_url against the
        # concrete DNS records used for the outbound connection.
        return True

    return _is_public_preview_ip(ip_obj)


def _resolve_public_preview_addresses(hostname: str, port: int):
    normalized_host = str(hostname or '').strip().rstrip('.')
    if not normalized_host:
        return []
    try:
        records = socket.getaddrinfo(normalized_host, int(port), type=socket.SOCK_STREAM)
    except OSError:
        return []
    if not records:
        return []

    public_records = []
    seen = set()
    for record in records:
        address = str(record[4][0] or '').strip()
        if not address:
            return []
        try:
            ip_obj = ipaddress.ip_address(address)
        except ValueError:
            return []
        if not _is_public_preview_ip(ip_obj):
            return []
        record_key = (record[0], record[2], record[4])
        if record_key in seen:
            continue
        seen.add(record_key)
        public_records.append(record)
    return public_records


def _hostname_resolves_public_only(hostname: str, port: int = 443) -> bool:
    return bool(_resolve_public_preview_addresses(hostname, port))


class _PinnedHTTPConnection(http.client.HTTPConnection):
    def __init__(self, host: str, port: int, resolved_sockaddr, *, timeout: float):
        super().__init__(host, port=port, timeout=timeout)
        self._resolved_sockaddr = resolved_sockaddr

    def connect(self):
        self.sock = socket.create_connection(
            _socket_create_connection_address(self._resolved_sockaddr),
            self.timeout,
            self.source_address,
        )


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, host: str, port: int, resolved_sockaddr, *, timeout: float):
        context = ssl.create_default_context()
        super().__init__(host, port=port, timeout=timeout, context=context)
        self._resolved_sockaddr = resolved_sockaddr

    def connect(self):
        raw_sock = socket.create_connection(
            _socket_create_connection_address(self._resolved_sockaddr),
            self.timeout,
            self.source_address,
        )
        self.sock = self._context.wrap_socket(raw_sock, server_hostname=self.host)


def _socket_create_connection_address(sockaddr):
    if isinstance(sockaddr, tuple) and len(sockaddr) >= 2:
        return (sockaddr[0], sockaddr[1])
    return sockaddr


def _is_allowed_preview_url(url: str) -> bool:
    parsed = urlparse(str(url or '').strip())
    host = str(parsed.hostname or '').strip().lower()
    if not _is_allowed_preview_hostname(host):
        return False
    port = int(parsed.port or (443 if str(parsed.scheme or '').lower() == 'https' else 80))
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return _hostname_resolves_public_only(host, port)
    return bool(_resolve_public_preview_addresses(host, port))


def _preview_request_target(parsed) -> str:
    path = str(parsed.path or '') or '/'
    if parsed.params:
        path = f'{path};{parsed.params}'
    if parsed.query:
        path = f'{path}?{parsed.query}'
    return path


def _redirect_target_url(current_url: str, location: str) -> str:
    if not location:
        return ''
    return _normalize_absolute_preview_url(urljoin(current_url, location))


def _open_public_preview_response(url: str, *, headers: dict, timeout: float):
    current_url = _normalize_absolute_preview_url(url)
    if not current_url:
        raise URLError('invalid_url')

    for _redirect_index in range(_LINK_PREVIEW_MAX_REDIRECTS + 1):
        if not _is_allowed_preview_url(current_url):
            raise URLError('forbidden_host')

        parsed = urlparse(current_url)
        hostname = str(parsed.hostname or '').strip().lower()
        scheme = str(parsed.scheme or '').lower()
        port = int(parsed.port or (443 if scheme == 'https' else 80))
        records = _resolve_public_preview_addresses(hostname, port)
        if not records:
            raise URLError('forbidden_host')

        last_error = None
        redirected_url = ''
        for record in records:
            conn = None
            try:
                if scheme == 'https':
                    conn = _PinnedHTTPSConnection(hostname, port, record[4], timeout=timeout)
                else:
                    conn = _PinnedHTTPConnection(hostname, port, record[4], timeout=timeout)
                conn.request('GET', _preview_request_target(parsed), headers=headers)
                response = conn.getresponse()
                if response.status in {301, 302, 303, 307, 308}:
                    location = str(response.headers.get('Location') or '').strip()
                    try:
                        response.read(1024)
                    finally:
                        conn.close()
                    redirected_url = _redirect_target_url(current_url, location)
                    if not redirected_url or not _is_allowed_preview_url(redirected_url):
                        raise URLError('forbidden_host')
                    break
                if response.status >= 400:
                    raise HTTPError(current_url, response.status, response.reason, response.headers, None)
                return conn, response, current_url
            except (HTTPError, URLError):
                if conn is not None:
                    conn.close()
                raise
            except (OSError, TimeoutError, ssl.SSLError, http.client.HTTPException) as exc:
                if conn is not None:
                    conn.close()
                last_error = exc
                continue

        if redirected_url:
            current_url = redirected_url
            continue
        if last_error:
            raise URLError(last_error)
        raise URLError('fetch_failed')

    raise URLError('too_many_redirects')


def _looks_like_challenge_url(url: str) -> bool:
    parsed = urlparse(str(url or '').strip())
    path = str(parsed.path or '').strip()
    if not path:
        return False
    return bool(_LINK_PREVIEW_CHALLENGE_PATH_RE.search(path))


def _reserve_link_preview_host_budget(hostname: str) -> bool:
    normalized_host = str(hostname or '').strip().lower()
    if not normalized_host:
        return False
    now = float(time.time())
    window_start = now - float(_LINK_PREVIEW_HOST_BUDGET_WINDOW_SECONDS)
    with _LINK_PREVIEW_HOST_BUDGET_LOCK:
        if (
            normalized_host not in _LINK_PREVIEW_HOST_BUDGET
            and len(_LINK_PREVIEW_HOST_BUDGET) >= int(_LINK_PREVIEW_HOST_BUDGET_MAX_HOSTS)
        ):
            oldest_host = min(
                _LINK_PREVIEW_HOST_BUDGET,
                key=lambda key: min(_LINK_PREVIEW_HOST_BUDGET[key] or [now]),
            )
            _LINK_PREVIEW_HOST_BUDGET.pop(oldest_host, None)
        timestamps = [
            float(value)
            for value in _LINK_PREVIEW_HOST_BUDGET.get(normalized_host, [])
            if float(value) >= window_start
        ]
        if len(timestamps) >= max(1, int(_LINK_PREVIEW_HOST_BUDGET_MAX_FETCHES)):
            _LINK_PREVIEW_HOST_BUDGET[normalized_host] = timestamps
            return False
        timestamps.append(now)
        _LINK_PREVIEW_HOST_BUDGET[normalized_host] = timestamps
        return True


def _fetch_preview_html(url: str) -> tuple[str, str]:
    request_headers = {
        'User-Agent': _LINK_PREVIEW_BOT_USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,ru;q=0.8',
        'Cache-Control': 'no-cache',
    }
    conn, response, resolved_url = _open_public_preview_response(
        url,
        headers=request_headers,
        timeout=_LINK_PREVIEW_TIMEOUT_SECONDS,
    )
    try:
        content_type_header = str(response.headers.get('Content-Type') or '').lower()
        if 'text/html' not in content_type_header and 'application/xhtml+xml' not in content_type_header:
            return '', resolved_url

        data_buffer = bytearray()
        head_closed = False
        while len(data_buffer) < _LINK_PREVIEW_MAX_HTML_BYTES:
            remaining = _LINK_PREVIEW_MAX_HTML_BYTES - len(data_buffer)
            chunk = response.read(min(16_384, remaining))
            if not chunk:
                break
            data_buffer.extend(chunk)
            if not head_closed and b'</head>' in bytes(data_buffer).lower():
                head_closed = True
                break
        data = bytes(data_buffer)

        charset = response.headers.get_content_charset() or 'utf-8'
        try:
            html = data.decode(charset, errors='replace')
        except LookupError:
            html = data.decode('utf-8', errors='replace')
        return html, resolved_url
    finally:
        conn.close()


def _fetch_preview_image(url: str) -> tuple[bytes, str, str]:
    request_headers = {
        'User-Agent': 'SUNMessengerLinkPreview/1.0',
        'Accept': 'image/*,*/*;q=0.1',
    }
    conn, response, resolved_url = _open_public_preview_response(
        url,
        headers=request_headers,
        timeout=_LINK_PREVIEW_TIMEOUT_SECONDS,
    )
    try:
        content_type_header = str(response.headers.get('Content-Type') or '').strip().lower()
        mime_type = content_type_header.split(';', 1)[0].strip()
        if not mime_type.startswith('image/'):
            raise ValueError('not_image_content_type')

        data = response.read(_LINK_PREVIEW_MAX_IMAGE_BYTES + 1)
        if len(data) > _LINK_PREVIEW_MAX_IMAGE_BYTES:
            raise ValueError('image_too_large')
        return data, mime_type, resolved_url
    finally:
        conn.close()


def _parse_preview_payload(url: str, html_text: str, resolved_url: str) -> dict:
    parser = _MetaPreviewParser()
    try:
        parser.feed(html_text)
    except Exception:
        pass

    parsed_resolved = urlparse(resolved_url or url)
    hostname = str(parsed_resolved.hostname or '').lower()

    title = (
        parser.meta.get('og:title')
        or parser.meta.get('twitter:title')
        or parser.title
    )
    description = (
        parser.meta.get('og:description')
        or parser.meta.get('twitter:description')
        or parser.meta.get('description')
    )
    site_name = (
        parser.meta.get('og:site_name')
        or parser.meta.get('application-name')
        or hostname
    )

    safe_title = _trim_value(title, max_len=140)
    safe_description = _trim_value(description, max_len=220)
    safe_site_name = _trim_value(site_name, max_len=80)
    image_url = (
        parser.meta.get('og:image:secure_url')
        or parser.meta.get('og:image:url')
        or parser.meta.get('og:image')
        or parser.meta.get('twitter:image')
        or parser.meta.get('twitter:image:src')
    )
    safe_image_url = _normalize_asset_url(image_url, base_url=resolved_url or url)
    if not safe_image_url:
        safe_image_url = _select_best_icon_url(parser.icon_links, base_url=resolved_url or url)
    if not safe_image_url:
        safe_image_url = _normalize_asset_url('/favicon.ico', base_url=resolved_url or url)
    image_width, image_height = _choose_preview_image_geometry(parser.meta, safe_image_url)
    image_layout, image_aspect_ratio = _compute_preview_layout(image_width, image_height, safe_image_url)

    return {
        'success': True,
        'url': resolved_url or url,
        'hostname': hostname,
        'site_name': safe_site_name,
        'title': safe_title,
        'description': safe_description,
        'image_url': safe_image_url,
        'image_width': image_width or 0,
        'image_height': image_height or 0,
        'image_aspect_ratio': image_aspect_ratio,
        'image_layout': image_layout,
        'has_meta': bool(safe_title or safe_description),
    }


def _cached_preview_payload(normalized_url: str):
    now = time.time()
    with _LINK_PREVIEW_CACHE_LOCK:
        cached = _LINK_PREVIEW_CACHE.get(normalized_url)
        if not cached:
            return None
        if float(cached.get('expires_at') or 0) < now:
            _LINK_PREVIEW_CACHE.pop(normalized_url, None)
            return None
        if int(cached.get('schema_version') or 0) != _LINK_PREVIEW_CACHE_SCHEMA_VERSION:
            _LINK_PREVIEW_CACHE.pop(normalized_url, None)
            return None
        payload = dict(cached.get('payload') or {})
        if 'image_url' not in payload:
            _LINK_PREVIEW_CACHE.pop(normalized_url, None)
            return None
        return payload


def _cached_or_persisted_preview_payload(normalized_url: str):
    cached_payload = _cached_preview_payload(normalized_url)
    if cached_payload is not None:
        return cached_payload

    persisted_payload = load_persisted_link_preview(
        normalized_url,
        schema_version=_LINK_PREVIEW_CACHE_SCHEMA_VERSION,
    )
    if not isinstance(persisted_payload, dict):
        return None
    if 'image_url' not in persisted_payload:
        return None

    _put_preview_cache(normalized_url, persisted_payload)
    return persisted_payload


def _put_preview_cache(normalized_url: str, payload: dict) -> None:
    has_meta = bool((payload or {}).get('has_meta'))
    ttl_seconds = _LINK_PREVIEW_CACHE_TTL_SECONDS if has_meta else _LINK_PREVIEW_EMPTY_META_CACHE_TTL_SECONDS
    expires_at = time.time() + ttl_seconds
    with _LINK_PREVIEW_CACHE_LOCK:
        if len(_LINK_PREVIEW_CACHE) >= _LINK_PREVIEW_CACHE_MAX_ENTRIES:
            stale_url = min(
                _LINK_PREVIEW_CACHE,
                key=lambda key: float(_LINK_PREVIEW_CACHE[key].get('expires_at') or 0.0),
            )
            _LINK_PREVIEW_CACHE.pop(stale_url, None)
        _LINK_PREVIEW_CACHE[normalized_url] = {
            'expires_at': expires_at,
            'schema_version': _LINK_PREVIEW_CACHE_SCHEMA_VERSION,
            'payload': dict(payload or {}),
        }
    persist_link_preview_payload(
        normalized_url,
        dict(payload or {}),
        schema_version=_LINK_PREVIEW_CACHE_SCHEMA_VERSION,
        ttl_seconds=ttl_seconds,
    )


def _empty_preview_payload(normalized_url: str, hostname: str) -> dict:
    fallback_image_url = _normalize_asset_url('/favicon.ico', base_url=normalized_url)
    return {
        'success': True,
        'url': normalized_url,
        'hostname': hostname,
        'site_name': hostname,
        'title': '',
        'description': '',
        'image_url': fallback_image_url,
        'image_width': 0,
        'image_height': 0,
        'image_aspect_ratio': '1.7778',
        'image_layout': 'compact',
        'has_meta': False,
    }


def resolve_link_preview_payload(raw_url: str) -> tuple[dict, int]:
    normalized_url = _normalize_preview_url(raw_url)
    if not normalized_url:
        return {'success': False, 'error': 'invalid_url'}, 400

    parsed = urlparse(normalized_url)
    hostname = str(parsed.hostname or '').strip().lower()
    if not _is_allowed_preview_url(normalized_url):
        return {'success': False, 'error': 'forbidden_host'}, 400

    cached_payload = _cached_or_persisted_preview_payload(normalized_url)
    if cached_payload is not None:
        return cached_payload, 200

    if not _reserve_link_preview_host_budget(hostname):
        payload = _empty_preview_payload(normalized_url, hostname)
        _put_preview_cache(normalized_url, payload)
        return payload, 200

    try:
        html_text, resolved_url = _fetch_preview_html(normalized_url)
    except (HTTPError, URLError, TimeoutError, OSError):
        return _empty_preview_payload(normalized_url, hostname), 200
    if not _is_allowed_preview_url(resolved_url or normalized_url):
        return {'success': False, 'error': 'forbidden_host'}, 400
    if _looks_like_challenge_url(resolved_url or ''):
        payload = _empty_preview_payload(normalized_url, hostname)
        _put_preview_cache(normalized_url, payload)
        return payload, 200

    payload = _parse_preview_payload(normalized_url, html_text, resolved_url)
    _put_preview_cache(normalized_url, payload)
    return payload, 200


def register_chat_link_preview_routes(chat_bp, *, limiter):  # noqa: C901
    @chat_bp.route('/link_preview', methods=['GET'])
    @limiter.limit('120 per minute')
    def get_link_preview():
        if 'user_id' not in session:
            return jsonify({'success': False, 'error': 'unauthorized'}), 401

        raw_url = request.args.get('url', '')
        payload, status_code = resolve_link_preview_payload(raw_url)
        return jsonify(payload), status_code

    @chat_bp.route('/link_preview_prewarm', methods=['GET'])
    @limiter.limit('240 per minute')
    def prewarm_link_preview():
        if 'user_id' not in session:
            return jsonify({'success': False, 'error': 'unauthorized'}), 401

        raw_url = request.args.get('url', '')
        normalized_url = _normalize_preview_url(raw_url)
        if not normalized_url:
            return jsonify({'success': False, 'error': 'invalid_url'}), 400
        if not _is_allowed_preview_url(normalized_url):
            return jsonify({'success': False, 'error': 'forbidden_host'}), 400

        queued = schedule_link_preview_prewarm(
            normalized_url,
            resolve_preview_payload_func=resolve_link_preview_payload,
        )
        return jsonify({'success': True, 'queued': bool(queued)}), 202

    @chat_bp.route('/link_preview_image', methods=['GET'])
    @limiter.limit('120 per minute')
    def get_link_preview_image():
        if 'user_id' not in session:
            return jsonify({'success': False, 'error': 'unauthorized'}), 401

        raw_url = request.args.get('url', '')
        normalized_url = _normalize_asset_url(raw_url, base_url='https://example.com')
        if not normalized_url:
            return jsonify({'success': False, 'error': 'invalid_url'}), 400

        if not _is_allowed_preview_url(normalized_url):
            return jsonify({'success': False, 'error': 'forbidden_host'}), 400

        parsed = urlparse(normalized_url)
        hostname = str(parsed.hostname or '').strip().lower()
        if not _reserve_link_preview_host_budget(hostname):
            return jsonify({'success': False, 'error': 'host_rate_limited'}), 429

        try:
            image_bytes, mime_type, resolved_url = _fetch_preview_image(normalized_url)
        except (HTTPError, URLError, TimeoutError, OSError, ValueError):
            return jsonify({'success': False, 'error': 'image_unavailable'}), 404
        if not _is_allowed_preview_url(resolved_url or normalized_url):
            return jsonify({'success': False, 'error': 'forbidden_host'}), 400

        response = Response(image_bytes, mimetype=mime_type)
        response.headers['Cache-Control'] = 'private, max-age=3600'
        return response
