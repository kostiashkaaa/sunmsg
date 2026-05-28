import logging
import secrets
import time

from flask import Flask, g, jsonify, redirect, request, session
from flask_compress import Compress
from flask_wtf.csrf import CSRFProtect

from app.bootstrap.assets import register_asset_helpers
from app.bootstrap.csp import register_security_headers
from app.bootstrap.env_boot import (
    configure_testing_database_schema,
    enforce_production_runtime_guards,
    load_app_config,
    sync_runtime_environment,
)
from app.bootstrap.errors import register_error_handlers
from app.bootstrap.logging_config import configure_logging
from app.bootstrap.observability import init_sentry
from app.bootstrap.security import (
    apply_proxy_fix_if_enabled,
    require_production_realtime_backing_services,
    require_production_security_baseline,
)
from app.db.connection import close_request_db_connection
from app.extensions import init_extensions
from app.routes.auth import auth_bp
from app.routes.call_routes import call_bp
from app.routes.chat import chat_bp
from app.routes.contacts import contacts_bp
from app.routes.crypto_v2_routes import crypto_v2_bp
from app.routes.health import health_bp
from app.routes.mobile import mobile_bp
from app.routes.moderation import moderation_bp
from app.routes.spotify import spotify_bp
from app.routes.support import support_bp
from app.services.presence import configure_presence
from app.services.operations_metrics import record_http_request

logger = logging.getLogger(__name__)

csrf = CSRFProtect()

# Backward compatibility for modules importing from app.
_require_production_realtime_backing_services = require_production_realtime_backing_services
_require_production_security_baseline = require_production_security_baseline
_apply_proxy_fix_if_enabled = apply_proxy_fix_if_enabled


def create_app(config_name=None, overrides=None):
    app = Flask(__name__, template_folder="../templates", static_folder="../static")
    load_app_config(app, config_name=config_name, overrides=overrides)
    configure_logging(app.config)

    configure_testing_database_schema(app, overrides=overrides)
    apply_proxy_fix_if_enabled(app)

    if app.config.get("USING_DEV_SECRET_KEY"):
        logger.warning("Using development SECRET_KEY fallback.")

    enforce_production_runtime_guards(app, overrides=overrides)
    sync_runtime_environment(app)

    # Initialise Sentry as early as possible so subsequent bootstrap errors
    # (extensions, blueprint loading) are captured.
    init_sentry(app)

    Compress(app)
    app.secret_key = app.config["SECRET_KEY"]
    is_production = app.config["ENV_NAME"] == "production"
    configure_presence(app.config.get("REDIS_URL"), app.config["ENV_NAME"])

    @app.before_request
    def _prepare_request_context():
        g.csp_nonce = secrets.token_urlsafe(16)
        g.request_started_monotonic = time.perf_counter()

    @app.after_request
    def _record_request_metrics(response):
        started = getattr(g, 'request_started_monotonic', None)
        if started is not None and not request.path.startswith('/static/'):
            route = request.url_rule.rule if request.url_rule is not None else 'unmatched'
            record_http_request(
                method=request.method,
                route=route,
                status_code=response.status_code,
                duration_seconds=time.perf_counter() - float(started),
            )
        return response

    @app.before_request
    def _enforce_session_auto_logout():
        if request.path.startswith('/static/') or request.path == '/favicon.ico':
            return None
        if request.path in {'/api/refresh', '/logout', '/api/logout'}:
            return None
        if request.path in {'/health', '/healthz', '/ready', '/readyz'}:
            return None
        user_id = session.get('user_id')
        if not user_id:
            return None

        from app.services.refresh_tokens import REFRESH_COOKIE_NAME, touch_refresh_token
        from app.services.session_policy import normalize_session_auto_logout_seconds

        now = int(time.time())
        ttl_seconds = normalize_session_auto_logout_seconds(session.get('session_auto_logout_seconds'))
        try:
            expires_at = int(session.get('session_expires_at') or 0)
        except (TypeError, ValueError):
            expires_at = 0
        if expires_at and expires_at <= now:
            session.clear()
            if request.path == '/':
                return None
            if request.path.startswith('/api/'):
                return jsonify({'success': False, 'error': 'Сессия истекла.'}), 401
            return redirect('/')

        session.permanent = True
        session['session_auto_logout_seconds'] = ttl_seconds
        session['session_expires_at'] = now + ttl_seconds

        try:
            last_touch = int(session.get('session_last_activity_touch_at') or 0)
        except (TypeError, ValueError):
            last_touch = 0
        if now - last_touch >= 60 * 60:
            raw_token = request.cookies.get(REFRESH_COOKIE_NAME)
            if raw_token:
                touch_refresh_token(raw_token, int(user_id), ttl_seconds=ttl_seconds)
            session['session_last_activity_touch_at'] = now
        return None

    @app.teardown_appcontext
    def _close_request_db_connection(_exception):
        close_request_db_connection()

    init_extensions(app)
    csrf.init_app(app)

    app.register_blueprint(auth_bp)
    app.register_blueprint(call_bp)
    app.register_blueprint(chat_bp)
    app.register_blueprint(contacts_bp)
    app.register_blueprint(crypto_v2_bp)
    app.register_blueprint(health_bp)
    csrf.exempt(health_bp)  # Probes are unauthenticated GETs; CSRF is not applicable
    app.register_blueprint(mobile_bp)
    app.register_blueprint(moderation_bp)
    app.register_blueprint(spotify_bp)
    app.register_blueprint(support_bp)

    register_asset_helpers(app)

    if app.config.get("FORCE_HTTPS"):
        @app.before_request
        def enforce_https():
            proto = request.headers.get("X-Forwarded-Proto", request.scheme)
            if proto == "http":
                url = request.url.replace("http://", "https://", 1)
                return redirect(url, code=301)

    register_security_headers(app, is_production=is_production)
    register_error_handlers(app, logger)

    if app.config.get("START_SCHEDULER_IN_WEB", False):
        from app.services.scheduler_runtime import start_scheduler_if_enabled

        start_scheduler_if_enabled(app.config)

    from app.sockets import events  # noqa: F401

    return app
