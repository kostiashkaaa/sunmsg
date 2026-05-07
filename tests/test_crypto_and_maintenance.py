import base64
from pathlib import Path

from cryptography.hazmat.primitives import serialization

import app.database as database_module
from app.database import (
    check_database_integrity,
    create_database_backup,
    restore_database_backup,
)
from tests._pg_test_db import connect_test_db
from app.services import crypto, maintenance_runtime
from app import create_app


def test_public_key_normalization_and_pem_helpers():
    raw_public = (
        "-----BEGIN PUBLIC KEY-----\n"
        "ABCDEF123456\n"
        "7890ZYXW\n"
        "-----END PUBLIC KEY-----\n"
    )

    normalized = crypto.normalize_public_key(raw_public)
    cleaned = crypto.clean_public_key(raw_public)
    pem = crypto.add_pem_headers(normalized)
    pem_from_wrapped = crypto.add_pem_headers(raw_public)

    assert normalized == 'ABCDEF1234567890ZYXW'
    assert cleaned == 'ABCDEF123456\n7890ZYXW'
    assert pem == (
        "-----BEGIN PUBLIC KEY-----\n"
        "ABCDEF1234567890ZYXW\n"
        "-----END PUBLIC KEY-----"
    )
    assert pem_from_wrapped == pem


def test_private_key_normalization_preserves_pem_body():
    raw_private = "line-1\nline-2"
    normalized = crypto.normalize_private_key(raw_private)

    assert normalized == (
        "-----BEGIN RSA PRIVATE KEY-----\n"
        "line-1\n"
        "line-2\n"
        "-----END RSA PRIVATE KEY-----"
    )

    already_wrapped = (
        "-----BEGIN RSA PRIVATE KEY-----\n"
        "  line-a  \n"
        "line-b\n"
        "-----END RSA PRIVATE KEY-----\n"
    )
    normalized_wrapped = crypto.normalize_private_key(already_wrapped)
    assert normalized_wrapped == (
        "-----BEGIN RSA PRIVATE KEY-----\n"
        "line-a\n"
        "line-b\n"
        "-----END RSA PRIVATE KEY-----"
    )


def test_key_generation_and_chat_id_helpers():
    private_pem, public_pem = crypto.generate_keys()
    private_key = serialization.load_pem_private_key(private_pem.encode('utf-8'), password=None)
    public_key = serialization.load_pem_public_key(public_pem.encode('utf-8'))

    assert private_key.key_size == 2048
    assert public_key.key_size == 2048

    symmetric_key = crypto.generate_symmetric_key()
    assert isinstance(symmetric_key, bytes)
    assert len(symmetric_key) == 32

    chat_id_ab = crypto.generate_chat_id('pk-a', 'pk-b')
    chat_id_ba = crypto.generate_chat_id('pk-b', 'pk-a')
    assert chat_id_ab == chat_id_ba
    assert len(chat_id_ab) == 64
    assert crypto.is_valid_chat_id(chat_id_ab) is True
    assert crypto.is_valid_chat_id(chat_id_ab.upper()) is False
    assert crypto.is_valid_chat_id('not-a-chat-id') is False
    assert crypto.is_valid_chat_id(None) is False


def test_ciphertext_detection_accepts_base64_and_rejects_invalid_values():
    valid_payload = base64.b64encode(b'x' * 32).decode('ascii')
    valid_urlsafe_payload = base64.urlsafe_b64encode(b'y' * 32).decode('ascii')

    assert crypto.looks_like_ciphertext(valid_payload) is True
    assert crypto.looks_like_ciphertext(valid_urlsafe_payload) is True
    assert crypto.looks_like_ciphertext('short') is False
    assert crypto.looks_like_ciphertext('!' * 64) is False
    assert crypto.looks_like_ciphertext(123) is False


def test_run_database_maintenance_applies_overrides_and_runs_migrations(monkeypatch, tmp_path):
    db_path = tmp_path / 'maintenance.db'
    calls = []

    class _FakeConfig:
        @classmethod
        def from_env(cls):
            return {'DATABASE_PATH': 'from-config.db', 'EXTRA': 'value'}

    monkeypatch.setattr(maintenance_runtime, 'load_environment', lambda: calls.append('load_environment'))
    monkeypatch.setattr(maintenance_runtime, 'get_config_class', lambda config_name=None: _FakeConfig)
    monkeypatch.setattr(maintenance_runtime, 'run_migrations', lambda: calls.append('run_migrations'))
    monkeypatch.setattr(
        maintenance_runtime,
        'check_database_integrity',
        lambda database_path: {
            'ok': True,
            'database_path': database_path,
            'integrity_check': ['ok'],
            'foreign_key_violations': [],
        },
    )

    config = maintenance_runtime.run_database_maintenance(
        'testing',
        overrides={'DATABASE_PATH': str(db_path), 'OVERRIDDEN': True},
    )

    assert calls == ['load_environment', 'run_migrations']
    assert config['DATABASE_PATH'] == str(db_path)
    assert config['EXTRA'] == 'value'
    assert config['OVERRIDDEN'] is True


def test_fresh_schema_exposes_foreign_keys(monkeypatch, tmp_path):
    db_path = tmp_path / 'fk-schema.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    conn = connect_test_db(db_path)
    try:
        contacts_fk = conn.execute('PRAGMA foreign_key_list(contacts)').fetchall()
        messages_fk = conn.execute('PRAGMA foreign_key_list(messages)').fetchall()
        refresh_fk = conn.execute('PRAGMA foreign_key_list(refresh_tokens)').fetchall()
    finally:
        conn.close()

    assert contacts_fk
    assert messages_fk
    assert refresh_fk


def test_database_backup_restore_and_integrity_check(monkeypatch, tmp_path):
    db_path = tmp_path / 'main.db'
    backup_dir = tmp_path / 'backups'
    restored_path = tmp_path / 'restored.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    create_app('testing', overrides={'DATABASE_PATH': str(db_path)})

    conn = connect_test_db(db_path)
    try:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES (1, 'pk-1', 'alice', 'Alice')
            '''
        )
        conn.commit()
    finally:
        conn.close()

    integrity = check_database_integrity(str(db_path))
    assert integrity['ok'] is True
    assert integrity['integrity_check'] == ['ok']
    assert integrity['foreign_key_violations'] == []

    backup_path = create_database_backup(str(db_path), backup_dir=str(backup_dir), label='test-run')
    assert Path(backup_path).exists()

    restore_database_backup(backup_path, target_path=str(restored_path))
    restored_conn = connect_test_db(restored_path)
    try:
        restored_row = restored_conn.execute(
            'SELECT username FROM users WHERE id = 1'
        ).fetchone()
    finally:
        restored_conn.close()

    assert restored_row[0] == 'alice'


def test_postgres_backup_and_restore_use_pg_tools_without_leaking_password(monkeypatch, tmp_path):
    backup_dir = tmp_path / 'pg-backups'
    backup_archive = backup_dir / '20260501000000_test.dump'
    calls = []

    monkeypatch.setenv(
        'DATABASE_URL',
        'postgresql://sunmessenger:secret-pass@127.0.0.1:5432/sunmessenger',
    )
    monkeypatch.delenv('DATABASE_SCHEMA', raising=False)
    monkeypatch.setattr(database_module, '_backup_stamp', lambda: '20260501000000')
    monkeypatch.setattr(database_module, '_resolve_pg_tool', lambda _env_name, default_name: default_name)

    def fake_run(command, **kwargs):
        calls.append((command, kwargs))
        if command[0] == 'pg_dump':
            backup_archive.parent.mkdir(parents=True, exist_ok=True)
            backup_archive.write_bytes(b'fake-pg-dump')

        class Result:
            returncode = 0
            stdout = ''
            stderr = ''

        return Result()

    monkeypatch.setattr(database_module.subprocess, 'run', fake_run)

    created = create_database_backup(backup_dir=str(backup_dir), label='test')
    restore_database_backup(created)

    assert created == str(backup_archive)
    assert calls[0][0][:2] == ['pg_dump', '--format=custom']
    assert calls[1][0][0] == 'pg_restore'
    assert 'secret-pass' not in ' '.join(calls[0][0])
    assert 'secret-pass' not in ' '.join(calls[1][0])
    assert calls[0][1]['env']['PGPASSWORD'] == 'secret-pass'
    assert calls[1][1]['env']['PGPASSWORD'] == 'secret-pass'


def test_run_database_maintenance_supports_restore_backup_and_integrity_only(monkeypatch, tmp_path):
    db_path = tmp_path / 'maintenance-runtime.db'
    restore_source = tmp_path / 'restore-source.db'
    backup_dir = tmp_path / 'maintenance-backups'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    create_app('testing', overrides={'DATABASE_PATH': str(restore_source)})
    conn = connect_test_db(restore_source)
    try:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES (1, 'pk-restore', 'restored_user', 'Restored User')
            '''
        )
        conn.commit()
    finally:
        conn.close()

    config = maintenance_runtime.run_database_maintenance(
        'testing',
        overrides={'DATABASE_PATH': str(db_path)},
        backup_dir=str(backup_dir),
        restore_from=str(restore_source),
        integrity_only=True,
    )

    report = config['maintenance_report']
    assert report['restore_target'] == str(db_path)
    assert report['backup_path'] is None
    assert report['post_check']['ok'] is True

    restored_conn = connect_test_db(db_path)
    try:
        restored_row = restored_conn.execute(
            'SELECT username FROM users WHERE id = 1'
        ).fetchone()
    finally:
        restored_conn.close()

    assert restored_row[0] == 'restored_user'
