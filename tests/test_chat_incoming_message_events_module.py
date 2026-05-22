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


def test_self_echo_keeps_pending_plaintext_when_decrypt_returns_ciphertext():
    module_path = ROOT / 'static' / 'modules' / 'chat-incoming-message-events.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

let source = await readFile({str(module_path)!r}, 'utf8');
source = source.replace(
  /import \\{{[\\s\\S]*?\\}} from '\\.\\/chat-mentions\\.js';/,
  `const isCurrentUserMentioned = () => false;
const normalizeMentionUserIds = (value) => Array.isArray(value) ? value : [];`,
);
source = source.replace(
  "import {{ normalizeGroupReaders }} from './chat-group-read-receipts.js';",
  "const normalizeGroupReaders = (value) => Array.isArray(value) ? value : [];",
);
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64');
const {{ registerIncomingMessageSocketHandlers }} = await import(moduleUrl);
const handlers = new Map();
const calls = [];
const encrypted = '{{"encrypted_message":"cipher","encrypted_key_receiver":"receiver","encrypted_key_sender":"sender","iv":"iv"}}';
const state = {{
  messages: [{{
    sender: 'self',
    message: 'plain text',
    message_type: 'text',
    replyToText: 'plain reply',
    pending: true,
    clientId: 'client-1',
    created_at: '2026-05-14T23:00:00Z',
    reactions: [],
  }}],
  messageHeights: new Map(),
  renderedKeys: new Set(['client:client-1']),
}};

registerIncomingMessageSocketHandlers({{
  socket: {{
    on(event, handler) {{
      handlers.set(event, handler);
    }},
  }},
  isBlockedChat: () => false,
  getCurrentChatId: () => 'chat-1',
  currentUserPublicKey: 'pk-self',
  getPrivateKeyPem: () => '',
  decryptForDisplay: async (_privateKey, payload) => payload,
  getChatState: () => state,
  findMessageIndex: (targetState, predicate) => targetState.messages.findIndex(predicate),
  cancelPendingTimeout: (clientId) => calls.push(['cancel', clientId]),
  normalizeChatMessageOrder: () => {{}},
  updateActiveContactLastMessage: (...args) => calls.push(['last', ...args]),
  isChatNearBottom: () => true,
  isWindowActiveForUnreadHandling: () => true,
  getCurrentChatScrollTop: () => 0,
  getCurrentChatScrollHeight: () => 0,
  appendMessage: () => calls.push(['append']),
  isEncryptedPayload: (value) => typeof value === 'string' && value.includes('encrypted_message'),
  normalizeMessageReactions: (value) => value || [],
  getCurrentPartnerDisplayName: () => 'Partner',
  markCurrentChatSeenIfPossible: () => {{}},
  setKeepChatPinnedToBottom: () => {{}},
  incrementOpenChatUnreadCount: () => {{}},
  updateJumpToNewMessagesButton: () => {{}},
  setContactUnreadBadge: () => {{}},
  upsertChatMessage: () => {{}},
  updateSidebarForOtherChat: () => {{}},
  showToast: (...args) => calls.push(['toast', ...args]),
  updateMessageContent: () => {{}},
  rerenderCurrentChat: () => calls.push(['rerender']),
  resolveMessageElement: () => null,
  getMessageKey: (msg) => msg.id ? `id:${{msg.id}}` : `client:${{msg.clientId}}`,
  confirmPendingMessageDom: (payload) => {{
    calls.push(['confirm', payload.message.message, payload.message.replyToText]);
    return true;
  }},
  loadContacts: () => {{}},
  enrichVisualMediaMessage: async (value) => value,
  notifyIncomingMessage: () => {{}},
  onIncomingRawMessage: () => {{}},
  prewarmMessageLinkPreview: async () => {{}},
  getCurrentUserId: () => '1',
  getCurrentUsername: () => 'self',
}});

await handlers.get('receive_message')({{
  id: 44,
  chat_id: 'chat-1',
  sender_public_key: 'pk-self',
  sender_user_id: 1,
  message: encrypted,
  message_type: 'text',
  reply_to_id: 12,
  reply_message: encrypted,
  reply_sender_pub: 'pk-self',
  client_id: 'client-1',
  created_at: '2026-05-14T23:00:01Z',
  reactions: [],
}});

if (state.messages[0].message !== 'plain text') {{
  throw new Error(`Expected plaintext to survive self echo, got ${{state.messages[0].message}}`);
}}
if (state.messages[0].replyToText !== 'plain reply') {{
  throw new Error(`Expected plaintext reply to survive self echo, got ${{state.messages[0].replyToText}}`);
}}
if (!calls.some((call) => call[0] === 'confirm' && call[1] === 'plain text' && call[2] === 'plain reply')) {{
  throw new Error(`DOM confirmation received wrong message: ${{JSON.stringify(calls)}}`);
}}
if (!calls.some((call) => call[0] === 'last' && call[1] === 'plain text')) {{
  throw new Error(`Sidebar last message received ciphertext: ${{JSON.stringify(calls)}}`);
}}
if (calls.some((call) => call[0] === 'rerender')) {{
  throw new Error(`Self echo should patch DOM without forced rerender: ${{JSON.stringify(calls)}}`);
}}
"""
    result = _run_node_harness(node_harness)
    assert result.returncode == 0, result.stderr or result.stdout


def test_self_echo_uses_sender_user_id_when_public_key_differs():
    module_path = ROOT / 'static' / 'modules' / 'chat-incoming-message-events.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

let source = await readFile({str(module_path)!r}, 'utf8');
source = source.replace(
  /import \\{{[\\s\\S]*?\\}} from '\\.\\/chat-mentions\\.js';/,
  `const isCurrentUserMentioned = () => false;
const normalizeMentionUserIds = (value) => Array.isArray(value) ? value : [];`,
);
source = source.replace(
  "import {{ normalizeGroupReaders }} from './chat-group-read-receipts.js';",
  "const normalizeGroupReaders = (value) => Array.isArray(value) ? value : [];",
);
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64');
const {{ registerIncomingMessageSocketHandlers }} = await import(moduleUrl);
const handlers = new Map();
const calls = [];
const decryptCalls = [];
const encrypted = '{{"encrypted_message":"cipher","encrypted_key_receiver":"receiver","encrypted_key_sender":"sender","iv":"iv"}}';
const state = {{
  messages: [{{
    sender: 'self',
    message: 'visible text',
    message_type: 'text',
    pending: true,
    clientId: 'client-1',
    created_at: '2026-05-14T23:00:00Z',
    reactions: [],
  }}],
  messageHeights: new Map(),
  renderedKeys: new Set(['client:client-1']),
}};

registerIncomingMessageSocketHandlers({{
  socket: {{
    on(event, handler) {{
      handlers.set(event, handler);
    }},
  }},
  isBlockedChat: () => false,
  getCurrentChatId: () => 'chat-1',
  currentUserPublicKey: 'pk-current',
  getPrivateKeyPem: () => 'private-key',
  decryptForDisplay: async (_privateKey, payload, isSelf) => {{
    decryptCalls.push(isSelf);
    return payload;
  }},
  getChatState: () => state,
  findMessageIndex: (targetState, predicate) => targetState.messages.findIndex(predicate),
  cancelPendingTimeout: (clientId) => calls.push(['cancel', clientId]),
  normalizeChatMessageOrder: () => {{}},
  updateActiveContactLastMessage: (...args) => calls.push(['last', ...args]),
  isChatNearBottom: () => true,
  isWindowActiveForUnreadHandling: () => true,
  getCurrentChatScrollTop: () => 0,
  getCurrentChatScrollHeight: () => 0,
  appendMessage: () => calls.push(['append']),
  isEncryptedPayload: (value) => typeof value === 'string' && value.includes('encrypted_message'),
  normalizeMessageReactions: (value) => value || [],
  getCurrentPartnerDisplayName: () => 'Partner',
  markCurrentChatSeenIfPossible: () => {{}},
  setKeepChatPinnedToBottom: () => {{}},
  incrementOpenChatUnreadCount: () => {{}},
  updateJumpToNewMessagesButton: () => {{}},
  setContactUnreadBadge: () => {{}},
  upsertChatMessage: () => calls.push(['upsert']),
  updateSidebarForOtherChat: () => calls.push(['sidebar-other']),
  showToast: (...args) => calls.push(['toast', ...args]),
  updateMessageContent: () => {{}},
  rerenderCurrentChat: () => calls.push(['rerender']),
  resolveMessageElement: () => null,
  getMessageKey: (msg) => msg.id ? `id:${{msg.id}}` : `client:${{msg.clientId}}`,
  confirmPendingMessageDom: (payload) => {{
    calls.push(['confirm', payload.message.message]);
    return true;
  }},
  loadContacts: () => {{}},
  enrichVisualMediaMessage: async (value) => value,
  notifyIncomingMessage: () => {{}},
  onIncomingRawMessage: () => {{}},
  prewarmMessageLinkPreview: async () => {{}},
  getCurrentUserId: () => '1',
  getCurrentUsername: () => 'self',
}});

await handlers.get('receive_message')({{
  id: 45,
  chat_id: 'chat-1',
  sender_public_key: 'pk-stale-format',
  sender_user_id: 1,
  message: encrypted,
  message_type: 'text',
  client_id: 'client-1',
  created_at: '2026-05-14T23:00:01Z',
  reactions: [],
}});

if (decryptCalls[0] !== true) {{
  throw new Error(`Expected self decrypt key path, got ${{JSON.stringify(decryptCalls)}}`);
}}
if (state.messages[0].sender !== 'self' || state.messages[0].message !== 'visible text') {{
  throw new Error(`Expected pending self message to stay visible: ${{JSON.stringify(state.messages[0])}}`);
}}
if (calls.some((call) => call[0] === 'append' || call[0] === 'upsert' || call[0] === 'sidebar-other')) {{
  throw new Error(`Self echo should not be appended as other: ${{JSON.stringify(calls)}}`);
}}
if (!calls.some((call) => call[0] === 'confirm' && call[1] === 'visible text')) {{
  throw new Error(`Expected DOM confirmation with plaintext: ${{JSON.stringify(calls)}}`);
}}
"""
    result = _run_node_harness(node_harness)
    assert result.returncode == 0, result.stderr or result.stdout


def test_other_chat_self_echo_preserves_pending_plaintext_preview():
    module_path = ROOT / 'static' / 'modules' / 'chat-incoming-message-events.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

let source = await readFile({str(module_path)!r}, 'utf8');
source = source.replace(
  /import \\{{[\\s\\S]*?\\}} from '\\.\\/chat-mentions\\.js';/,
  `const isCurrentUserMentioned = () => false;
const normalizeMentionUserIds = (value) => Array.isArray(value) ? value : [];`,
);
source = source.replace(
  "import {{ normalizeGroupReaders }} from './chat-group-read-receipts.js';",
  "const normalizeGroupReaders = (value) => Array.isArray(value) ? value : [];",
);
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64');
const {{ registerIncomingMessageSocketHandlers }} = await import(moduleUrl);
const handlers = new Map();
const calls = [];
const encrypted = '{{"encrypted_message":"cipher","encrypted_key_receiver":"receiver","encrypted_key_sender":"sender","iv":"iv"}}';
const otherState = {{
  initialized: true,
  messages: [{{
    sender: 'self',
    message: 'background visible text',
    message_type: 'text',
    pending: true,
    clientId: 'client-bg',
    created_at: '2026-05-14T23:00:00Z',
    reactions: [],
  }}],
  messageHeights: new Map([['client:client-bg', 88]]),
  renderedKeys: new Set(['client:client-bg']),
  heightIndexRevision: 0,
}};

registerIncomingMessageSocketHandlers({{
  socket: {{
    on(event, handler) {{
      handlers.set(event, handler);
    }},
  }},
  isBlockedChat: () => false,
  getCurrentChatId: () => 'chat-current',
  currentUserPublicKey: 'pk-self',
  getPrivateKeyPem: () => '',
  decryptForDisplay: async (_privateKey, payload) => payload,
  getChatState: (chatId) => {{
    if (chatId === 'chat-other') return otherState;
    return {{ initialized: false, messages: [], messageHeights: new Map(), renderedKeys: new Set() }};
  }},
  findMessageIndex: (targetState, predicate) => targetState.messages.findIndex(predicate),
  cancelPendingTimeout: (clientId) => calls.push(['cancel', clientId]),
  normalizeChatMessageOrder: () => calls.push(['normalize']),
  updateActiveContactLastMessage: () => calls.push(['active-last']),
  isChatNearBottom: () => true,
  isWindowActiveForUnreadHandling: () => true,
  getCurrentChatScrollTop: () => 0,
  getCurrentChatScrollHeight: () => 0,
  appendMessage: () => calls.push(['append']),
  isEncryptedPayload: (value) => typeof value === 'string' && value.includes('encrypted_message'),
  normalizeMessageReactions: (value) => value || [],
  getCurrentPartnerDisplayName: () => 'Partner',
  markCurrentChatSeenIfPossible: () => {{}},
  setKeepChatPinnedToBottom: () => {{}},
  incrementOpenChatUnreadCount: () => {{}},
  updateJumpToNewMessagesButton: () => {{}},
  setContactUnreadBadge: () => {{}},
  upsertChatMessage: () => calls.push(['upsert']),
  updateSidebarForOtherChat: (...args) => calls.push(['sidebar-other', ...args]),
  showToast: (...args) => calls.push(['toast', ...args]),
  updateMessageContent: () => {{}},
  rerenderCurrentChat: () => calls.push(['rerender']),
  resolveMessageElement: () => null,
  getMessageKey: (msg) => msg.id ? `id:${{msg.id}}` : `client:${{msg.clientId}}`,
  confirmPendingMessageDom: () => false,
  loadContacts: () => {{}},
  enrichVisualMediaMessage: async (value) => value,
  notifyIncomingMessage: () => calls.push(['notify']),
  onIncomingRawMessage: () => {{}},
  prewarmMessageLinkPreview: async () => {{}},
  getCurrentUserId: () => '1',
  getCurrentUsername: () => 'self',
}});

await handlers.get('receive_message')({{
  id: 46,
  chat_id: 'chat-other',
  sender_public_key: 'pk-self',
  sender_user_id: 1,
  message: encrypted,
  message_type: 'text',
  client_id: 'client-bg',
  created_at: '2026-05-14T23:00:01Z',
  reactions: [],
}});

if (otherState.messages[0].message !== 'background visible text') {{
  throw new Error(`Expected background pending plaintext to survive, got ${{otherState.messages[0].message}}`);
}}
if (otherState.messages[0].pending !== false || otherState.messages[0].clientId !== null || otherState.messages[0].id !== 46) {{
  throw new Error(`Expected pending message confirmation state, got ${{JSON.stringify(otherState.messages[0])}}`);
}}
if (otherState.messageHeights.has('client:client-bg') || otherState.messageHeights.get('id:46') !== 88) {{
  throw new Error(`Expected height cache migration, got ${{JSON.stringify(Array.from(otherState.messageHeights.entries()))}}`);
}}
if (otherState.renderedKeys.has('client:client-bg') || !otherState.renderedKeys.has('id:46')) {{
  throw new Error(`Expected rendered key migration, got ${{JSON.stringify(Array.from(otherState.renderedKeys))}}`);
}}
if (!calls.some((call) => call[0] === 'sidebar-other' && call[2] === 'background visible text')) {{
  throw new Error(`Sidebar preview received wrong payload: ${{JSON.stringify(calls)}}`);
}}
if (calls.some((call) => call[0] === 'upsert' || call[0] === 'append' || call[0] === 'notify')) {{
  throw new Error(`Background self echo should only confirm pending state: ${{JSON.stringify(calls)}}`);
}}
"""
    result = _run_node_harness(node_harness)
    assert result.returncode == 0, result.stderr or result.stdout
