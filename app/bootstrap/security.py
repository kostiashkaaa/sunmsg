import logging

from flask import Flask
from werkzeug.middleware.proxy_fix import ProxyFix

logger = logging.getLogger(__name__)


def _is_redis_like_uri(value) -> bool:
    raw = str(value or "").strip().lower()
    return raw.startswith(("redis://", "rediss://", "redis+unix://", "unix://"))


def require_production_realtime_backing_services(config) -> None:
    if config["ENV_NAME"] != "production":
        return

    required = (
        ("REDIS_URL", "presence store"),
        ("RATELIMIT_STORAGE_URI", "rate limiter storage"),
        ("SOCKETIO_MESSAGE_QUEUE", "Socket.IO message queue"),
    )
    for config_key, purpose in required:
        value = config.get(config_key)
        if not str(value or "").strip():
            raise RuntimeError(
                f"{config_key} must be set in production ({purpose})."
            )
        if not _is_redis_like_uri(value):
            raise RuntimeError(
                f"{config_key} must point to Redis in production "
                f"(expected redis://, rediss://, redis+unix://, or unix:// for {purpose})."
            )


def _is_default_or_weak_production_secret(
    secret_key: str, *, using_dev_secret: bool
) -> bool:
    if using_dev_secret:
        return True

    normalized = str(secret_key or "").strip()
    if len(normalized) < 32:
        return True

    lowered = normalized.lower()
    weak_defaults = {
        "change-me",
        "replace-with-64-bytes-random-secret",
        "dev_only_secret_key_change_me_at_least_32_bytes_long",
        "default-secret-key",
    }
    return lowered in weak_defaults


def _cors_origins_include_wildcard(origins) -> bool:
    if isinstance(origins, (list, tuple, set)):
        values = [str(item or "").strip() for item in origins]
    else:
        values = [part.strip() for part in str(origins or "").split(",")]
    return any(value == "*" for value in values if value)


def require_production_security_baseline(config) -> None:
    if config["ENV_NAME"] != "production":
        return

    if bool(config.get("DEBUG")):
        raise RuntimeError("DEBUG must remain disabled in production.")

    if _cors_origins_include_wildcard(config.get("SOCKETIO_CORS_ORIGINS")):
        raise RuntimeError('SOCKETIO_CORS_ORIGINS cannot include wildcard "*" in production.')

    if _is_default_or_weak_production_secret(
        str(config.get("SECRET_KEY") or ""),
        using_dev_secret=bool(config.get("USING_DEV_SECRET_KEY")),
    ):
        raise RuntimeError(
            "SECRET_KEY must be a strong non-default value of at least 32 characters in production."
        )

    if not bool(config.get("SESSION_COOKIE_SECURE")):
        raise RuntimeError("SESSION_COOKIE_SECURE must be enabled in production.")

    if int(config.get("PROXY_FIX_X_FOR", 0) or 0) < 1:
        raise RuntimeError("PROXY_FIX_X_FOR must be >= 1 in production.")
    if int(config.get("PROXY_FIX_X_PROTO", 0) or 0) < 1:
        raise RuntimeError("PROXY_FIX_X_PROTO must be >= 1 in production.")

    if bool(config.get("ALLOW_UNSAFE_WERKZEUG")):
        raise RuntimeError("ALLOW_UNSAFE_WERKZEUG must remain disabled in production.")
    if bool(config.get("ALLOW_EMBEDDED_WEB_SERVER")):
        raise RuntimeError("ALLOW_EMBEDDED_WEB_SERVER must remain disabled in production.")

    if bool(config.get("CSP_STYLE_UNSAFE_INLINE")):
        raise RuntimeError("CSP_STYLE_UNSAFE_INLINE must remain disabled in production.")

    if not bool(config.get("CHAT_MEDIA_AV_SCAN_ENABLED")):
        raise RuntimeError("CHAT_MEDIA_AV_SCAN_ENABLED must be enabled in production.")
    if not bool(config.get("CHAT_MEDIA_AV_FAIL_CLOSED")):
        raise RuntimeError("CHAT_MEDIA_AV_FAIL_CLOSED must be enabled in production.")
    if not str(config.get("CHAT_MEDIA_AV_COMMAND") or "").strip():
        raise RuntimeError("CHAT_MEDIA_AV_COMMAND must be configured in production.")

    if bool(config.get("WEB_PUSH_ENABLED")):
        if not str(config.get("WEB_PUSH_VAPID_PUBLIC_KEY") or "").strip():
            raise RuntimeError("WEB_PUSH_VAPID_PUBLIC_KEY must be configured in production.")
        if not str(config.get("WEB_PUSH_VAPID_PRIVATE_KEY") or "").strip():
            raise RuntimeError("WEB_PUSH_VAPID_PRIVATE_KEY must be configured in production.")
        if not str(config.get("WEB_PUSH_VAPID_SUBJECT") or "").strip():
            raise RuntimeError("WEB_PUSH_VAPID_SUBJECT must be configured in production.")


def apply_proxy_fix_if_enabled(app: Flask) -> None:
    x_for = int(app.config.get("PROXY_FIX_X_FOR", 0) or 0)
    x_proto = int(app.config.get("PROXY_FIX_X_PROTO", 0) or 0)
    x_host = int(app.config.get("PROXY_FIX_X_HOST", 0) or 0)
    x_port = int(app.config.get("PROXY_FIX_X_PORT", 0) or 0)
    x_prefix = int(app.config.get("PROXY_FIX_X_PREFIX", 0) or 0)

    if not any((x_for, x_proto, x_host, x_port, x_prefix)):
        return

    app.wsgi_app = ProxyFix(  # type: ignore[assignment]
        app.wsgi_app,
        x_for=x_for,
        x_proto=x_proto,
        x_host=x_host,
        x_port=x_port,
        x_prefix=x_prefix,
    )
    logger.info(
        "ProxyFix enabled (x_for=%s, x_proto=%s, x_host=%s, x_port=%s, x_prefix=%s)",
        x_for,
        x_proto,
        x_host,
        x_port,
        x_prefix,
    )
