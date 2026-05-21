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


def test_history_decode_uses_sender_user_id_for_own_messages():
    module_path = ROOT / 'static' / 'modules' / 'chat-history-runtime.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

let source = await readFile({str(module_path)!r}, 'utf8');
source = source.replace(
  "import {{ withAppRoot }} from './app-url.js';",
  "const withAppRoot = (value) => value;",
);
source = source.replace(
  "import {{ normalizeMentionUserIds }} from './chat-mentions.js';",
  "const normalizeMentionUserIds = (value) => Array.isArray(value) ? value : [];",
);
source = source.replace(
  "import {{ normalizeGroupReaders }} from './chat-group-read-receipts.js';",
  "const normalizeGroupReaders = (value) => Array.isArray(value) ? value : [];",
);
source = source.replace(
  "import {{ insertUnreadDivider, removeUnreadDivider }} from './chat-skeleton-ui.js';",
  "const insertUnreadDivider = () => {{}}; const removeUnreadDivider = () => {{}};",
);
source = source.replace(
  "import {{ captureChatViewportAnchor }} from './chat-scroll-stability.js';",
  "const captureChatViewportAnchor = () => null;",
);
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64');
const {{ createChatHistoryRuntime }} = await import(moduleUrl);
const decryptCalls = [];
const encrypted = '{{"encrypted_message":"cipher","encrypted_key_receiver":"receiver","encrypted_key_sender":"sender","iv":"iv"}}';
const runtime = createChatHistoryRuntime({{
  getPrivateKeyPem: () => 'private-key',
  getCurrentUserPublicKey: () => 'pk-current',
  getCurrentUserId: () => '1',
  getCurrentPartnerData: () => ({{ display_name: 'Partner' }}),
  isEncryptedPayload: (value) => typeof value === 'string' && value.includes('encrypted_message'),
  decryptForDisplay: async (_privateKey, _payload, isSelf) => {{
    decryptCalls.push(isSelf);
    return isSelf ? 'self plaintext' : 'other plaintext';
  }},
  normalizeMessageReactions: (value) => value || [],
  enrichDecodedMessagesVisualMeta: async (messages) => messages,
  chatDecryptConcurrency: 2,
  chatDecryptWorkerTimeoutMs: 100,
  WorkerCtor: null,
}});

const decoded = await runtime.decodeChatMessages([{{
  id: 7,
  sender_user_id: 1,
  sender_public_key: 'pk-stale-format',
  message: encrypted,
  message_type: 'text',
  created_at: '2026-05-14T23:00:01Z',
  reactions: [],
}}]);

if (decryptCalls[0] !== true) {{
  throw new Error(`Expected history decrypt to use sender key path: ${{JSON.stringify(decryptCalls)}}`);
}}
if (decoded[0].sender !== 'self' || decoded[0].message !== 'self plaintext') {{
  throw new Error(`Expected own history message plaintext: ${{JSON.stringify(decoded[0])}}`);
}}
"""
    result = _run_node_harness(node_harness)
    assert result.returncode == 0, result.stderr or result.stdout


def test_empty_history_initializes_render_range_before_first_message():
    module_path = ROOT / 'static' / 'modules' / 'chat-history-runtime.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

let source = await readFile({str(module_path)!r}, 'utf8');
source = source.replace(
  "import {{ withAppRoot }} from './app-url.js';",
  "const withAppRoot = (value) => value;",
);
source = source.replace(
  "import {{ normalizeMentionUserIds }} from './chat-mentions.js';",
  "const normalizeMentionUserIds = (value) => Array.isArray(value) ? value : [];",
);
source = source.replace(
  "import {{ normalizeGroupReaders }} from './chat-group-read-receipts.js';",
  "const normalizeGroupReaders = (value) => Array.isArray(value) ? value : [];",
);
source = source.replace(
  "import {{ insertUnreadDivider, removeUnreadDivider }} from './chat-skeleton-ui.js';",
  "const insertUnreadDivider = () => {{}}; const removeUnreadDivider = () => {{}};",
);
source = source.replace(
  "import {{ captureChatViewportAnchor }} from './chat-scroll-stability.js';",
  "const captureChatViewportAnchor = () => null;",
);
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64');
const {{ createChatHistoryRuntime }} = await import(moduleUrl);

const state = {{
  initialized: false,
  isLoadingInitial: false,
  historyRequestToken: 0,
  messages: [],
  hasMoreBefore: true,
  savedScrollTop: 0,
  hasSavedScrollTop: false,
  lastRenderRange: null,
  renderedKeys: new Set(),
  blockState: {{}},
}};
const renderCalls = [];
const keepPinnedCalls = [];
const stageLoadingCalls = [];
const historyLoadingCalls = [];

const runtime = createChatHistoryRuntime({{
  chatHistoryPageSize: 50,
  chatHistoryMaxPageSize: 100,
  chatDecryptConcurrency: 2,
  chatDecryptWorkerTimeoutMs: 100,
  fetchImpl: async () => ({{
    ok: true,
    json: async () => ({{
      success: true,
      messages: [],
      has_more_before: false,
      pins: [],
      favorites: [],
      block_state: {{}},
    }}),
  }}),
  getChatState: () => state,
  getCurrentChatId: () => 'chat-empty',
  getPrivateKeyPem: () => 'private-key',
  getCurrentUserPublicKey: () => 'pk-current',
  getCurrentUserId: () => '1',
  getCurrentPartnerData: () => ({{ display_name: 'Partner' }}),
  isEncryptedPayload: () => false,
  decryptForDisplay: async (_privateKey, payload) => payload,
  normalizeMessageReactions: (value) => value || [],
  enrichDecodedMessagesVisualMeta: async (messages) => messages,
  ensureChatIdbReady: async () => false,
  isChatIdbReady: () => false,
  createHistoryAbortController: () => ({{ signal: undefined }}),
  releaseHistoryAbortController: () => {{}},
  historyInitialAbortControllers: new Map(),
  applyChatBlockState: () => {{}},
  resetOpenChatUnreadCounter: () => {{}},
  setChatStageLoading: (value) => stageLoadingCalls.push(value),
  setHistoryLoading: (value) => historyLoadingCalls.push(value),
  hidePinnedBar: () => {{}},
  hideFavoriteBar: () => {{}},
  setChatPinnedMessages: () => {{}},
  setChatFavoriteMessages: () => {{}},
  normalizePinnedMessages: () => [],
  normalizeFavoriteMessages: () => [],
  normalizeBlockState: (value) => value,
  resolveSavedChatScrollTop: () => NaN,
  getMessageKey: (msg) => `id:${{msg.id}}`,
  setChatMessages: () => {{
    throw new Error('Empty unchanged history should not reset messages');
  }},
  renderChatMessages: (chatId, options) => {{
    renderCalls.push({{ chatId, options }});
    state.lastRenderRange = {{ start: 0, end: 0 }};
  }},
  renderChatMessagesStable: async () => {{
    throw new Error('Empty unchanged history should use plain render');
  }},
  setKeepChatPinnedToBottom: (value) => keepPinnedCalls.push(value),
  resolveContactItemByChatId: () => null,
  isAbortError: () => false,
  showToast: (message) => {{
    throw new Error(`Unexpected toast: ${{message}}`);
  }},
}});

await runtime.fetchChatHistory('chat-empty');

if (renderCalls.length !== 1) {{
  throw new Error(`Expected one empty render, got ${{JSON.stringify(renderCalls)}}`);
}}
if (renderCalls[0].chatId !== 'chat-empty' || renderCalls[0].options.scrollToBottom !== true || renderCalls[0].options.force !== true) {{
  throw new Error(`Unexpected render call: ${{JSON.stringify(renderCalls[0])}}`);
}}
if (keepPinnedCalls.length !== 1 || keepPinnedCalls[0] !== true) {{
  throw new Error(`Expected bottom pin after empty render: ${{JSON.stringify(keepPinnedCalls)}}`);
}}
if (stageLoadingCalls[0] !== true || stageLoadingCalls[stageLoadingCalls.length - 1] !== false) {{
  throw new Error(`Expected stage loader around initial fetch: ${{JSON.stringify(stageLoadingCalls)}}`);
}}
if (historyLoadingCalls.includes(true)) {{
  throw new Error(`Initial fetch must not show older-history loader: ${{JSON.stringify(historyLoadingCalls)}}`);
}}
"""
    result = _run_node_harness(node_harness)
    assert result.returncode == 0, result.stderr or result.stdout


def test_initialized_history_restores_snapshot_without_visibility_rerender():
    module_path = ROOT / 'static' / 'modules' / 'chat-history-runtime.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

let source = await readFile({str(module_path)!r}, 'utf8');
source = source.replace(
  "import {{ withAppRoot }} from './app-url.js';",
  "const withAppRoot = (value) => value;",
);
source = source.replace(
  "import {{ normalizeMentionUserIds }} from './chat-mentions.js';",
  "const normalizeMentionUserIds = (value) => Array.isArray(value) ? value : [];",
);
source = source.replace(
  "import {{ normalizeGroupReaders }} from './chat-group-read-receipts.js';",
  "const normalizeGroupReaders = (value) => Array.isArray(value) ? value : [];",
);
source = source.replace(
  "import {{ insertUnreadDivider, removeUnreadDivider }} from './chat-skeleton-ui.js';",
  "const insertUnreadDivider = () => {{}}; const removeUnreadDivider = () => {{}};",
);
source = source.replace(
  "import {{ captureChatViewportAnchor }} from './chat-scroll-stability.js';",
  "const captureChatViewportAnchor = () => null;",
);
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64');
const {{ createChatHistoryRuntime }} = await import(moduleUrl);

const state = {{
  initialized: true,
  isLoadingInitial: false,
  historyRequestToken: 0,
  messages: [{{ id: 1, message: 'cached' }}],
  pins: [],
  favorites: [],
  blockState: {{}},
  activePinMessageId: null,
  activeFavoriteMessageId: null,
  lastRenderRange: {{ start: 0, end: 1 }},
  renderedKeys: new Set(['id:1']),
}};
const showCalls = [];
const restoreCalls = [];

const runtime = createChatHistoryRuntime({{
  chatHistoryPageSize: 50,
  chatHistoryMaxPageSize: 100,
  getChatState: () => state,
  getCurrentChatId: () => 'chat-ready',
  getPrivateKeyPem: () => 'private-key',
  getCurrentUserPublicKey: () => 'pk-current',
  isEncryptedPayload: () => false,
  decryptForDisplay: async (_privateKey, payload) => payload,
  normalizePinnedMessages: () => [],
  normalizeFavoriteMessages: () => [],
  hidePinnedBar: () => {{}},
  hideFavoriteBar: () => {{}},
  applyChatBlockState: () => {{}},
  resetOpenChatUnreadCounter: () => {{}},
  showChatContent: (show, options) => showCalls.push({{ show, options }}),
  setChatStageLoading: () => {{}},
  setHistoryLoading: () => {{}},
  restoreChatDomSnapshot: (chatId) => {{
    restoreCalls.push(chatId);
    return true;
  }},
  setKeepChatPinnedToBottom: () => {{}},
  isChatNearBottom: () => false,
  schedulePostRenderUiRefresh: () => {{}},
  renderChatMessages: () => {{
    throw new Error('Snapshot restore should not be preceded by a forced render');
  }},
  renderChatAtBottom: () => {{
    throw new Error('Snapshot restore should not fall through to bottom render');
  }},
  resolveSavedChatScrollTop: () => NaN,
  normalizeMessageReactions: (value) => value || [],
  enrichDecodedMessagesVisualMeta: async (messages) => messages,
}});

await runtime.fetchChatHistory('chat-ready');

if (showCalls.length !== 1 || showCalls[0].show !== true) {{
  throw new Error(`Expected one showChatContent call: ${{JSON.stringify(showCalls)}}`);
}}
if (showCalls[0].options?.renderInitializedChat !== false) {{
  throw new Error(`Initialized history must not trigger visibility rerender: ${{JSON.stringify(showCalls)}}`);
}}
if (restoreCalls.length !== 1 || restoreCalls[0] !== 'chat-ready') {{
  throw new Error(`Expected snapshot restore before render: ${{JSON.stringify(restoreCalls)}}`);
}}
"""
    result = _run_node_harness(node_harness)
    assert result.returncode == 0, result.stderr or result.stdout


def test_load_older_messages_anchors_current_viewport_after_async_fetch():
    module_path = ROOT / 'static' / 'modules' / 'chat-history-runtime.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

let source = await readFile({str(module_path)!r}, 'utf8');
source = source.replace(
  "import {{ withAppRoot }} from './app-url.js';",
  "const withAppRoot = (value) => value;",
);
source = source.replace(
  "import {{ normalizeMentionUserIds }} from './chat-mentions.js';",
  "const normalizeMentionUserIds = (value) => Array.isArray(value) ? value : [];",
);
source = source.replace(
  "import {{ normalizeGroupReaders }} from './chat-group-read-receipts.js';",
  "const normalizeGroupReaders = (value) => Array.isArray(value) ? value : [];",
);
source = source.replace(
  "import {{ insertUnreadDivider, removeUnreadDivider }} from './chat-skeleton-ui.js';",
  "const insertUnreadDivider = () => {{}}; const removeUnreadDivider = () => {{}};",
);
source = source.replace(
  "import {{ captureChatViewportAnchor }} from './chat-scroll-stability.js';",
  "const captureChatViewportAnchor = () => ({{ messageKey: 'id:10', offsetTop: 32 }});",
);
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64');
const {{ createChatHistoryRuntime }} = await import(moduleUrl);

const state = {{
  initialized: true,
  isLoadingInitial: false,
  isLoadingOlder: false,
  historyOlderToken: 0,
  messages: [
    {{ id: 10, message: 'visible anchor', created_at: '2026-01-02T00:00:00Z' }},
    {{ id: 11, message: 'next', created_at: '2026-01-02T00:01:00Z' }},
  ],
  hasMoreBefore: true,
  renderedKeys: new Set(['id:10', 'id:11']),
}};
const classNames = new Set();
const chatMessages = {{
  scrollTop: 120,
  scrollHeight: 1000,
  clientHeight: 400,
  classList: {{
    add: (name) => classNames.add(name),
    remove: (name) => classNames.delete(name),
  }},
}};
const renderCalls = [];

const runtime = createChatHistoryRuntime({{
  chatHistoryPageSize: 50,
  chatHistoryMaxPageSize: 100,
  chatDecryptConcurrency: 2,
  chatDecryptWorkerTimeoutMs: 100,
  fetchImpl: async () => {{
    chatMessages.scrollTop = 180;
    chatMessages.scrollHeight = 1100;
    return {{
      ok: true,
      json: async () => ({{
        success: true,
        messages: [
          {{ id: 8, sender_public_key: 'other', message: 'older 8', created_at: '2026-01-01T23:58:00Z', reactions: [] }},
          {{ id: 9, sender_public_key: 'other', message: 'older 9', created_at: '2026-01-01T23:59:00Z', reactions: [] }},
        ],
        has_more_before: true,
      }}),
    }};
  }},
  chatMessagesEl: chatMessages,
  getChatState: () => state,
  getCurrentChatId: () => 'chat-older',
  getPrivateKeyPem: () => 'private-key',
  getCurrentUserPublicKey: () => 'pk-current',
  getCurrentUserId: () => '1',
  getCurrentPartnerData: () => ({{ display_name: 'Partner' }}),
  isEncryptedPayload: () => false,
  decryptForDisplay: async (_privateKey, payload) => payload,
  normalizeMessageReactions: (value) => value || [],
  enrichDecodedMessagesVisualMeta: async (messages) => messages,
  createHistoryAbortController: () => ({{ signal: undefined }}),
  releaseHistoryAbortController: () => {{}},
  historyOlderAbortControllers: new Map(),
  getMessageKey: (msg) => `id:${{msg.id}}`,
  prependChatMessages: (_chatId, messages) => {{
    state.messages = [...messages, ...state.messages];
    return messages.length;
  }},
  sumEstimatedHeights: () => 240,
  renderChatMessages: (_chatId, options) => renderCalls.push(options),
  appendEncryptedMessagesToCache: async () => {{}},
  isAbortError: () => false,
  showToast: (message) => {{
    throw new Error(`Unexpected toast: ${{message}}`);
  }},
}});

const loaded = await runtime.loadOlderMessages('chat-older');

if (!loaded) {{
  throw new Error('Expected older messages to load');
}}
if (renderCalls.length !== 1) {{
  throw new Error(`Expected one anchored render, got ${{JSON.stringify(renderCalls)}}`);
}}
const options = renderCalls[0];
if (options.previousScrollTop !== 180 || options.previousScrollHeight !== 1100) {{
  throw new Error(`Prepend must anchor the viewport at mutation time, got ${{JSON.stringify(options)}}`);
}}
if (options.anchorMessageKey !== 'id:10' || options.anchorOffsetTop !== 32) {{
  throw new Error(`Missing viewport anchor: ${{JSON.stringify(options)}}`);
}}
if (options.scrollTop !== 420) {{
  throw new Error(`Expected estimated post-prepend scrollTop 420, got ${{options.scrollTop}}`);
}}
if (options.reuseExistingNodes !== true || options.preserveHeightDelta !== true) {{
  throw new Error(`Prepend render must preserve existing DOM/media nodes: ${{JSON.stringify(options)}}`);
}}
if (classNames.size) {{
  throw new Error(`History loading class was not cleaned up: ${{JSON.stringify([...classNames])}}`);
}}
"""
    result = _run_node_harness(node_harness)
    assert result.returncode == 0, result.stderr or result.stdout
