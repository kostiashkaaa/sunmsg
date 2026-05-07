from pathlib import Path
import os
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault('TEST_SCHEMA_SALT', uuid.uuid4().hex[:12])

from app.config import load_environment  # noqa: E402

load_environment()

from tests._pg_test_db import connect_test_db  # noqa: E402,F401
