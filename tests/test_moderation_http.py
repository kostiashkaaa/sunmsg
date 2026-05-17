from app import create_app
from app.services import moderation as moderation_service

from tests._chat_contacts_http_helpers import _authed_client, _connect


def _seed_users(conn):
    conn.execute(
        '''
        INSERT INTO users (id, public_key, username, display_name)
        VALUES
            (1, 'pk-1', 'alice', 'Alice'),
            (2, 'pk-2', 'bob', 'Bob'),
            (99, 'pk-99', 'moderator', 'Moderator')
        '''
    )
    conn.commit()


def _grant_moderator_role(conn, *, user_id: int = 99):
    conn.execute(
        '''
        INSERT INTO moderation_user_roles (user_id, role)
        VALUES (?, 'moderator')
        ON CONFLICT(user_id, role) DO NOTHING
        ''',
        (int(user_id),),
    )
    conn.commit()


def test_maybe_apply_automated_spam_mute_from_block_spike(monkeypatch, tmp_path):
    db_path = tmp_path / 'moderation-auto-spam-mute.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)
    create_app('testing', overrides={'DATABASE_PATH': str(db_path)})

    with _connect(db_path) as conn:
        _seed_users(conn)
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES (3, 'pk-3', 'cara', 'Cara')
            '''
        )
        conn.execute('INSERT INTO block_list (blocker_id, blocked_id) VALUES (1, 2)')
        conn.execute('INSERT INTO block_list (blocker_id, blocked_id) VALUES (3, 2)')
        conn.commit()

        restriction = moderation_service.maybe_apply_automated_spam_mute(
            conn,
            user_id=2,
            trigger='pre_send',
            window_seconds=3600,
            reports_threshold=3,
            blocks_threshold=2,
            ttl_seconds=3600,
        )

        assert restriction is not None
        assert restriction['action_type'] == 'mute_temp'
        assert restriction['reason_code'] == 'automated_spam'
        active = moderation_service.active_user_restriction(conn, user_id=2)
        assert active is not None
        assert active['sanction_id'] == restriction['sanction_id']


def _process_jobs(db_path, *, worker_id='test-worker'):
    with _connect(db_path) as conn:
        return moderation_service.process_next_report_job(
            conn,
            worker_id=worker_id,
            max_attempts=5,
            retry_delay_seconds=1,
            auto_action_threshold=0.99,
            auto_action_type='mute_temp',
            auto_action_ttl_seconds=3600,
            rate_window_seconds=3600,
            repeat_window_days=90,
            rate_threshold=5,
            high_risk_ip_cidrs=[],
        )


def test_moderation_report_submit_and_status_flow(monkeypatch, tmp_path):
    db_path = tmp_path / 'moderation-report-http.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app(
        'testing',
        overrides={
            'DATABASE_PATH': str(db_path),
            'MODERATOR_USER_IDS': '',
            'MODERATION_AUTO_ACTION_THRESHOLD': 0.99,
            'MODERATION_REPORT_ASYNC_ENABLED': True,
        },
    )

    with _connect(db_path) as conn:
        _seed_users(conn)
        _grant_moderator_role(conn, user_id=99)

    reporter_client = _authed_client(app, 1, 'pk-1')

    response = reporter_client.post(
        '/api/moderation/reports',
        json={
            'target_type': 'user',
            'target_id': '2',
            'reason_code': 'spam',
            'comment': 'mass spam',
            'idempotency_key': 'report-1',
        },
    )
    payload = response.get_json()
    assert response.status_code == 200
    assert payload['success'] is True
    assert payload['created'] is True
    assert isinstance(payload['report_id'], int)
    assert payload['case_id'] is None
    assert payload['status'] == 'received'
    report_id = int(payload['report_id'])
    case_id = 0

    response = reporter_client.post(
        '/api/moderation/reports',
        json={
            'target_type': 'user',
            'target_id': '2',
            'reason_code': 'spam',
            'idempotency_key': 'report-1',
        },
    )
    payload = response.get_json()
    assert response.status_code == 200
    assert payload['success'] is True
    assert payload['created'] is False
    assert int(payload['report_id']) == report_id
    assert payload['case_id'] in {None, 0}

    processing_result = _process_jobs(db_path)
    assert processing_result['status'] == 'processed'
    case_id = int(processing_result['case_id'])

    response = reporter_client.get(f'/api/moderation/reports/{report_id}')
    payload = response.get_json()
    assert response.status_code == 200
    assert payload['success'] is True
    assert int(payload['report_id']) == report_id
    assert int(payload['case_id']) == case_id
    assert payload['status'] in {'triaged', 'closed'}


def test_moderation_rbac_requires_db_role_or_override(monkeypatch, tmp_path):
    db_path = tmp_path / 'moderation-rbac-http.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app(
        'testing',
        overrides={
            'DATABASE_PATH': str(db_path),
            'MODERATOR_USER_IDS': '',
            'MODERATION_REPORT_ASYNC_ENABLED': True,
        },
    )

    with _connect(db_path) as conn:
        _seed_users(conn)

    moderator_client = _authed_client(app, 99, 'pk-99')
    response = moderator_client.get('/api/moderation/cases')
    assert response.status_code == 403

    with _connect(db_path) as conn:
        _grant_moderator_role(conn, user_id=99)

    response = moderator_client.get('/api/moderation/cases')
    assert response.status_code == 200
    assert response.get_json()['success'] is True

    app_override = create_app(
        'testing',
        overrides={
            'DATABASE_PATH': str(db_path),
            'MODERATOR_USER_IDS': '99',
            'MODERATION_REPORT_ASYNC_ENABLED': True,
        },
    )
    with _connect(db_path) as conn:
        conn.execute("DELETE FROM moderation_user_roles WHERE user_id = ? AND role = 'moderator'", (99,))
        conn.commit()
    override_client = _authed_client(app_override, 99, 'pk-99')
    response = override_client.get('/api/moderation/cases')
    assert response.status_code == 200
    assert response.get_json()['success'] is True


def test_moderation_case_action_and_appeal(monkeypatch, tmp_path):
    db_path = tmp_path / 'moderation-case-action-http.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app(
        'testing',
        overrides={
            'DATABASE_PATH': str(db_path),
            'MODERATOR_USER_IDS': '',
            'MODERATION_AUTO_ACTION_THRESHOLD': 0.99,
            'MODERATION_REPORT_ASYNC_ENABLED': True,
        },
    )

    with _connect(db_path) as conn:
        _seed_users(conn)
        _grant_moderator_role(conn, user_id=99)

    reporter_client = _authed_client(app, 1, 'pk-1')
    moderator_client = _authed_client(app, 99, 'pk-99')
    target_client = _authed_client(app, 2, 'pk-2')

    report_response = reporter_client.post(
        '/api/moderation/reports',
        json={
            'target_type': 'user',
            'target_id': '2',
            'reason_code': 'scam',
            'idempotency_key': 'case-action-report',
        },
    )
    report_payload = report_response.get_json()
    assert report_payload['case_id'] is None
    processing_result = _process_jobs(db_path)
    assert processing_result['status'] == 'processed'
    case_id = int(processing_result['case_id'])

    response = moderator_client.get('/api/moderation/cases?state=open')
    payload = response.get_json()
    assert response.status_code == 200
    assert payload['success'] is True
    assert any(int(case['id']) == case_id for case in payload['cases'])

    response = moderator_client.post(
        f'/api/moderation/cases/{case_id}/actions',
        json={
            'action': 'ban_temp',
            'reason_code': 'repeat_spam',
            'duration_sec': 3600,
            'note': 'manual action',
        },
    )
    payload = response.get_json()
    assert response.status_code == 200
    assert payload['success'] is True
    assert payload['action_type'] == 'ban_temp'
    sanction_id = int(payload['sanction_id'])

    response = target_client.post(
        '/api/moderation/appeals',
        json={
            'sanction_id': sanction_id,
            'text': 'please review',
        },
    )
    payload = response.get_json()
    assert response.status_code == 200
    assert payload['success'] is True
    assert payload['state'] == 'submitted'
    appeal_id = int(payload['appeal_id'])

    response = target_client.get(f'/api/moderation/appeals/{appeal_id}')
    payload = response.get_json()
    assert response.status_code == 200
    assert payload['success'] is True
    assert int(payload['appeal_id']) == appeal_id
    assert int(payload['sanction_id']) == sanction_id

    response = moderator_client.get('/api/moderation/appeals?state=submitted')
    payload = response.get_json()
    assert response.status_code == 200
    assert payload['success'] is True
    assert any(int(item['id']) == appeal_id for item in payload['appeals'])

    response = moderator_client.post(
        f'/api/moderation/appeals/{appeal_id}/resolve',
        json={
            'resolution': 'reversed',
            'resolution_note': 'false positive',
        },
    )
    payload = response.get_json()
    assert response.status_code == 200
    assert payload['success'] is True
    assert payload['state'] == 'reversed'

    response = target_client.get(f'/api/moderation/appeals/{appeal_id}')
    payload = response.get_json()
    assert response.status_code == 200
    assert payload['success'] is True
    assert payload['state'] == 'reversed'


def test_moderation_console_and_metrics(monkeypatch, tmp_path):
    db_path = tmp_path / 'moderation-console-http.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app(
        'testing',
        overrides={
            'DATABASE_PATH': str(db_path),
            'MODERATOR_USER_IDS': '',
            'MODERATION_AUTO_ACTION_THRESHOLD': 0.99,
            'MODERATION_REPORT_ASYNC_ENABLED': True,
        },
    )

    with _connect(db_path) as conn:
        _seed_users(conn)
        _grant_moderator_role(conn, user_id=99)

    reporter_client = _authed_client(app, 1, 'pk-1')
    moderator_client = _authed_client(app, 99, 'pk-99')

    response = reporter_client.post(
        '/api/moderation/reports',
        json={
            'target_type': 'user',
            'target_id': '2',
            'reason_code': 'spam',
            'idempotency_key': 'console-report',
        },
    )
    assert response.status_code == 200
    process_result = _process_jobs(db_path)
    assert process_result['status'] == 'processed'

    response = moderator_client.get('/moderation/console')
    assert response.status_code == 200
    html = response.get_data(as_text=True)
    assert 'Moderation Console' in html
    assert 'Queue Pending' in html
    assert 'Refresh (sec)' in html
    assert 'Prometheus Metrics' in html
    assert 'sla-timer' in html

    response = moderator_client.get('/api/moderation/metrics')
    payload = response.get_json()
    assert response.status_code == 200
    assert payload['success'] is True
    assert 'time_to_action_p95_seconds' in payload
    assert 'queue' in payload

    response = moderator_client.get('/metrics/moderation')
    assert response.status_code == 200
    text = response.get_data(as_text=True)
    assert 'moderation_time_to_action_p95_seconds' in text
    assert 'moderation_queue_jobs{status="pending"}' in text


def test_moderation_appeals_console(monkeypatch, tmp_path):
    db_path = tmp_path / 'moderation-appeals-console-http.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app(
        'testing',
        overrides={
            'DATABASE_PATH': str(db_path),
            'MODERATOR_USER_IDS': '',
            'MODERATION_AUTO_ACTION_THRESHOLD': 0.99,
            'MODERATION_REPORT_ASYNC_ENABLED': True,
        },
    )

    with _connect(db_path) as conn:
        _seed_users(conn)
        _grant_moderator_role(conn, user_id=99)

    reporter_client = _authed_client(app, 1, 'pk-1')
    moderator_client = _authed_client(app, 99, 'pk-99')
    target_client = _authed_client(app, 2, 'pk-2')

    response = reporter_client.post(
        '/api/moderation/reports',
        json={
            'target_type': 'user',
            'target_id': '2',
            'reason_code': 'spam',
            'idempotency_key': 'appeal-console-report',
        },
    )
    assert response.status_code == 200
    process_result = _process_jobs(db_path)
    case_id = int(process_result['case_id'])

    response = moderator_client.post(
        f'/api/moderation/cases/{case_id}/actions',
        json={
            'action': 'ban_temp',
            'reason_code': 'repeat_spam',
            'duration_sec': 3600,
            'note': 'manual action',
        },
    )
    sanction_id = int(response.get_json()['sanction_id'])

    response = target_client.post(
        '/api/moderation/appeals',
        json={
            'sanction_id': sanction_id,
            'text': 'please review',
        },
    )
    appeal_id = int(response.get_json()['appeal_id'])

    response = moderator_client.get('/moderation/console/appeals')
    assert response.status_code == 200
    html = response.get_data(as_text=True)
    assert 'Appeals Console' in html
    assert f'#{appeal_id}' in html
    assert 'Refresh (sec)' in html

    response = moderator_client.post(
        f'/moderation/console/appeals/{appeal_id}/resolve',
        data={
            'resolution': 'upheld',
            'resolution_note': 'confirmed',
        },
        follow_redirects=True,
    )
    assert response.status_code == 200
    html = response.get_data(as_text=True)
    assert 'Appeal resolved' in html


def test_moderation_group_member_sanction_supports_appeal(monkeypatch, tmp_path):
    db_path = tmp_path / 'moderation-group-member-appeal-http.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app(
        'testing',
        overrides={
            'DATABASE_PATH': str(db_path),
            'MODERATOR_USER_IDS': '',
            'MODERATION_REPORT_ASYNC_ENABLED': True,
        },
    )

    with _connect(db_path) as conn:
        _seed_users(conn)
        conn.execute(
            '''
            INSERT INTO moderation_sanctions (
                case_id,
                subject_type,
                subject_id,
                action_type,
                reason_code,
                status,
                created_by
            )
            VALUES (NULL, 'group_member', ?, 'mute_temp', 'flood', 'active', 'group_moderator:99')
            ''',
            ('chat-x:2',),
        )
        conn.commit()
        row = conn.execute(
            '''
            SELECT id
            FROM moderation_sanctions
            WHERE subject_type = 'group_member'
              AND subject_id = 'chat-x:2'
            ORDER BY id DESC
            LIMIT 1
            '''
        ).fetchone()
        sanction_id = int(row['id'])

    target_client = _authed_client(app, 2, 'pk-2')
    response = target_client.post(
        '/api/moderation/appeals',
        json={
            'sanction_id': sanction_id,
            'text': 'appeal group mute',
        },
    )
    payload = response.get_json()
    assert response.status_code == 200
    assert payload['success'] is True
    assert payload['state'] == 'submitted'
