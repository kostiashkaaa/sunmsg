from __future__ import annotations

import hashlib
import json
from pathlib import Path

from app.services.logging_safety import redact_url_for_log
from app.services.operations_metrics import (
    prometheus_text,
    record_http_request,
    record_socket_event,
)


ROOT = Path(__file__).resolve().parents[1]


def test_log_redaction_removes_url_passwords_and_oauth_query_values() -> None:
    text = redact_url_for_log('redis://default:secret@localhost:6379/0?token=abc')

    assert 'secret' not in text
    assert 'token=abc' not in text
    assert 'token=***' in text


def test_operations_metrics_include_http_socketio_redis_and_queue_signals() -> None:
    record_http_request(method='GET', route='/ready', status_code=503, duration_seconds=0.25)
    record_socket_event(event_name='send_message', status='ok', duration_seconds=0.05)

    text = prometheus_text(
        db_pool_metrics=[{'schema': 'public', 'in_use': 1, 'idle': 2, 'total': 3, 'max_size': 5, 'exhaustions_total': 0}],
        redis_metrics={'up': True, 'connected_clients': 2, 'queues': {'queue-a': 7}},
        moderation_queue={'pending': 4, 'processing': 1, 'failed': 0},
    )

    assert 'sun_http_requests_total{method="GET",route="/ready",status_class="5xx",status="503"}' in text
    assert 'sun_socketio_events_total{event="send_message",status="ok"}' in text
    assert 'sun_redis_up 1' in text
    assert 'sun_redis_queue_length{queue="queue-a"} 7' in text
    assert 'sun_db_pool_connections{schema="public",state="in_use"} 1' in text
    assert 'sun_moderation_jobs{status="pending"} 4' in text


def test_vendor_manifest_hashes_match_vendored_js_files() -> None:
    manifest_path = ROOT / 'static' / 'vendor' / 'vendor-manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))

    for rel_path, metadata in manifest.items():
        digest = hashlib.sha256((manifest_path.parent / rel_path).read_bytes()).hexdigest()
        assert digest == metadata['sha256']
