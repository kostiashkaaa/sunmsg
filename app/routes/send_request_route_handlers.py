from app.db_backend import DatabaseError


def process_send_request(
    conn,
    *,
    sender_user_id: int,
    receiver_user_id: int,
    send_dialog_request_workflow_func,
    normalize_block_state_func,
    build_block_state_func,
):
    try:
        result = send_dialog_request_workflow_func(
            conn,
            sender_user_id=sender_user_id,
            receiver_user_id=receiver_user_id,
            normalize_block_state_func=normalize_block_state_func,
            build_block_state_func=build_block_state_func,
        )
    except DatabaseError:
        return {'status': 'db_error'}
    except Exception:
        return {'status': 'db_error'}

    status = result.get('status')
    if status == 'receiver_missing':
        return {'status': 'receiver_missing'}
    if status == 'blocked':
        return {'status': 'blocked', 'block_state': result.get('block_state')}
    if status == 'auto_decline':
        return {'status': 'auto_decline'}
    if status == 'cooldown':
        return {
            'status': 'cooldown',
            'retry_after': int(result.get('retry_after') or 0),
        }
    return {'status': 'ok', 'event': result.get('event')}


def process_send_request_route(
    conn,
    *,
    sender_user_id: int,
    data,
    parse_int_func,
    process_send_request_func,
    send_dialog_request_workflow_func,
    normalize_block_state_func,
    build_block_state_func,
):
    if not data:
        return {'status': 'invalid_payload'}

    receiver_user_id = parse_int_func(data.get('contact_user_id'))
    if not receiver_user_id:
        return {'status': 'invalid_contact_user_id'}

    if int(sender_user_id) == int(receiver_user_id):
        return {'status': 'self_request'}

    return process_send_request_func(
        conn,
        sender_user_id=sender_user_id,
        receiver_user_id=receiver_user_id,
        send_dialog_request_workflow_func=send_dialog_request_workflow_func,
        normalize_block_state_func=normalize_block_state_func,
        build_block_state_func=build_block_state_func,
    )
