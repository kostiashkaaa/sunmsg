from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class TurnRelay:
    relay_id: str
    urls: tuple[str, ...]
    health_score: int
    enabled: bool = True


@dataclass(frozen=True)
class TurnRelaySelection:
    relays: tuple[TurnRelay, ...]
    source: str
    pool_configured: bool

    @property
    def urls_count(self) -> int:
        return sum(len(relay.urls) for relay in self.relays)

    @property
    def selected_ids(self) -> list[str]:
        return [relay.relay_id for relay in self.relays]


def parse_turn_urls(raw_value: str | list[str] | tuple[str, ...]) -> list[str]:
    raw_items: list[str] = []
    if isinstance(raw_value, (list, tuple)):
        raw_items = [str(item or '') for item in raw_value]
    else:
        raw_items = str(raw_value or '').split(',')

    urls = []
    for item in raw_items:
        url = item.strip()
        if not url:
            continue
        if not (url.startswith('turn:') or url.startswith('turns:')):
            continue
        urls.append(url)
    return urls


def select_turn_relays(
    *,
    pool_raw: str,
    legacy_urls_raw: str,
    limit: int,
) -> TurnRelaySelection:
    pool_relays, pool_configured = parse_turn_server_pool(pool_raw)
    bounded_limit = _bounded_limit(limit)

    if pool_configured:
        healthy_relays = [
            relay for relay in pool_relays
            if relay.enabled and relay.health_score > 0 and relay.urls
        ]
        healthy_relays.sort(key=lambda relay: (-relay.health_score, relay.relay_id))
        return TurnRelaySelection(
            relays=tuple(healthy_relays[:bounded_limit]),
            source='pool',
            pool_configured=True,
        )

    legacy_urls = parse_turn_urls(legacy_urls_raw)
    if legacy_urls:
        return TurnRelaySelection(
            relays=(TurnRelay(relay_id='legacy', urls=tuple(legacy_urls), health_score=100),),
            source='legacy',
            pool_configured=False,
        )

    return TurnRelaySelection(relays=(), source='none', pool_configured=False)


def parse_turn_server_pool(raw_value: str) -> tuple[list[TurnRelay], bool]:
    raw_text = str(raw_value or '').strip()
    if not raw_text:
        return [], False

    try:
        payload = json.loads(raw_text)
    except (TypeError, ValueError):
        return [], True

    entries = _pool_entries(payload)
    relays = []
    for index, entry in enumerate(entries, start=1):
        relay = _relay_from_entry(entry, index)
        if relay:
            relays.append(relay)
    return relays, True


def _pool_entries(payload: Any) -> list[Any]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        relays = payload.get('relays')
        if isinstance(relays, list):
            return relays
        entries = []
        for key, value in payload.items():
            if isinstance(value, dict):
                entries.append({'id': key, **value})
        return entries
    return []


def _relay_from_entry(entry: Any, index: int) -> TurnRelay | None:
    if not isinstance(entry, dict):
        return None

    urls = parse_turn_urls(entry.get('urls') or entry.get('url') or '')
    if not urls:
        return None

    relay_id = str(entry.get('id') or entry.get('name') or f'relay-{index}').strip()
    if not relay_id:
        relay_id = f'relay-{index}'

    return TurnRelay(
        relay_id=relay_id,
        urls=tuple(urls),
        health_score=_health_score(entry),
        enabled=_enabled(entry.get('enabled', True)),
    )


def _health_score(entry: dict[str, Any]) -> int:
    for key in ('health_score', 'healthScore', 'health-score', 'score'):
        if key in entry:
            return _clamped_score(entry.get(key))
    return 100


def _clamped_score(raw_value: Any) -> int:
    try:
        score = int(raw_value)
    except (TypeError, ValueError):
        return 0
    return min(100, max(0, score))


def _enabled(raw_value: Any) -> bool:
    if isinstance(raw_value, bool):
        return raw_value
    return str(raw_value).strip().lower() not in {'0', 'false', 'no', 'off', 'disabled'}


def _bounded_limit(raw_value: int) -> int:
    try:
        limit = int(raw_value)
    except (TypeError, ValueError):
        limit = 2
    return min(8, max(1, limit))
