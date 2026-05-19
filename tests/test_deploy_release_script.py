from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEPLOY_SCRIPT = ROOT / 'deploy' / 'scripts' / 'deploy_release.sh'
WEB_SERVICE = ROOT / 'deploy' / 'systemd' / 'sunmessenger-web.service'
MEDIASOUP_SERVICE = ROOT / 'deploy' / 'systemd' / 'sun-mediasoup.service'
LOCAL_DEPLOY_PS1 = ROOT / 'deploy' / 'scripts' / 'deploy_local.ps1'
LOCAL_DEPLOY_SH = ROOT / 'deploy' / 'scripts' / 'deploy_local.sh'


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


def test_mediasoup_deploy_tracks_current_release_when_unit_is_installed() -> None:
    script = DEPLOY_SCRIPT.read_text(encoding='utf-8')
    unit = MEDIASOUP_SERVICE.read_text(encoding='utf-8')

    assert 'Invalid environment: $TARGET_ENV' in script
    assert 'install_mediasoup_dependencies_if_enabled' in script
    assert 'restart_mediasoup_service_if_present' in script
    assert 'npm --prefix "$RELEASE_DIR/server-mediasoup"' in script
    assert 'WorkingDirectory=/srv/sunmessenger/current/server-mediasoup' in unit
    assert 'EnvironmentFile=/srv/sunmessenger/shared/.env.mediasoup' in unit
    assert 'User=sunmessenger' in unit
    assert '/opt/sunmessenger' not in unit


def test_local_deploy_helpers_do_not_assume_one_workstation_path() -> None:
    ps1 = LOCAL_DEPLOY_PS1.read_text(encoding='utf-8')
    sh = LOCAL_DEPLOY_SH.read_text(encoding='utf-8')

    assert '/mnt/d/SUNmessenger' not in ps1
    assert 'wslpath -a -u $repoRoot' in ps1
    assert 'mkdir -p $remotePath /srv/sunmessenger/shared' in ps1
    assert '[ValidateSet("staging", "production")]' in ps1
    assert 'Invalid environment: $DEPLOY_ENV' in sh
    assert 'SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"' in sh
    assert 'cd "$REPO_ROOT"' in sh
    assert 'mkdir -p \'$REMOTE_ARTIFACT_DIR\' /srv/sunmessenger/shared' in sh
