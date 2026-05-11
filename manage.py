import argparse
import json
import logging

from app.database import get_db_connection
from app.services import moderation as moderation_service
from app.services.maintenance_runtime import run_database_maintenance
from app.services.moderation_worker_runtime import process_one_report_job, run_moderation_worker_forever
from app.services.pip_audit_runtime import run_pip_audit
from app.services.production_config_runtime import run_production_config_check
from app.services.scheduler_runtime import run_scheduler_forever
from app.services.security_runtime import run_security_check
from app.services.web_runtime import run_web_server


def build_parser():
    parser = argparse.ArgumentParser(
        description='SUN Messenger runtime entrypoint.',
    )
    parser.add_argument(
        '--env',
        dest='global_config_name',
        default=None,
        help='Configuration name: development, testing, production.',
    )

    subparsers = parser.add_subparsers(dest='command', required=True)
    for command_name, help_text in (
        ('web', 'Run the web application.'),
        ('scheduler', 'Run only background scheduler jobs.'),
        ('maintenance', 'Run schema migrations and maintenance tasks.'),
        ('security-check', 'Validate production security configuration.'),
        ('production-config-check', 'Validate production config guardrails (secrets, Redis, HTTPS, cookies).'),
        ('pip-audit', 'Audit Python dependencies for known vulnerabilities.'),
        ('moderation-worker', 'Run moderation async report processing worker.'),
        ('moderation-rbac', 'Manage moderation RBAC roles in database.'),
    ):
        subparser = subparsers.add_parser(command_name, help=help_text)
        subparser.add_argument(
            '--env',
            dest='config_name',
            default=None,
            help='Configuration name: development, testing, production.',
        )
        if command_name == 'maintenance':
            subparser.add_argument(
                '--integrity-only',
                action='store_true',
                help='Run integrity checks without applying migrations.',
            )
            subparser.add_argument(
                '--backup-dir',
                default=None,
                help='Directory for pre-maintenance PostgreSQL backups.',
            )
            subparser.add_argument(
                '--restore-from',
                default=None,
                help='Restore a PostgreSQL backup before running checks/migrations.',
            )
            subparser.add_argument(
                '--no-backup',
                action='store_true',
                help='Skip the automatic pre-maintenance backup.',
            )
        if command_name == 'moderation-worker':
            subparser.add_argument(
                '--once',
                action='store_true',
                help='Process at most one queued moderation job and exit.',
            )
            subparser.add_argument(
                '--sleep-seconds',
                default=2,
                type=int,
                help='Polling interval when running in loop mode.',
            )
        if command_name == 'pip-audit':
            subparser.add_argument(
                '--requirements',
                action='append',
                default=[],
                help='Requirements file relative to project root. Repeatable. Default: requirements.txt',
            )
            subparser.add_argument(
                '--no-strict',
                action='store_true',
                help='Do not fail the run when dependency collection for some package fails.',
            )
        if command_name == 'moderation-rbac':
            subparser.add_argument(
                'action',
                choices=('grant', 'revoke', 'list'),
                help='RBAC action.',
            )
            subparser.add_argument(
                '--user-id',
                dest='user_id',
                type=int,
                default=None,
                help='Target user id for grant/revoke.',
            )
            subparser.add_argument(
                '--role',
                dest='role',
                default='moderator',
                help='Role name (default: moderator).',
            )
    return parser


def main(argv=None):  # noqa: C901, PLR0915 - CLI command dispatcher with guarded branches
    parser = build_parser()
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO)
    config_name = getattr(args, 'config_name', None) or getattr(args, 'global_config_name', None)

    if args.command == 'web':
        run_web_server(config_name)
        return 0
    if args.command == 'scheduler':
        run_scheduler_forever(config_name)
        return 0
    if args.command == 'maintenance':
        maintenance_kwargs = {}
        if getattr(args, 'integrity_only', False):
            maintenance_kwargs['integrity_only'] = True
        if getattr(args, 'backup_dir', None):
            maintenance_kwargs['backup_dir'] = args.backup_dir
        if getattr(args, 'restore_from', None):
            maintenance_kwargs['restore_from'] = args.restore_from
        if getattr(args, 'no_backup', False):
            maintenance_kwargs['skip_backup'] = True

        if maintenance_kwargs:
            run_database_maintenance(config_name, **maintenance_kwargs)
        else:
            run_database_maintenance(config_name)
        return 0
    if args.command == 'security-check':
        try:
            report = run_security_check(config_name)
        except RuntimeError as exc:
            print(
                json.dumps(
                    {
                        'status': 'failed',
                        'error': str(exc),
                    },
                    ensure_ascii=False,
                    indent=2,
                )
            )
            return 1
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    if args.command == 'production-config-check':
        report = run_production_config_check(config_name)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0 if report.get('status') == 'ok' else 1
    if args.command == 'pip-audit':
        requirements = [str(item).strip() for item in getattr(args, 'requirements', []) if str(item).strip()]
        report = run_pip_audit(requirements or None, strict=not bool(getattr(args, 'no_strict', False)))
        if report.get('stdout'):
            print(report['stdout'])
        if report.get('stderr'):
            print(report['stderr'])
        if report.get('status') == 'failed' and report.get('error'):
            print(json.dumps({'status': 'failed', 'error': report['error']}, ensure_ascii=False))
        return int(report.get('exit_code', 1))
    if args.command == 'moderation-worker':
        if getattr(args, 'once', False):
            from app.config import get_config_class, load_environment
            import os

            load_environment()
            config = get_config_class(config_name).from_env()
            os.environ['DATABASE_BACKEND'] = 'postgres'
            database_url = str(config.get('DATABASE_URL') or '').strip()
            if database_url:
                os.environ['DATABASE_URL'] = database_url
            result = process_one_report_job(config)
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 0

        run_moderation_worker_forever(config_name, sleep_seconds=max(1, int(getattr(args, 'sleep_seconds', 2))))
        return 0
    if args.command == 'moderation-rbac':
        from app.config import get_config_class, load_environment
        import os

        load_environment()
        config = get_config_class(config_name).from_env()
        os.environ['DATABASE_BACKEND'] = 'postgres'
        database_url = str(config.get('DATABASE_URL') or '').strip()
        if database_url:
            os.environ['DATABASE_URL'] = database_url
        elif not str(os.environ.get('DATABASE_URL') or '').strip():
            print(json.dumps({'status': 'failed', 'error': 'DATABASE_URL must be set'}, ensure_ascii=False))
            return 2

        action = str(getattr(args, 'action', '') or '').strip().lower()
        role = moderation_service.normalize_role(getattr(args, 'role', 'moderator'))
        user_id = getattr(args, 'user_id', None)
        conn = get_db_connection()
        try:
            if action == 'list':
                rows = conn.execute(
                    '''
                    SELECT user_id, role, granted_by_user_id, granted_at
                    FROM moderation_user_roles
                    ORDER BY role ASC, user_id ASC
                    '''
                ).fetchall()
                print(
                    json.dumps(
                        [
                            {
                                'user_id': int(row['user_id']),
                                'role': str(row['role']),
                                'granted_by_user_id': (
                                    int(row['granted_by_user_id'])
                                    if row['granted_by_user_id'] is not None
                                    else None
                                ),
                                'granted_at': str(row['granted_at'] or ''),
                            }
                            for row in rows
                        ],
                        ensure_ascii=False,
                        indent=2,
                    )
                )
                return 0

            if user_id is None or int(user_id) <= 0:
                print(json.dumps({'status': 'failed', 'error': '--user-id is required and must be > 0'}, ensure_ascii=False))
                return 2
            if not role:
                print(json.dumps({'status': 'failed', 'error': '--role is invalid'}, ensure_ascii=False))
                return 2

            if action == 'grant':
                moderation_service.assign_user_role(
                    conn,
                    user_id=int(user_id),
                    role=role,
                    granted_by_user_id=None,
                )
                conn.commit()
                print(json.dumps({'status': 'ok', 'action': 'grant', 'user_id': int(user_id), 'role': role}, ensure_ascii=False))
                return 0

            if action == 'revoke':
                removed = moderation_service.revoke_user_role(
                    conn,
                    user_id=int(user_id),
                    role=role,
                )
                conn.commit()
                print(
                    json.dumps(
                        {
                            'status': 'ok',
                            'action': 'revoke',
                            'user_id': int(user_id),
                            'role': role,
                            'removed': bool(removed),
                        },
                        ensure_ascii=False,
                    )
                )
                return 0
        finally:
            conn.close()
        parser.error(f'Unknown moderation-rbac action: {action}')
        return 2

    parser.error(f'Unknown command: {args.command}')
    return 2


if __name__ == '__main__':
    raise SystemExit(main())
