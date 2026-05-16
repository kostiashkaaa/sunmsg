from scripts import prepare_test_database as prep


def test_with_database_rewrites_only_database_name():
    rewritten = prep._with_database(
        "postgresql://user:pass@127.0.0.1:5432/app_db?sslmode=disable",
        "postgres",
    )

    assert rewritten == "postgresql://user:pass@127.0.0.1:5432/postgres?sslmode=disable"


def test_prepare_test_database_creates_missing_test_database(monkeypatch):
    calls = []
    executed = []

    class _Cursor:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, query, params=None):
            executed.append((query, params))

        def fetchone(self):
            return None

    class _Connection:
        def __init__(self, url):
            self.url = url

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def cursor(self):
            return _Cursor()

    def _fake_connect(url):
        calls.append(url)
        return _Connection(url)

    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql://postgres:postgres@127.0.0.1:5432/sunmessenger_ci",
    )
    monkeypatch.setenv(
        "TEST_DATABASE_URL",
        "postgresql://postgres:postgres@127.0.0.1:5432/sunmessenger_test_ci",
    )
    monkeypatch.delenv("POSTGRES_MAINTENANCE_URL", raising=False)
    monkeypatch.setattr(prep, "_connect_with_retry", _fake_connect)

    prep.prepare_test_database()

    assert calls == [
        "postgresql://postgres:postgres@127.0.0.1:5432/postgres",
        "postgresql://postgres:postgres@127.0.0.1:5432/sunmessenger_test_ci",
    ]
    assert executed == [
        (
            "SELECT 1 FROM pg_database WHERE datname = %s",
            ("sunmessenger_test_ci",),
        ),
        ('CREATE DATABASE "sunmessenger_test_ci"', None),
    ]
