import logging
import time
from threading import Lock

from apscheduler.schedulers.background import BackgroundScheduler
from flask_socketio import SocketIO

from app.database import get_db_connection
from app.services.refresh_tokens import cleanup_expired as cleanup_expired_refresh
from app.services.disappearing_messages import cleanup_expired_messages as cleanup_disappearing
from app.services.soft_delete_cleanup import cleanup_soft_deleted_messages
from app.services.calls import mark_missed_calls

logger = logging.getLogger(__name__)

_scheduler_lock = Lock()
_scheduler_started = False
_scheduler_instance = None
_spotify_poll_client_id = ''
_spotify_poll_client_secret = ''
_spotify_socket_message_queue = ''
_spotify_socket_publisher = None


def _configure_spotify_polling(config=None) -> int:
    global _spotify_poll_client_id, _spotify_poll_client_secret, _spotify_socket_message_queue, _spotify_socket_publisher
    cfg = config or {}
    _spotify_poll_client_id = str(cfg.get('SPOTIFY_CLIENT_ID') or '').strip()
    _spotify_poll_client_secret = str(cfg.get('SPOTIFY_CLIENT_SECRET') or '').strip()
    next_queue = str(cfg.get('SOCKETIO_MESSAGE_QUEUE') or '').strip()
    if next_queue != _spotify_socket_message_queue:
        _spotify_socket_publisher = None
    _spotify_socket_message_queue = next_queue
    try:
        interval = int(cfg.get('SPOTIFY_POLLING_INTERVAL_SECONDS') or 30)
    except (TypeError, ValueError):
        interval = 30
    return max(5, interval)


def _get_spotify_socket_publisher():
    global _spotify_socket_publisher
    if not _spotify_socket_message_queue:
        return None
    if _spotify_socket_publisher is None:
        _spotify_socket_publisher = SocketIO(message_queue=_spotify_socket_message_queue)
    return _spotify_socket_publisher


def _emit_spotify_socket_event(event_name: str, payload: dict, *, room: str) -> None:
    room_name = str(room or '').strip()
    if not room_name:
        return

    publisher = _get_spotify_socket_publisher()
    if publisher is not None:
        publisher.emit(event_name, payload, room=room_name)
        return

    from app.extensions import socketio

    socketio.emit(event_name, payload, room=room_name)


def _emit_scheduler_socket_event(event_name: str, payload: dict, *, room: str) -> None:
    room_name = str(room or '').strip()
    if not room_name:
        return

    publisher = _get_spotify_socket_publisher()
    if publisher is not None:
        publisher.emit(event_name, payload, room=room_name)
        return

    from app.extensions import socketio

    socketio.emit(event_name, payload, room=room_name)


def cleanup_disappearing_messages_realtime() -> int:
    return cleanup_disappearing(emit_func=_emit_scheduler_socket_event)


def _spotify_realtime_rooms(conn, user_id: int) -> set[str]:
    from app.services.blocking import list_visible_contact_public_keys

    rooms: set[str] = set()
    owner = conn.execute(
        'SELECT public_key FROM users WHERE id = ?',
        (user_id,),
    ).fetchone()
    owner_public_key = str(owner['public_key'] or '').strip() if owner else ''
    if owner_public_key:
        rooms.add(owner_public_key)

    for row in list_visible_contact_public_keys(conn, user_id):
        public_key = str(row['public_key'] or '').strip()
        if public_key:
            rooms.add(public_key)
    return rooms


def _broadcast_spotify_status(conn, user_id: int, spotify_status: dict | None) -> None:
    owner = conn.execute(
        'SELECT public_key FROM users WHERE id = ?',
        (user_id,),
    ).fetchone()
    owner_public_key = str(owner['public_key'] or '').strip() if owner else ''
    if not owner_public_key:
        return

    payload = {
        'user_id': int(user_id),
        'public_key': owner_public_key,
        'spotify_status': spotify_status,
    }
    for room in _spotify_realtime_rooms(conn, user_id):
        try:
            _emit_spotify_socket_event('spotify_status_updated', payload, room=room)
        except Exception:
            logger.debug('Spotify realtime emit failed for room %s user %s', room, user_id, exc_info=True)


def poll_spotify_now_playing():
    """Fetch current playback for all connected Spotify users and update cache."""
    from app.services.spotify import (
        get_connected_user_ids,
        poll_and_update,
    )

    client_id = _spotify_poll_client_id
    client_secret = _spotify_poll_client_secret
    if not client_id or not client_secret:
        return

    conn = get_db_connection()
    try:
        user_ids = get_connected_user_ids(conn)
    finally:
        conn.close()

    for uid in user_ids:
        conn = get_db_connection()
        try:
            spotify_status = poll_and_update(conn, uid, client_id, client_secret)
            _broadcast_spotify_status(conn, uid, spotify_status)
        except Exception:
            logger.warning('Spotify poll failed for user %s', uid, exc_info=True)
        finally:
            conn.close()


def cleanup_stale_ringing_calls():
    """Mark ringing calls older than 60 s as missed so they don't block chats."""
    conn = get_db_connection()
    try:
        missed = mark_missed_calls(conn)
        if missed:
            logger.info('Scheduler: marked %d stale call(s) as missed: %s', len(missed), missed)
    except Exception:
        logger.exception('Stale ringing calls cleanup failed')
    finally:
        conn.close()


def cleanup_dialog_keys():
    conn = get_db_connection()
    try:
        conn.execute(
            "DELETE FROM dialog_keys WHERE used = 1 OR created_at < (CURRENT_TIMESTAMP - INTERVAL '1 minute')"
        )
        conn.commit()
    except Exception:
        logger.exception('Dialog key cleanup failed')
    finally:
        conn.close()


def create_scheduler(config=None):
    scheduler = BackgroundScheduler()
    scheduler.add_job(
        func=cleanup_dialog_keys,
        trigger='interval',
        seconds=60,
        id='cleanup_dialog_keys',
        replace_existing=True,
    )
    scheduler.add_job(
        func=cleanup_expired_refresh,
        trigger='interval',
        hours=6,
        id='cleanup_refresh_tokens',
        replace_existing=True,
    )
    scheduler.add_job(
        func=cleanup_disappearing_messages_realtime,
        trigger='interval',
        seconds=30,
        id='cleanup_disappearing_messages',
        replace_existing=True,
    )
    scheduler.add_job(
        func=cleanup_stale_ringing_calls,
        trigger='interval',
        seconds=60,
        id='cleanup_stale_ringing_calls',
        replace_existing=True,
    )
    scheduler.add_job(
        func=cleanup_soft_deleted_messages,
        trigger='interval',
        hours=6,
        id='cleanup_soft_deleted_messages',
        replace_existing=True,
    )
    poll_interval = _configure_spotify_polling(config)
    if _spotify_poll_client_id and _spotify_poll_client_secret:
        scheduler.add_job(
            func=poll_spotify_now_playing,
            trigger='interval',
            seconds=poll_interval,
            id='poll_spotify_now_playing',
            replace_existing=True,
        )
    return scheduler


def start_scheduler_if_enabled(config):
    global _scheduler_started, _scheduler_instance
    if not config.get('SCHEDULER_ENABLED', True):
        return None

    with _scheduler_lock:
        if _scheduler_started and _scheduler_instance:
            return _scheduler_instance

        scheduler = create_scheduler(config=config)
        scheduler.start()
        _scheduler_instance = scheduler
        _scheduler_started = True
        return scheduler


def run_scheduler_forever(config_name=None):
    import os

    from app.config import get_config_class, load_environment

    load_environment()
    config = get_config_class(config_name).from_env()
    os.environ['DATABASE_BACKEND'] = 'postgres'
    database_url = str(config.get('DATABASE_URL') or '').strip()
    if database_url:
        os.environ['DATABASE_URL'] = database_url
    elif not str(os.environ.get('DATABASE_URL') or '').strip():
        raise RuntimeError('DATABASE_URL must be set for scheduler runtime')
    scheduler = start_scheduler_if_enabled(config)
    if scheduler is None:
        logger.info('Scheduler is disabled by configuration.')
        return

    logger.info('Background scheduler started.')
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        logger.info('Stopping background scheduler...')
    finally:
        scheduler.shutdown(wait=False)
