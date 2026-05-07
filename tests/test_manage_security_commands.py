import json

import manage


def test_manage_production_config_check_exit_codes(monkeypatch, capsys):
    monkeypatch.setattr(
        manage,
        'run_production_config_check',
        lambda _config_name=None: {'status': 'ok', 'env': 'production', 'checks': []},
    )
    assert manage.main(['production-config-check']) == 0
    ok_output = capsys.readouterr().out
    assert json.loads(ok_output)['status'] == 'ok'

    monkeypatch.setattr(
        manage,
        'run_production_config_check',
        lambda _config_name=None: {'status': 'failed', 'env': 'production', 'checks': []},
    )
    assert manage.main(['production-config-check']) == 1
    failed_output = capsys.readouterr().out
    assert json.loads(failed_output)['status'] == 'failed'


def test_manage_pip_audit_command_forwards_requirements(monkeypatch, capsys):
    captured = {}

    def _fake_run_pip_audit(requirements_files=None, *, strict=True):
        captured['requirements_files'] = requirements_files
        captured['strict'] = strict
        return {
            'status': 'ok',
            'exit_code': 0,
            'stdout': '{"dependencies":[]}\n',
            'stderr': '',
        }

    monkeypatch.setattr(manage, 'run_pip_audit', _fake_run_pip_audit)

    exit_code = manage.main(
        [
            'pip-audit',
            '--requirements',
            'requirements.txt',
            '--requirements',
            'requirements-dev.txt',
        ]
    )

    assert exit_code == 0
    assert captured['requirements_files'] == ['requirements.txt', 'requirements-dev.txt']
    assert captured['strict'] is True
    assert '{"dependencies":[]}' in capsys.readouterr().out

    exit_code = manage.main(['pip-audit', '--no-strict'])
    assert exit_code == 0
    assert captured['requirements_files'] is None
    assert captured['strict'] is False
