from __future__ import annotations

import logging
import os
import shlex
import shutil
import subprocess
from dataclasses import dataclass

logger = logging.getLogger(__name__)


class AVScanError(RuntimeError):
    """Raised when antivirus scanning cannot complete reliably."""


@dataclass(frozen=True)
class AVScanResult:
    infected: bool
    signature: str
    output: str


def _build_scan_command(command_template: str, file_path: str) -> list[str]:
    template = str(command_template or '').strip()
    if not template:
        raise AVScanError('CHAT_MEDIA_AV_COMMAND is empty.')

    command = shlex.split(template, posix=os.name != 'nt')
    if not command:
        raise AVScanError('CHAT_MEDIA_AV_COMMAND cannot be parsed.')

    has_placeholder = False
    resolved: list[str] = []
    for part in command:
        if '{path}' in part:
            resolved.append(part.replace('{path}', file_path))
            has_placeholder = True
        else:
            resolved.append(part)
    if not has_placeholder:
        resolved.append(file_path)
    return resolved


def _extract_signature(scan_output: str) -> str:
    for raw_line in str(scan_output or '').splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if not line.upper().endswith('FOUND'):
            continue
        signature_part = line.rsplit(':', 1)[-1].strip()
        if signature_part.upper().endswith('FOUND'):
            signature_part = signature_part[:-5].strip()
        return signature_part or 'malware-detected'
    return 'malware-detected'


def validate_scan_command(command_template: str) -> list[str]:
    """Validate scanner command syntax and executable availability."""
    command = _build_scan_command(command_template, os.devnull)
    executable = str(command[0] or '').strip()
    if not executable:
        raise AVScanError('Antivirus scanner executable is not configured.')

    if os.path.isabs(executable):
        if not os.path.exists(executable):
            raise AVScanError(f'Antivirus scanner executable not found: {executable}')
        return command

    resolved = shutil.which(executable)
    if not resolved:
        raise AVScanError(f'Antivirus scanner executable not found in PATH: {executable}')
    return command


def scan_file(
    file_path: str,
    *,
    command_template: str,
    timeout_seconds: int = 20,
) -> AVScanResult:
    command = _build_scan_command(command_template, file_path)
    timeout = max(1, int(timeout_seconds or 1))

    try:
        completed = subprocess.run(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding='utf-8',
            errors='replace',
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise AVScanError(f'Antivirus scan timed out after {timeout}s.') from exc
    except OSError as exc:
        raise AVScanError(f'Failed to execute antivirus scanner: {exc}') from exc

    output_parts = []
    if completed.stdout:
        output_parts.append(str(completed.stdout).strip())
    if completed.stderr:
        output_parts.append(str(completed.stderr).strip())
    output = '\n'.join(part for part in output_parts if part)

    if completed.returncode == 0:
        return AVScanResult(infected=False, signature='', output=output)

    if completed.returncode == 1:
        signature = _extract_signature(output)
        return AVScanResult(infected=True, signature=signature, output=output)

    raise AVScanError(
        f'Antivirus scanner failed with exit code {completed.returncode}.'
    )
