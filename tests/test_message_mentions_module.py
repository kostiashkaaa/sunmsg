from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def test_message_mentions_normalizes_deduplicates_and_limits_usernames():
    module_path = ROOT / 'static' / 'modules' / 'message-mentions.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

const source = await readFile({str(module_path)!r}, 'utf8');
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64');
const moduleApi = await import(moduleUrl);

const mentions = moduleApi.extractMentionedUsernames(
  '@Alice hello (@bob) @alice @bad! @carol-name @d.e_f',
);
if (JSON.stringify(mentions) !== JSON.stringify(['alice', 'bob', 'bad', 'carol-name', 'd.e_f'])) {{
  throw new Error(`unexpected mentions: ${{JSON.stringify(mentions)}}`);
}}

const limited = moduleApi.extractMentionedUsernames('@a @b @c', {{ maxMentions: 2 }});
if (JSON.stringify(limited) !== JSON.stringify(['a', 'b'])) {{
  throw new Error(`unexpected limited mentions: ${{JSON.stringify(limited)}}`);
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
