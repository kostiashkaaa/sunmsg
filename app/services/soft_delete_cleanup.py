from __future__ import annotations

import logging

from app.database import get_db_connection

logger = logging.getLogger(__name__)

# Messages deleted by both sides more than this many days ago are removed.
SOFT_DELETE_RETENTION_DAYS = 30


def cleanup_soft_deleted_messages() -> int:
    """
    Hard-delete messages that have been soft-deleted by all parties for longer
    than SOFT_DELETE_RETENTION_DAYS.

    Direct (1-on-1) messages: deleted when both deleted_by_sender=1 and
    deleted_by_receiver=1 (or the message was marked for_both deletion).

    Group messages: deleted when deleted_for_user=1 on every message_receipt
    row for that message — meaning every member has hidden the message.
    """
    conn = get_db_connection()
    deleted_count = 0
    try:
        cutoff_expr = f"CURRENT_TIMESTAMP - INTERVAL '{SOFT_DELETE_RETENTION_DAYS} days'"

        # --- Direct messages: both sides deleted ---
        result = conn.execute(
            f'''
            DELETE FROM messages
            WHERE receiver_id IS NOT NULL
              AND deleted_by_sender = 1
              AND deleted_by_receiver = 1
              AND updated_at < {cutoff_expr}
            RETURNING id
            ''',
        )
        direct_deleted = len(result.fetchall()) if result else 0
        deleted_count += direct_deleted

        # --- Group messages: every receipt hidden ---
        # A group message is safe to hard-delete when every member's receipt
        # has deleted_for_user=1, which means nobody can see it anymore.
        result = conn.execute(
            f'''
            DELETE FROM messages
            WHERE receiver_id IS NULL
              AND updated_at < {cutoff_expr}
              AND id IN (
                  SELECT m.id
                  FROM messages m
                  WHERE m.receiver_id IS NULL
                    AND m.updated_at < {cutoff_expr}
                    AND NOT EXISTS (
                        SELECT 1
                        FROM message_receipts mr
                        WHERE mr.message_id = m.id
                          AND mr.deleted_for_user = 0
                    )
              )
            RETURNING id
            ''',
        )
        group_deleted = len(result.fetchall()) if result else 0
        deleted_count += group_deleted

        conn.commit()
        if deleted_count:
            logger.info('Soft-delete cleanup removed %d messages.', deleted_count)
    except Exception:
        logger.exception('Soft-delete cleanup failed')
        try:
            conn.rollback()
        except Exception:  # noqa: BLE001
            pass
    finally:
        conn.close()

    return deleted_count
