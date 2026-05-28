from __future__ import annotations

import threading
import time
from collections import Counter, deque
from typing import Any

_MAX_SAMPLES = 10_000
_DEFAULT_WINDOW_SECONDS = 24 * 60 * 60
_ROUTES = {'host', 'srflx', 'prflx', 'relay', 'unknown'}
_QUALITY_LEVELS = {'good', 'fair', 'poor', 'unknown'}
_SAMPLES: deque[dict[str, Any]] = deque(maxlen=_MAX_SAMPLES)
_LOCK = threading.Lock()


def record_call_quality_sample(
    *,
    call_id: str,
    user_id: int,
    payload: dict[str, Any],
    now: float | None = None,
) -> dict[str, Any]:
    sample = _normalize_sample(call_id=call_id, user_id=user_id, payload=payload, now=now)
    with _LOCK:
        _prune_locked(float(sample['ts']) - _DEFAULT_WINDOW_SECONDS)
        _SAMPLES.append(sample)
    return sample


def call_quality_metrics(*, window_seconds: int = _DEFAULT_WINDOW_SECONDS, now: float | None = None) -> dict[str, Any]:
    current_ts = time.time() if now is None else float(now)
    safe_window = min(_DEFAULT_WINDOW_SECONDS, max(60, int(window_seconds or _DEFAULT_WINDOW_SECONDS)))
    cutoff = current_ts - safe_window
    with _LOCK:
        _prune_locked(cutoff)
        samples = [sample for sample in _SAMPLES if float(sample.get('ts') or 0) >= cutoff]

    route_counts = Counter(str(sample.get('selected_candidate_route') or 'unknown') for sample in samples)
    quality_counts = Counter(str(sample.get('level') or 'unknown') for sample in samples)
    total = len(samples)
    relay_samples = int(route_counts.get('relay') or 0)
    return {
        'window_seconds': safe_window,
        'samples_total': total,
        'relay_samples': relay_samples,
        'relay_ratio': round(relay_samples / total, 4) if total else 0.0,
        'routes': {route: int(route_counts.get(route) or 0) for route in sorted(_ROUTES)},
        'quality': {level: int(quality_counts.get(level) or 0) for level in sorted(_QUALITY_LEVELS)},
        'avg_packet_loss_percent': _avg(samples, 'packet_loss_percent'),
        'avg_remote_loss_percent': _avg(samples, 'remote_loss_percent'),
        'avg_rtt_ms': _avg(samples, 'rtt_ms'),
        'avg_jitter_ms': _avg(samples, 'jitter_ms'),
        'avg_jitter_buffer_delay_ms': _avg(samples, 'jitter_buffer_delay_ms'),
        'avg_concealment_percent': _avg(samples, 'concealment_percent'),
        'avg_video_frames_dropped_percent': _avg(samples, 'video_frames_dropped_percent'),
    }


def reset_call_quality_metrics() -> None:
    with _LOCK:
        _SAMPLES.clear()


def _normalize_sample(
    *,
    call_id: str,
    user_id: int,
    payload: dict[str, Any],
    now: float | None,
) -> dict[str, Any]:
    local_type = _route_value(payload.get('local_candidate_type'))
    remote_type = _route_value(payload.get('remote_candidate_type'))
    selected_route = _route_value(payload.get('selected_candidate_route'))
    if selected_route == 'unknown' and (local_type == 'relay' or remote_type == 'relay'):
        selected_route = 'relay'

    return {
        'ts': time.time() if now is None else float(now),
        'call_id': str(call_id or '')[:128],
        'user_id': int(user_id),
        'level': _quality_value(payload.get('level')),
        'send_level': _quality_value(payload.get('send_level')),
        'packet_loss_percent': _bounded_number(payload.get('packet_loss_percent'), 0, 100),
        'remote_loss_percent': _bounded_number(payload.get('remote_loss_percent'), 0, 100),
        'rtt_ms': _bounded_number(payload.get('rtt_ms'), 0, 60_000),
        'jitter_ms': _bounded_number(payload.get('jitter_ms'), 0, 60_000),
        'jitter_buffer_delay_ms': _bounded_number(payload.get('jitter_buffer_delay_ms'), 0, 60_000),
        'concealment_percent': _bounded_number(payload.get('concealment_percent'), 0, 100),
        'video_frames_dropped_percent': _bounded_number(payload.get('video_frames_dropped_percent'), 0, 100),
        'selected_candidate_route': selected_route,
        'local_candidate_type': local_type,
        'remote_candidate_type': remote_type,
        'relay_protocol': _short_string(payload.get('relay_protocol')),
        'network_type': _short_string(payload.get('network_type')),
        'audio_codec': _short_string(payload.get('audio_codec')),
        'video_codec': _short_string(payload.get('video_codec')),
    }


def _prune_locked(cutoff_ts: float) -> None:
    while _SAMPLES and float(_SAMPLES[0].get('ts') or 0) < cutoff_ts:
        _SAMPLES.popleft()


def _avg(samples: list[dict[str, Any]], key: str) -> float:
    if not samples:
        return 0.0
    return round(sum(float(sample.get(key) or 0.0) for sample in samples) / len(samples), 2)


def _quality_value(value: Any) -> str:
    normalized = str(value or '').strip().lower()
    return normalized if normalized in _QUALITY_LEVELS else 'unknown'


def _route_value(value: Any) -> str:
    normalized = str(value or '').strip().lower()
    return normalized if normalized in _ROUTES else 'unknown'


def _bounded_number(value: Any, lower: float, upper: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    if number != number:
        return 0.0
    return round(min(upper, max(lower, number)), 1)


def _short_string(value: Any) -> str:
    return ''.join(ch for ch in str(value or '') if ch.isalnum() or ch in {' ', '.', ':', '/', '+', '-'})[:80]
