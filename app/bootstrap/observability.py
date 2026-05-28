"""
Observability bootstrap: Sentry SDK initialization.

Sentry is enabled only when SENTRY_DSN is set. We initialize it once per
process before create_app() returns, so that handlers registered by
register_error_handlers() can re-raise into Sentry's hooks.

We never send PII by default (send_default_pii=False). Request bodies are
scrubbed: chat payloads can contain ciphertext + recipient identifiers
which we treat as sensitive.
"""
from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)

_INITIALIZED = False


def _scrub_event(event, hint):  # noqa: ANN001 — Sentry SDK signature
    """Strip request body and cookies before sending to Sentry."""
    request = event.get('request') if isinstance(event, dict) else None
    if isinstance(request, dict):
        request.pop('data', None)
        request.pop('cookies', None)
        headers = request.get('headers')
        if isinstance(headers, dict):
            for sensitive in ('Cookie', 'Authorization', 'X-CSRF-Token', 'X-CSRFToken'):
                headers.pop(sensitive, None)
    return event


def init_sentry(app) -> bool:
    """
    Initialize Sentry if SENTRY_DSN is set. Returns True if initialized.

    Idempotent: subsequent calls (e.g. in tests that recreate the app) are no-ops.
    """
    global _INITIALIZED
    if _INITIALIZED:
        return True

    dsn = str(os.environ.get('SENTRY_DSN') or '').strip()
    if not dsn:
        if app.config.get('ENV_NAME') == 'production':
            logger.warning(
                'SENTRY_DSN is not set in production; '
                'unhandled exceptions will only appear in local logs.'
            )
        return False

    try:
        import sentry_sdk
        from sentry_sdk.integrations.flask import FlaskIntegration
    except ImportError:
        logger.warning('SENTRY_DSN is set but sentry-sdk is not installed.')
        return False

    environment = str(app.config.get('ENV_NAME') or 'development')
    release = (
        str(os.environ.get('DEPLOY_SHA') or os.environ.get('APP_RELEASE') or '').strip()
        or None
    )
    traces_sample_rate = _env_float('SENTRY_TRACES_SAMPLE_RATE', 0.0)
    profiles_sample_rate = _env_float('SENTRY_PROFILES_SAMPLE_RATE', 0.0)

    sentry_sdk.init(
        dsn=dsn,
        integrations=[FlaskIntegration()],
        environment=environment,
        release=release,
        traces_sample_rate=traces_sample_rate,
        profiles_sample_rate=profiles_sample_rate,
        send_default_pii=False,
        before_send=_scrub_event,
        # Keep breadcrumb volume reasonable for chat workload.
        max_breadcrumbs=50,
    )
    _INITIALIZED = True
    logger.info(
        'Sentry initialized: env=%s release=%s traces=%.2f',
        environment,
        release or '(none)',
        traces_sample_rate,
    )
    return True


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return default
    if value < 0.0:
        return 0.0
    if value > 1.0:
        return 1.0
    return value
