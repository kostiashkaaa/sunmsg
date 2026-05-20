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
const patchedSource = source.replace(
  "import {{ generateRequestId }} from './utils.js';",
  "const generateRequestId = () => crypto.randomUUID();",
);
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(patchedSource, 'utf8').toString('base64');
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


def test_text_send_settles_composer_before_optimistic_append():
    module_path = ROOT / 'static' / 'modules' / 'chat-text-send.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

const source = await readFile({str(module_path)!r}, 'utf8');
const patchedSource = source.replace(
  "import {{ generateRequestId }} from './utils.js';",
  "const generateRequestId = () => crypto.randomUUID();",
);
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(patchedSource, 'utf8').toString('base64');
const {{ sendTextMessageFlow }} = await import(moduleUrl);
const calls = [];

Object.defineProperty(globalThis, 'crypto', {{ value: {{ randomUUID: () => 'client-1' }}, configurable: true }});
Object.defineProperty(globalThis, 'window', {{ value: {{ matchMedia: () => ({{ matches: true }}) }}, configurable: true }});
Object.defineProperty(globalThis, 'requestAnimationFrame', {{
  value: () => {{ throw new Error('composer resize must be synchronous in the send frame'); }},
  configurable: true,
}});

await sendTextMessageFlow({{
  message: 'https://example.com',
  isChatBlocked: () => false,
  getBlockedNoticeText: () => '',
  currentBlockState: null,
  showToast: (...args) => calls.push(['toast', ...args]),
  setSendingState: (value) => calls.push(['sending', value]),
  encryptForCurrentChat: async (message) => `enc:${{message}}`,
  getReplyState: () => ({{}}),
  cancelReply: () => calls.push(['cancelReply']),
  emitSocket: () => true,
  currentChatId: 'chat-1',
  appendMessage: () => calls.push(['append']),
  setKeepChatPinnedToBottom: (value) => calls.push(['pin', value]),
  updateActiveContactLastMessage: () => calls.push(['lastMessage']),
  schedulePendingTimeout: () => calls.push(['timeout']),
  clearComposerInput: () => calls.push(['clear']),
  resizeComposerInput: () => calls.push(['resize']),
  restoreComposerFocus: () => calls.push(['focus']),
  prewarmMessageLinkPreview: () => calls.push(['prewarm']),
  enqueueOutbox: async () => true,
  failPendingMessage: (clientId) => calls.push(['fail', clientId]),
}});

const order = calls.map((call) => call[0]);
const pinAt = order.indexOf('pin');
const clearAt = order.indexOf('clear');
const resizeAt = order.indexOf('resize');
const appendAt = order.indexOf('append');
if (!(pinAt > -1 && pinAt < clearAt && clearAt < resizeAt && resizeAt < appendAt)) {{
  throw new Error(`Composer should settle before optimistic append: ${{JSON.stringify(calls)}}`);
}}
"""
    result = _run_node_harness(node_harness)
    assert result.returncode == 0, result.stderr or result.stdout


def test_file_send_uploads_and_queues_when_socket_is_disconnected():
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
  /import \\{{[\\s\\S]*?\\}} from '\\.\\/chat-media-e2ee\\.js';/,
  `const appendEncryptedMediaFragment = (url) => url;
const encryptChatMediaFile = async (file) => ({{ uploadFile: file, metadata: null }});`,
);
source = source.replace(
  "import {{ createTypingSignalHeartbeat }} from './chat-typing-signal-heartbeat.js';",
  "const createTypingSignalHeartbeat = () => ({{ start() {{}}, stopAll() {{}} }});",
);
source = source.replace(
  "import {{ generateRequestId }} from './utils.js';",
  "const generateRequestId = () => crypto.randomUUID();",
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
  isRealtimeConnected: () => false,
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


def test_file_send_keeps_mobile_composer_enabled_during_upload():
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
  /import \\{{[\\s\\S]*?\\}} from '\\.\\/chat-media-e2ee\\.js';/,
  `const appendEncryptedMediaFragment = (url) => url;
const encryptChatMediaFile = async (file) => ({{ uploadFile: file, metadata: null }});`,
);
source = source.replace(
  "import {{ createTypingSignalHeartbeat }} from './chat-typing-signal-heartbeat.js';",
  "const createTypingSignalHeartbeat = () => ({{ start() {{}}, stopAll() {{}} }});",
);
source = source.replace(
  "import {{ generateRequestId }} from './utils.js';",
  "const generateRequestId = () => crypto.randomUUID();",
);
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64');
const {{ sendFileMessageFlow }} = await import(moduleUrl);
const calls = [];

Object.defineProperty(globalThis, 'crypto', {{ value: {{ randomUUID: () => 'client-file-mobile' }}, configurable: true }});
Object.defineProperty(globalThis, 'URL', {{
  value: {{ createObjectURL: () => 'blob:preview', revokeObjectURL: () => {{}} }},
  configurable: true,
}});
Object.defineProperty(globalThis, 'window', {{
  value: {{
    matchMedia: () => ({{ matches: true }}),
    setTimeout: () => 0,
  }},
  configurable: true,
}});

await sendFileMessageFlow({{
  file: {{ name: 'mobile.txt', type: 'text/plain', size: 5 }},
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
  emitSocket: () => true,
  appendMessage: () => calls.push(['append']),
  setKeepChatPinnedToBottom: () => {{}},
  updateActiveContactLastMessage: () => {{}},
  schedulePendingTimeout: () => calls.push(['timeout']),
  updatePendingFileUploadProgress: () => {{}},
  commitPendingFileUpload: () => calls.push(['commitUpload']),
  failPendingMessage: (clientId) => calls.push(['fail', clientId]),
  setActiveComposerUpload: () => calls.push(['activeUpload']),
  updateActiveComposerUploadProgress: () => {{}},
  clearActiveComposerUpload: () => calls.push(['clearUpload']),
  enqueueOutbox: async () => true,
}});

if (calls.some((call) => call[0] === 'sending')) {{
  throw new Error(`Mobile file send must not disable composer: ${{JSON.stringify(calls)}}`);
}}
if (!calls.some((call) => call[0] === 'append')) {{
  throw new Error(`Expected optimistic append: ${{JSON.stringify(calls)}}`);
}}
"""
    result = _run_node_harness(node_harness)
    assert result.returncode == 0, result.stderr or result.stdout


def test_file_send_rejects_oversized_files_before_client_side_optimization():
    module_path = ROOT / 'static' / 'modules' / 'chat-file-send.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

let source = await readFile({str(module_path)!r}, 'utf8');
source = source.replace(
  /import \\{{[\\s\\S]*?\\}} from '\\.\\/chat-media-upload\\.js';/,
  `const detectFileCategory = () => 'image';
const getMessageTypeByCategory = () => 'photo';
let optimizeCalls = 0;
const optimizeFileForAttachMode = async () => {{ optimizeCalls += 1; throw new Error('optimize should not run'); }};
const uploadChatMedia = async () => {{}};
const isUploadAbortedError = () => false;
const probeAudioDurationSeconds = async () => null;
const buildAudioWaveformPeaks = async () => null;
const probeVisualMediaMetadata = async () => null;
globalThis.__optimizeCalls = () => optimizeCalls;`,
);
source = source.replace(
  /import \\{{[\\s\\S]*?\\}} from '\\.\\/chat-media-e2ee\\.js';/,
  `const appendEncryptedMediaFragment = (url) => url;
const encryptChatMediaFile = async (file) => ({{ uploadFile: file, metadata: null }});`,
);
source = source.replace(
  "import {{ createTypingSignalHeartbeat }} from './chat-typing-signal-heartbeat.js';",
  "const createTypingSignalHeartbeat = () => ({{ start() {{}}, stopAll() {{}} }});",
);
source = source.replace(
  "import {{ generateRequestId }} from './utils.js';",
  "const generateRequestId = () => 'client-oversized';",
);
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64');
const {{ sendFileMessageFlow }} = await import(moduleUrl);

let rejected = false;
try {{
  await sendFileMessageFlow({{
    file: {{ name: 'huge.jpg', type: 'image/jpeg', size: 2048 }},
    options: {{ attachMode: 'media' }},
    isChatBlocked: () => false,
    getBlockedNoticeText: () => '',
    currentBlockState: null,
    showToast: () => {{}},
    maxChatMediaSize: 1024,
  }});
}} catch (error) {{
  rejected = /Максимум|\\u041C\\u0430\\u043A\\u0441\\u0438\\u043C\\u0443\\u043C/.test(error.message);
}}

if (!rejected) {{
  throw new Error('Expected oversized file to be rejected');
}}
if (globalThis.__optimizeCalls() !== 0) {{
  throw new Error(`Oversized file must not enter optimization; calls=${{globalThis.__optimizeCalls()}}`);
}}
"""
    result = _run_node_harness(node_harness)
    assert result.returncode == 0, result.stderr or result.stdout


def test_link_preview_scroll_stabilization_skips_detached_nodes():
    module_path = ROOT / 'static' / 'modules' / 'message-link-preview.js'
    source = module_path.read_text(encoding='utf-8')

    assert 'if (!referenceNode.isConnected) return null;' in source
