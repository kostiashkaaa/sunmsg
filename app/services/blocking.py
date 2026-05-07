from typing import Any, Dict, Optional

from flask import jsonify

from app.services.chat_members import get_chat_type, is_chat_member

BLOCK_ERROR_CODE = 'FORBIDDEN_BLOCKED'


def _to_bool(value: Any) -> bool:
    return bool(value)


def normalize_block_state(state: Optional[Dict[str, Any]]) -> Dict[str, bool]:
    state = state or {}
    blocked_by_me = _to_bool(state.get('blocked_by_me'))
    blocked_me = _to_bool(state.get('blocked_me'))
    return {
        'is_blocked': blocked_by_me or blocked_me,
        'blocked_by_me': blocked_by_me,
        'blocked_me': blocked_me,
    }


def build_block_state(conn: Any, user_id: int, other_user_id: int) -> Dict[str, bool]:
    rows = conn.execute(
        '''
        SELECT blocker_id, blocked_id
        FROM block_list
        WHERE (blocker_id = ? AND blocked_id = ?)
           OR (blocker_id = ? AND blocked_id = ?)
        ''',
        (user_id, other_user_id, other_user_id, user_id),
    ).fetchall()

    blocked_by_me = any(r['blocker_id'] == user_id and r['blocked_id'] == other_user_id for r in rows)
    blocked_me = any(r['blocker_id'] == other_user_id and r['blocked_id'] == user_id for r in rows)
    return normalize_block_state({'blocked_by_me': blocked_by_me, 'blocked_me': blocked_me})


def get_chat_partner(conn: Any, user_id: int, chat_id: str):
    direct_partner = conn.execute(
        '''
        SELECT c.contact_id, u.public_key
        FROM contacts c
        JOIN users u ON u.id = c.contact_id
        WHERE c.user_id = ? AND c.chat_id = ?
        ''',
        (user_id, chat_id),
    ).fetchone()
    if direct_partner:
        return direct_partner

    if get_chat_type(conn, chat_id) == 'group' and is_chat_member(conn, int(user_id), str(chat_id)):
        return {
            'contact_id': None,
            'public_key': None,
            'chat_type': 'group',
            'is_group': True,
        }
    return None


def block_error_payload(message: str, state: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    normalized = normalize_block_state(state)
    return {
        'success': False,
        'error': {
            'code': BLOCK_ERROR_CODE,
            'message': message,
            'blocked_by_me': normalized['blocked_by_me'],
            'blocked_me': normalized['blocked_me'],
        },
    }


def block_forbidden_response(message: str, state: Optional[Dict[str, Any]] = None):
    return jsonify(block_error_payload(message, state)), 403


def list_visible_contact_public_keys(conn: Any, user_id: int):
    return conn.execute(
        '''
        SELECT u.public_key
        FROM contacts c
        JOIN users u ON u.id = c.user_id
        WHERE c.contact_id = ?
          AND NOT EXISTS (
              SELECT 1
              FROM block_list b
              WHERE (b.blocker_id = ? AND b.blocked_id = c.user_id)
                 OR (b.blocker_id = c.user_id AND b.blocked_id = ?)
          )
        ''',
        (user_id, user_id, user_id),
    ).fetchall()
