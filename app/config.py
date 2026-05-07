from __future__ import annotations

import os
from datetime import timedelta

from dotenv import load_dotenv

_ENV_LOADED = False


def load_environment() -> None:
    global _ENV_LOADED
    if _ENV_LOADED:
        return
    load_dotenv(override=False)
    _ENV_LOADED = True


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {'1', 'true', 'yes', 'on'}


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except (TypeError, ValueError):
        return default


def _env_csv(name: str, default: str) -> tuple[str, ...]:
    raw = os.environ.get(name)
    source = raw if raw is not None else default
    parts = [part.strip().lower() for part in str(source or '').split(',')]
    return tuple(part for part in parts if part)


class BaseConfig:
    ENV_NAME = 'development'
    DEBUG = False
    TESTING = False
    IS_PRODUCTION = False
    FORCE_HTTPS = False
    SESSION_COOKIE_SECURE = False
    SCHEDULER_ENABLED = True
    START_SCHEDULER_IN_WEB = False
    RUN_MIGRATIONS_ON_STARTUP = False
    WTF_CSRF_ENABLED = True
    WTF_CSRF_TIME_LIMIT = None
    ALLOW_UNSAFE_WERKZEUG = True
    ALLOW_EMBEDDED_WEB_SERVER = True
    PROXY_FIX_X_FOR = 0
    PROXY_FIX_X_PROTO = 0
    PROXY_FIX_X_HOST = 0
    PROXY_FIX_X_PORT = 0
    PROXY_FIX_X_PREFIX = 0
    CONNECT_SRC_HOSTS = ''
    MEDIA_SRC_HOSTS = ''
    CSP_STYLE_UNSAFE_INLINE = True
    DATABASE_BACKUP_DIR = ''
    CHAT_MEDIA_CACHE_MAX_AGE_SECONDS = 3600
    CHAT_MEDIA_AV_SCAN_ENABLED = False
    CHAT_MEDIA_AV_FAIL_CLOSED = False
    CHAT_MEDIA_AV_TIMEOUT_SECONDS = 20
    CHAT_MEDIA_AV_COMMAND = (
        'clamdscan --fdpass --no-summary {path} || '
        'clamscan --no-summary --infected --stdout {path}'
    )
    CHAT_MEDIA_AV_SCAN_EXTENSIONS = 'zip,rar,7z'
    RATELIMIT_DEFAULT = '300 per minute'
    RATELIMIT_APPLICATION = '5000 per minute'
    SOCKET_CONNECT_IP_LIMIT = 180
    SOCKET_CONNECT_IP_WINDOW_SECONDS = 60
    SOCKET_MAX_CONNECTIONS_PER_USER = 12
    WEB_PUSH_ENABLED = False
    WEB_PUSH_VAPID_PUBLIC_KEY = ''
    WEB_PUSH_VAPID_PRIVATE_KEY = ''
    WEB_PUSH_VAPID_SUBJECT = 'mailto:noreply@sunmessenger.local'
    MODERATOR_USER_IDS = ''
    MODERATION_BLOCKED_PUBLIC_DOMAINS = ''
    MODERATION_HIGH_RISK_IP_CIDRS = ''
    MODERATION_AUTO_ACTION_THRESHOLD = 0.85
    MODERATION_AUTO_ACTION_TYPE = 'mute_temp'
    MODERATION_AUTO_ACTION_TTL_SECONDS = 3600
    MODERATION_REPORT_RATE_WINDOW_SECONDS = 3600
    MODERATION_REPEAT_WINDOW_DAYS = 90
    MODERATION_REPORT_RATE_THRESHOLD = 5
    MODERATION_REPORT_ASYNC_ENABLED = True
    MODERATION_JOB_MAX_ATTEMPTS = 5
    MODERATION_JOB_RETRY_DELAY_SECONDS = 30
    MODERATION_WORKER_ID = 'moderation-worker'
    MODERATION_SLA_PRIORITY_1_SECONDS = 15 * 60
    MODERATION_SLA_PRIORITY_2_SECONDS = 60 * 60
    MODERATION_SLA_PRIORITY_3_SECONDS = 4 * 60 * 60
    MODERATION_SLA_PRIORITY_4_SECONDS = 12 * 60 * 60

    @classmethod
    def default_socketio_origins(cls) -> str:
        return 'https://sunmessenger.ru' if cls.IS_PRODUCTION else '*'

    @classmethod
    def from_env(cls) -> dict:
        load_environment()

        secret_key = os.environ.get('SECRET_KEY')
        using_dev_secret_key = not bool(secret_key)
        if not secret_key:
            if cls.IS_PRODUCTION:
                raise RuntimeError('SECRET_KEY must be set in production')
            secret_key = 'dev_only_secret_key_change_me_at_least_32_bytes_long'

        socketio_async_mode = (
            os.environ.get('SOCKETIO_ASYNC_MODE', 'threading').strip() or 'threading'
        )
        socketio_client_transports = os.environ.get('SOCKETIO_CLIENT_TRANSPORTS')
        if socketio_client_transports is None:
            socketio_client_transports = (
                'polling,websocket'
                if socketio_async_mode == 'threading'
                else 'websocket,polling'
            )
        redis_url = str(os.environ.get('REDIS_URL') or '').strip()
        ratelimit_storage_uri = str(os.environ.get('RATELIMIT_STORAGE_URI') or '').strip()
        if not ratelimit_storage_uri:
            ratelimit_storage_uri = redis_url or 'memory://'
        socketio_message_queue = str(os.environ.get('SOCKETIO_MESSAGE_QUEUE') or '').strip()
        if not socketio_message_queue:
            socketio_message_queue = redis_url
        database_url = str(os.environ.get('DATABASE_URL') or '').strip()
        if not database_url:
            raise RuntimeError('DATABASE_URL must be set')
        test_database_url = str(os.environ.get('TEST_DATABASE_URL') or '').strip()

        return {
            'ENV_NAME': cls.ENV_NAME,
            'DEBUG': _env_bool('APP_DEBUG', cls.DEBUG),
            'TESTING': cls.TESTING or _env_bool('APP_TESTING', False),
            'SECRET_KEY': secret_key,
            'USING_DEV_SECRET_KEY': using_dev_secret_key,
            'SESSION_COOKIE_SECURE': cls.SESSION_COOKIE_SECURE
            or _env_bool('SESSION_COOKIE_SECURE', False),
            'SESSION_COOKIE_HTTPONLY': True,
            'SESSION_COOKIE_SAMESITE': os.environ.get('SESSION_COOKIE_SAMESITE', 'Lax'),
            'PERMANENT_SESSION_LIFETIME': timedelta(
                days=_env_int('PERMANENT_SESSION_LIFETIME_DAYS', 30)
            ),
            'MAX_CONTENT_LENGTH': _env_int('MAX_CONTENT_LENGTH_MB', 100) * 1024 * 1024,
            'CHAT_MEDIA_CACHE_MAX_AGE_SECONDS': max(
                0,
                _env_int(
                    'CHAT_MEDIA_CACHE_MAX_AGE_SECONDS',
                    cls.CHAT_MEDIA_CACHE_MAX_AGE_SECONDS,
                ),
            ),
            'CHAT_MEDIA_AV_SCAN_ENABLED': _env_bool(
                'CHAT_MEDIA_AV_SCAN_ENABLED',
                cls.CHAT_MEDIA_AV_SCAN_ENABLED,
            ),
            'CHAT_MEDIA_AV_FAIL_CLOSED': _env_bool(
                'CHAT_MEDIA_AV_FAIL_CLOSED',
                cls.CHAT_MEDIA_AV_FAIL_CLOSED,
            ),
            'CHAT_MEDIA_AV_TIMEOUT_SECONDS': max(
                1,
                _env_int(
                    'CHAT_MEDIA_AV_TIMEOUT_SECONDS',
                    cls.CHAT_MEDIA_AV_TIMEOUT_SECONDS,
                ),
            ),
            'CHAT_MEDIA_AV_COMMAND': str(
                os.environ.get('CHAT_MEDIA_AV_COMMAND', cls.CHAT_MEDIA_AV_COMMAND)
                or ''
            ).strip(),
            'CHAT_MEDIA_AV_SCAN_EXTENSIONS': _env_csv(
                'CHAT_MEDIA_AV_SCAN_EXTENSIONS',
                cls.CHAT_MEDIA_AV_SCAN_EXTENSIONS,
            ),
            'DATABASE_URL': database_url,
            'TEST_DATABASE_URL': test_database_url,
            'DATABASE_BACKEND': 'postgres',
            'DATABASE_BACKUP_DIR': os.environ.get(
                'DATABASE_BACKUP_DIR',
                cls.DATABASE_BACKUP_DIR,
            ),
            'REDIS_URL': redis_url,
            'RATELIMIT_STORAGE_URI': ratelimit_storage_uri,
            'RATELIMIT_DEFAULT': os.environ.get(
                'RATELIMIT_DEFAULT',
                cls.RATELIMIT_DEFAULT,
            ),
            'RATELIMIT_APPLICATION': os.environ.get(
                'RATELIMIT_APPLICATION',
                cls.RATELIMIT_APPLICATION,
            ),
            'SOCKETIO_ASYNC_MODE': socketio_async_mode,
            'SOCKETIO_MESSAGE_QUEUE': socketio_message_queue,
            'SOCKETIO_CORS_ORIGINS': os.environ.get(
                'SOCKETIO_CORS_ORIGINS',
                cls.default_socketio_origins(),
            ),
            'SOCKETIO_CLIENT_TRANSPORTS': socketio_client_transports,
            'SOCKETIO_CLIENT_UPGRADE': _env_bool(
                'SOCKETIO_CLIENT_UPGRADE',
                socketio_async_mode != 'threading',
            ),
            'SOCKETIO_PING_TIMEOUT': _env_int('SOCKETIO_PING_TIMEOUT', 30),
            'SOCKETIO_PING_INTERVAL': _env_int('SOCKETIO_PING_INTERVAL', 15),
            'SOCKETIO_MAX_HTTP_BUFFER_SIZE': _env_int(
                'SOCKETIO_MAX_HTTP_BUFFER_SIZE_MB',
                16,
            )
            * 1024
            * 1024,
            'SOCKET_CONNECT_IP_LIMIT': max(
                0,
                _env_int('SOCKET_CONNECT_IP_LIMIT', cls.SOCKET_CONNECT_IP_LIMIT),
            ),
            'SOCKET_CONNECT_IP_WINDOW_SECONDS': max(
                1,
                _env_int(
                    'SOCKET_CONNECT_IP_WINDOW_SECONDS',
                    cls.SOCKET_CONNECT_IP_WINDOW_SECONDS,
                ),
            ),
            'SOCKET_MAX_CONNECTIONS_PER_USER': max(
                0,
                _env_int(
                    'SOCKET_MAX_CONNECTIONS_PER_USER',
                    cls.SOCKET_MAX_CONNECTIONS_PER_USER,
                ),
            ),
            'WEB_PUSH_ENABLED': _env_bool('WEB_PUSH_ENABLED', cls.WEB_PUSH_ENABLED),
            'WEB_PUSH_VAPID_PUBLIC_KEY': str(
                os.environ.get(
                    'WEB_PUSH_VAPID_PUBLIC_KEY',
                    cls.WEB_PUSH_VAPID_PUBLIC_KEY,
                )
                or ''
            ).strip(),
            'WEB_PUSH_VAPID_PRIVATE_KEY': str(
                os.environ.get(
                    'WEB_PUSH_VAPID_PRIVATE_KEY',
                    cls.WEB_PUSH_VAPID_PRIVATE_KEY,
                )
                or ''
            ).strip(),
            'WEB_PUSH_VAPID_SUBJECT': str(
                os.environ.get(
                    'WEB_PUSH_VAPID_SUBJECT',
                    cls.WEB_PUSH_VAPID_SUBJECT,
                )
                or ''
            ).strip(),
            'MODERATOR_USER_IDS': str(
                os.environ.get(
                    'MODERATOR_USER_IDS',
                    cls.MODERATOR_USER_IDS,
                )
                or ''
            ).strip(),
            'MODERATION_BLOCKED_PUBLIC_DOMAINS': str(
                os.environ.get(
                    'MODERATION_BLOCKED_PUBLIC_DOMAINS',
                    cls.MODERATION_BLOCKED_PUBLIC_DOMAINS,
                )
                or ''
            ).strip(),
            'MODERATION_HIGH_RISK_IP_CIDRS': str(
                os.environ.get(
                    'MODERATION_HIGH_RISK_IP_CIDRS',
                    cls.MODERATION_HIGH_RISK_IP_CIDRS,
                )
                or ''
            ).strip(),
            'MODERATION_AUTO_ACTION_THRESHOLD': _env_float(
                'MODERATION_AUTO_ACTION_THRESHOLD',
                cls.MODERATION_AUTO_ACTION_THRESHOLD,
            ),
            'MODERATION_AUTO_ACTION_TYPE': str(
                os.environ.get(
                    'MODERATION_AUTO_ACTION_TYPE',
                    cls.MODERATION_AUTO_ACTION_TYPE,
                )
                or cls.MODERATION_AUTO_ACTION_TYPE
            ).strip().lower(),
            'MODERATION_AUTO_ACTION_TTL_SECONDS': max(
                0,
                _env_int(
                    'MODERATION_AUTO_ACTION_TTL_SECONDS',
                    cls.MODERATION_AUTO_ACTION_TTL_SECONDS,
                ),
            ),
            'MODERATION_REPORT_RATE_WINDOW_SECONDS': max(
                60,
                _env_int(
                    'MODERATION_REPORT_RATE_WINDOW_SECONDS',
                    cls.MODERATION_REPORT_RATE_WINDOW_SECONDS,
                ),
            ),
            'MODERATION_REPEAT_WINDOW_DAYS': max(
                1,
                _env_int(
                    'MODERATION_REPEAT_WINDOW_DAYS',
                    cls.MODERATION_REPEAT_WINDOW_DAYS,
                ),
            ),
            'MODERATION_REPORT_RATE_THRESHOLD': max(
                1,
                _env_int(
                    'MODERATION_REPORT_RATE_THRESHOLD',
                    cls.MODERATION_REPORT_RATE_THRESHOLD,
                ),
            ),
            'MODERATION_REPORT_ASYNC_ENABLED': _env_bool(
                'MODERATION_REPORT_ASYNC_ENABLED',
                cls.MODERATION_REPORT_ASYNC_ENABLED,
            ),
            'MODERATION_JOB_MAX_ATTEMPTS': max(
                1,
                _env_int(
                    'MODERATION_JOB_MAX_ATTEMPTS',
                    cls.MODERATION_JOB_MAX_ATTEMPTS,
                ),
            ),
            'MODERATION_JOB_RETRY_DELAY_SECONDS': max(
                1,
                _env_int(
                    'MODERATION_JOB_RETRY_DELAY_SECONDS',
                    cls.MODERATION_JOB_RETRY_DELAY_SECONDS,
                ),
            ),
            'MODERATION_WORKER_ID': str(
                os.environ.get(
                    'MODERATION_WORKER_ID',
                    cls.MODERATION_WORKER_ID,
                )
                or cls.MODERATION_WORKER_ID
            ).strip(),
            'MODERATION_SLA_PRIORITY_1_SECONDS': max(
                60,
                _env_int(
                    'MODERATION_SLA_PRIORITY_1_SECONDS',
                    cls.MODERATION_SLA_PRIORITY_1_SECONDS,
                ),
            ),
            'MODERATION_SLA_PRIORITY_2_SECONDS': max(
                60,
                _env_int(
                    'MODERATION_SLA_PRIORITY_2_SECONDS',
                    cls.MODERATION_SLA_PRIORITY_2_SECONDS,
                ),
            ),
            'MODERATION_SLA_PRIORITY_3_SECONDS': max(
                60,
                _env_int(
                    'MODERATION_SLA_PRIORITY_3_SECONDS',
                    cls.MODERATION_SLA_PRIORITY_3_SECONDS,
                ),
            ),
            'MODERATION_SLA_PRIORITY_4_SECONDS': max(
                60,
                _env_int(
                    'MODERATION_SLA_PRIORITY_4_SECONDS',
                    cls.MODERATION_SLA_PRIORITY_4_SECONDS,
                ),
            ),
            'FORCE_HTTPS': cls.FORCE_HTTPS or _env_bool('FORCE_HTTPS', False),
            'WEBAUTHN_RP_ID': str(os.environ.get('WEBAUTHN_RP_ID') or '').strip(),
            'WEBAUTHN_ORIGIN': str(os.environ.get('WEBAUTHN_ORIGIN') or '').strip(),
            'WEBAUTHN_RP_NAME': str(os.environ.get('WEBAUTHN_RP_NAME') or 'SUN Messenger').strip() or 'SUN Messenger',
            'SCHEDULER_ENABLED': _env_bool('SCHEDULER_ENABLED', cls.SCHEDULER_ENABLED),
            'START_SCHEDULER_IN_WEB': _env_bool(
                'START_SCHEDULER_IN_WEB',
                cls.START_SCHEDULER_IN_WEB,
            ),
            'RUN_MIGRATIONS_ON_STARTUP': _env_bool(
                'RUN_MIGRATIONS_ON_STARTUP',
                cls.RUN_MIGRATIONS_ON_STARTUP,
            ),
            'WTF_CSRF_ENABLED': cls.WTF_CSRF_ENABLED,
            'WTF_CSRF_TIME_LIMIT': cls.WTF_CSRF_TIME_LIMIT,
            'SCRIPT_SRC_HOSTS': os.environ.get(
                'SCRIPT_SRC_HOSTS',
                '',
            ),
            'STYLE_SRC_HOSTS': os.environ.get(
                'STYLE_SRC_HOSTS',
                '',
            ),
            'FONT_SRC_HOSTS': os.environ.get(
                'FONT_SRC_HOSTS',
                '',
            ),
            'IMG_SRC_HOSTS': os.environ.get(
                'IMG_SRC_HOSTS',
                '',
            ),
            'MEDIA_SRC_HOSTS': os.environ.get(
                'MEDIA_SRC_HOSTS',
                cls.MEDIA_SRC_HOSTS,
            ),
            'CONNECT_SRC_HOSTS': os.environ.get(
                'CONNECT_SRC_HOSTS',
                cls.CONNECT_SRC_HOSTS,
            ),
            'CSP_STYLE_UNSAFE_INLINE': _env_bool(
                'CSP_STYLE_UNSAFE_INLINE',
                cls.CSP_STYLE_UNSAFE_INLINE,
            ),
            'HOST': os.environ.get('HOST', '127.0.0.1'),
            'PORT': _env_int('PORT', 5000),
            'TLS_PORT': _env_int('TLS_PORT', 443),
            'TLS_CERT_PATH': os.environ.get(
                'TLS_CERT_PATH',
                '/etc/letsencrypt/live/sunmessenger.ru/fullchain.pem',
            ),
            'TLS_KEY_PATH': os.environ.get(
                'TLS_KEY_PATH',
                '/etc/letsencrypt/live/sunmessenger.ru/privkey.pem',
            ),
            'ALLOW_UNSAFE_WERKZEUG': _env_bool(
                'ALLOW_UNSAFE_WERKZEUG',
                cls.ALLOW_UNSAFE_WERKZEUG,
            ),
            'ALLOW_EMBEDDED_WEB_SERVER': _env_bool(
                'ALLOW_EMBEDDED_WEB_SERVER',
                cls.ALLOW_EMBEDDED_WEB_SERVER,
            ),
            'PROXY_FIX_X_FOR': max(0, _env_int('PROXY_FIX_X_FOR', cls.PROXY_FIX_X_FOR)),
            'PROXY_FIX_X_PROTO': max(0, _env_int('PROXY_FIX_X_PROTO', cls.PROXY_FIX_X_PROTO)),
            'PROXY_FIX_X_HOST': max(0, _env_int('PROXY_FIX_X_HOST', cls.PROXY_FIX_X_HOST)),
            'PROXY_FIX_X_PORT': max(0, _env_int('PROXY_FIX_X_PORT', cls.PROXY_FIX_X_PORT)),
            'PROXY_FIX_X_PREFIX': max(0, _env_int('PROXY_FIX_X_PREFIX', cls.PROXY_FIX_X_PREFIX)),
        }


class DevelopmentConfig(BaseConfig):
    ENV_NAME = 'development'
    RUN_MIGRATIONS_ON_STARTUP = True


class TestingConfig(BaseConfig):
    ENV_NAME = 'testing'
    TESTING = True
    SCHEDULER_ENABLED = False
    START_SCHEDULER_IN_WEB = False
    RUN_MIGRATIONS_ON_STARTUP = True
    CSP_STYLE_UNSAFE_INLINE = False
    WTF_CSRF_ENABLED = False


class ProductionConfig(BaseConfig):
    ENV_NAME = 'production'
    IS_PRODUCTION = True
    FORCE_HTTPS = True
    SESSION_COOKIE_SECURE = True
    ALLOW_UNSAFE_WERKZEUG = False
    ALLOW_EMBEDDED_WEB_SERVER = False
    PROXY_FIX_X_FOR = 1
    PROXY_FIX_X_PROTO = 1
    PROXY_FIX_X_HOST = 1
    PROXY_FIX_X_PORT = 1
    CSP_STYLE_UNSAFE_INLINE = False
    DATABASE_BACKUP_DIR = '/srv/sunmessenger/shared/backups'
    CHAT_MEDIA_AV_SCAN_ENABLED = True
    CHAT_MEDIA_AV_FAIL_CLOSED = True
    WEB_PUSH_ENABLED = False


CONFIG_MAP = {
    'development': DevelopmentConfig,
    'dev': DevelopmentConfig,
    'testing': TestingConfig,
    'test': TestingConfig,
    'production': ProductionConfig,
    'prod': ProductionConfig,
}


def get_config_class(config_name: str | None = None):
    load_environment()
    selected = (
        config_name
        or os.environ.get('APP_ENV')
        or os.environ.get('FLASK_ENV')
        or ('testing' if _env_bool('APP_TESTING', False) else 'development')
    )
    return CONFIG_MAP.get(str(selected).strip().lower(), DevelopmentConfig)
