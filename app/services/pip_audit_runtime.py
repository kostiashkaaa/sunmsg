from __future__ import annotations

import subprocess
from pathlib import Path


def run_pip_audit(
    requirements_files: list[str] | None = None,
    *,
    strict: bool = True,
) -> dict:
    project_root = Path(__file__).resolve().parents[2]
    selected_files = requirements_files or ['requirements.txt']

    args = ['pip-audit', '--format', 'json']
    if strict:
        args.append('--strict')

    missing_files: list[str] = []
    for item in selected_files:
        req_path = (project_root / str(item)).resolve()
        try:
            req_path.relative_to(project_root.resolve())
        except ValueError:
            missing_files.append(str(item))
            continue
        if not req_path.exists():
            missing_files.append(str(item))
            continue
        args.extend(['-r', str(req_path)])

    if missing_files:
        return {
            'status': 'failed',
            'exit_code': 2,
            'error': f"Missing requirements files: {', '.join(missing_files)}",
            'command': args,
        }

    result = subprocess.run(
        args,
        capture_output=True,
        text=True,
        check=False,
        cwd=str(project_root),
    )

    return {
        'status': 'ok' if result.returncode == 0 else 'failed',
        'exit_code': int(result.returncode),
        'command': args,
        'stdout': result.stdout,
        'stderr': result.stderr,
    }
