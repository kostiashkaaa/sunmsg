from app.sockets.chat_access import emit_blocked_error as emit_blocked_error_impl
from app.sockets.validation import socket_connect_csrf_ok as socket_connect_csrf_ok_impl
from app.sockets.validation import socket_csrf_ok as socket_csrf_ok_impl


def socket_csrf_ok(
    data,
    *,
    validate_csrf_func,
    emit_func,
    logger,
    user_id,
    validation_error_cls,
) -> bool:
    return socket_csrf_ok_impl(
        data,
        validate_csrf_func=validate_csrf_func,
        emit_func=emit_func,
        logger=logger,
        user_id=user_id,
        validation_error_cls=validation_error_cls,
    )


def socket_connect_csrf_ok(
    auth,
    *,
    validate_csrf_func,
    logger,
    user_id,
    sid: str,
    validation_error_cls,
) -> bool:
    return socket_connect_csrf_ok_impl(
        auth,
        validate_csrf_func=validate_csrf_func,
        logger=logger,
        user_id=user_id,
        sid=sid,
        validation_error_cls=validation_error_cls,
    )


def emit_blocked_error(
    message: str,
    *,
    state=None,
    request_id: str | None = None,
    block_error_payload_func,
    normalize_block_state_func,
    emit_func,
):
    emit_blocked_error_impl(
        message,
        state=state,
        request_id=request_id,
        block_error_payload_func=block_error_payload_func,
        normalize_block_state_func=normalize_block_state_func,
        emit_func=emit_func,
    )
