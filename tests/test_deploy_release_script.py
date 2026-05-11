from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEPLOY_SCRIPT = ROOT / 'deploy' / 'scripts' / 'deploy_release.sh'
WEB_SERVICE = ROOT / 'deploy' / 'systemd' / 'sunmessenger-web.service'


def test_web_service_uses_restart_after_release_symlink_switch() -> None:
    script = DEPLOY_SCRIPT.read_text(encoding='utf-8')
    unit = WEB_SERVICE.read_text(encoding='utf-8')

    assert 'kill --signal=HUP' not in script
    assert 'run_systemctl restart sunmessenger-web.service' in script
    assert 'WorkingDirectory=/srv/sunmessenger/current' in unit
    assert 'gunicorn' in unit


def test_deploy_and_rollback_call_web_restart_helper() -> None:
    script = DEPLOY_SCRIPT.read_text(encoding='utf-8')

    assert 'restart_web_service || true' in script
    assert '\nrestart_web_service\n' in script
