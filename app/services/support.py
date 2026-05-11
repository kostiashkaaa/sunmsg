from __future__ import annotations

import json
from typing import Any

from app.services import moderation as moderation_service

ALLOWED_REQUEST_STATUSES = {'open', 'in_progress', 'resolved', 'rejected', 'closed'}
TERMINAL_REQUEST_STATUSES = {'resolved', 'rejected', 'closed'}
ALLOWED_CATEGORIES = {
    'general',
    'bug',
    'performance',
    'registration',
    'login',
    'access',
    'feature',
    'security',
    'other',
}


def normalize_status(value: Any) -> str:
    normalized = str(value or '').strip().lower()
    if normalized in ALLOWED_REQUEST_STATUSES:
        return normalized
    return ''


def normalize_category(value: Any) -> str:
    normalized = str(value or '').strip().lower()
    if normalized in ALLOWED_CATEGORIES:
        return normalized
    if not normalized:
        return 'general'
    return 'other'


def normalize_source_page(value: Any) -> str:
    normalized = str(value or '').strip().lower()
    if not normalized:
        return 'unknown'
    return normalized[:64]


def normalize_subject(value: Any, *, max_length: int = 160) -> str:
    normalized = str(value or '').strip()
    return normalized[:max_length]


def normalize_body(value: Any, *, max_length: int = 8000) -> str:
    normalized = str(value or '').strip()
    return normalized[:max_length]


def normalize_handle(value: Any, *, max_length: int = 120) -> str:
    normalized = str(value or '').strip()
    return normalized[:max_length]


def normalize_email(value: Any, *, max_length: int = 200) -> str:
    normalized = str(value or '').strip().lower()
    return normalized[:max_length]


def normalize_priority(value: Any) -> int:
    parsed = moderation_service.parse_int(value, min_value=1, max_value=4)
    if parsed is None:
        return 3
    return int(parsed)


def create_support_request(  # noqa: PLR0913 - explicit support-request creation contract
    conn,
    *,
    created_by_user_id: int | None,
    created_by_username: str,
    contact_email: str,
    contact_handle: str,
    source_page: str,
    category: str,
    subject: str,
    body: str,
    priority: int,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    clean_subject = normalize_subject(subject)
    clean_body = normalize_body(body)
    if not clean_subject:
        raise ValueError('subject_required')
    if not clean_body:
        raise ValueError('body_required')

    payload_meta = meta if isinstance(meta, dict) else {}
    meta_json = json.dumps(payload_meta, ensure_ascii=False)
    source = normalize_source_page(source_page)
    cat = normalize_category(category)
    safe_priority = normalize_priority(priority)

    row = conn.execute(
        '''
        INSERT INTO support_requests (
            created_by_user_id,
            created_by_username,
            contact_email,
            contact_handle,
            source_page,
            category,
            subject,
            body,
            status,
            priority,
            meta_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
        RETURNING id, status, created_at
        ''',
        (
            int(created_by_user_id) if created_by_user_id is not None else None,
            normalize_handle(created_by_username),
            normalize_email(contact_email),
            normalize_handle(contact_handle),
            source,
            cat,
            clean_subject,
            clean_body,
            safe_priority,
            meta_json,
        ),
    ).fetchone()
    conn.commit()

    return {
        'request_id': int(row['id']),
        'status': str(row['status']),
        'created_at': str(row['created_at'] or ''),
    }


def list_support_requests(
    conn,
    *,
    status: str,
    category: str,
    limit: int,
    offset: int,
) -> list[dict[str, Any]]:
    safe_status = normalize_status(status)
    safe_category = normalize_category(category) if str(category or '').strip() else ''
    safe_limit = moderation_service.parse_int(limit, min_value=1, max_value=200) or 50
    safe_offset = moderation_service.parse_int(offset, min_value=0, max_value=50_000) or 0

    rows = conn.execute(
        '''
        SELECT
            sr.id,
            sr.created_by_user_id,
            sr.created_by_username,
            sr.contact_email,
            sr.contact_handle,
            sr.source_page,
            sr.category,
            sr.subject,
            sr.body,
            sr.status,
            sr.priority,
            sr.assigned_moderator_user_id,
            sr.resolution_note,
            sr.meta_json,
            sr.created_at,
            sr.updated_at,
            sr.resolved_at,
            u.username AS linked_username,
            u.display_name AS linked_display_name
        FROM support_requests sr
        LEFT JOIN users u ON u.id = sr.created_by_user_id
        WHERE (? = '' OR sr.status = ?)
          AND (? = '' OR sr.category = ?)
        ORDER BY
            CASE sr.status
                WHEN 'open' THEN 0
                WHEN 'in_progress' THEN 1
                ELSE 2
            END ASC,
            sr.priority ASC,
            sr.created_at DESC
        LIMIT ?
        OFFSET ?
        ''',
        (safe_status, safe_status, safe_category, safe_category, safe_limit, safe_offset),
    ).fetchall()

    result: list[dict[str, Any]] = []
    for row in rows:
        result.append(
            {
                'id': int(row['id']),
                'created_by_user_id': (
                    int(row['created_by_user_id']) if row['created_by_user_id'] is not None else None
                ),
                'created_by_username': str(row['created_by_username'] or ''),
                'linked_username': str(row['linked_username'] or ''),
                'linked_display_name': str(row['linked_display_name'] or ''),
                'contact_email': str(row['contact_email'] or ''),
                'contact_handle': str(row['contact_handle'] or ''),
                'source_page': str(row['source_page'] or ''),
                'category': str(row['category'] or ''),
                'subject': str(row['subject'] or ''),
                'body': str(row['body'] or ''),
                'status': str(row['status'] or ''),
                'priority': int(row['priority'] or 3),
                'assigned_moderator_user_id': (
                    int(row['assigned_moderator_user_id'])
                    if row['assigned_moderator_user_id'] is not None
                    else None
                ),
                'resolution_note': str(row['resolution_note'] or ''),
                'meta_json': str(row['meta_json'] or '{}'),
                'created_at': str(row['created_at'] or ''),
                'updated_at': str(row['updated_at'] or ''),
                'resolved_at': str(row['resolved_at'] or ''),
            }
        )
    return result


def resolve_support_request(  # noqa: PLR0913 - explicit support-request resolution contract
    conn,
    *,
    request_id: int,
    moderator_user_id: int,
    next_status: str,
    resolution_note: str,
    assign_to_user_id: int | None = None,
) -> dict[str, Any]:
    status = normalize_status(next_status)
    if status not in ALLOWED_REQUEST_STATUSES:
        raise ValueError('invalid_status')

    row = conn.execute(
        '''
        SELECT id, status
        FROM support_requests
        WHERE id = ?
        LIMIT 1
        ''',
        (int(request_id),),
    ).fetchone()
    if not row:
        raise ValueError('support_request_not_found')

    resolved_at_sql = 'CURRENT_TIMESTAMP' if status in TERMINAL_REQUEST_STATUSES else 'NULL'
    conn.execute(
        f'''
        UPDATE support_requests
        SET
            status = ?,
            resolution_note = ?,
            assigned_moderator_user_id = COALESCE(?, ?),
            updated_at = CURRENT_TIMESTAMP,
            resolved_at = {resolved_at_sql}
        WHERE id = ?
        ''',
        (
            status,
            moderation_service.normalize_comment(resolution_note, max_length=2000),
            int(assign_to_user_id) if assign_to_user_id is not None else None,
            int(moderator_user_id),
            int(request_id),
        ),
    )
    moderation_service.add_audit_log(
        conn,
        actor_type='moderator',
        actor_id=str(int(moderator_user_id)),
        action='support_request_updated',
        entity_type='support_request',
        entity_id=str(int(request_id)),
        details_json=json.dumps(
            {
                'status': status,
                'resolution_note': moderation_service.normalize_comment(resolution_note, max_length=2000),
            },
            ensure_ascii=False,
        ),
    )
    conn.commit()

    return {
        'request_id': int(request_id),
        'status': status,
    }


def lookup_users(conn, *, query: str, limit: int = 20) -> list[dict[str, Any]]:
    raw_query = str(query or '').strip()
    if not raw_query:
        return []
    safe_limit = moderation_service.parse_int(limit, min_value=1, max_value=50) or 20
    maybe_id = moderation_service.parse_int(raw_query, min_value=1)
    like_value = f"%{raw_query.lower()}%"
    base_sql = '''
        SELECT
            u.id,
            u.username,
            u.display_name,
            u.language,
            u.is_public,
            u.is_online,
            (
                SELECT ms.action_type
                FROM moderation_sanctions ms
                WHERE ms.subject_type = 'user'
                  AND ms.subject_id = CAST(u.id AS TEXT)
                  AND ms.status = 'active'
                  AND ms.action_type IN ('mute_temp', 'ban_temp', 'ban_perma')
                  AND (ms.expires_at IS NULL OR ms.expires_at > CURRENT_TIMESTAMP)
                ORDER BY ms.created_at DESC
                LIMIT 1
            ) AS active_restriction_type,
            (
                SELECT ms.expires_at
                FROM moderation_sanctions ms
                WHERE ms.subject_type = 'user'
                  AND ms.subject_id = CAST(u.id AS TEXT)
                  AND ms.status = 'active'
                  AND ms.action_type IN ('mute_temp', 'ban_temp', 'ban_perma')
                  AND (ms.expires_at IS NULL OR ms.expires_at > CURRENT_TIMESTAMP)
                ORDER BY ms.created_at DESC
                LIMIT 1
            ) AS active_restriction_expires_at
        FROM users u
    '''
    if maybe_id is not None:
        rows = conn.execute(
            base_sql
            + '''
            WHERE
                u.id = ?
                OR LOWER(u.username) LIKE ?
                OR LOWER(u.display_name) LIKE ?
            ORDER BY
                CASE WHEN LOWER(u.username) = LOWER(?) THEN 0 ELSE 1 END ASC,
                u.id ASC
            LIMIT ?
            ''',
            (
                int(maybe_id),
                like_value,
                like_value,
                raw_query,
                safe_limit,
            ),
        ).fetchall()
    else:
        rows = conn.execute(
            base_sql
            + '''
            WHERE
                LOWER(u.username) LIKE ?
                OR LOWER(u.display_name) LIKE ?
            ORDER BY
                CASE WHEN LOWER(u.username) = LOWER(?) THEN 0 ELSE 1 END ASC,
                u.id ASC
            LIMIT ?
            ''',
            (
                like_value,
                like_value,
                raw_query,
                safe_limit,
            ),
        ).fetchall()

    return [
        {
            'id': int(row['id']),
            'username': str(row['username'] or ''),
            'display_name': str(row['display_name'] or ''),
            'language': str(row['language'] or 'ru'),
            'is_public': bool(row['is_public']),
            'is_online': bool(row['is_online']),
            'active_restriction_type': str(row['active_restriction_type'] or ''),
            'active_restriction_expires_at': str(row['active_restriction_expires_at'] or ''),
        }
        for row in rows
    ]


def attach_user_moderation_context(
    conn,
    users: list[dict[str, Any]],
    *,
    history_limit: int = 8,
) -> list[dict[str, Any]]:
    safe_limit = moderation_service.parse_int(history_limit, min_value=1, max_value=50) or 8
    for user in users:
        user_id = moderation_service.parse_int(user.get('id'), min_value=1)
        if user_id is None:
            user['moderation_summary'] = {}
            user['recent_sanctions'] = []
            user['recent_appeals'] = []
            user['recent_support_requests'] = []
            continue

        sanctions = conn.execute(
            '''
            SELECT
                id,
                action_type,
                reason_code,
                status,
                created_by,
                created_at,
                expires_at
            FROM moderation_sanctions
            WHERE subject_type = 'user'
              AND subject_id = ?
            ORDER BY id DESC
            LIMIT ?
            ''',
            (str(int(user_id)), safe_limit),
        ).fetchall()

        appeals = conn.execute(
            '''
            SELECT
                a.id,
                a.state,
                a.created_at,
                a.resolved_at,
                a.resolution_note,
                a.sanction_id,
                s.action_type AS sanction_action_type,
                s.reason_code AS sanction_reason_code
            FROM moderation_appeals a
            JOIN moderation_sanctions s ON s.id = a.sanction_id
            WHERE s.subject_type = 'user'
              AND s.subject_id = ?
            ORDER BY a.id DESC
            LIMIT ?
            ''',
            (str(int(user_id)), safe_limit),
        ).fetchall()

        support_requests = conn.execute(
            '''
            SELECT
                id,
                status,
                category,
                subject,
                created_at,
                resolved_at
            FROM support_requests
            WHERE created_by_user_id = ?
            ORDER BY id DESC
            LIMIT ?
            ''',
            (int(user_id), safe_limit),
        ).fetchall()

        summary = conn.execute(
            '''
            SELECT
                (
                    SELECT COUNT(*)
                    FROM moderation_sanctions ms
                    WHERE ms.subject_type = 'user'
                      AND ms.subject_id = ?
                ) AS sanctions_total,
                (
                    SELECT COUNT(*)
                    FROM moderation_sanctions ms
                    WHERE ms.subject_type = 'user'
                      AND ms.subject_id = ?
                      AND ms.status = 'active'
                      AND ms.action_type IN ('mute_temp', 'ban_temp', 'ban_perma')
                      AND (ms.expires_at IS NULL OR ms.expires_at > CURRENT_TIMESTAMP)
                ) AS active_sanctions_total,
                (
                    SELECT COUNT(*)
                    FROM moderation_appeals a
                    JOIN moderation_sanctions s ON s.id = a.sanction_id
                    WHERE s.subject_type = 'user'
                      AND s.subject_id = ?
                ) AS appeals_total,
                (
                    SELECT COUNT(*)
                    FROM support_requests sr
                    WHERE sr.created_by_user_id = ?
                ) AS support_requests_total,
                (
                    SELECT COUNT(*)
                    FROM support_requests sr
                    WHERE sr.created_by_user_id = ?
                      AND sr.status IN ('open', 'in_progress')
                ) AS support_requests_open_total
            ''',
            (
                str(int(user_id)),
                str(int(user_id)),
                str(int(user_id)),
                int(user_id),
                int(user_id),
            ),
        ).fetchone()

        user['moderation_summary'] = {
            'sanctions_total': int(summary['sanctions_total'] or 0),
            'active_sanctions_total': int(summary['active_sanctions_total'] or 0),
            'appeals_total': int(summary['appeals_total'] or 0),
            'support_requests_total': int(summary['support_requests_total'] or 0),
            'support_requests_open_total': int(summary['support_requests_open_total'] or 0),
        }
        user['recent_sanctions'] = [
            {
                'id': int(row['id']),
                'action_type': str(row['action_type'] or ''),
                'reason_code': str(row['reason_code'] or ''),
                'status': str(row['status'] or ''),
                'created_by': str(row['created_by'] or ''),
                'created_at': str(row['created_at'] or ''),
                'expires_at': str(row['expires_at'] or ''),
            }
            for row in sanctions
        ]
        user['recent_appeals'] = [
            {
                'id': int(row['id']),
                'state': str(row['state'] or ''),
                'created_at': str(row['created_at'] or ''),
                'resolved_at': str(row['resolved_at'] or ''),
                'resolution_note': str(row['resolution_note'] or ''),
                'sanction_id': int(row['sanction_id']) if row['sanction_id'] is not None else None,
                'sanction_action_type': str(row['sanction_action_type'] or ''),
                'sanction_reason_code': str(row['sanction_reason_code'] or ''),
            }
            for row in appeals
        ]
        user['recent_support_requests'] = [
            {
                'id': int(row['id']),
                'status': str(row['status'] or ''),
                'category': str(row['category'] or ''),
                'subject': str(row['subject'] or ''),
                'created_at': str(row['created_at'] or ''),
                'resolved_at': str(row['resolved_at'] or ''),
            }
            for row in support_requests
        ]
    return users
