from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def test_chat_pts_normalizer_accepts_only_positive_integer_cursor_values():
    module_path = ROOT / 'static' / 'modules' / 'chat-pts.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

const source = await readFile({str(module_path)!r}, 'utf8');
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64');
const moduleApi = await import(moduleUrl);

const cases = [
  [undefined, null],
  [0, null],
  [-1, null],
  [1.9, 1],
  ['42', 42],
  ['x', null],
];

for (const [input, expected] of cases) {{
  const actual = moduleApi.normalizePositiveChatPts(input);
  if (actual !== expected) {{
    throw new Error(`expected ${{String(input)}} -> ${{expected}}, got ${{actual}}`);
  }}
}}
"""
    result = subprocess.run(
        ['node', '--input-type=module', '-e', node_harness],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr or result.stdout
