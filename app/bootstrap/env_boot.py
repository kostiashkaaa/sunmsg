import os
from pathlib import Path

from flask import Flask

from app.config import get_config_class, load_environment
from app.database import run_migrations
from app.db_backend import ensure_postgres_schema, testing_schema_from_identifier
from app.bootstrap.security import (
    require_production_realtime_backing_services,
    require_production_security_baseline,
)


def load_app_config(app: Flask, config_name=None, overrides=None):
    load_environment()
    config_class = get_config_class(config_name)
    app.config.from_mapping(config_class.from_env())
    if overrides:
        app.config.update(overrides)
    if app.config.get("TESTING"):
        # Tests must stay hermetic and never inherit sticky runtime realtime env
        # from previously initialized app instances in the same Python process.
        if not (overrides and "REDIS_URL" in overrides):
            app.config["REDIS_URL"] = ""
        if not (overrides and "RATELIMIT_STORAGE_URI" in overrides):
            app.config["RATELIMIT_STORAGE_URI"] = "memory://"
        if not (overrides and "SOCKETIO_MESSAGE_QUEUE" in overrides):
            app.config["SOCKETIO_MESSAGE_QUEUE"] = ""
    if app.config.get("TESTING") and not (overrides and "CSP_STYLE_UNSAFE_INLINE" in overrides):
        app.config["CSP_STYLE_UNSAFE_INLINE"] = False


def _quote_ident(value: str) -> str:
    return '"' + str(value or '').replace('"', '""') + '"'


def _reset_postgres_schema(database_url: str, schema_name: str) -> None:
    dsn = str(database_url or '').strip()
    schema = str(schema_name or '').strip()
    if not dsn or not schema:
        return
    try:
        import psycopg
    except ImportError:
        return

    safe_schema = _quote_ident(schema)
    with psycopg.connect(dsn, autocommit=True, options='-c timezone=UTC', connect_timeout=5) as raw_conn:
        with raw_conn.cursor() as cur:
            cur.execute(f'DROP SCHEMA IF EXISTS {safe_schema} CASCADE')
            cur.execute(f'CREATE SCHEMA IF NOT EXISTS {safe_schema}')


def configure_testing_database_schema(app: Flask, overrides=None) -> str:
    # Legacy tests may still pass DATABASE_PATH while runtime is PostgreSQL-only.
    # In testing mode we map each path to an isolated PostgreSQL schema.
    legacy_database_path = ""
    if app.config.get("TESTING"):
        explicit_database_url = str((overrides or {}).get("DATABASE_URL") or "").strip()
        runtime_database_url = str(app.config.get("DATABASE_URL") or "").strip()
        runtime_baseline_database_url = str(os.environ.get("RUNTIME_DATABASE_URL_ORIGINAL") or "").strip()
        if not runtime_baseline_database_url and runtime_database_url:
            os.environ["RUNTIME_DATABASE_URL_ORIGINAL"] = runtime_database_url
            runtime_baseline_database_url = runtime_database_url
        test_database_url = str(
            (overrides or {}).get("TEST_DATABASE_URL")
            or app.config.get("TEST_DATABASE_URL")
            or os.environ.get("TEST_DATABASE_URL")
            or ""
        ).strip()

        if not explicit_database_url:
            if not test_database_url:
                raise RuntimeError(
                    "TEST_DATABASE_URL must be set in testing mode to isolate tests from runtime database."
                )
            comparison_database_url = runtime_baseline_database_url or runtime_database_url
            if comparison_database_url and test_database_url == comparison_database_url:
                raise RuntimeError(
                    "TEST_DATABASE_URL must differ from DATABASE_URL in testing mode."
                )
            app.config["DATABASE_URL"] = test_database_url

        if overrides and str(overrides.get("DATABASE_URL") or "").strip():
            os.environ.pop("DATABASE_SCHEMA", None)
        else:
            legacy_database_path_raw = str((overrides or {}).get("DATABASE_PATH") or "").strip()
            if legacy_database_path_raw:
                try:
                    legacy_database_path = str(Path(legacy_database_path_raw).resolve())
                except OSError:
                    legacy_database_path = legacy_database_path_raw
                try:
                    legacy_db_file = Path(legacy_database_path)
                    legacy_db_file.parent.mkdir(parents=True, exist_ok=True)
                    legacy_db_file.touch(exist_ok=True)
                except OSError:
                    pass
                schema_name = testing_schema_from_identifier(legacy_database_path)
                app.config["DATABASE_SCHEMA"] = schema_name
                os.environ["DATABASE_SCHEMA"] = schema_name
                _reset_postgres_schema(app.config.get("DATABASE_URL"), schema_name)
                ensure_postgres_schema(app.config.get("DATABASE_URL"), schema_name)
            else:
                os.environ.pop("DATABASE_SCHEMA", None)
    return legacy_database_path


def enforce_production_runtime_guards(app: Flask, overrides=None) -> None:
    if app.config["ENV_NAME"] != "production":
        return

    if app.config.get("START_SCHEDULER_IN_WEB", False):
        raise RuntimeError(
            "START_SCHEDULER_IN_WEB must remain disabled in production. "
            "Run `python manage.py scheduler` as a separate process."
        )
    if app.config.get("RUN_MIGRATIONS_ON_STARTUP", False):
        raise RuntimeError(
            "RUN_MIGRATIONS_ON_STARTUP must remain disabled in production. "
            "Run `python manage.py maintenance` separately before starting web workers."
        )

    realtime_override_keys = {"REDIS_URL", "RATELIMIT_STORAGE_URI", "SOCKETIO_MESSAGE_QUEUE"}
    has_explicit_realtime_overrides = any(key in (overrides or {}) for key in realtime_override_keys)
    if has_explicit_realtime_overrides:
        require_production_realtime_backing_services(app.config)
        require_production_security_baseline(app.config)
    else:
        require_production_security_baseline(app.config)
        require_production_realtime_backing_services(app.config)


def sync_runtime_environment(app: Flask) -> None:
    os.environ["DATABASE_BACKEND"] = "postgres"
    database_schema = str(app.config.get("DATABASE_SCHEMA") or "").strip()
    if database_schema:
        os.environ["DATABASE_SCHEMA"] = database_schema
    else:
        os.environ.pop("DATABASE_SCHEMA", None)

    if app.config.get("DATABASE_URL"):
        os.environ["DATABASE_URL"] = app.config["DATABASE_URL"]
    else:
        os.environ.pop("DATABASE_URL", None)

    if app.config.get("REDIS_URL"):
        os.environ["REDIS_URL"] = app.config["REDIS_URL"]
    else:
        os.environ.pop("REDIS_URL", None)

    if app.config.get("RUN_MIGRATIONS_ON_STARTUP", True):
        run_migrations()
