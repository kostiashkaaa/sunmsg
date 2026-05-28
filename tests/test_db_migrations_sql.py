import inspect

from app.db import migrations as db_migrations


def test_moderation_audit_append_only_raise_uses_single_placeholder():
    source = inspect.getsource(db_migrations._run_moderation_audit_append_only_migration)

    assert "operation % blocked" in source
    assert "operation %% blocked" not in source
