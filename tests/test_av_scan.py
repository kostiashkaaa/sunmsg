import subprocess
from types import SimpleNamespace

import pytest

from app.services import av_scan
from app.services.av_scan import AVScanError


def test_build_scan_command_supports_placeholder_and_implicit_path():
    explicit = av_scan._build_scan_command(
        'clamscan --no-summary --infected {path}',
        '/tmp/file.bin',
    )
    assert explicit == ['clamscan', '--no-summary', '--infected', '/tmp/file.bin']

    implicit = av_scan._build_scan_command(
        'clamscan --no-summary --infected',
        '/tmp/file.bin',
    )
    assert implicit == ['clamscan', '--no-summary', '--infected', '/tmp/file.bin']


def test_build_scan_commands_supports_fallback_chain():
    commands = av_scan._build_scan_commands(
        'clamdscan --fdpass {path} || clamscan --no-summary --infected --stdout {path}',
        '/tmp/file.bin',
    )
    assert commands == [
        ['clamdscan', '--fdpass', '/tmp/file.bin'],
        ['clamscan', '--no-summary', '--infected', '--stdout', '/tmp/file.bin'],
    ]


def test_scan_file_returns_clean_or_infected(monkeypatch):
    monkeypatch.setattr(
        av_scan.subprocess,
        'run',
        lambda *args, **kwargs: SimpleNamespace(
            returncode=0,
            stdout='Everything ok',
            stderr='',
        ),
    )
    clean_result = av_scan.scan_file(
        '/tmp/file.bin',
        command_template='scanner --scan {path}',
        timeout_seconds=3,
    )
    assert clean_result.infected is False
    assert clean_result.signature == ''

    monkeypatch.setattr(
        av_scan.subprocess,
        'run',
        lambda *args, **kwargs: SimpleNamespace(
            returncode=1,
            stdout='/tmp/file.bin: Eicar-Test-Signature FOUND',
            stderr='',
        ),
    )
    infected_result = av_scan.scan_file(
        '/tmp/file.bin',
        command_template='scanner --scan {path}',
        timeout_seconds=3,
    )
    assert infected_result.infected is True
    assert infected_result.signature == 'Eicar-Test-Signature'


def test_scan_file_raises_on_timeout_and_execution_error(monkeypatch):
    def _raise_timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired(cmd='scanner', timeout=2)

    monkeypatch.setattr(av_scan.subprocess, 'run', _raise_timeout)
    with pytest.raises(AVScanError, match='timed out'):
        av_scan.scan_file('/tmp/file.bin', command_template='scanner --scan {path}', timeout_seconds=2)

    def _raise_oserror(*args, **kwargs):
        raise OSError('not found')

    monkeypatch.setattr(av_scan.subprocess, 'run', _raise_oserror)
    with pytest.raises(AVScanError, match='failed to execute'):
        av_scan.scan_file('/tmp/file.bin', command_template='scanner --scan {path}', timeout_seconds=2)


def test_scan_file_raises_on_nonstandard_exit_code(monkeypatch):
    monkeypatch.setattr(
        av_scan.subprocess,
        'run',
        lambda *args, **kwargs: SimpleNamespace(returncode=2, stdout='', stderr='engine error'),
    )
    with pytest.raises(AVScanError, match='exit code 2'):
        av_scan.scan_file('/tmp/file.bin', command_template='scanner --scan {path}', timeout_seconds=2)


def test_validate_scan_command_checks_path_resolution(monkeypatch):
    monkeypatch.setattr(
        av_scan.shutil,
        'which',
        lambda executable: 'C:/tools/scanner.exe' if executable == 'scanner' else None,
    )
    command = av_scan.validate_scan_command('scanner --scan {path}')
    assert command[0] == 'scanner'

    monkeypatch.setattr(av_scan.shutil, 'which', lambda executable: None)
    with pytest.raises(AVScanError, match='not found in PATH'):
        av_scan.validate_scan_command('missing-scanner --scan {path}')


def test_validate_scan_command_uses_first_available_from_chain(monkeypatch):
    monkeypatch.setattr(
        av_scan.shutil,
        'which',
        lambda executable: 'C:/tools/clamscan.exe' if executable == 'clamscan' else None,
    )
    command = av_scan.validate_scan_command(
        'clamdscan --fdpass {path} || clamscan --no-summary --infected --stdout {path}'
    )
    assert command[0] == 'clamscan'


def test_scan_file_falls_back_to_next_command_when_first_unavailable(monkeypatch):
    calls = {'count': 0}

    def _fake_run(command, **kwargs):
        calls['count'] += 1
        if command[0] == 'clamdscan':
            raise OSError('No such file or directory')
        return SimpleNamespace(returncode=0, stdout='Everything ok', stderr='')

    monkeypatch.setattr(av_scan.subprocess, 'run', _fake_run)
    result = av_scan.scan_file(
        '/tmp/file.bin',
        command_template='clamdscan --fdpass {path} || clamscan --no-summary --infected --stdout {path}',
        timeout_seconds=3,
    )
    assert result.infected is False
    assert calls['count'] == 2
