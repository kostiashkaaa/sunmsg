import os

from flask import Flask

from app.bootstrap import env_boot


class _FakeConfig:
    @classmethod
    def from_env(cls):
        return {
            'TESTING': True,
            'CSP_STYLE_UNSAFE_INLINE': True,
            'ENV_NAME': 'testing',
        }


def _make_app(**mapping):
    app = Flask(__name__)
    app.config.update(mapping)
    return app


def test_load_app_config_forces_csp_inline_off_in_testing(monkeypatch):
    app = Flask(__name__)
    monkeypatch.setattr(env_boot, 'load_environment', lambda: None)
    monkeypatch.setattr(env_boot, 'get_config_class', lambda _name=None: _FakeConfig)

    env_boot.load_app_config(app, config_name='testing', overrides={'TESTING': True})

    assert app.config['TESTING'] is True
    assert app.config['CSP_STYLE_UNSAFE_INLINE'] is False


def test_load_app_config_keeps_explicit_csp_override(monkeypatch):
    app = Flask(__name__)
    monkeypatch.setattr(env_boot, 'load_environment', lambda: None)
    monkeypatch.setattr(env_boot, 'get_config_class', lambda _name=None: _FakeConfig)

    env_boot.load_app_config(
        app,
        config_name='testing',
        overrides={'TESTING': True, 'CSP_STYLE_UNSAFE_INLINE': True},
    )

    assert app.config['CSP_STYLE_UNSAFE_INLINE'] is True


def test_configure_testing_database_schema_maps_legacy_path(monkeypatch, tmp_path):
    app = _make_app(
        TESTING=True,
        DATABASE_URL='postgresql://example/db',
        TEST_DATABASE_URL='postgresql://example/test_db',
    )
    legacy_path = tmp_path / 'legacy' / 'test.db'
    called = {}

    def _fake_testing_schema(identifier):
        called['identifier'] = identifier
        return 'test_schema_123'

    def _fake_ensure_schema(database_url, schema_name):
        called['database_url'] = database_url
        called['schema_name'] = schema_name

    def _fake_reset_schema(database_url, schema_name):
        called['reset_database_url'] = database_url
        called['reset_schema_name'] = schema_name

    monkeypatch.setattr(env_boot, 'testing_schema_from_identifier', _fake_testing_schema)
    monkeypatch.setattr(env_boot, 'ensure_postgres_schema', _fake_ensure_schema)
    monkeypatch.setattr(env_boot, '_reset_postgres_schema', _fake_reset_schema)
    monkeypatch.delenv('DATABASE_SCHEMA', raising=False)

    resolved = env_boot.configure_testing_database_schema(
        app,
        overrides={'DATABASE_PATH': str(legacy_path)},
    )

    assert resolved == str(legacy_path.resolve())
    assert called['identifier'] == str(legacy_path.resolve())
    assert called['database_url'] == 'postgresql://example/test_db'
    assert called['schema_name'] == 'test_schema_123'
    assert called['reset_database_url'] == 'postgresql://example/test_db'
    assert called['reset_schema_name'] == 'test_schema_123'
    assert app.config['DATABASE_SCHEMA'] == 'test_schema_123'
    assert os.environ.get('DATABASE_SCHEMA') == 'test_schema_123'
    assert legacy_path.exists() is True


def test_configure_testing_database_schema_skips_when_database_url_override_present(monkeypatch):
    app = _make_app(
        TESTING=True,
        DATABASE_URL='postgresql://example/db',
        TEST_DATABASE_URL='postgresql://example/test_db',
    )
    monkeypatch.setenv('DATABASE_SCHEMA', 'stale')

    ensure_calls = []
    reset_calls = []
    monkeypatch.setattr(env_boot, 'ensure_postgres_schema', lambda *_args, **_kwargs: ensure_calls.append(1))
    monkeypatch.setattr(env_boot, '_reset_postgres_schema', lambda *_args, **_kwargs: reset_calls.append(1))

    resolved = env_boot.configure_testing_database_schema(
        app,
        overrides={'DATABASE_URL': 'postgresql://override/db', 'DATABASE_PATH': 'ignored.db'},
    )

    assert resolved == ''
    assert os.environ.get('DATABASE_SCHEMA') is None
    assert ensure_calls == []
    assert reset_calls == []


def test_configure_testing_database_schema_requires_test_database_url_without_override(monkeypatch):
    monkeypatch.delenv('TEST_DATABASE_URL', raising=False)
    app = _make_app(TESTING=True, DATABASE_URL='postgresql://example/db')

    try:
        env_boot.configure_testing_database_schema(
            app,
            overrides={'DATABASE_PATH': 'ignored.db'},
        )
    except RuntimeError as exc:
        assert 'TEST_DATABASE_URL must be set' in str(exc)
    else:
        raise AssertionError('Expected RuntimeError when TEST_DATABASE_URL is missing.')


def test_enforce_production_runtime_guards_rejects_scheduler_in_web():
    app = _make_app(ENV_NAME='production', START_SCHEDULER_IN_WEB=True, RUN_MIGRATIONS_ON_STARTUP=False)

    try:
        env_boot.enforce_production_runtime_guards(app, overrides={})
    except RuntimeError as exc:
        assert 'START_SCHEDULER_IN_WEB' in str(exc)
    else:
        raise AssertionError('Expected RuntimeError for START_SCHEDULER_IN_WEB in production.')


def test_enforce_production_runtime_guards_rejects_runtime_migrations():
    app = _make_app(ENV_NAME='production', START_SCHEDULER_IN_WEB=False, RUN_MIGRATIONS_ON_STARTUP=True)

    try:
        env_boot.enforce_production_runtime_guards(app, overrides={})
    except RuntimeError as exc:
        assert 'RUN_MIGRATIONS_ON_STARTUP' in str(exc)
    else:
        raise AssertionError('Expected RuntimeError for RUN_MIGRATIONS_ON_STARTUP in production.')


def test_enforce_production_runtime_guards_calls_baseline_then_realtime_by_default(monkeypatch):
    app = _make_app(ENV_NAME='production', START_SCHEDULER_IN_WEB=False, RUN_MIGRATIONS_ON_STARTUP=False)
    calls = []
    monkeypatch.setattr(env_boot, 'require_production_security_baseline', lambda _cfg: calls.append('security'))
    monkeypatch.setattr(env_boot, 'require_production_realtime_backing_services', lambda _cfg: calls.append('realtime'))

    env_boot.enforce_production_runtime_guards(app, overrides={})

    assert calls == ['security', 'realtime']


def test_enforce_production_runtime_guards_calls_realtime_then_baseline_with_explicit_realtime_override(monkeypatch):
    app = _make_app(ENV_NAME='production', START_SCHEDULER_IN_WEB=False, RUN_MIGRATIONS_ON_STARTUP=False)
    calls = []
    monkeypatch.setattr(env_boot, 'require_production_security_baseline', lambda _cfg: calls.append('security'))
    monkeypatch.setattr(env_boot, 'require_production_realtime_backing_services', lambda _cfg: calls.append('realtime'))

    env_boot.enforce_production_runtime_guards(
        app,
        overrides={'REDIS_URL': 'redis://127.0.0.1:6379/0'},
    )

    assert calls == ['realtime', 'security']


def test_sync_runtime_environment_sets_and_clears_expected_env(monkeypatch):
    app = _make_app(
        DATABASE_SCHEMA='schema_a',
        DATABASE_URL='postgresql://example/db',
        REDIS_URL='redis://127.0.0.1:6379/0',
        RUN_MIGRATIONS_ON_STARTUP=False,
    )
    monkeypatch.delenv('DATABASE_BACKEND', raising=False)
    monkeypatch.delenv('DATABASE_SCHEMA', raising=False)
    monkeypatch.delenv('DATABASE_URL', raising=False)
    monkeypatch.delenv('REDIS_URL', raising=False)

    migrations_calls = []
    monkeypatch.setattr(env_boot, 'run_migrations', lambda: migrations_calls.append('run'))

    env_boot.sync_runtime_environment(app)

    assert os.environ.get('DATABASE_BACKEND') == 'postgres'
    assert os.environ.get('DATABASE_SCHEMA') == 'schema_a'
    assert os.environ.get('DATABASE_URL') == 'postgresql://example/db'
    assert os.environ.get('REDIS_URL') == 'redis://127.0.0.1:6379/0'
    assert migrations_calls == []

    app.config['DATABASE_SCHEMA'] = ''
    app.config['DATABASE_URL'] = ''
    app.config['REDIS_URL'] = ''
    app.config['RUN_MIGRATIONS_ON_STARTUP'] = True

    env_boot.sync_runtime_environment(app)

    assert os.environ.get('DATABASE_SCHEMA') is None
    assert os.environ.get('DATABASE_URL') is None
    assert os.environ.get('REDIS_URL') is None
    assert migrations_calls == ['run']


def test_sync_runtime_environment_sets_database_url_in_testing(monkeypatch):
    app = _make_app(
        TESTING=True,
        DATABASE_SCHEMA='schema_test',
        DATABASE_URL='postgresql://example/test_db',
        REDIS_URL='redis://127.0.0.1:6379/0',
        RUN_MIGRATIONS_ON_STARTUP=False,
    )
    monkeypatch.setenv('DATABASE_URL', 'postgresql://example/runtime_db')
    monkeypatch.delenv('DATABASE_SCHEMA', raising=False)
    monkeypatch.delenv('REDIS_URL', raising=False)

    env_boot.sync_runtime_environment(app)

    assert os.environ.get('DATABASE_URL') == 'postgresql://example/test_db'
    assert os.environ.get('DATABASE_SCHEMA') == 'schema_test'
    assert os.environ.get('REDIS_URL') == 'redis://127.0.0.1:6379/0'
