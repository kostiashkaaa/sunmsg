import logging
import secrets

from flask import Flask, g, redirect, request
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
from app.bootstrap.security import (
    apply_proxy_fix_if_enabled,
    require_production_realtime_backing_services,
    require_production_security_baseline,
)
from app.db.connection import close_request_db_connection
from app.extensions import init_extensions
from app.routes.auth import auth_bp
from app.routes.chat import chat_bp
from app.routes.contacts import contacts_bp
from app.routes.moderation import moderation_bp
from app.routes.support import support_bp
from app.services.presence import configure_presence

logger = logging.getLogger(__name__)

csrf = CSRFProtect()

# Backward compatibility for modules importing from app.
_require_production_realtime_backing_services = require_production_realtime_backing_services
_require_production_security_baseline = require_production_security_baseline
_apply_proxy_fix_if_enabled = apply_proxy_fix_if_enabled


def create_app(config_name=None, overrides=None):
    app = Flask(__name__, template_folder="../templates", static_folder="../static")
    load_app_config(app, config_name=config_name, overrides=overrides)

    configure_testing_database_schema(app, overrides=overrides)
    apply_proxy_fix_if_enabled(app)

    if app.config.get("USING_DEV_SECRET_KEY"):
        logger.warning("Using development SECRET_KEY fallback.")

    enforce_production_runtime_guards(app, overrides=overrides)
    sync_runtime_environment(app)

    Compress(app)
    app.secret_key = app.config["SECRET_KEY"]
    is_production = app.config["ENV_NAME"] == "production"
    configure_presence(app.config.get("REDIS_URL"), app.config["ENV_NAME"])

    @app.before_request
    def _prepare_request_context():
        g.csp_nonce = secrets.token_urlsafe(16)

    @app.teardown_appcontext
    def _close_request_db_connection(_exception):
        close_request_db_connection()

    init_extensions(app)
    csrf.init_app(app)

    app.register_blueprint(auth_bp)
    app.register_blueprint(chat_bp)
    app.register_blueprint(contacts_bp)
    app.register_blueprint(moderation_bp)
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
