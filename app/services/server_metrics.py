from __future__ import annotations

import ctypes
import os
import platform
import shutil
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_PROCESS_STARTED_MONOTONIC = time.monotonic()
_CPU_SAMPLE_LOCK = threading.Lock()
_PREVIOUS_CPU_SAMPLE: tuple[int, int] | None = None


def _utc_iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def _bounded_percent(value: float | None) -> float | None:
    if value is None:
        return None
    return round(max(0.0, min(100.0, float(value))), 1)


def _percent(used: int | None, total: int | None) -> float | None:
    if used is None or total is None or total <= 0:
        return None
    return _bounded_percent((float(used) / float(total)) * 100.0)


def _read_linux_cpu_totals() -> tuple[int, int] | None:
    try:
        with open('/proc/stat', 'r', encoding='utf-8') as file:
            first_line = file.readline()
    except OSError:
        return None
    parts = first_line.split()
    if len(parts) < 5 or parts[0] != 'cpu':
        return None
    try:
        values = [int(part) for part in parts[1:]]
    except ValueError:
        return None
    idle = values[3] + (values[4] if len(values) > 4 else 0)
    total = sum(values)
    return idle, total


def _cpu_usage_percent() -> float | None:
    global _PREVIOUS_CPU_SAMPLE

    current = _read_linux_cpu_totals()
    if current is None:
        return None

    with _CPU_SAMPLE_LOCK:
        previous = _PREVIOUS_CPU_SAMPLE
        _PREVIOUS_CPU_SAMPLE = current

    if previous is None:
        return None

    idle_delta = current[0] - previous[0]
    total_delta = current[1] - previous[1]
    if total_delta <= 0:
        return None
    busy_ratio = 1.0 - (float(idle_delta) / float(total_delta))
    return _bounded_percent(busy_ratio * 100.0)


def _load_average(cpu_count: int) -> dict[str, float | None]:
    try:
        load_1m, load_5m, load_15m = os.getloadavg()
    except (AttributeError, OSError):
        return {
            'load_average_1m': None,
            'load_average_5m': None,
            'load_average_15m': None,
            'load_percent_1m': None,
        }

    load_percent = None
    if cpu_count > 0:
        load_percent = _bounded_percent((float(load_1m) / float(cpu_count)) * 100.0)
    return {
        'load_average_1m': round(float(load_1m), 2),
        'load_average_5m': round(float(load_5m), 2),
        'load_average_15m': round(float(load_15m), 2),
        'load_percent_1m': load_percent,
    }


def _linux_memory() -> dict[str, int | float | None] | None:
    try:
        with open('/proc/meminfo', 'r', encoding='utf-8') as file:
            lines = file.readlines()
    except OSError:
        return None

    values: dict[str, int] = {}
    for line in lines:
        key, _, rest = line.partition(':')
        parts = rest.strip().split()
        if not key or not parts:
            continue
        try:
            values[key] = int(parts[0]) * 1024
        except ValueError:
            continue

    total = values.get('MemTotal')
    available = values.get('MemAvailable')
    if available is None:
        available = (
            values.get('MemFree', 0)
            + values.get('Buffers', 0)
            + values.get('Cached', 0)
        )
    used = total - available if total is not None and available is not None else None
    return {
        'total_bytes': total,
        'available_bytes': available,
        'used_bytes': used,
        'used_percent': _percent(used, total),
    }


def _windows_memory() -> dict[str, int | float | None] | None:
    if os.name != 'nt':
        return None

    class MemoryStatusEx(ctypes.Structure):
        _fields_ = [
            ('dwLength', ctypes.c_ulong),
            ('dwMemoryLoad', ctypes.c_ulong),
            ('ullTotalPhys', ctypes.c_ulonglong),
            ('ullAvailPhys', ctypes.c_ulonglong),
            ('ullTotalPageFile', ctypes.c_ulonglong),
            ('ullAvailPageFile', ctypes.c_ulonglong),
            ('ullTotalVirtual', ctypes.c_ulonglong),
            ('ullAvailVirtual', ctypes.c_ulonglong),
            ('ullAvailExtendedVirtual', ctypes.c_ulonglong),
        ]

    status = MemoryStatusEx()
    status.dwLength = ctypes.sizeof(MemoryStatusEx)
    try:
        ok = ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status))
    except (AttributeError, OSError):
        return None
    if not ok:
        return None
    total = int(status.ullTotalPhys)
    available = int(status.ullAvailPhys)
    used = total - available
    return {
        'total_bytes': total,
        'available_bytes': available,
        'used_bytes': used,
        'used_percent': _bounded_percent(float(status.dwMemoryLoad)),
    }


def _memory() -> dict[str, int | float | None]:
    return _linux_memory() or _windows_memory() or {
        'total_bytes': None,
        'available_bytes': None,
        'used_bytes': None,
        'used_percent': None,
    }


def _disk(path: str | os.PathLike[str] | None) -> dict[str, int | float | str | None]:
    resolved = Path(path or Path.cwd()).resolve()
    usage = shutil.disk_usage(resolved)
    return {
        'path': str(resolved),
        'total_bytes': int(usage.total),
        'used_bytes': int(usage.used),
        'free_bytes': int(usage.free),
        'used_percent': _percent(int(usage.used), int(usage.total)),
    }


def _linux_process_rss_bytes() -> int | None:
    try:
        with open('/proc/self/statm', 'r', encoding='utf-8') as file:
            parts = file.readline().split()
    except OSError:
        return None
    if len(parts) < 2:
        return None
    try:
        resident_pages = int(parts[1])
        page_size = int(os.sysconf('SC_PAGE_SIZE'))
    except (OSError, ValueError):
        return None
    return resident_pages * page_size


def _process_rss_bytes() -> int | None:
    return _linux_process_rss_bytes()


def collect_server_metrics(*, disk_path: str | os.PathLike[str] | None = None) -> dict[str, Any]:
    cpu_count = int(os.cpu_count() or 0)
    load_average = _load_average(cpu_count)
    usage_percent = _cpu_usage_percent()
    process_uptime_seconds = max(0.0, time.monotonic() - _PROCESS_STARTED_MONOTONIC)

    return {
        'collected_at': _utc_iso_now(),
        'platform': {
            'system': platform.system(),
            'release': platform.release(),
            'python_version': platform.python_version(),
        },
        'cpu': {
            'logical_count': cpu_count,
            'usage_percent': usage_percent,
            **load_average,
        },
        'memory': _memory(),
        'disk': _disk(disk_path),
        'process': {
            'pid': os.getpid(),
            'uptime_seconds': round(process_uptime_seconds, 1),
            'rss_bytes': _process_rss_bytes(),
            'python_threads': threading.active_count(),
        },
    }
