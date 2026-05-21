from pathlib import Path
import subprocess


def _run_socket_client_harness(harness_body: str) -> subprocess.CompletedProcess[str]:
    module_path = Path(__file__).resolve().parents[1] / 'static' / 'modules' / 'chat-socket-client.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

let source = await readFile({str(module_path)!r}, 'utf8');
source = source.replace(
  "import {{ getCsrfToken }} from './csrf.js';",
  "const getCsrfToken = () => '';",
);
source = source.replace(
  "import {{ withAppRoot }} from './app-url.js';",
  "const withAppRoot = (path) => path;",
);
source = source.replace(
  "import {{ normalizePositiveChatPts }} from './chat-pts.js';",
  "const normalizePositiveChatPts = (value) => {{ const numeric = Number(value); if (!Number.isFinite(numeric)) return null; const normalized = Math.floor(numeric); return normalized > 0 ? normalized : null; }};",
);
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64');
const moduleApi = await import(moduleUrl);

{harness_body}
"""
    return subprocess.run(
        ['node', '--input-type=module', '-e', node_harness],
        capture_output=True,
        text=True,
        check=False,
    )


def test_enveloped_event_reaches_all_same_event_listeners_once():
    harness_body = """
const rawHandlers = new Map();
const fakeSocket = {
  connected: true,
  on(eventName, handler) {
    if (!rawHandlers.has(eventName)) rawHandlers.set(eventName, []);
    rawHandlers.get(eventName).push(handler);
    return this;
  },
  off() { return this; },
  emit() {},
};
globalThis.io = () => fakeSocket;

const socket = moduleApi.createChatSocketClient({ path: '/socket.io', transports: ['polling'] });
const calls = [];
socket.on('message_sent', () => calls.push('outbox'));
socket.on('message_sent', () => calls.push('status'));

const payload = {
  id: 1,
  chat_id: 'chat-1',
  client_id: 'client-1',
  event_id: 'event-1',
  event_type: 'message_sent',
  server_ts: '2026-05-12T00:00:00.000Z',
  chat_pts: 1,
};

for (const handler of rawHandlers.get('message_sent')) {
  handler(payload);
}
await new Promise((resolve) => setTimeout(resolve, 0));

if (calls.join(',') !== 'outbox,status') {
  throw new Error(`Expected both listeners, got ${calls.join(',')}`);
}

const duplicatePayload = { ...payload };
for (const handler of rawHandlers.get('message_sent')) {
  handler(duplicatePayload);
}
await new Promise((resolve) => setTimeout(resolve, 0));

if (calls.join(',') !== 'outbox,status') {
  throw new Error(`Duplicate event should stay deduped, got ${calls.join(',')}`);
}
"""
    result = _run_socket_client_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout
