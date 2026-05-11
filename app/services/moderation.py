from __future__ import annotations

import ipaddress
import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any

URL_PATTERN = re.compile(r"\bhttps?://[^\s<>\"'`]+|\bwww\.[^\s<>\"'`]+", re.IGNORECASE)
ALLOWED_TARGET_TYPES = {'user', 'message', 'chat', 'channel', 'bot'}
AUTO_SANCTION_ACTION_TYPES = {'mute_temp', 'ban_temp'}
RESTRICTED_USER_ACTION_TYPES = {'mute_temp', 'ban_temp', 'ban_perma'}
RESTRICTED_GROUP_ACTION_TYPES = {'mute_temp', 'ban_temp', 'ban_perma'}
DEFAULT_REPORT_REASON = 'abuse'
MODERATION_JOB_PENDING = 'pending'
MODERATION_JOB_PROCESSING = 'processing'
MODERATION_JOB_DONE = 'done'
MODERATION_JOB_FAILED = 'failed'
MODERATOR_ROLE = 'moderator'
GROUP_MEMBER_SUBJECT_TYPE = 'group_member'


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def to_db_timestamp(value: datetime) -> str:
    return value.astimezone(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')


def parse_int(value: Any, *, min_value: int | None = None, max_value: int | None = None) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    if min_value is not None and parsed < min_value:
        return None
    if max_value is not None and parsed > max_value:
        return None
    return parsed


def parse_csv(value: str | None) -> list[str]:
    raw = str(value or '').strip()
    if not raw:
        return []
    return [item.strip() for item in raw.split(',') if item.strip()]


def moderator_id_set(raw_value: str | None) -> set[int]:
    result: set[int] = set()
    for entry in parse_csv(raw_value):
        parsed = parse_int(entry, min_value=1)
        if parsed is not None:
            result.add(parsed)
    return result


def is_moderator(user_id: int, *, moderator_ids: set[int]) -> bool:
    return int(user_id) in moderator_ids


def normalize_role(value: Any) -> str:
    normalized = str(value or '').strip().lower()
    if not normalized:
        return ''
    return normalized[:64]


def has_user_role(conn, *, user_id: int, role: str) -> bool:
    normalized_role = normalize_role(role)
    if not normalized_role:
        return False
    row = conn.execute(
        '''
        SELECT 1
        FROM moderation_user_roles
        WHERE user_id = ?
          AND role = ?
        LIMIT 1
        ''',
        (int(user_id), normalized_role),
    ).fetchone()
    return row is not None


def is_moderator_user(
    conn,
    *,
    user_id: int,
    moderator_ids_override: set[int] | None = None,
) -> bool:
    if has_user_role(conn, user_id=int(user_id), role=MODERATOR_ROLE):
        return True
    if moderator_ids_override and int(user_id) in moderator_ids_override:
        return True
    return False


def assign_user_role(
    conn,
    *,
    user_id: int,
    role: str,
    granted_by_user_id: int | None = None,
) -> None:
    normalized_role = normalize_role(role)
    if not normalized_role:
        raise ValueError('invalid_role')
    conn.execute(
        '''
        INSERT INTO moderation_user_roles (user_id, role, granted_by_user_id)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id, role) DO NOTHING
        ''',
        (
            int(user_id),
            normalized_role,
            int(granted_by_user_id) if granted_by_user_id is not None else None,
        ),
    )


def revoke_user_role(conn, *, user_id: int, role: str) -> bool:
    normalized_role = normalize_role(role)
    if not normalized_role:
        raise ValueError('invalid_role')
    cur = conn.execute(
        '''
        DELETE FROM moderation_user_roles
        WHERE user_id = ?
          AND role = ?
        ''',
        (int(user_id), normalized_role),
    )
    return int(cur.rowcount or 0) > 0


def normalize_target_type(value: Any) -> str:
    normalized = str(value or '').strip().lower()
    return normalized if normalized in ALLOWED_TARGET_TYPES else ''


def normalize_target_id(value: Any, *, max_length: int = 256) -> str:
    normalized = str(value or '').strip()
    if not normalized:
        return ''
    return normalized[:max_length]


def normalize_reason_code(value: Any, *, max_length: int = 64) -> str:
    normalized = str(value or '').strip().lower()
    if not normalized:
        return DEFAULT_REPORT_REASON
    return normalized[:max_length]


def normalize_optional_code(value: Any, *, max_length: int = 64) -> str:
    normalized = str(value or '').strip().lower()
    if not normalized:
        return ''
    return normalized[:max_length]


def normalize_comment(value: Any, *, max_length: int = 2000) -> str:
    normalized = str(value or '').strip()
    if not normalized:
        return ''
    return normalized[:max_length]


def normalize_idempotency_key(value: Any, *, max_length: int = 128) -> str:
    normalized = str(value or '').strip()
    if not normalized:
        return ''
    return normalized[:max_length]


def make_group_member_subject_id(chat_id: str, user_id: int) -> str:
    safe_chat_id = str(chat_id or '').strip()
    safe_user_id = int(user_id)
    return f'{safe_chat_id}:{safe_user_id}'


def parse_group_member_subject_id(value: str | None) -> tuple[str, int] | None:
    raw = str(value or '').strip()
    if not raw or ':' not in raw:
        return None
    chat_id, user_id_raw = raw.rsplit(':', 1)
    chat_id = str(chat_id or '').strip()
    parsed_user_id = parse_int(user_id_raw, min_value=1)
    if not chat_id or parsed_user_id is None:
        return None
    return chat_id, parsed_user_id


def extract_urls(text: str) -> list[str]:
    raw = str(text or '')
    if not raw:
        return []
    return [match.group(0).rstrip('),.;:!?]') for match in URL_PATTERN.finditer(raw)]


def _normalize_domain(domain: str) -> str:
    return str(domain or '').strip().lower().rstrip('.')


def _url_hostname(url: str) -> str:
    candidate = str(url or '').strip()
    if not candidate:
        return ''
    if candidate.lower().startswith('www.'):
        candidate = f'https://{candidate}'
    try:
        from urllib.parse import urlparse

        parsed = urlparse(candidate)
    except Exception:
        return ''
    return _normalize_domain(parsed.hostname or '')


def _domain_matches(hostname: str, blocked_domain: str) -> bool:
    host = _normalize_domain(hostname)
    blocked = _normalize_domain(blocked_domain)
    if not host or not blocked:
        return False
    return host == blocked or host.endswith(f'.{blocked}')


def evaluate_public_links(message_text: str, *, blocked_domains: list[str]) -> dict[str, Any]:
    urls = extract_urls(message_text)
    if not urls:
        return {'blocked': False, 'urls': []}
    for url in urls:
        host = _url_hostname(url)
        for blocked in blocked_domains:
            if _domain_matches(host, blocked):
                return {
                    'blocked': True,
                    'reason': 'blocked_public_link_domain',
                    'url': url,
                    'domain': blocked,
                    'urls': urls,
                }
    return {'blocked': False, 'urls': urls}


def _is_high_risk_ip(remote_ip: str, cidrs: list[str]) -> bool:
    candidate = str(remote_ip or '').strip()
    if not candidate:
        return False
    try:
        ip_obj = ipaddress.ip_address(candidate)
    except ValueError:
        return False
    for cidr in cidrs:
        try:
            network = ipaddress.ip_network(str(cidr).strip(), strict=False)
        except ValueError:
            continue
        if ip_obj in network:
            return True
    return False


def _count_recent_reports(conn, *, target_type: str, target_id: str, since_ts: str) -> int:
    row = conn.execute(
        '''
        SELECT COUNT(*) AS cnt
        FROM moderation_reports
        WHERE target_type = ?
          AND target_id = ?
          AND created_at >= ?
        ''',
        (target_type, target_id, since_ts),
    ).fetchone()
    if not row:
        return 0
    return int(row['cnt'] or 0)


def _count_recent_sanctions(conn, *, subject_type: str, subject_id: str, since_ts: str) -> int:
    row = conn.execute(
        '''
        SELECT COUNT(*) AS cnt
        FROM moderation_sanctions
        WHERE subject_type = ?
          AND subject_id = ?
          AND created_at >= ?
        ''',
        (subject_type, subject_id, since_ts),
    ).fetchone()
    if not row:
        return 0
    return int(row['cnt'] or 0)


def evaluate_rules(  # noqa: PLR0913 - explicit moderation rule-evaluation contract
    conn,
    *,
    target_type: str,
    target_id: str,
    remote_ip: str,
    now: datetime,
    rate_window_seconds: int,
    repeat_window_days: int,
    rate_threshold: int,
    high_risk_ip_cidrs: list[str],
) -> dict[str, Any]:
    report_window_start = to_db_timestamp(now - timedelta(seconds=max(1, int(rate_window_seconds))))
    repeat_window_start = to_db_timestamp(now - timedelta(days=max(1, int(repeat_window_days))))

    recent_reports = _count_recent_reports(
        conn,
        target_type=target_type,
        target_id=target_id,
        since_ts=report_window_start,
    )
    recent_sanctions = _count_recent_sanctions(
        conn,
        subject_type='user' if target_type == 'user' else target_type,
        subject_id=target_id,
        since_ts=repeat_window_start,
    )
    high_risk_ip = _is_high_risk_ip(remote_ip, high_risk_ip_cidrs)

    rate_over = max(0, recent_reports - max(1, int(rate_threshold)) + 1)
    rate_component = min(0.45, float(rate_over) * 0.10)
    repeat_component = min(0.40, float(recent_sanctions) * 0.15)
    ip_component = 0.20 if high_risk_ip else 0.0

    base = 0.25
    risk_score = min(1.0, base + rate_component + repeat_component + ip_component)
    confidence = min(0.99, 0.55 + (rate_component * 0.8) + (repeat_component * 0.5) + (ip_component * 0.6))

    if risk_score >= 0.90:
        priority = 1
    elif risk_score >= 0.75:
        priority = 2
    elif risk_score >= 0.50:
        priority = 3
    else:
        priority = 4

    reasons: list[str] = []
    if rate_component > 0:
        reasons.append('report_rate_spike')
    if repeat_component > 0:
        reasons.append('repeat_offender')
    if ip_component > 0:
        reasons.append('high_risk_ip')
    if not reasons:
        reasons.append('baseline_signal')

    return {
        'risk_score': round(risk_score, 4),
        'confidence': round(confidence, 4),
        'priority': priority,
        'reasons': reasons,
        'recent_reports': recent_reports,
        'recent_sanctions': recent_sanctions,
        'high_risk_ip': high_risk_ip,
    }


def add_audit_log(  # noqa: PLR0913 - explicit moderation audit contract
    conn,
    *,
    actor_type: str,
    actor_id: str,
    action: str,
    entity_type: str,
    entity_id: str,
    details_json: str = '{}',
    trace_id: str = '',
) -> None:
    conn.execute(
        '''
        INSERT INTO moderation_audit_log (
            actor_type,
            actor_id,
            action,
            entity_type,
            entity_id,
            details_json,
            trace_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ''',
        (
            str(actor_type or '').strip() or 'system',
            str(actor_id or '').strip() or '0',
            str(action or '').strip() or 'unknown',
            str(entity_type or '').strip() or 'unknown',
            str(entity_id or '').strip() or '0',
            str(details_json or '{}'),
            str(trace_id or '').strip(),
        ),
    )


def _report_case_id(conn, *, report_id: int) -> int:
    row = conn.execute(
        '''
        SELECT mcr.case_id
        FROM moderation_case_reports mcr
        WHERE mcr.report_id = ?
        LIMIT 1
        ''',
        (report_id,),
    ).fetchone()
    if not row or row['case_id'] is None:
        return 0
    return int(row['case_id'])


def create_report_only(  # noqa: PLR0913 - explicit report-creation contract
    conn,
    *,
    reporter_user_id: int,
    target_type: str,
    target_id: str,
    message_id: int | None,
    reason_code: str,
    subreason_code: str,
    comment: str,
    idempotency_key: str,
    remote_ip: str,
) -> dict[str, Any]:
    if not idempotency_key:
        raise ValueError('idempotency_key_required')

    existing_report = conn.execute(
        '''
        SELECT id
        FROM moderation_reports
        WHERE reporter_user_id = ?
          AND idempotency_key = ?
        LIMIT 1
        ''',
        (reporter_user_id, idempotency_key),
    ).fetchone()
    if existing_report:
        report_id = int(existing_report['id'])
        status_row = conn.execute(
            '''
            SELECT status
            FROM moderation_reports
            WHERE id = ?
            ''',
            (report_id,),
        ).fetchone()
        return {
            'report_id': report_id,
            'case_id': _report_case_id(conn, report_id=report_id),
            'created': False,
            'status': str(status_row['status'] or 'received') if status_row else 'received',
        }

    report_row = conn.execute(
        '''
        INSERT INTO moderation_reports (
            reporter_user_id,
            target_type,
            target_id,
            message_id,
            reason_code,
            subreason_code,
            comment,
            status,
            idempotency_key,
            source_ip
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'received', ?, ?)
        RETURNING id
        ''',
        (
            reporter_user_id,
            target_type,
            target_id,
            message_id,
            reason_code,
            subreason_code or None,
            comment or None,
            idempotency_key,
            remote_ip or None,
        ),
    ).fetchone()
    if not report_row:
        raise RuntimeError('report_create_failed')
    report_id = int(report_row['id'])
    add_audit_log(
        conn,
        actor_type='user',
        actor_id=str(reporter_user_id),
        action='report_submitted',
        entity_type='report',
        entity_id=str(report_id),
        details_json=('{"target_type":"%s","target_id":"%s"}' % (target_type, target_id)),
    )
    conn.commit()
    return {
        'report_id': report_id,
        'case_id': 0,
        'created': True,
        'status': 'received',
    }


def enqueue_report_job(conn, *, report_id: int) -> None:
    conn.execute(
        '''
        INSERT INTO moderation_jobs (
            report_id,
            status,
            available_at
        )
        VALUES (?, 'pending', CURRENT_TIMESTAMP)
        ON CONFLICT(report_id) DO NOTHING
        ''',
        (report_id,),
    )


def _triage_report(  # noqa: PLR0913 - explicit report-triage contract
    conn,
    *,
    report_id: int,
    auto_action_threshold: float,
    auto_action_type: str,
    auto_action_ttl_seconds: int,
    rate_window_seconds: int,
    repeat_window_days: int,
    rate_threshold: int,
    high_risk_ip_cidrs: list[str],
) -> dict[str, Any]:
    existing_case_id = _report_case_id(conn, report_id=report_id)
    if existing_case_id:
        case_row = conn.execute(
            '''
            SELECT id, state, risk_score, confidence
            FROM moderation_cases
            WHERE id = ?
            ''',
            (existing_case_id,),
        ).fetchone()
        return {
            'report_id': report_id,
            'case_id': existing_case_id,
            'created': False,
            'action_applied': None,
            'risk_score': float(case_row['risk_score']) if case_row else None,
            'confidence': float(case_row['confidence']) if case_row else None,
            'report_status': 'closed' if case_row and str(case_row['state']) != 'open' else 'triaged',
        }

    report = conn.execute(
        '''
        SELECT
            id,
            reporter_user_id,
            target_type,
            target_id,
            reason_code,
            source_ip
        FROM moderation_reports
        WHERE id = ?
        LIMIT 1
        ''',
        (report_id,),
    ).fetchone()
    if not report:
        raise ValueError('report_not_found')

    now = utc_now()
    signals = evaluate_rules(
        conn,
        target_type=str(report['target_type']),
        target_id=str(report['target_id']),
        remote_ip=str(report['source_ip'] or ''),
        now=now,
        rate_window_seconds=rate_window_seconds,
        repeat_window_days=repeat_window_days,
        rate_threshold=rate_threshold,
        high_risk_ip_cidrs=high_risk_ip_cidrs,
    )
    risk_score = float(signals['risk_score'])
    confidence = float(signals['confidence'])

    decision_reasons = ','.join(signals['reasons'])
    case_state = 'open'
    decision_source = 'rules'

    auto_action = ''
    target_type_str = str(report['target_type'])
    if (
        target_type_str in {'user', GROUP_MEMBER_SUBJECT_TYPE}
        and risk_score >= float(auto_action_threshold)
        and auto_action_type in AUTO_SANCTION_ACTION_TYPES
    ):
        auto_action = auto_action_type
        case_state = 'auto_resolved'

    case_row = conn.execute(
        '''
        INSERT INTO moderation_cases (
            case_type,
            subject_type,
            subject_id,
            state,
            priority,
            risk_score,
            confidence,
            decision_source,
            decision_reason
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id
        ''',
        (
            str(report['reason_code']),
            str(report['target_type']),
            str(report['target_id']),
            case_state,
            int(signals['priority']),
            risk_score,
            confidence,
            decision_source,
            decision_reasons,
        ),
    ).fetchone()
    if not case_row:
        raise RuntimeError('case_create_failed')
    case_id = int(case_row['id'])

    conn.execute(
        '''
        INSERT INTO moderation_case_reports (case_id, report_id)
        VALUES (?, ?)
        ON CONFLICT(case_id, report_id) DO NOTHING
        ''',
        (case_id, report_id),
    )

    report_status = 'triaged'
    if auto_action:
        expires_at = None
        if auto_action_ttl_seconds > 0:
            expires_at = to_db_timestamp(now + timedelta(seconds=int(auto_action_ttl_seconds)))
        conn.execute(
            '''
            INSERT INTO moderation_sanctions (
                case_id,
                subject_type,
                subject_id,
                action_type,
                reason_code,
                status,
                created_by,
                starts_at,
                expires_at
            )
            VALUES (?, ?, ?, ?, ?, 'active', 'system:rules', ?, ?)
            ''',
            (
                case_id,
                str(report['target_type']),
                str(report['target_id']),
                auto_action,
                str(report['reason_code']),
                to_db_timestamp(now),
                expires_at,
            ),
        )
        report_status = 'closed'
        add_audit_log(
            conn,
            actor_type='system',
            actor_id='rules',
            action='auto_sanction_applied',
            entity_type='case',
            entity_id=str(case_id),
            details_json=(
                '{"action":"%s","risk_score":%.4f,"confidence":%.4f}'
                % (auto_action, risk_score, confidence)
            ),
        )

    conn.execute(
        '''
        UPDATE moderation_reports
        SET status = ?
        WHERE id = ?
        ''',
        (report_status, report_id),
    )
    conn.execute(
        '''
        UPDATE moderation_cases
        SET updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        ''',
        (case_id,),
    )
    add_audit_log(
        conn,
        actor_type='system',
        actor_id='rules',
        action='report_triaged',
        entity_type='report',
        entity_id=str(report_id),
        details_json=(
            '{"case_id":%d,"target_type":"%s","risk_score":%.4f}'
            % (case_id, str(report['target_type']), risk_score)
        ),
    )
    return {
        'report_id': report_id,
        'case_id': case_id,
        'created': True,
        'action_applied': auto_action or None,
        'risk_score': risk_score,
        'confidence': confidence,
        'report_status': report_status,
    }


def create_report_and_case(  # noqa: PLR0913 - explicit report+case workflow contract
    conn,
    *,
    reporter_user_id: int,
    target_type: str,
    target_id: str,
    message_id: int | None,
    reason_code: str,
    subreason_code: str,
    comment: str,
    idempotency_key: str,
    remote_ip: str,
    auto_action_threshold: float,
    auto_action_type: str,
    auto_action_ttl_seconds: int,
    rate_window_seconds: int,
    repeat_window_days: int,
    rate_threshold: int,
    high_risk_ip_cidrs: list[str],
) -> dict[str, Any]:
    report_result = create_report_only(
        conn,
        reporter_user_id=reporter_user_id,
        target_type=target_type,
        target_id=target_id,
        message_id=message_id,
        reason_code=reason_code,
        subreason_code=subreason_code,
        comment=comment,
        idempotency_key=idempotency_key,
        remote_ip=remote_ip,
    )
    triage_result = _triage_report(
        conn,
        report_id=int(report_result['report_id']),
        auto_action_threshold=auto_action_threshold,
        auto_action_type=auto_action_type,
        auto_action_ttl_seconds=auto_action_ttl_seconds,
        rate_window_seconds=rate_window_seconds,
        repeat_window_days=repeat_window_days,
        rate_threshold=rate_threshold,
        high_risk_ip_cidrs=high_risk_ip_cidrs,
    )
    conn.commit()
    return triage_result


def create_report_and_enqueue(  # noqa: PLR0913 - explicit report-enqueue workflow contract
    conn,
    *,
    reporter_user_id: int,
    target_type: str,
    target_id: str,
    message_id: int | None,
    reason_code: str,
    subreason_code: str,
    comment: str,
    idempotency_key: str,
    remote_ip: str,
) -> dict[str, Any]:
    report_result = create_report_only(
        conn,
        reporter_user_id=reporter_user_id,
        target_type=target_type,
        target_id=target_id,
        message_id=message_id,
        reason_code=reason_code,
        subreason_code=subreason_code,
        comment=comment,
        idempotency_key=idempotency_key,
        remote_ip=remote_ip,
    )
    enqueue_report_job(conn, report_id=int(report_result['report_id']))
    conn.commit()
    return report_result


def process_next_report_job(  # noqa: PLR0913 - explicit report-job processing contract
    conn,
    *,
    worker_id: str,
    max_attempts: int,
    retry_delay_seconds: int,
    auto_action_threshold: float,
    auto_action_type: str,
    auto_action_ttl_seconds: int,
    rate_window_seconds: int,
    repeat_window_days: int,
    rate_threshold: int,
    high_risk_ip_cidrs: list[str],
) -> dict[str, Any]:
    claimed = conn.execute(
        '''
        WITH candidate AS (
            SELECT id
            FROM moderation_jobs
            WHERE status IN ('pending', 'failed')
              AND available_at <= CURRENT_TIMESTAMP
              AND attempts < ?
            ORDER BY created_at ASC
            LIMIT 1
        )
        UPDATE moderation_jobs
        SET
            status = 'processing',
            attempts = attempts + 1,
            locked_at = CURRENT_TIMESTAMP,
            locked_by = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id IN (SELECT id FROM candidate)
        RETURNING id, report_id, attempts
        ''',
        (max(1, int(max_attempts)), str(worker_id or 'worker')),
    ).fetchone()
    if not claimed:
        conn.rollback()
        return {'status': 'idle'}

    job_id = int(claimed['id'])
    report_id = int(claimed['report_id'])
    try:
        triage = _triage_report(
            conn,
            report_id=report_id,
            auto_action_threshold=auto_action_threshold,
            auto_action_type=auto_action_type,
            auto_action_ttl_seconds=auto_action_ttl_seconds,
            rate_window_seconds=rate_window_seconds,
            repeat_window_days=repeat_window_days,
            rate_threshold=rate_threshold,
            high_risk_ip_cidrs=high_risk_ip_cidrs,
        )
        conn.execute(
            '''
            UPDATE moderation_jobs
            SET
                status = 'done',
                locked_at = NULL,
                locked_by = NULL,
                last_error = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            ''',
            (job_id,),
        )
        conn.commit()
        return {
            'status': 'processed',
            'job_id': job_id,
            'report_id': report_id,
            'case_id': triage.get('case_id'),
        }
    except Exception as exc:  # noqa: BLE001
        conn.rollback()
        next_try = to_db_timestamp(utc_now() + timedelta(seconds=max(1, int(retry_delay_seconds))))
        conn.execute(
            '''
            UPDATE moderation_jobs
            SET
                status = 'failed',
                locked_at = NULL,
                locked_by = NULL,
                last_error = ?,
                available_at = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            ''',
            (normalize_comment(str(exc), max_length=2000), next_try, job_id),
        )
        conn.commit()
        return {
            'status': 'failed',
            'job_id': job_id,
            'report_id': report_id,
            'error': str(exc),
        }


def report_status(conn, *, report_id: int, reporter_user_id: int) -> dict[str, Any] | None:
    row = conn.execute(
        '''
        SELECT
            r.id,
            r.status,
            r.reason_code,
            r.created_at,
            c.id AS case_id,
            c.state AS case_state,
            c.risk_score,
            c.confidence,
            c.updated_at
        FROM moderation_reports r
        LEFT JOIN moderation_case_reports mcr ON mcr.report_id = r.id
        LEFT JOIN moderation_cases c ON c.id = mcr.case_id
        WHERE r.id = ?
          AND r.reporter_user_id = ?
        LIMIT 1
        ''',
        (report_id, reporter_user_id),
    ).fetchone()
    if not row:
        return None
    return {
        'report_id': int(row['id']),
        'status': str(row['status']),
        'reason_code': str(row['reason_code'] or ''),
        'created_at': str(row['created_at'] or ''),
        'case_id': int(row['case_id']) if row['case_id'] is not None else None,
        'case_state': str(row['case_state'] or '') if row['case_state'] is not None else None,
        'risk_score': float(row['risk_score']) if row['risk_score'] is not None else None,
        'confidence': float(row['confidence']) if row['confidence'] is not None else None,
        'updated_at': str(row['updated_at'] or ''),
    }


def list_cases(conn, *, state: str, limit: int, offset: int) -> list[dict[str, Any]]:
    rows = conn.execute(
        '''
        SELECT
            c.id,
            c.case_type,
            c.subject_type,
            c.subject_id,
            c.state,
            c.priority,
            c.risk_score,
            c.confidence,
            c.decision_source,
            c.decision_reason,
            c.assigned_moderator_user_id,
            c.created_at,
            c.updated_at,
            (
                SELECT COUNT(*)
                FROM moderation_case_reports mcr_cnt
                WHERE mcr_cnt.case_id = c.id
            ) AS reports_count,
            r.id AS primary_report_id,
            r.target_type AS report_target_type,
            r.target_id AS report_target_id,
            r.message_id AS report_message_id,
            r.reason_code AS report_reason_code,
            r.comment AS report_comment,
            s_active.id AS active_sanction_id,
            s_active.action_type AS active_sanction_action_type,
            s_active.reason_code AS active_sanction_reason_code,
            s_active.expires_at AS active_sanction_expires_at
        FROM moderation_cases c
        LEFT JOIN moderation_reports r ON r.id = (
            SELECT mcr_rep.report_id
            FROM moderation_case_reports mcr_rep
            WHERE mcr_rep.case_id = c.id
            ORDER BY mcr_rep.report_id ASC
            LIMIT 1
        )
        LEFT JOIN moderation_sanctions s_active ON s_active.id = (
            SELECT ms.id
            FROM moderation_sanctions ms
            WHERE ms.case_id = c.id
              AND ms.status = 'active'
              AND ms.action_type IN ('mute_temp', 'ban_temp', 'ban_perma')
              AND (ms.expires_at IS NULL OR ms.expires_at > CURRENT_TIMESTAMP)
            ORDER BY ms.created_at DESC, ms.id DESC
            LIMIT 1
        )
        WHERE (? = '' OR c.state = ?)
        ORDER BY c.priority ASC, c.created_at ASC
        LIMIT ?
        OFFSET ?
        ''',
        (state, state, limit, offset),
    ).fetchall()
    payload: list[dict[str, Any]] = []
    for row in rows:
        payload.append(
            {
                'id': int(row['id']),
                'case_type': str(row['case_type']),
                'subject_type': str(row['subject_type']),
                'subject_id': str(row['subject_id']),
                'state': str(row['state']),
                'priority': int(row['priority']),
                'risk_score': float(row['risk_score']),
                'confidence': float(row['confidence']),
                'decision_source': str(row['decision_source']),
                'decision_reason': str(row['decision_reason'] or ''),
                'assigned_moderator_user_id': (
                    int(row['assigned_moderator_user_id'])
                    if row['assigned_moderator_user_id'] is not None
                    else None
                ),
                'created_at': str(row['created_at'] or ''),
                'updated_at': str(row['updated_at'] or ''),
                'reports_count': int(row['reports_count'] or 0),
                'report': {
                    'id': int(row['primary_report_id']) if row['primary_report_id'] is not None else None,
                    'target_type': str(row['report_target_type'] or ''),
                    'target_id': str(row['report_target_id'] or ''),
                    'message_id': int(row['report_message_id']) if row['report_message_id'] is not None else None,
                    'reason_code': str(row['report_reason_code'] or ''),
                    'comment': str(row['report_comment'] or ''),
                },
                'active_sanction': (
                    {
                        'id': int(row['active_sanction_id']),
                        'action_type': str(row['active_sanction_action_type'] or ''),
                        'reason_code': str(row['active_sanction_reason_code'] or ''),
                        'expires_at': str(row['active_sanction_expires_at'] or ''),
                    }
                    if row['active_sanction_id'] is not None
                    else None
                ),
            }
        )
    return payload


def list_appeals(conn, *, state: str, limit: int, offset: int) -> list[dict[str, Any]]:
    rows = conn.execute(
        '''
        SELECT
            a.id,
            a.sanction_id,
            a.appellant_user_id,
            a.text,
            a.state,
            a.reviewer_user_id,
            a.resolution_note,
            a.created_at,
            a.resolved_at,
            s.action_type AS sanction_action_type,
            s.reason_code AS sanction_reason_code,
            s.subject_type AS sanction_subject_type,
            s.subject_id AS sanction_subject_id
        FROM moderation_appeals a
        JOIN moderation_sanctions s ON s.id = a.sanction_id
        WHERE (? = '' OR a.state = ?)
        ORDER BY a.created_at ASC
        LIMIT ?
        OFFSET ?
        ''',
        (state, state, limit, offset),
    ).fetchall()
    payload: list[dict[str, Any]] = []
    for row in rows:
        payload.append(
            {
                'id': int(row['id']),
                'sanction_id': int(row['sanction_id']),
                'appellant_user_id': int(row['appellant_user_id']),
                'text': str(row['text'] or ''),
                'state': str(row['state']),
                'reviewer_user_id': int(row['reviewer_user_id']) if row['reviewer_user_id'] is not None else None,
                'resolution_note': str(row['resolution_note'] or ''),
                'created_at': str(row['created_at'] or ''),
                'resolved_at': str(row['resolved_at'] or ''),
                'sanction': {
                    'action_type': str(row['sanction_action_type'] or ''),
                    'reason_code': str(row['sanction_reason_code'] or ''),
                    'subject_type': str(row['sanction_subject_type'] or ''),
                    'subject_id': str(row['sanction_subject_id'] or ''),
                },
            }
        )
    return payload


def resolve_appeal(
    conn,
    *,
    appeal_id: int,
    reviewer_user_id: int,
    resolution: str,
    resolution_note: str,
) -> dict[str, Any]:
    normalized_resolution = str(resolution or '').strip().lower()
    if normalized_resolution not in {'upheld', 'reversed'}:
        raise ValueError('invalid_resolution')

    appeal = conn.execute(
        '''
        SELECT
            a.id,
            a.sanction_id,
            a.state,
            s.status AS sanction_status
        FROM moderation_appeals a
        JOIN moderation_sanctions s ON s.id = a.sanction_id
        WHERE a.id = ?
        LIMIT 1
        ''',
        (appeal_id,),
    ).fetchone()
    if not appeal:
        raise ValueError('appeal_not_found')
    current_state = str(appeal['state'] or '')
    if current_state not in {'submitted', 'in_review'}:
        raise ValueError('appeal_already_resolved')

    now_ts = to_db_timestamp(utc_now())
    conn.execute(
        '''
        UPDATE moderation_appeals
        SET
            state = ?,
            reviewer_user_id = ?,
            resolution_note = ?,
            resolved_at = ?
        WHERE id = ?
        ''',
        (
            normalized_resolution,
            reviewer_user_id,
            normalize_comment(resolution_note, max_length=2000) or None,
            now_ts,
            appeal_id,
        ),
    )

    if normalized_resolution == 'reversed':
        conn.execute(
            '''
            UPDATE moderation_sanctions
            SET status = 'reversed'
            WHERE id = ?
            ''',
            (int(appeal['sanction_id']),),
        )

    add_audit_log(
        conn,
        actor_type='moderator',
        actor_id=str(reviewer_user_id),
        action='appeal_resolved',
        entity_type='appeal',
        entity_id=str(appeal_id),
        details_json=(
            '{"resolution":"%s","sanction_id":%d}'
            % (normalized_resolution, int(appeal['sanction_id']))
        ),
    )
    conn.commit()
    return {
        'appeal_id': int(appeal_id),
        'state': normalized_resolution,
        'sanction_id': int(appeal['sanction_id']),
    }


def apply_case_action(  # noqa: PLR0913 - explicit case-action contract
    conn,
    *,
    case_id: int,
    moderator_user_id: int,
    action_type: str,
    reason_code: str,
    duration_seconds: int,
    note: str,
) -> dict[str, Any]:
    case_row = conn.execute(
        '''
        SELECT id, subject_type, subject_id, state
        FROM moderation_cases
        WHERE id = ?
        LIMIT 1
        ''',
        (case_id,),
    ).fetchone()
    if not case_row:
        raise ValueError('case_not_found')

    subject_type = str(case_row['subject_type'])
    subject_id = str(case_row['subject_id'])
    action = str(action_type or '').strip().lower()
    if not action:
        raise ValueError('action_type_required')

    now = utc_now()
    expires_at = None
    if duration_seconds > 0:
        expires_at = to_db_timestamp(now + timedelta(seconds=int(duration_seconds)))

    sanction_id = None
    if action in {'warn', 'mute_temp', 'ban_temp', 'ban_perma', 'freeze', 'delete'}:
        status = 'active'
        if action in {'delete'}:
            status = 'applied'
        sanction_row = conn.execute(
            '''
            INSERT INTO moderation_sanctions (
                case_id,
                subject_type,
                subject_id,
                action_type,
                reason_code,
                status,
                created_by,
                starts_at,
                expires_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id
            ''',
            (
                case_id,
                subject_type,
                subject_id,
                action,
                reason_code,
                status,
                f'moderator:{moderator_user_id}',
                to_db_timestamp(now),
                expires_at,
            ),
        ).fetchone()
        if sanction_row:
            sanction_id = int(sanction_row['id'])

    conn.execute(
        '''
        UPDATE moderation_cases
        SET
            state = 'closed',
            assigned_moderator_user_id = ?,
            decision_source = 'human',
            decision_reason = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        ''',
        (
            moderator_user_id,
            normalize_comment(note, max_length=512) or action,
            case_id,
        ),
    )
    conn.execute(
        '''
        UPDATE moderation_reports
        SET status = 'closed'
        WHERE id IN (
            SELECT report_id
            FROM moderation_case_reports
            WHERE case_id = ?
        )
        ''',
        (case_id,),
    )
    add_audit_log(
        conn,
        actor_type='moderator',
        actor_id=str(moderator_user_id),
        action='case_action_applied',
        entity_type='case',
        entity_id=str(case_id),
        details_json=(
            '{"action":"%s","reason":"%s","sanction_id":%s}'
            % (action, reason_code, str(sanction_id or 'null'))
        ),
    )
    conn.commit()
    return {
        'case_id': case_id,
        'subject_type': subject_type,
        'subject_id': subject_id,
        'action_type': action,
        'sanction_id': sanction_id,
        'expires_at': expires_at,
        'status': 'applied',
    }


def apply_manual_user_action(  # noqa: PLR0913 - explicit manual-action contract
    conn,
    *,
    target_user_id: int,
    moderator_user_id: int,
    action_type: str,
    reason_code: str,
    duration_seconds: int,
    note: str,
) -> dict[str, Any]:
    safe_target_user_id = parse_int(target_user_id, min_value=1)
    if safe_target_user_id is None:
        raise ValueError('invalid_target_user_id')

    user_row = conn.execute(
        '''
        SELECT id, username
        FROM users
        WHERE id = ?
        LIMIT 1
        ''',
        (int(safe_target_user_id),),
    ).fetchone()
    if not user_row:
        raise ValueError('target_user_not_found')

    action = str(action_type or '').strip().lower()
    if action not in {'warn', 'mute_temp', 'ban_temp', 'ban_perma'}:
        raise ValueError('invalid_action_type')

    now = utc_now()
    expires_at = None
    if action in {'mute_temp', 'ban_temp'}:
        safe_duration = parse_int(duration_seconds, min_value=1, max_value=31_536_000)
        if safe_duration is None:
            raise ValueError('invalid_duration')
        expires_at = to_db_timestamp(now + timedelta(seconds=int(safe_duration)))

    safe_reason = normalize_reason_code(reason_code or 'manual_action')
    safe_note = normalize_comment(note, max_length=512) or action

    case_row = conn.execute(
        '''
        INSERT INTO moderation_cases (
            case_type,
            subject_type,
            subject_id,
            state,
            priority,
            risk_score,
            confidence,
            decision_source,
            decision_reason,
            assigned_moderator_user_id,
            created_at,
            updated_at
        )
        VALUES (
            'manual_user_action',
            'user',
            ?,
            'closed',
            2,
            1.0,
            1.0,
            'human',
            ?,
            ?,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
        )
        RETURNING id
        ''',
        (
            str(int(safe_target_user_id)),
            safe_note,
            int(moderator_user_id),
        ),
    ).fetchone()
    case_id = int(case_row['id'])

    sanction_row = conn.execute(
        '''
        INSERT INTO moderation_sanctions (
            case_id,
            subject_type,
            subject_id,
            action_type,
            reason_code,
            status,
            created_by,
            starts_at,
            expires_at
        )
        VALUES (?, 'user', ?, ?, ?, 'active', ?, ?, ?)
        RETURNING id
        ''',
        (
            int(case_id),
            str(int(safe_target_user_id)),
            action,
            safe_reason,
            f'moderator:{int(moderator_user_id)}',
            to_db_timestamp(now),
            expires_at,
        ),
    ).fetchone()
    sanction_id = int(sanction_row['id'])

    add_audit_log(
        conn,
        actor_type='moderator',
        actor_id=str(int(moderator_user_id)),
        action='manual_user_action_applied',
        entity_type='user',
        entity_id=str(int(safe_target_user_id)),
        details_json=json.dumps(
            {
                'case_id': int(case_id),
                'sanction_id': int(sanction_id),
                'action': action,
                'reason_code': safe_reason,
                'note': safe_note,
            },
            ensure_ascii=False,
        ),
    )
    conn.commit()
    return {
        'case_id': int(case_id),
        'sanction_id': int(sanction_id),
        'target_user_id': int(safe_target_user_id),
        'target_username': str(user_row['username'] or ''),
        'action_type': action,
        'reason_code': safe_reason,
        'expires_at': expires_at,
        'status': 'applied',
    }


def lift_sanction(
    conn,
    *,
    sanction_id: int,
    moderator_user_id: int,
    note: str,
) -> dict[str, Any]:
    sanction_row = conn.execute(
        '''
        SELECT id, status, subject_type, subject_id, action_type, expires_at
        FROM moderation_sanctions
        WHERE id = ?
        LIMIT 1
        ''',
        (int(sanction_id),),
    ).fetchone()
    if not sanction_row:
        raise ValueError('sanction_not_found')

    current_status = str(sanction_row['status'] or '').strip().lower()
    if current_status != 'active':
        raise ValueError('sanction_not_active')

    conn.execute(
        '''
        UPDATE moderation_sanctions
        SET
            status = 'reversed',
            expires_at = CURRENT_TIMESTAMP
        WHERE id = ?
        ''',
        (int(sanction_id),),
    )
    add_audit_log(
        conn,
        actor_type='moderator',
        actor_id=str(moderator_user_id),
        action='sanction_lifted',
        entity_type='sanction',
        entity_id=str(int(sanction_id)),
        details_json=json.dumps(
            {
                'subject_type': str(sanction_row['subject_type'] or ''),
                'subject_id': str(sanction_row['subject_id'] or ''),
                'action_type': str(sanction_row['action_type'] or ''),
                'note': normalize_comment(note, max_length=512),
            },
            ensure_ascii=False,
        ),
    )
    conn.commit()
    return {
        'sanction_id': int(sanction_id),
        'status': 'reversed',
        'subject_type': str(sanction_row['subject_type'] or ''),
        'subject_id': str(sanction_row['subject_id'] or ''),
        'action_type': str(sanction_row['action_type'] or ''),
    }


def submit_appeal(
    conn,
    *,
    sanction_id: int,
    appellant_user_id: int,
    text: str,
) -> dict[str, Any]:
    sanction = conn.execute(
        '''
        SELECT id, subject_type, subject_id, action_type, status
        FROM moderation_sanctions
        WHERE id = ?
        LIMIT 1
        ''',
        (sanction_id,),
    ).fetchone()
    if not sanction:
        raise ValueError('sanction_not_found')

    subject_type = str(sanction['subject_type'] or '')
    subject_id = str(sanction['subject_id'] or '')
    if subject_type == 'user':
        if subject_id != str(appellant_user_id):
            raise ValueError('appeal_not_allowed')
    elif subject_type == GROUP_MEMBER_SUBJECT_TYPE:
        parsed_subject = parse_group_member_subject_id(subject_id)
        if not parsed_subject or int(parsed_subject[1]) != int(appellant_user_id):
            raise ValueError('appeal_not_allowed')
    else:
        raise ValueError('appeal_not_allowed')

    existing = conn.execute(
        '''
        SELECT id
        FROM moderation_appeals
        WHERE sanction_id = ?
          AND appellant_user_id = ?
          AND state IN ('submitted', 'in_review')
        LIMIT 1
        ''',
        (sanction_id, appellant_user_id),
    ).fetchone()
    if existing:
        return {
            'appeal_id': int(existing['id']),
            'created': False,
            'state': 'submitted',
        }

    appeal_row = conn.execute(
        '''
        INSERT INTO moderation_appeals (
            sanction_id,
            appellant_user_id,
            text,
            state
        )
        VALUES (?, ?, ?, 'submitted')
        RETURNING id
        ''',
        (sanction_id, appellant_user_id, normalize_comment(text, max_length=2000) or None),
    ).fetchone()
    if not appeal_row:
        raise RuntimeError('appeal_create_failed')
    appeal_id = int(appeal_row['id'])

    add_audit_log(
        conn,
        actor_type='user',
        actor_id=str(appellant_user_id),
        action='appeal_submitted',
        entity_type='appeal',
        entity_id=str(appeal_id),
        details_json=('{"sanction_id":%d}' % sanction_id),
    )
    conn.commit()
    return {
        'appeal_id': appeal_id,
        'created': True,
        'state': 'submitted',
    }


def active_user_restriction(conn, *, user_id: int) -> dict[str, Any] | None:
    row = conn.execute(
        '''
        SELECT id, action_type, reason_code, expires_at
        FROM moderation_sanctions
        WHERE subject_type = 'user'
          AND subject_id = ?
          AND status = 'active'
          AND action_type IN ('mute_temp', 'ban_temp', 'ban_perma')
          AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
        ORDER BY created_at DESC
        LIMIT 1
        ''',
        (str(user_id),),
    ).fetchone()
    if not row:
        return None
    return {
        'sanction_id': int(row['id']),
        'action_type': str(row['action_type']),
        'reason_code': str(row['reason_code'] or ''),
        'expires_at': str(row['expires_at'] or ''),
    }


def active_group_restriction(conn, *, chat_id: str, user_id: int) -> dict[str, Any] | None:
    subject_id = make_group_member_subject_id(str(chat_id), int(user_id))
    row = conn.execute(
        '''
        SELECT id, action_type, reason_code, expires_at
        FROM moderation_sanctions
        WHERE subject_type = ?
          AND subject_id = ?
          AND status = 'active'
          AND action_type IN ('mute_temp', 'ban_temp', 'ban_perma')
          AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
        ORDER BY created_at DESC
        LIMIT 1
        ''',
        (GROUP_MEMBER_SUBJECT_TYPE, subject_id),
    ).fetchone()
    if not row:
        return None
    return {
        'sanction_id': int(row['id']),
        'chat_id': str(chat_id),
        'user_id': int(user_id),
        'action_type': str(row['action_type']),
        'reason_code': str(row['reason_code'] or ''),
        'expires_at': str(row['expires_at'] or ''),
    }


def apply_group_member_sanction(  # noqa: PLR0913 - explicit group-sanction contract
    conn,
    *,
    chat_id: str,
    target_user_id: int,
    moderator_user_id: int,
    action_type: str,
    reason_code: str,
    duration_seconds: int,
    note: str,
) -> dict[str, Any]:
    normalized_action = str(action_type or '').strip().lower()
    if normalized_action not in RESTRICTED_GROUP_ACTION_TYPES:
        raise ValueError('invalid_action_type')

    safe_chat_id = str(chat_id or '').strip()
    if not safe_chat_id:
        raise ValueError('invalid_chat_id')
    safe_target_user_id = parse_int(target_user_id, min_value=1)
    if safe_target_user_id is None:
        raise ValueError('invalid_target_user_id')

    now = utc_now()
    expires_at = None
    if normalized_action in {'mute_temp', 'ban_temp'}:
        safe_duration = parse_int(duration_seconds, min_value=1, max_value=31_536_000)
        if safe_duration is None:
            raise ValueError('invalid_duration')
        expires_at = to_db_timestamp(now + timedelta(seconds=int(safe_duration)))

    subject_id = make_group_member_subject_id(safe_chat_id, safe_target_user_id)
    case_row = conn.execute(
        '''
        INSERT INTO moderation_cases (
            case_type,
            subject_type,
            subject_id,
            state,
            priority,
            risk_score,
            confidence,
            decision_source,
            decision_reason,
            assigned_moderator_user_id
        )
        VALUES ('group_moderation', ?, ?, 'closed', 2, 0.0, 1.0, 'human', ?, ?)
        RETURNING id
        ''',
        (
            GROUP_MEMBER_SUBJECT_TYPE,
            subject_id,
            normalize_comment(note, max_length=512) or normalized_action,
            int(moderator_user_id),
        ),
    ).fetchone()
    if not case_row:
        raise RuntimeError('case_create_failed')
    case_id = int(case_row['id'])

    sanction_row = conn.execute(
        '''
        INSERT INTO moderation_sanctions (
            case_id,
            subject_type,
            subject_id,
            action_type,
            reason_code,
            status,
            created_by,
            starts_at,
            expires_at
        )
        VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
        RETURNING id
        ''',
        (
            case_id,
            GROUP_MEMBER_SUBJECT_TYPE,
            subject_id,
            normalized_action,
            normalize_reason_code(reason_code or 'group_moderation'),
            f'group_moderator:{int(moderator_user_id)}',
            to_db_timestamp(now),
            expires_at,
        ),
    ).fetchone()
    if not sanction_row:
        raise RuntimeError('sanction_create_failed')
    sanction_id = int(sanction_row['id'])

    add_audit_log(
        conn,
        actor_type='moderator',
        actor_id=str(int(moderator_user_id)),
        action='group_sanction_applied',
        entity_type='sanction',
        entity_id=str(sanction_id),
        details_json=json.dumps(
            {
                'chat_id': safe_chat_id,
                'target_user_id': int(safe_target_user_id),
                'action_type': normalized_action,
                'reason_code': normalize_reason_code(reason_code or 'group_moderation'),
            },
            ensure_ascii=False,
        ),
    )
    conn.commit()

    return {
        'sanction_id': sanction_id,
        'case_id': case_id,
        'chat_id': safe_chat_id,
        'target_user_id': int(safe_target_user_id),
        'action_type': normalized_action,
        'reason_code': normalize_reason_code(reason_code or 'group_moderation'),
        'expires_at': expires_at,
        'status': 'active',
    }


def moderation_metrics(conn, *, since_hours: int = 24) -> dict[str, Any]:
    safe_hours = max(1, min(int(since_hours), 24 * 90))
    since_ts = to_db_timestamp(utc_now() - timedelta(hours=safe_hours))
    active_users_since_ts = to_db_timestamp(utc_now() - timedelta(hours=24))

    tta_row = conn.execute(
        '''
        SELECT
            COUNT(*) AS cnt,
            COALESCE(
                percentile_cont(0.95) WITHIN GROUP (
                    ORDER BY EXTRACT(EPOCH FROM (c.updated_at - c.created_at))
                ),
                0
            ) AS p95_seconds
        FROM moderation_cases c
        WHERE c.state IN ('closed', 'auto_resolved')
          AND c.updated_at >= ?
        ''',
        (since_ts,),
    ).fetchone()

    appeals_row = conn.execute(
        '''
        SELECT
            COUNT(*) FILTER (WHERE state IN ('upheld', 'reversed')) AS resolved_total,
            COUNT(*) FILTER (WHERE state = 'reversed') AS reversed_total
        FROM moderation_appeals
        WHERE created_at >= ?
        ''',
        (since_ts,),
    ).fetchone()

    throughput_rows = conn.execute(
        '''
        SELECT
            assigned_moderator_user_id AS moderator_id,
            COUNT(*) AS decisions
        FROM moderation_cases
        WHERE state IN ('closed', 'auto_resolved')
          AND assigned_moderator_user_id IS NOT NULL
          AND updated_at >= ?
        GROUP BY assigned_moderator_user_id
        ORDER BY decisions DESC, moderator_id ASC
        ''',
        (since_ts,),
    ).fetchall()

    queue_row = conn.execute(
        '''
        SELECT
            COUNT(*) FILTER (WHERE status = 'pending') AS pending_jobs,
            COUNT(*) FILTER (WHERE status = 'processing') AS processing_jobs,
            COUNT(*) FILTER (WHERE status = 'failed') AS failed_jobs
        FROM moderation_jobs
        '''
    ).fetchone()

    users_row = conn.execute(
        '''
        SELECT
            COUNT(*) AS total_registered,
            COUNT(*) FILTER (WHERE COALESCE(is_online, 0) = 1) AS online_now,
            COUNT(*) FILTER (
                WHERE COALESCE(is_online, 0) = 1
                   OR (
                        NULLIF(last_seen, '') IS NOT NULL
                        AND NULLIF(last_seen, '') >= ?
                   )
            ) AS active_last_24h
        FROM users
        ''',
        (active_users_since_ts,),
    ).fetchone()

    resolved_total = int((appeals_row['resolved_total'] or 0) if appeals_row else 0)
    reversed_total = int((appeals_row['reversed_total'] or 0) if appeals_row else 0)
    reversal_rate = (float(reversed_total) / float(resolved_total)) if resolved_total > 0 else 0.0

    return {
        'window_hours': safe_hours,
        'time_to_action_p95_seconds': float((tta_row['p95_seconds'] or 0.0) if tta_row else 0.0),
        'resolved_cases': int((tta_row['cnt'] or 0) if tta_row else 0),
        'appeal_reversal_rate': round(reversal_rate, 4),
        'appeals_resolved': resolved_total,
        'appeals_reversed': reversed_total,
        'moderator_throughput': [
            {
                'moderator_user_id': int(row['moderator_id']),
                'decisions': int(row['decisions']),
            }
            for row in throughput_rows
        ],
        'queue': {
            'pending': int((queue_row['pending_jobs'] or 0) if queue_row else 0),
            'processing': int((queue_row['processing_jobs'] or 0) if queue_row else 0),
            'failed': int((queue_row['failed_jobs'] or 0) if queue_row else 0),
        },
        'user_stats': {
            'total_registered': int((users_row['total_registered'] or 0) if users_row else 0),
            'online_now': int((users_row['online_now'] or 0) if users_row else 0),
            'active_last_24h': int((users_row['active_last_24h'] or 0) if users_row else 0),
        },
    }


def moderation_metrics_prometheus_text(metrics: dict[str, Any]) -> str:
    window_hours = int(metrics.get('window_hours') or 24)
    lines: list[str] = []
    lines.append('# HELP moderation_time_to_action_p95_seconds p95 moderation time to action in seconds.')
    lines.append('# TYPE moderation_time_to_action_p95_seconds gauge')
    lines.append(f'moderation_time_to_action_p95_seconds{{window_hours="{window_hours}"}} {float(metrics.get("time_to_action_p95_seconds") or 0.0)}')
    lines.append('# HELP moderation_resolved_cases_total Number of resolved moderation cases in window.')
    lines.append('# TYPE moderation_resolved_cases_total gauge')
    lines.append(f'moderation_resolved_cases_total{{window_hours="{window_hours}"}} {int(metrics.get("resolved_cases") or 0)}')
    lines.append('# HELP moderation_appeal_reversal_rate Appeal reversal rate within window.')
    lines.append('# TYPE moderation_appeal_reversal_rate gauge')
    lines.append(f'moderation_appeal_reversal_rate{{window_hours="{window_hours}"}} {float(metrics.get("appeal_reversal_rate") or 0.0)}')
    lines.append('# HELP moderation_appeals_resolved_total Number of resolved appeals in window.')
    lines.append('# TYPE moderation_appeals_resolved_total gauge')
    lines.append(f'moderation_appeals_resolved_total{{window_hours="{window_hours}"}} {int(metrics.get("appeals_resolved") or 0)}')
    lines.append('# HELP moderation_appeals_reversed_total Number of reversed appeals in window.')
    lines.append('# TYPE moderation_appeals_reversed_total gauge')
    lines.append(f'moderation_appeals_reversed_total{{window_hours="{window_hours}"}} {int(metrics.get("appeals_reversed") or 0)}')
    lines.append('# HELP moderation_queue_jobs Queue job counts by status.')
    lines.append('# TYPE moderation_queue_jobs gauge')
    queue = metrics.get('queue') or {}
    lines.append(f'moderation_queue_jobs{{status="pending"}} {int(queue.get("pending") or 0)}')
    lines.append(f'moderation_queue_jobs{{status="processing"}} {int(queue.get("processing") or 0)}')
    lines.append(f'moderation_queue_jobs{{status="failed"}} {int(queue.get("failed") or 0)}')
    lines.append('# HELP moderation_moderator_decisions Decisions by moderator in window.')
    lines.append('# TYPE moderation_moderator_decisions gauge')
    throughput = metrics.get('moderator_throughput') or []
    for row in throughput:
        lines.append(
            'moderation_moderator_decisions{moderator_user_id="%s",window_hours="%d"} %d'
            % (
                str(int(row.get('moderator_user_id') or 0)),
                window_hours,
                int(row.get('decisions') or 0),
            )
        )
    return '\n'.join(lines) + '\n'
