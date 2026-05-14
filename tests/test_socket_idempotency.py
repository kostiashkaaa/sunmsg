from app.sockets import idempotency


class _FakeRedis:
    def __init__(self):
        self.values = {}

    def set(self, key, value, *, nx=False, ex=None):
        if nx and key in self.values:
            return False
        self.values[key] = {'value': value, 'ex': ex}
        return True

    def delete(self, key):
        self.values.pop(key, None)


def test_socket_idempotency_uses_shared_redis_reservation(monkeypatch):
    fake_redis = _FakeRedis()
    monkeypatch.setattr(idempotency, '_get_redis_client', lambda: fake_redis)

    allowed, reservation = idempotency.reserve_request(
        user_id=1,
        event_name='send_message',
        request_id='req-1',
    )
    duplicate_allowed, duplicate_reservation = idempotency.reserve_request(
        user_id=1,
        event_name='send_message',
        request_id='req-1',
    )

    assert allowed is True
    assert reservation is not None
    assert reservation.backend == 'redis'
    assert duplicate_allowed is False
    assert duplicate_reservation is None

    idempotency.mark_request_completed(reservation, completed_ttl_seconds=180)

    completed_record = next(iter(fake_redis.values.values()))
    assert completed_record['value'] == 'completed'
    assert completed_record['ex'] == 180
