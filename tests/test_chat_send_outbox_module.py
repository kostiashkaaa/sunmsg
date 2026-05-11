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


def test_text_send_marks_queued_outbox_message_failed_without_pending_timeout():
    module_path = ROOT / 'static' / 'modules' / 'chat-text-send.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

const source = await readFile({str(module_path)!r}, 'utf8');
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64');
const {{ sendTextMessageFlow }} = await import(moduleUrl);
const calls = [];

Object.defineProperty(globalThis, 'crypto', {{ value: {{ randomUUID: () => 'client-1' }}, configurable: true }});
Object.defineProperty(globalThis, 'window', {{ value: {{ matchMedia: () => ({{ matches: false }}) }}, configurable: true }});
Object.defineProperty(globalThis, 'requestAnimationFrame', {{ value: (cb) => cb(), configurable: true }});

await sendTextMessageFlow({{
  message: 'hello',
  isChatBlocked: () => false,
  getBlockedNoticeText: () => '',
  currentBlockState: null,
  showToast: (...args) => calls.push(['toast', ...args]),
  setSendingState: (value) => calls.push(['sending', value]),
  encryptForCurrentChat: async (message) => `enc:${{message}}`,
  getReplyState: () => ({{}}),
  cancelReply: () => calls.push(['cancelReply']),
  emitSocket: () => false,
  currentChatId: 'chat-1',
  appendMessage: () => calls.push(['append']),
  setKeepChatPinnedToBottom: () => {{}},
  updateActiveContactLastMessage: () => {{}},
  schedulePendingTimeout: () => calls.push(['timeout']),
  clearComposerInput: () => {{}},
  resizeComposerInput: () => {{}},
  restoreComposerFocus: () => {{}},
  prewarmMessageLinkPreview: () => {{}},
  enqueueOutbox: async () => true,
  failPendingMessage: (clientId) => calls.push(['fail', clientId]),
}});

if (!calls.some((call) => call[0] === 'fail' && call[1] === 'client-1')) {{
  throw new Error(`Expected queued message to be marked failed: ${{JSON.stringify(calls)}}`);
}}
if (calls.some((call) => call[0] === 'timeout')) {{
  throw new Error(`Queued offline message should not keep pending timeout: ${{JSON.stringify(calls)}}`);
}}
if (!calls.some((call) => call[0] === 'toast' && call[2] === 'warning')) {{
  throw new Error(`Expected offline warning toast: ${{JSON.stringify(calls)}}`);
}}
"""
    result = _run_node_harness(node_harness)
    assert result.returncode == 0, result.stderr or result.stdout


def test_file_send_marks_queued_outbox_message_failed_without_pending_timeout():
    module_path = ROOT / 'static' / 'modules' / 'chat-file-send.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

let source = await readFile({str(module_path)!r}, 'utf8');
source = source.replace(
  /import \\{{[\\s\\S]*?\\}} from '\\.\\/chat-media-upload\\.js';/,
  `const detectFileCategory = () => 'file';
const getMessageTypeByCategory = () => 'file';
const optimizeFileForAttachMode = async (file) => ({{ file }});
const uploadChatMedia = async (file) => ({{ name: file.name, mime: file.type, url: '/media/test.txt', size: file.size }});
const isUploadAbortedError = () => false;
const probeAudioDurationSeconds = async () => null;
const buildAudioWaveformPeaks = async () => null;
const probeVisualMediaMetadata = async () => null;`,
);
source = source.replace(
  "import {{ createTypingSignalHeartbeat }} from './chat-typing-signal-heartbeat.js';",
  "const createTypingSignalHeartbeat = () => ({{ start() {{}}, stopAll() {{}} }});",
);
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64');
const {{ sendFileMessageFlow }} = await import(moduleUrl);
const calls = [];

Object.defineProperty(globalThis, 'crypto', {{ value: {{ randomUUID: () => 'client-file-1' }}, configurable: true }});
Object.defineProperty(globalThis, 'URL', {{
  value: {{ createObjectURL: () => 'blob:preview', revokeObjectURL: () => {{}} }},
  configurable: true,
}});
Object.defineProperty(globalThis, 'window', {{ value: {{ setTimeout: () => 0 }}, configurable: true }});

await sendFileMessageFlow({{
  file: {{ name: 'test.txt', type: 'text/plain', size: 5 }},
  caption: '',
  options: {{}},
  isChatBlocked: () => false,
  getBlockedNoticeText: () => '',
  currentBlockState: null,
  showToast: (...args) => calls.push(['toast', ...args]),
  maxChatMediaSize: 1024,
  currentChatId: 'chat-1',
  getCsrfToken: () => 'csrf',
  setSendingState: (value) => calls.push(['sending', value]),
  getReplyState: () => ({{}}),
  cancelReply: () => calls.push(['cancelReply']),
  encryptForCurrentChat: async (message) => `enc:${{message}}`,
  isRealtimeConnected: () => true,
  emitSocket: () => false,
  appendMessage: () => calls.push(['append']),
  setKeepChatPinnedToBottom: () => {{}},
  updateActiveContactLastMessage: () => {{}},
  schedulePendingTimeout: () => calls.push(['timeout']),
  updatePendingFileUploadProgress: () => {{}},
  commitPendingFileUpload: () => calls.push(['commitUpload']),
  failPendingMessage: (clientId) => calls.push(['fail', clientId]),
  setActiveComposerUpload: () => {{}},
  updateActiveComposerUploadProgress: () => {{}},
  clearActiveComposerUpload: () => {{}},
  enqueueOutbox: async () => true,
}});

if (!calls.some((call) => call[0] === 'fail' && call[1] === 'client-file-1')) {{
  throw new Error(`Expected queued file message to be marked failed: ${{JSON.stringify(calls)}}`);
}}
if (calls.some((call) => call[0] === 'timeout')) {{
  throw new Error(`Queued offline file should not keep pending timeout: ${{JSON.stringify(calls)}}`);
}}
if (!calls.some((call) => call[0] === 'toast' && call[2] === 'warning')) {{
  throw new Error(`Expected offline warning toast: ${{JSON.stringify(calls)}}`);
}}
"""
    result = _run_node_harness(node_harness)
    assert result.returncode == 0, result.stderr or result.stdout
