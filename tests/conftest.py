from pathlib import Path
import inspect
import os
import sys
import uuid

import pytest

ROOT = Path(__file__).resolve().parents[1]

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault('TEST_SCHEMA_SALT', uuid.uuid4().hex[:12])

from app.config import load_environment  # noqa: E402

load_environment()

from tests._pg_test_db import (  # noqa: E402,F401
    connect_test_db,
    should_require_test_database,
    test_database_unavailable_reason,
)

_DB_REQUIRED_FIXTURES = {'_flask_server', 'perf_server', 'visual_server'}
_DB_SKIP_EXCLUDED_FILES = {'test_env_boot.py', 'test_prepare_test_database.py'}
_DB_REQUIRED_FILES = {'test_passkeys_http.py'}


def _item_needs_postgres(item) -> bool:
    file_name = Path(str(item.fspath)).name
    if file_name in _DB_SKIP_EXCLUDED_FILES:
        return False
    if file_name in _DB_REQUIRED_FILES:
        return True
    if not os.environ.get('PLAYWRIGHT_BASE_URL') and _DB_REQUIRED_FIXTURES.intersection(item.fixturenames):
        return True
    try:
        source = inspect.getsource(item.obj)
    except (OSError, TypeError):
        source = ''
    return (
        'connect_test_db' in source
        or ('create_app(' in source and 'DATABASE_PATH' in source)
    )


def pytest_collection_modifyitems(config, items):  # noqa: ARG001
    reason = test_database_unavailable_reason()
    if not reason or should_require_test_database():
        return
    skip_marker = pytest.mark.skip(reason=reason)
    for item in items:
        if _item_needs_postgres(item):
            item.add_marker(skip_marker)
