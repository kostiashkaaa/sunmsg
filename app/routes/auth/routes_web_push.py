from flask import current_app, jsonify, make_response, request, session

from app.database import get_db_connection
from app.extensions import limiter
from .context import auth_bp
from app.services.web_push import (
    deactivate_push_subscription,
    deactivate_user_push_subscriptions,
    normalize_subscription,
    save_push_subscription,
    web_push_bootstrap_payload,
)


@auth_bp.route('/service-worker.js', methods=['GET'])
def service_worker_script():
    response = make_response(current_app.send_static_file('service-worker.js'))
    response.headers['Service-Worker-Allowed'] = '/'
    response.headers['Cache-Control'] = 'no-cache'
    response.headers['Content-Type'] = 'application/javascript; charset=utf-8'
    return response


@auth_bp.route('/api/web_push/public_key', methods=['GET'])
@limiter.limit("120 per minute")
def web_push_public_key():
    payload = web_push_bootstrap_payload(current_app.config)
    return jsonify({'success': True, **payload})


@auth_bp.route('/api/web_push/subscribe', methods=['POST'])
@limiter.limit("30 per minute")
def web_push_subscribe():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Не авторизован.'}), 401

    payload = web_push_bootstrap_payload(current_app.config)
    if not payload['enabled']:
        return jsonify({'success': False, 'error': 'Web push отключен на сервере.'}), 503

    data = request.get_json(silent=True) or {}
    subscription = normalize_subscription(data.get('subscription'))
    if not subscription:
        return jsonify({'success': False, 'error': 'Некорректная push-подписка.'}), 400

    conn = get_db_connection()
    try:
        save_push_subscription(
            conn,
            user_id=int(session['user_id']),
            subscription=subscription,
            user_agent=str(request.headers.get('User-Agent') or ''),
        )
        conn.commit()
    finally:
        conn.close()

    return jsonify({'success': True})


@auth_bp.route('/api/web_push/unsubscribe', methods=['POST'])
@limiter.limit("30 per minute")
def web_push_unsubscribe():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Не авторизован.'}), 401

    data = request.get_json(silent=True) or {}
    endpoint = str(data.get('endpoint') or '').strip()
    user_id = int(session['user_id'])

    conn = get_db_connection()
    try:
        if endpoint:
            updated = deactivate_push_subscription(conn, user_id=user_id, endpoint=endpoint)
        else:
            updated = deactivate_user_push_subscriptions(conn, user_id=user_id)
        conn.commit()
    finally:
        conn.close()

    return jsonify({'success': True, 'updated': int(updated)})
