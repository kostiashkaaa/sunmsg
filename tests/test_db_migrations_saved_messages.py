from app.db import migrations as db_migrations
from app.db.schema import ensure_base_schema
from app.services.crypto import generate_chat_id
from tests._pg_test_db import connect_test_db


def test_run_migrations_backfills_saved_messages_chat_for_existing_users(monkeypatch, tmp_path):
    db_path = tmp_path / 'saved-messages-migration.db'

    with connect_test_db(db_path) as conn:
        ensure_base_schema(conn)
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES
                (1, 'pk-1', 'alice', 'Alice'),
                (2, 'pk-2', 'bob', 'Bob')
            '''
        )
        conn.execute(
            '''
            INSERT INTO chats (chat_id, chat_name)
            VALUES ('legacy-self-chat', 'Legacy Chat')
            '''
        )
        conn.execute(
            '''
            INSERT INTO contacts (user_id, contact_id, chat_id)
            VALUES (2, 2, 'legacy-self-chat')
            '''
        )
        conn.commit()

    monkeypatch.setattr(db_migrations, 'get_db_connection', lambda: connect_test_db(db_path))

    db_migrations.run_migrations()
    db_migrations.run_migrations()

    expected_chat_1 = generate_chat_id('pk-1', 'pk-1')
    expected_chat_2 = generate_chat_id('pk-2', 'pk-2')

    with connect_test_db(db_path) as conn:
        self_contact_1 = conn.execute(
            'SELECT chat_id FROM contacts WHERE user_id = ? AND contact_id = ?',
            (1, 1),
        ).fetchall()
        self_contact_2 = conn.execute(
            'SELECT chat_id FROM contacts WHERE user_id = ? AND contact_id = ?',
            (2, 2),
        ).fetchall()
        self_chat_1 = conn.execute(
            'SELECT chat_id, chat_name FROM chats WHERE chat_id = ?',
            (expected_chat_1,),
        ).fetchone()
        self_chat_2 = conn.execute(
            'SELECT chat_id, chat_name FROM chats WHERE chat_id = ?',
            (expected_chat_2,),
        ).fetchone()
        migration_row = conn.execute(
            'SELECT version, name FROM schema_migrations WHERE version = ?',
            (db_migrations.SAVED_MESSAGES_CHAT_BACKFILL_MIGRATION[0],),
        ).fetchone()
        spotify_migration_row = conn.execute(
            'SELECT version, name FROM schema_migrations WHERE version = ?',
            (db_migrations.SPOTIFY_INTEGRATION_MIGRATION[0],),
        ).fetchone()
        spotify_tokens_table = conn.execute(
            '''
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = current_schema()
              AND table_name = ?
            ''',
            ('spotify_tokens',),
        ).fetchone()
        spotify_now_playing_table = conn.execute(
            '''
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = current_schema()
              AND table_name = ?
            ''',
            ('spotify_now_playing',),
        ).fetchone()

    assert len(self_contact_1) == 1
    assert self_contact_1[0]['chat_id'] == expected_chat_1
    assert len(self_contact_2) == 1
    assert self_contact_2[0]['chat_id'] == expected_chat_2
    assert self_chat_1
    assert self_chat_1['chat_name'] == 'Saved Messages'
    assert self_chat_2
    assert self_chat_2['chat_name'] == 'Saved Messages'
    assert migration_row
    assert int(migration_row['version']) == db_migrations.SAVED_MESSAGES_CHAT_BACKFILL_MIGRATION[0]
    assert spotify_migration_row
    assert int(spotify_migration_row['version']) == db_migrations.SPOTIFY_INTEGRATION_MIGRATION[0]
    assert spotify_tokens_table
    assert spotify_now_playing_table
