from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def _run_node_harness(source: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ['node', '--input-type=module', '-e', source],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


def test_incoming_notification_plays_sound_before_visible_alerts():
    module_path = ROOT / 'static' / 'modules' / 'chat-incoming-notifications.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

const source = await readFile({str(module_path)!r}, 'utf8');
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64');
const {{ notifyIncomingChatMessage }} = await import(moduleUrl);
const calls = [];

notifyIncomingChatMessage({{
  chatId: 'chat-1',
  isChatMuted: () => false,
  isWindowActive: () => true,
  playIncomingMessageSound: () => calls.push('sound'),
  pushTabAlert: () => calls.push('tab'),
  showToast: () => calls.push('toast'),
}});

if (calls.join(',') !== 'sound,tab,toast') {{
  throw new Error(`Expected sound before visible alerts: ${{JSON.stringify(calls)}}`);
}}
"""
    result = _run_node_harness(node_harness)
    assert result.returncode == 0, result.stderr or result.stdout


def test_muted_incoming_notification_does_not_play_sound():
    module_path = ROOT / 'static' / 'modules' / 'chat-incoming-notifications.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

const source = await readFile({str(module_path)!r}, 'utf8');
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64');
const {{ notifyIncomingChatMessage }} = await import(moduleUrl);
const calls = [];

notifyIncomingChatMessage({{
  chatId: 'chat-1',
  isMention: true,
  isChatMuted: () => true,
  isWindowActive: () => true,
  allowMentionWhenMuted: true,
  playIncomingMessageSound: () => calls.push('sound'),
  pushTabAlert: () => calls.push('tab'),
  showToast: () => calls.push('toast'),
}});

if (calls.includes('sound')) {{
  throw new Error(`Muted notification must stay silent: ${{JSON.stringify(calls)}}`);
}}
if (calls.join(',') !== 'tab,toast') {{
  throw new Error(`Muted mention should keep existing visible alerts: ${{JSON.stringify(calls)}}`);
}}
"""
    result = _run_node_harness(node_harness)
    assert result.returncode == 0, result.stderr or result.stdout
