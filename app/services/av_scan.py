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


def _split_command_templates(command_template: str) -> list[str]:
    raw = str(command_template or '').strip()
    if not raw:
        raise AVScanError('CHAT_MEDIA_AV_COMMAND is empty.')
    parts = [part.strip() for part in raw.split('||') if part.strip()]
    if not parts:
        raise AVScanError('CHAT_MEDIA_AV_COMMAND cannot be parsed.')
    return parts


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


def _build_scan_commands(command_template: str, file_path: str) -> list[list[str]]:
    commands: list[list[str]] = []
    for template in _split_command_templates(command_template):
        commands.append(_build_scan_command(template, file_path))
    return commands


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
    """Validate scanner command syntax and executable availability.

    Supports fallback chains split by ``||`` and returns the first
    resolvable command.
    """
    commands = _build_scan_commands(command_template, os.devnull)
    unavailable: list[str] = []

    for command in commands:
        executable = str(command[0] or '').strip()
        if not executable:
            unavailable.append('empty executable')
            continue

        if os.path.isabs(executable):
            if os.path.exists(executable):
                return command
            unavailable.append(f'not found: {executable}')
            continue

        resolved = shutil.which(executable)
        if resolved:
            return command
        unavailable.append(f'not found in PATH: {executable}')

    details = '; '.join(unavailable) if unavailable else 'no usable scanner commands'
    raise AVScanError(f'Antivirus scanner executable not found ({details}).')


def scan_file(
    file_path: str,
    *,
    command_template: str,
    timeout_seconds: int = 20,
) -> AVScanResult:
    commands = _build_scan_commands(command_template, file_path)
    timeout = max(1, int(timeout_seconds or 1))
    errors: list[str] = []

    for command in commands:
        executable = str(command[0] or '').strip() or '<unknown>'
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
        except subprocess.TimeoutExpired:
            errors.append(f'{executable}: timed out after {timeout}s')
            continue
        except OSError as exc:
            errors.append(f'{executable}: failed to execute ({exc})')
            continue

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

        errors.append(f'{executable}: exit code {completed.returncode}')

    if errors:
        raise AVScanError(f'Antivirus scanner failed ({"; ".join(errors)}).')
    raise AVScanError('Antivirus scanner failed: no scanner commands configured.')
