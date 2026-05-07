import logging

from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_socketio import SocketIO

logger = logging.getLogger(__name__)

socketio = SocketIO()
limiter = Limiter(key_func=get_remote_address)
_DEFAULT_FALLBACK_LIMIT = '300 per minute'
_DEFAULT_APPLICATION_LIMIT = '5000 per minute'


def _parse_socketio_origins(value):
    if isinstance(value, (list, tuple, set)):
        return [str(origin).strip() for origin in value if str(origin).strip()]

    raw = str(value or '').strip()
    if not raw or raw == '*':
        return '*'
    return [origin.strip() for origin in raw.split(',') if origin.strip()]


def init_extensions(app) -> None:
    message_queue = str(app.config.get('SOCKETIO_MESSAGE_QUEUE') or '').strip() or None
    if app.config.get('ENV_NAME') == 'production':
        cors_allowed_origins = _parse_socketio_origins(app.config['SOCKETIO_CORS_ORIGINS'])
    else:
        # In local/dev/testing we disable Engine.IO origin enforcement to avoid
        # brittle localhost+ephemeral-port mismatches in browser automation.
        cors_allowed_origins = []
    app.config.setdefault('RATELIMIT_DEFAULT', _DEFAULT_FALLBACK_LIMIT)
    app.config.setdefault('RATELIMIT_APPLICATION', _DEFAULT_APPLICATION_LIMIT)

    limiter.init_app(app)
    # Flask-SocketIO keeps server_options on the singleton instance.
    # Reset per-app options to avoid leaking message_queue across create_app() calls.
    socketio.server_options = {}
    socketio.init_app(
        app,
        async_mode=app.config['SOCKETIO_ASYNC_MODE'],
        message_queue=message_queue,
        cors_allowed_origins=cors_allowed_origins,
        ping_timeout=app.config['SOCKETIO_PING_TIMEOUT'],
        ping_interval=app.config['SOCKETIO_PING_INTERVAL'],
        manage_session=True,
        max_http_buffer_size=app.config['SOCKETIO_MAX_HTTP_BUFFER_SIZE'],
    )

    if (
        app.config['ENV_NAME'] == 'production'
        and str(app.config['RATELIMIT_STORAGE_URI']).startswith('memory://')
    ):
        logger.warning(
            'RATELIMIT_STORAGE_URI is memory:// in production; '
            'distributed rate limiting will be inconsistent across workers.'
        )

    if (
        app.config['ENV_NAME'] == 'production'
        and app.config['SOCKETIO_ASYNC_MODE'] == 'threading'
    ):
        logger.warning(
            'SocketIO async_mode=threading in production. '
            'Use a threaded worker deployment such as gunicorn + simple-websocket.'
        )

    if app.config['ENV_NAME'] == 'production' and not message_queue:
        logger.warning(
            'SOCKETIO_MESSAGE_QUEUE is not configured in production; '
            'cross-worker realtime events will be inconsistent.'
        )
