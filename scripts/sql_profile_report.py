from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path


def _should_skip_sql(sql: str, *, include_metadata: bool) -> bool:
    if include_metadata:
        return False
    normalized = sql.strip().lower()
    if not normalized:
        return True
    if 'information_schema' in normalized:
        return True
    if 'schema_migrations' in normalized:
        return True
    return (
        normalized.startswith('create table')
        or normalized.startswith('create index')
        or normalized.startswith('alter table')
        or normalized.startswith('drop table')
        or normalized.startswith('drop index')
    )


def main() -> int:  # noqa: C901 - one-pass report classification flow
    args = list(sys.argv[1:])
    include_metadata = False
    if '--include-metadata' in args:
        include_metadata = True
        args.remove('--include-metadata')
    path = Path(args[0]) if args else Path('.runtime/sql-profile.ndjson')
    if not path.exists():
        print(f'profile file not found: {path}')
        return 1

    buckets: dict[str, dict[str, object]] = defaultdict(
        lambda: {
            'calls': 0,
            'total_ms': 0.0,
            'max_ms': 0.0,
            'sql': '',
        }
    )
    with path.open('r', encoding='utf-8') as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            fingerprint = str(record.get('fingerprint') or '').strip()
            if not fingerprint:
                continue
            sql = str(record.get('sql') or '')
            if _should_skip_sql(sql, include_metadata=include_metadata):
                continue
            duration = float(record.get('duration_ms') or 0.0)
            bucket = buckets[fingerprint]
            bucket['calls'] = int(bucket['calls']) + 1
            bucket['total_ms'] = float(bucket['total_ms']) + duration
            bucket['max_ms'] = max(float(bucket['max_ms']), duration)
            if not bucket['sql']:
                bucket['sql'] = sql

    ranked = sorted(
        buckets.items(),
        key=lambda pair: float(pair[1]['total_ms']),
        reverse=True,
    )
    if not include_metadata:
        print('Top runtime SQL by total runtime (metadata/DDL filtered):')
    else:
        print('Top SQL by total runtime:')
    for fingerprint, data in ranked[:20]:
        calls = int(data['calls'])
        total_ms = float(data['total_ms'])
        avg_ms = total_ms / max(1, calls)
        max_ms = float(data['max_ms'])
        sql = str(data['sql'])
        print(
            f'- fp={fingerprint} calls={calls} total_ms={total_ms:.2f} avg_ms={avg_ms:.2f} max_ms={max_ms:.2f}'
        )
        print(f'  {sql}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
