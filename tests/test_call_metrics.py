from app.services.call_metrics import (
    call_quality_metrics,
    record_call_quality_sample,
    reset_call_quality_metrics,
)
from app.sockets import call_handlers


def test_call_quality_metrics_count_relay_samples_and_average_jitter_buffer():
    reset_call_quality_metrics()
    try:
        record_call_quality_sample(
            call_id='call-1',
            user_id=1,
            now=1_000.0,
            payload={
                'level': 'fair',
                'send_level': 'poor',
                'packet_loss_percent': 3.2,
                'remote_loss_percent': 4.0,
                'rtt_ms': 280,
                'jitter_ms': 45,
                'jitter_buffer_delay_ms': 90,
                'concealment_percent': 2.5,
                'video_frames_dropped_percent': 6.0,
                'selected_candidate_route': 'relay',
                'local_candidate_type': 'relay',
                'remote_candidate_type': 'srflx',
                'relay_protocol': 'tcp',
                'audio_codec': 'audio/opus 48000Hz/2ch',
                'video_codec': 'video/VP8 90000Hz',
            },
        )
        record_call_quality_sample(
            call_id='call-1',
            user_id=2,
            now=1_010.0,
            payload={
                'level': 'good',
                'jitter_buffer_delay_ms': 30,
                'selected_candidate_route': 'host',
            },
        )

        metrics = call_quality_metrics(window_seconds=60, now=1_020.0)

        assert metrics['samples_total'] == 2
        assert metrics['relay_samples'] == 1
        assert metrics['relay_ratio'] == 0.5
        assert metrics['routes']['relay'] == 1
        assert metrics['routes']['host'] == 1
        assert metrics['quality']['fair'] == 1
        assert metrics['quality']['good'] == 1
        assert metrics['avg_jitter_buffer_delay_ms'] == 60.0
    finally:
        reset_call_quality_metrics()


def test_handle_call_quality_records_active_participant_sample(monkeypatch):
    recorded = []

    class FakeConnection:
        def close(self):
            pass

    monkeypatch.setattr(call_handlers, 'get_call_session', lambda conn, call_id: {'status': 'active'})
    monkeypatch.setattr(call_handlers, '_is_call_participant', lambda conn, call_id, user_id: True)
    monkeypatch.setattr(
        call_handlers,
        'record_call_quality_sample',
        lambda **kwargs: recorded.append(kwargs),
    )

    call_handlers.handle_call_quality(
        {
            'call_id': 'call-1',
            'csrf_token': 'csrf',
            'selected_candidate_route': 'relay',
        },
        session_store={'user_id': 12},
        require_payload_dict_func=lambda data: isinstance(data, dict),
        socket_csrf_ok_func=lambda data: data.get('csrf_token') == 'csrf',
        socket_rate_ok_func=lambda user_id, event: event == 'call_quality',
        get_db_connection_func=lambda request_scoped=False: FakeConnection(),
    )

    assert recorded == [
        {
            'call_id': 'call-1',
            'user_id': 12,
            'payload': {
                'call_id': 'call-1',
                'csrf_token': 'csrf',
                'selected_candidate_route': 'relay',
            },
        }
    ]
