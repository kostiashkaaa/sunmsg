from datetime import datetime
import time

from app.db.schema import tables_columns
from app.routes.bool_utils import coerce_bool_flag
from app.services.favorites_chat import (
    ensure_saved_messages_chat,
    resolve_contact_display_name,
)


def _resolve_schema_columns(conn, cursor, *, ensure_pinned_chats_table_func):
    schema_columns = tables_columns(
        cursor,
        ('chat_drafts', 'pinned_chats', 'users', 'chats', 'chat_members', 'message_receipts', 'messages'),
    )
    has_pinned_chats = bool(schema_columns.get('pinned_chats', set()))
    if not has_pinned_chats:
        ensure_pinned_chats_table_func(conn)
        schema_columns = tables_columns(
            cursor,
            ('chat_drafts', 'pinned_chats', 'users', 'chats', 'chat_members', 'message_receipts', 'messages'),
        )
        has_pinned_chats = bool(schema_columns.get('pinned_chats', set()))
    has_chat_drafts = bool(schema_columns.get('chat_drafts', set()))
    return schema_columns, has_pinned_chats, has_chat_drafts


def _resolve_saved_messages_id(conn, *, user_id: int) -> str:
    user_row = conn.execute(
        '''
        SELECT public_key
        FROM users
        WHERE id = ?
        ''',
        (user_id,),
    ).fetchone()
    if not user_row:
        return ''
    return ensure_saved_messages_chat(
        conn,
        user_id=user_id,
        public_key=str(user_row['public_key'] or ''),
    )


def _build_sql_projection_parts(*, schema_columns: dict, has_pinned_chats: bool, has_chat_drafts: bool):
    users_columns = schema_columns.get('users', set())
    last_seen_select_sql = 'u.last_seen AS last_seen' if 'last_seen' in users_columns else 'NULL AS last_seen'
    has_group_invite_privacy = 'group_invite_privacy' in users_columns
    group_add_direct_select_sql = (
        '''
            CASE
                WHEN LOWER(COALESCE(u.group_invite_privacy, 'all')) = 'nobody' THEN 0
                WHEN LOWER(COALESCE(u.group_invite_privacy, 'all')) = 'contacts'
                     AND EXISTS(
                        SELECT 1
                        FROM contacts invite_contacts
                        WHERE invite_contacts.user_id = u.id
                          AND invite_contacts.contact_id = ?
                     ) THEN 1
                WHEN LOWER(COALESCE(u.group_invite_privacy, 'all')) = 'contacts' THEN 0
                ELSE 1
            END AS can_group_add_direct
        '''
        if has_group_invite_privacy
        else '1 AS can_group_add_direct'
    )
    draft_select_sql = 'cd.draft_text, cd.updated_at AS draft_updated_at'
    draft_join_sql = 'LEFT JOIN chat_drafts cd ON cd.chat_id = uc.chat_id AND cd.user_id = ?'
    draft_order_value_sql = 'CAST(cd.updated_at AS TEXT)'
    if not has_chat_drafts:
        draft_select_sql = "'' AS draft_text, NULL AS draft_updated_at"
        draft_join_sql = ''
        draft_order_value_sql = 'NULL'

    pinned_select_sql = 'pc.chat_id IS NOT NULL AS is_pinned, COALESCE(pc.pin_order, 0) AS pin_order'
    pinned_join_sql = 'LEFT JOIN pinned_chats pc ON pc.chat_id = uc.chat_id AND pc.user_id = ?'
    pinned_order_presence_sql = 'CASE WHEN pc.chat_id IS NOT NULL THEN 0 ELSE 1 END ASC,'
    pinned_order_value_sql = 'CASE WHEN pc.chat_id IS NOT NULL THEN pc.pin_order ELSE NULL END ASC,'
    if not has_pinned_chats:
        pinned_select_sql = '0 AS is_pinned, 0 AS pin_order'
        pinned_join_sql = ''
        pinned_order_presence_sql = ''
        pinned_order_value_sql = ''
    message_expiry_filter_sql = ''
    if 'expires_at' in schema_columns.get('messages', set()):
        message_expiry_filter_sql = 'AND (m.expires_at IS NULL OR m.expires_at > ?)'

    return {
        'last_seen_select_sql': last_seen_select_sql,
        'has_group_invite_privacy': has_group_invite_privacy,
        'group_add_direct_select_sql': group_add_direct_select_sql,
        'draft_select_sql': draft_select_sql,
        'draft_join_sql': draft_join_sql,
        'draft_order_value_sql': draft_order_value_sql,
        'pinned_select_sql': pinned_select_sql,
        'pinned_join_sql': pinned_join_sql,
        'pinned_order_presence_sql': pinned_order_presence_sql,
        'pinned_order_value_sql': pinned_order_value_sql,
        'message_expiry_filter_sql': message_expiry_filter_sql,
    }


def _build_direct_contacts_query(*, projection_parts: dict) -> str:
    return '''
        WITH user_contacts AS (
            SELECT c.chat_id, c.contact_id
            FROM contacts c
            WHERE c.user_id = ?
        ),
        user_chat_ids AS (
            SELECT DISTINCT uc.chat_id
            FROM user_contacts uc
        ),
        latest_visible_message_ids AS (
            SELECT visible.chat_id, MAX(visible.id) AS last_message_id, COUNT(DISTINCT visible.id) AS message_count
            FROM (
                SELECT m.chat_id, m.id
                FROM messages m
                JOIN user_chat_ids uci ON uci.chat_id = m.chat_id
                WHERE m.sender_id = ? AND m.deleted_by_sender = 0
                  {message_expiry_filter_sql}

                UNION ALL

                SELECT m.chat_id, m.id
                FROM messages m
                JOIN user_chat_ids uci ON uci.chat_id = m.chat_id
                WHERE m.receiver_id = ? AND m.deleted_by_receiver = 0
                  {message_expiry_filter_sql}
            ) AS visible
            GROUP BY visible.chat_id
        ),
        last_messages AS (
            SELECT
                m.chat_id,
                m.message AS last_message,
                m.sender_id AS last_sender_id,
                m.is_read AS last_message_is_read,
                m.is_delivered AS last_message_is_delivered,
                m.created_at AS last_message_time,
                lvm.message_count
            FROM latest_visible_message_ids lvm
            JOIN messages m ON m.id = lvm.last_message_id
        ),
        unread_counts AS (
            SELECT
                m.chat_id,
                COUNT(*) AS unread_count
            FROM messages m
            JOIN user_chat_ids uci ON uci.chat_id = m.chat_id
            WHERE
                m.receiver_id = ?
                AND m.is_read = 0
                AND m.deleted_by_receiver = 0
                {message_expiry_filter_sql}
            GROUP BY m.chat_id
        )
        SELECT
            u.id,
            u.username,
            u.display_name,
            u.public_key,
            uc.chat_id,
            u.avatar_url,
            u.avatar_visibility,
            u.is_online,
            {last_seen_select_sql},
            u.hide_online_status,
            1 AS is_contact,
            {group_add_direct_select_sql},
            CASE WHEN bm.blocked_id IS NULL THEN 0 ELSE 1 END AS blocked_by_me,
            CASE WHEN bme.blocker_id IS NULL THEN 0 ELSE 1 END AS blocked_me,
            lm.last_message,
            lm.last_sender_id,
            lm.last_message_is_read,
            lm.last_message_is_delivered,
            lm.last_message_time,
            COALESCE(lm.message_count, 0) AS message_count,
            COALESCE(ucnt.unread_count, 0) AS unread_count,
            {pinned_select_sql},
            {draft_select_sql}
        FROM user_contacts uc
        JOIN users u ON uc.contact_id = u.id
        LEFT JOIN block_list bm ON bm.blocker_id = ? AND bm.blocked_id = u.id
        LEFT JOIN block_list bme ON bme.blocker_id = u.id AND bme.blocked_id = ?
        LEFT JOIN last_messages lm ON lm.chat_id = uc.chat_id
        LEFT JOIN unread_counts ucnt ON ucnt.chat_id = uc.chat_id
        {pinned_join_sql}
        {draft_join_sql}
        ORDER BY
            CASE WHEN uc.contact_id = ? THEN 0 ELSE 1 END ASC,
            {pinned_order_presence_sql}
            {pinned_order_value_sql}
            CASE WHEN COALESCE({draft_order_value_sql}, CAST(lm.last_message_time AS TEXT)) IS NULL THEN 1 ELSE 0 END ASC,
            COALESCE({draft_order_value_sql}, CAST(lm.last_message_time AS TEXT)) DESC
        '''.format(
        pinned_select_sql=projection_parts['pinned_select_sql'],
        pinned_join_sql=projection_parts['pinned_join_sql'],
        pinned_order_presence_sql=projection_parts['pinned_order_presence_sql'],
        pinned_order_value_sql=projection_parts['pinned_order_value_sql'],
        draft_select_sql=projection_parts['draft_select_sql'],
        draft_join_sql=projection_parts['draft_join_sql'],
        draft_order_value_sql=projection_parts['draft_order_value_sql'],
        last_seen_select_sql=projection_parts['last_seen_select_sql'],
        group_add_direct_select_sql=projection_parts['group_add_direct_select_sql'],
        message_expiry_filter_sql=projection_parts['message_expiry_filter_sql'],
    )


def _build_direct_contacts_params(
    *,
    user_id: int,
    projection_parts: dict,
    has_pinned_chats: bool,
    has_chat_drafts: bool,
    limit: int | None,
):
    message_expiry_filter_sql = str(projection_parts.get('message_expiry_filter_sql') or '')
    has_message_expiry_filter = bool(message_expiry_filter_sql)
    expiry_cutoff = int(time.time())
    params = [user_id, user_id]
    if has_message_expiry_filter:
        params.append(expiry_cutoff)
    params.append(user_id)
    if has_message_expiry_filter:
        params.append(expiry_cutoff)
    params.append(user_id)
    if has_message_expiry_filter:
        params.append(expiry_cutoff)
    if projection_parts['has_group_invite_privacy']:
        params.append(user_id)
    params.extend([user_id, user_id])
    if has_pinned_chats:
        params.append(user_id)
    if has_chat_drafts:
        params.append(user_id)
    params.append(user_id)
    if isinstance(limit, int) and limit > 0:
        params.append(limit)
    return params


def _fetch_direct_contacts_rows(  # noqa: PLR0913
    cursor,
    *,
    user_id: int,
    projection_parts: dict,
    has_pinned_chats: bool,
    has_chat_drafts: bool,
    limit: int | None,
):
    query = _build_direct_contacts_query(projection_parts=projection_parts)
    if isinstance(limit, int) and limit > 0:
        query += '\n        LIMIT ?'
    params = _build_direct_contacts_params(
        user_id=user_id,
        projection_parts=projection_parts,
        has_pinned_chats=has_pinned_chats,
        has_chat_drafts=has_chat_drafts,
        limit=limit,
    )
    return cursor.execute(query, tuple(params)).fetchall()


def _serialize_personal_contacts(  # noqa: PLR0913
    *,
    contacts,
    user_id: int,
    saved_messages_id: str,
    resolved_language: str,
    include_self_contact: bool,
    format_sidebar_time_func,
    build_initial_last_message_preview_func,
    get_safe_avatar_url_func,
    is_effectively_online_func,
):
    contacts_list = []
    for contact in contacts:
        blocked_by_me = bool(contact['blocked_by_me'])
        blocked_me = bool(contact['blocked_me'])
        is_blocked = blocked_by_me or blocked_me
        raw_last_message = contact['last_message']
        draft_text = str(contact['draft_text'] or '')
        has_draft = bool(draft_text.strip())
        preview_timestamp = contact['draft_updated_at'] if has_draft else contact['last_message_time']
        is_saved_messages = str(contact['chat_id'] or '') == str(saved_messages_id or '')
        resolved_display_name = resolve_contact_display_name(
            viewer_user_id=user_id,
            contact_user_id=int(contact['id']),
            language=resolved_language,
            display_name=str(contact['display_name'] or ''),
            username=str(contact['username'] or ''),
        )
        is_status_hidden = is_blocked or bool(contact['hide_online_status'])
        if (
            not include_self_contact
            and int(contact['id']) == int(user_id)
            and str(contact['chat_id'] or '') != str(saved_messages_id or '')
        ):
            continue
        contacts_list.append(
            {
                'userId': contact['id'],
                'display_name': resolved_display_name,
                'username': contact['username'],
                'public_key': contact['public_key'],
                'chatId': contact['chat_id'],
                'last_message': raw_last_message,
                'last_message_time': contact['last_message_time'],
                'message_count': int(contact['message_count'] or 0) if is_saved_messages else 0,
                'sidebar_time_text': format_sidebar_time_func(
                    preview_timestamp,
                    language=resolved_language,
                ),
                'initial_last_message_preview': build_initial_last_message_preview_func(
                    raw_last_message,
                    blocked_by_me=blocked_by_me,
                    blocked_me=blocked_me,
                    language=resolved_language,
                ),
                'unreadCount': 0 if is_saved_messages else contact['unread_count'],
                'avatar_url': get_safe_avatar_url_func(contact, user_id),
                'is_online': (
                    False
                    if is_status_hidden
                    else is_effectively_online_func(
                        contact['public_key'],
                        persisted=bool(contact['is_online']),
                    )
                ),
                'last_seen': None if is_status_hidden else contact['last_seen'],
                'last_sender_id': contact['last_sender_id'],
                'last_message_is_read': bool(contact['last_message_is_read']),
                'last_message_is_delivered': bool(contact['last_message_is_delivered']),
                'blocked_by_me': blocked_by_me,
                'blocked_me': blocked_me,
                'is_blocked': is_blocked,
                'can_group_add_direct': (
                    coerce_bool_flag(contact['can_group_add_direct'], default=True)
                    if 'can_group_add_direct' in contact.keys()
                    else True
                ),
                'is_pinned': bool(contact['is_pinned']),
                'pin_order': contact['pin_order'],
                'draft_text': draft_text if has_draft else '',
                'has_draft': has_draft,
                'draft_updated_at': contact['draft_updated_at'] if has_draft else None,
                'is_saved_messages': is_saved_messages,
            }
        )
    return contacts_list


def _fetch_group_rows(conn, cursor, *, schema_columns: dict, user_id: int):
    chats_columns = schema_columns.get('chats', set())
    has_chat_members_table = bool(schema_columns.get('chat_members', set()))
    has_message_receipts_table = bool(schema_columns.get('message_receipts', set()))
    if not has_chat_members_table or not has_message_receipts_table:
        return []
    message_expiry_filter_sql = ''
    if 'expires_at' in schema_columns.get('messages', set()):
        message_expiry_filter_sql = 'AND (m.expires_at IS NULL OR m.expires_at > ?)'
    has_message_expiry_filter = bool(message_expiry_filter_sql)
    expiry_cutoff = int(time.time())

    has_group_membership = cursor.execute(
        '''
        SELECT 1
        FROM chat_members
        WHERE user_id = ?
        LIMIT 1
        ''',
        (user_id,),
    ).fetchone()
    if not has_group_membership:
        return []

    has_chat_avatar_column = 'chat_avatar_url' in chats_columns
    has_chat_description_column = 'chat_description' in chats_columns
    group_avatar_select_sql = 'ch.chat_avatar_url AS chat_avatar_url' if has_chat_avatar_column else 'NULL AS chat_avatar_url'
    group_description_select_sql = (
        'ch.chat_description AS chat_description'
        if has_chat_description_column
        else "'' AS chat_description"
    )
    try:
        return cursor.execute(
            f'''
            WITH user_groups AS (
                SELECT ch.chat_id, ch.chat_name, {group_avatar_select_sql}, {group_description_select_sql}
                FROM chat_members cm
                JOIN chats ch ON ch.chat_id = cm.chat_id
                WHERE cm.user_id = ?
                  AND COALESCE(NULLIF(ch.chat_type, ''), 'group') = 'group'
            ),
            latest_group_message_ids AS (
                SELECT m.chat_id, MAX(m.id) AS last_message_id
                FROM messages m
                JOIN message_receipts mr ON mr.message_id = m.id
                JOIN user_groups ug ON ug.chat_id = m.chat_id
                WHERE mr.user_id = ?
                  AND mr.deleted_for_user = 0
                  {message_expiry_filter_sql}
                GROUP BY m.chat_id
            ),
            last_messages AS (
                SELECT
                    m.chat_id,
                    m.message AS last_message,
                    m.sender_id AS last_sender_id,
                    mr.is_read AS last_message_is_read,
                    mr.is_delivered AS last_message_is_delivered,
                    m.created_at AS last_message_time
                FROM latest_group_message_ids lgm
                JOIN messages m ON m.id = lgm.last_message_id
                LEFT JOIN message_receipts mr ON mr.message_id = m.id AND mr.user_id = ?
            ),
            unread_counts AS (
                SELECT
                    m.chat_id,
                    COUNT(*) AS unread_count
                FROM messages m
                JOIN message_receipts mr ON mr.message_id = m.id
                JOIN user_groups ug ON ug.chat_id = m.chat_id
                WHERE mr.user_id = ?
                  AND mr.deleted_for_user = 0
                  AND mr.is_read = 0
                  AND m.sender_id <> ?
                  {message_expiry_filter_sql}
                GROUP BY m.chat_id
            ),
            group_member_counts AS (
                SELECT cm.chat_id, COUNT(*) AS members_count
                FROM chat_members cm
                JOIN user_groups ug ON ug.chat_id = cm.chat_id
                GROUP BY cm.chat_id
            )
            SELECT
                ug.chat_id,
                ug.chat_name,
                ug.chat_avatar_url,
                ug.chat_description,
                lm.last_message,
                lm.last_sender_id,
                lm.last_message_is_read,
                lm.last_message_is_delivered,
                lm.last_message_time,
                COALESCE(uc.unread_count, 0) AS unread_count,
                COALESCE(gmc.members_count, 0) AS members_count,
                pc.chat_id IS NOT NULL AS is_pinned,
                COALESCE(pc.pin_order, 0) AS pin_order,
                cd.draft_text,
                cd.updated_at AS draft_updated_at
            FROM user_groups ug
            LEFT JOIN last_messages lm ON lm.chat_id = ug.chat_id
            LEFT JOIN unread_counts uc ON uc.chat_id = ug.chat_id
            LEFT JOIN group_member_counts gmc ON gmc.chat_id = ug.chat_id
            LEFT JOIN pinned_chats pc ON pc.user_id = ? AND pc.chat_id = ug.chat_id
            LEFT JOIN chat_drafts cd ON cd.user_id = ? AND cd.chat_id = ug.chat_id
            ''',
            (
                user_id,
                user_id,
                *([expiry_cutoff] if has_message_expiry_filter else []),
                user_id,
                user_id,
                user_id,
                *([expiry_cutoff] if has_message_expiry_filter else []),
                user_id,
                user_id,
            ),
        ).fetchall()
    except Exception:  # noqa: BLE001
        try:
            conn.rollback()
        except Exception:  # noqa: BLE001
            pass
        return []


def _append_group_contacts(  # noqa: PLR0913
    *,
    contacts_list: list[dict],
    group_rows,
    resolved_language: str,
    format_sidebar_time_func,
    build_initial_last_message_preview_func,
):
    for row in group_rows:
        raw_last_message = row['last_message']
        draft_text = str(row['draft_text'] or '')
        has_draft = bool(draft_text.strip())
        preview_timestamp = row['draft_updated_at'] if has_draft else row['last_message_time']
        group_initial_last_message_preview = (
            '__SUN_ENCRYPTED_LOADING__'
            if (not has_draft and str(raw_last_message or '').strip())
            else build_initial_last_message_preview_func(
                raw_last_message,
                blocked_by_me=False,
                blocked_me=False,
                language=resolved_language,
            )
        )
        contacts_list.append(
            {
                'userId': None,
                'display_name': str(row['chat_name'] or 'Group chat'),
                'username': '',
                'public_key': '',
                'chatId': row['chat_id'],
                'last_message': raw_last_message,
                'last_message_time': row['last_message_time'],
                'sidebar_time_text': format_sidebar_time_func(
                    preview_timestamp,
                    language=resolved_language,
                ),
                'initial_last_message_preview': group_initial_last_message_preview,
                'unreadCount': row['unread_count'],
                'avatar_url': str(row['chat_avatar_url'] or ''),
                'group_description': str(row['chat_description'] or ''),
                'is_online': False,
                'last_sender_id': row['last_sender_id'],
                'last_message_is_read': bool(row['last_message_is_read']),
                'last_message_is_delivered': bool(row['last_message_is_delivered']),
                'blocked_by_me': False,
                'blocked_me': False,
                'is_blocked': False,
                'is_pinned': bool(row['is_pinned']),
                'pin_order': row['pin_order'],
                'members_count': int(row['members_count'] or 0),
                'draft_text': draft_text if has_draft else '',
                'has_draft': has_draft,
                'draft_updated_at': row['draft_updated_at'] if has_draft else None,
                'is_group': True,
            }
        )


def _sort_contacts_with_pin_and_activity(contacts_list: list[dict]):
    def _sort_timestamp(item: dict) -> float:
        raw = str(item.get('draft_updated_at') or item.get('last_message_time') or '').strip()
        if not raw:
            return 0.0
        try:
            return datetime.fromisoformat(raw.replace(' ', 'T')).timestamp()
        except ValueError:
            return 0.0

    def _sort_key(item: dict):
        is_saved_messages = bool(item.get('is_saved_messages'))
        is_pinned = bool(item.get('is_pinned'))
        pin_order = int(item.get('pin_order') or 0)
        return (
            0 if is_saved_messages else 1,
            0 if is_pinned else 1,
            pin_order if is_pinned else 0,
            -_sort_timestamp(item),
        )

    contacts_list.sort(key=_sort_key)


def fetch_contacts_for_user(  # noqa: PLR0913
    user_id: int,
    conn,
    *,
    limit: int | None = None,
    language: str = 'ru',
    normalize_language_func,
    ensure_pinned_chats_table_func,
    format_sidebar_time_func,
    build_initial_last_message_preview_func,
    get_safe_avatar_url_func,
    is_effectively_online_func,
    include_self_contact: bool = True,
):
    resolved_language = normalize_language_func(language, default='ru')
    cursor = conn.cursor()
    schema_columns, has_pinned_chats, has_chat_drafts = _resolve_schema_columns(
        conn,
        cursor,
        ensure_pinned_chats_table_func=ensure_pinned_chats_table_func,
    )
    saved_messages_id = _resolve_saved_messages_id(conn, user_id=user_id)
    projection_parts = _build_sql_projection_parts(
        schema_columns=schema_columns,
        has_pinned_chats=has_pinned_chats,
        has_chat_drafts=has_chat_drafts,
    )
    contacts = _fetch_direct_contacts_rows(
        cursor,
        user_id=user_id,
        projection_parts=projection_parts,
        has_pinned_chats=has_pinned_chats,
        has_chat_drafts=has_chat_drafts,
        limit=limit,
    )
    contacts_list = _serialize_personal_contacts(
        contacts=contacts,
        user_id=user_id,
        saved_messages_id=saved_messages_id,
        resolved_language=resolved_language,
        include_self_contact=include_self_contact,
        format_sidebar_time_func=format_sidebar_time_func,
        build_initial_last_message_preview_func=build_initial_last_message_preview_func,
        get_safe_avatar_url_func=get_safe_avatar_url_func,
        is_effectively_online_func=is_effectively_online_func,
    )
    group_rows = _fetch_group_rows(conn, cursor, schema_columns=schema_columns, user_id=user_id)
    _append_group_contacts(
        contacts_list=contacts_list,
        group_rows=group_rows,
        resolved_language=resolved_language,
        format_sidebar_time_func=format_sidebar_time_func,
        build_initial_last_message_preview_func=build_initial_last_message_preview_func,
    )
    _sort_contacts_with_pin_and_activity(contacts_list)
    if isinstance(limit, int) and limit > 0:
        contacts_list = contacts_list[:limit]
    return contacts_list
