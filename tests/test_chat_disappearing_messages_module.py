import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _run_node_harness(source: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ['node', '--input-type=module', '-e', source],
        cwd=ROOT,
        text=True,
        capture_output=True,
        timeout=10,
        check=False,
    )


def test_disappearing_timer_labels_and_visible_copy():
    module_path = (ROOT / 'static' / 'modules' / 'chat-disappearing-messages.js').as_posix()
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

const source = await readFile('{module_path}', 'utf8');
const mod = await import(`data:text/javascript;charset=utf-8,${{encodeURIComponent(source)}}`);

const checks = [
  [mod.formatTimerLabel(0), 'Выкл.'],
  [mod.formatTimerLabel(86400), '24 часа'],
  [mod.formatTimerSummary(0), 'Новые сообщения остаются в чате.'],
  [mod.formatTimerSummary(3600), 'Новые сообщения удаляются через 1 час после отправки.'],
  [mod.formatTimerPillText(300), 'Исчезающие сообщения: 5 мин'],
  [mod.formatTimerPillText(0), ''],
];

for (const [actual, expected] of checks) {{
  if (actual !== expected) {{
    throw new Error(`Expected "${{expected}}", got "${{actual}}"`);
  }}
}}
"""
    result = _run_node_harness(node_harness)
    assert result.returncode == 0, result.stderr
