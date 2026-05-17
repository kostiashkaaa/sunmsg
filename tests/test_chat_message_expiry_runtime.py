from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def test_chat_message_expiry_runtime_expires_current_chat_messages():
    module_path = (ROOT / 'static' / 'modules' / 'chat-message-expiry-runtime.js').as_posix()
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

const source = await readFile('{module_path}', 'utf8');
const mod = await import(`data:text/javascript;charset=utf-8,${{encodeURIComponent(source)}}`);

const expired = [];
const timers = [];
const runtime = mod.createChatMessageExpiryRuntime({{
  getCurrentChatId: () => 'chat-1',
  getChatState: () => ({{
    messages: [
      {{ id: 10, expires_at: 99 }},
      {{ id: 11, expires_at: 100 }},
      {{ id: 12, expires_at: 110 }},
      {{ id: 13, expires_at: null }},
    ],
  }}),
  expireMessages: (chatId, ids) => expired.push([chatId, ids]),
  nowMs: () => 100000,
  setTimeoutFn: (handler, delay) => {{ timers.push(delay); return 1; }},
  clearTimeoutFn: () => {{}},
}});

runtime.scheduleCurrentChatExpiry();

if (JSON.stringify(expired) !== JSON.stringify([['chat-1', [10, 11]]])) {{
  throw new Error(`Unexpected expired payload: ${{JSON.stringify(expired)}}`);
}}
if (timers.length !== 0) {{
  throw new Error(`Runtime should not schedule next timer while expiring current messages: ${{timers}}`);
}}
"""
    result = subprocess.run(
        ['node', '--input-type=module', '-e', node_harness],
        cwd=ROOT,
        text=True,
        capture_output=True,
        timeout=10,
        check=False,
    )
    assert result.returncode == 0, result.stderr or result.stdout


def test_chat_message_expiry_runtime_schedules_next_expiry():
    module_path = (ROOT / 'static' / 'modules' / 'chat-message-expiry-runtime.js').as_posix()
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

const source = await readFile('{module_path}', 'utf8');
const mod = await import(`data:text/javascript;charset=utf-8,${{encodeURIComponent(source)}}`);

const expired = [];
const timers = [];
const runtime = mod.createChatMessageExpiryRuntime({{
  getCurrentChatId: () => 'chat-1',
  getChatState: () => ({{
    messages: [
      {{ id: 12, expires_at: 110 }},
      {{ id: 13, expires_at: 150 }},
    ],
  }}),
  expireMessages: (chatId, ids) => expired.push([chatId, ids]),
  nowMs: () => 100000,
  setTimeoutFn: (handler, delay) => {{ timers.push(delay); return 7; }},
  clearTimeoutFn: () => {{}},
}});

runtime.scheduleCurrentChatExpiry();

if (expired.length !== 0) {{
  throw new Error(`Messages should not expire yet: ${{JSON.stringify(expired)}}`);
}}
if (timers.length !== 1 || timers[0] !== 10050) {{
  throw new Error(`Expected next expiry in 10050ms, got ${{JSON.stringify(timers)}}`);
}}
"""
    result = subprocess.run(
        ['node', '--input-type=module', '-e', node_harness],
        cwd=ROOT,
        text=True,
        capture_output=True,
        timeout=10,
        check=False,
    )
    assert result.returncode == 0, result.stderr or result.stdout
