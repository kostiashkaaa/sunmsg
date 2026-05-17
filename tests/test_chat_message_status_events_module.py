from pathlib import Path
import subprocess


def _run_status_events_harness(harness_body: str) -> subprocess.CompletedProcess[str]:
    module_path = Path(__file__).resolve().parents[1] / 'static' / 'modules' / 'chat-message-status-events.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

let source = await readFile({str(module_path)!r}, 'utf8');
source = source.replace(
  /import\\s*\\{{[\\s\\S]*?\\}}\\s*from\\s*['"]\\.\\/chat-group-read-receipts\\.js['"];\\s*/,
  `const applyGroupReadMetaToElement = () => {{}};
const applyGroupReadUpdateToMessage = () => {{}};
const normalizeGroupReadUpdate = () => null;
`
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


def test_socket_error_with_request_id_fails_matching_pending_message():
    harness_body = """
const handlers = new Map();
const socket = { on: (eventName, callback) => handlers.set(eventName, callback) };
const failed = [];
const canceled = [];
const toasts = [];

moduleApi.registerMessageStatusSocketHandlers({
  socket,
  isBlockedChat: () => false,
  removeChatMessages: () => {},
  getCurrentChatId: () => 'chat-1',
  rerenderCurrentChat: () => {},
  loadContacts: () => {},
  getChatState: () => ({ messages: [], messageHeights: new Map(), renderedKeys: new Set() }),
  findMessageIndex: () => -1,
  cancelPendingTimeout: (clientId) => canceled.push(clientId),
  getMessageKey: () => '',
  normalizeChatMessageOrder: () => {},
  currentChatMessagesEl: null,
  applyTickToElement: () => {},
  formatTime: () => '',
  formatFullTimestamp: () => '',
  patchMessageReactions: () => {},
  updateSidebarContactTick: () => {},
  getContactsRoot: () => null,
  markAllTicksRead: () => {},
  onMessagesMarkedRead: () => {},
  failPendingMessage: (clientId) => failed.push(clientId),
  showToast: (message, type) => toasts.push({ message, type }),
});

handlers.get('error')({
  message: 'Too many messages. Please wait a little.',
  request_id: 'client-123',
});

if (canceled.join(',') !== 'client-123') {
  throw new Error(`Expected canceled client-123, got ${canceled.join(',')}`);
}
if (failed.join(',') !== 'client-123') {
  throw new Error(`Expected failed client-123, got ${failed.join(',')}`);
}
if (toasts.length !== 1 || toasts[0].message !== 'Too many messages. Please wait a little.' || toasts[0].type !== 'warning') {
  throw new Error(`Unexpected toast payload ${JSON.stringify(toasts)}`);
}
"""
    result = _run_status_events_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_duplicate_request_error_does_not_fail_pending_message():
    harness_body = """
const handlers = new Map();
const socket = { on: (eventName, callback) => handlers.set(eventName, callback) };
let failed = 0;

moduleApi.registerMessageStatusSocketHandlers({
  socket,
  isBlockedChat: () => false,
  removeChatMessages: () => {},
  getCurrentChatId: () => 'chat-1',
  rerenderCurrentChat: () => {},
  loadContacts: () => {},
  getChatState: () => ({ messages: [], messageHeights: new Map(), renderedKeys: new Set() }),
  findMessageIndex: () => -1,
  cancelPendingTimeout: () => {},
  getMessageKey: () => '',
  normalizeChatMessageOrder: () => {},
  currentChatMessagesEl: null,
  applyTickToElement: () => {},
  formatTime: () => '',
  formatFullTimestamp: () => '',
  patchMessageReactions: () => {},
  updateSidebarContactTick: () => {},
  getContactsRoot: () => null,
  markAllTicksRead: () => {},
  onMessagesMarkedRead: () => {},
  failPendingMessage: () => { failed += 1; },
  showToast: () => {},
});

handlers.get('error')({
  message: 'Duplicate request ignored.',
  code: 'duplicate_request',
  request_id: 'client-123',
});

if (failed !== 0) {
  throw new Error(`Duplicate request should not fail pending message, got ${failed}`);
}
"""
    result = _run_status_events_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_delete_event_rerenders_current_chat_with_visible_anchor():
    harness_body = """
const handlers = new Map();
const socket = { on: (eventName, callback) => handlers.set(eventName, callback) };
const calls = [];
const makeNode = (id, key, top, bottom) => ({
  getAttribute: (name) => {
    if (name === 'data-msg-id') return String(id);
    if (name === 'data-message-key') return key;
    return '';
  },
  getBoundingClientRect: () => ({ top, bottom }),
});
const chatMessages = {
  scrollTop: 140,
  scrollHeight: 1200,
  getBoundingClientRect: () => ({ top: 20, bottom: 620 }),
  querySelectorAll: () => [
    makeNode(10, 'id:10', 80, 120),
    makeNode(11, 'id:11', 130, 170),
  ],
};

moduleApi.registerMessageStatusSocketHandlers({
  socket,
  isBlockedChat: () => false,
  removeChatMessages: (chatId, ids) => calls.push(['remove', chatId, ids]),
  getCurrentChatId: () => 'chat-1',
  rerenderCurrentChat: (options) => calls.push(['rerender', options]),
  loadContacts: () => calls.push(['contacts']),
  getChatState: () => ({ messages: [], messageHeights: new Map(), renderedKeys: new Set() }),
  findMessageIndex: () => -1,
  cancelPendingTimeout: () => {},
  getMessageKey: () => '',
  normalizeChatMessageOrder: () => {},
  currentChatMessagesEl: chatMessages,
  applyTickToElement: () => {},
  formatTime: () => '',
  formatFullTimestamp: () => '',
  patchMessageReactions: () => {},
  updateSidebarContactTick: () => {},
  getContactsRoot: () => null,
  markAllTicksRead: () => {},
  onMessagesMarkedRead: () => {},
  failPendingMessage: () => {},
  showToast: () => {},
});

handlers.get('messages_deleted')({ chat_id: 'chat-1', msg_ids: [10] });

const rerender = calls.find((entry) => entry[0] === 'rerender')?.[1];
if (!rerender) {
  throw new Error(`Expected rerender call, got ${JSON.stringify(calls)}`);
}
if (rerender.force === true) {
  throw new Error(`Delete rerender must not force full DOM rebuild: ${JSON.stringify(rerender)}`);
}
if (rerender.anchorMessageKey !== 'id:11' || rerender.anchorOffsetTop !== 110) {
  throw new Error(`Unexpected delete anchor ${JSON.stringify(rerender)}`);
}
if (rerender.preserveHeightDelta !== true) {
  throw new Error(`Delete anchor should keep height fallback ${JSON.stringify(rerender)}`);
}
if (rerender.previousScrollTop !== 140 || rerender.previousScrollHeight !== 1200) {
  throw new Error(`Unexpected delete scroll fallback ${JSON.stringify(rerender)}`);
}
"""
    result = _run_status_events_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_messages_expired_uses_delete_pipeline_and_message_ids_payload():
    harness_body = """
const handlers = new Map();
const socket = { on: (eventName, callback) => handlers.set(eventName, callback) };
const calls = [];
const chatMessages = {
  scrollTop: 20,
  scrollHeight: 900,
  getBoundingClientRect: () => ({ top: 0, bottom: 500 }),
  querySelectorAll: () => [],
};

moduleApi.registerMessageStatusSocketHandlers({
  socket,
  isBlockedChat: () => false,
  removeChatMessages: (chatId, ids) => calls.push(['remove', chatId, ids]),
  getCurrentChatId: () => 'chat-1',
  rerenderCurrentChat: (options) => calls.push(['rerender', options]),
  loadContacts: () => calls.push(['contacts']),
  getChatState: () => ({ messages: [], messageHeights: new Map(), renderedKeys: new Set() }),
  findMessageIndex: () => -1,
  cancelPendingTimeout: () => {},
  getMessageKey: () => '',
  normalizeChatMessageOrder: () => {},
  currentChatMessagesEl: chatMessages,
  applyTickToElement: () => {},
  formatTime: () => '',
  formatFullTimestamp: () => '',
  patchMessageReactions: () => {},
  updateSidebarContactTick: () => {},
  getContactsRoot: () => null,
  markAllTicksRead: () => {},
  onMessagesMarkedRead: () => {},
  failPendingMessage: () => {},
  showToast: () => {},
});

handlers.get('messages_expired')({ chat_id: 'chat-1', message_ids: [20, '21', 'bad'] });

const remove = calls.find((entry) => entry[0] === 'remove');
if (!remove || remove[1] !== 'chat-1' || remove[2].join(',') !== '20,21') {
  throw new Error(`Expired messages must use delete removal path: ${JSON.stringify(calls)}`);
}
const rerender = calls.find((entry) => entry[0] === 'rerender')?.[1];
if (!rerender || rerender.preserveHeightDelta !== true || rerender.previousScrollTop !== 20 || rerender.previousScrollHeight !== 900) {
  throw new Error(`Expired current chat should rerender with scroll fallback: ${JSON.stringify(calls)}`);
}
if (!calls.some((entry) => entry[0] === 'contacts')) {
  throw new Error(`Expired messages should refresh sidebar preview: ${JSON.stringify(calls)}`);
}
"""
    result = _run_status_events_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_delete_event_animates_visible_messages_and_dismisses_tab_alerts():
    harness_body = """
const handlers = new Map();
const socket = { on: (eventName, callback) => handlers.set(eventName, callback) };
const calls = [];
const classes = new Set();
const nodeStyle = new Map();
const removedTimers = [];
const messageNode = {
  getAttribute: (name) => {
    if (name === 'data-msg-id') return '20';
    if (name === 'data-message-key') return 'id:20';
    return '';
  },
  getBoundingClientRect: () => ({ top: 80, bottom: 120, height: 40 }),
  classList: {
    add: (name) => classes.add(name),
  },
  style: {
    setProperty: (name, value) => nodeStyle.set(name, value),
  },
};
const chatMessages = {
  scrollTop: 50,
  scrollHeight: 500,
  getBoundingClientRect: () => ({ top: 0, bottom: 300 }),
  querySelectorAll: () => [messageNode],
};

moduleApi.registerMessageStatusSocketHandlers({
  socket,
  isBlockedChat: () => false,
  removeChatMessages: (chatId, ids) => calls.push(['remove', chatId, ids]),
  getCurrentChatId: () => 'chat-1',
  rerenderCurrentChat: (options) => calls.push(['rerender', options]),
  loadContacts: () => calls.push(['contacts']),
  getChatState: () => ({ messages: [], messageHeights: new Map(), renderedKeys: new Set() }),
  findMessageIndex: () => -1,
  cancelPendingTimeout: () => {},
  getMessageKey: () => '',
  normalizeChatMessageOrder: () => {},
  currentChatMessagesEl: chatMessages,
  applyTickToElement: () => {},
  formatTime: () => '',
  formatFullTimestamp: () => '',
  patchMessageReactions: () => {},
  updateSidebarContactTick: () => {},
  getContactsRoot: () => null,
  markAllTicksRead: () => {},
  onMessagesMarkedRead: () => {},
  failPendingMessage: () => {},
  showToast: () => {},
  dismissTabAlertsForChat: (chatId, count) => calls.push(['dismiss-alerts', chatId, count]),
  setTimeoutFn: (handler, delay) => {
    removedTimers.push(delay);
    handler();
    return 1;
  },
});

handlers.get('messages_deleted')({ chat_id: 'chat-1', msg_ids: [20] });

if (!classes.has('message--removing')) {
  throw new Error('Visible deleted message should receive removal animation class.');
}
if (nodeStyle.get('--message-removal-height') !== '40px') {
  throw new Error(`Expected measured removal height, got ${nodeStyle.get('--message-removal-height')}`);
}
if (removedTimers.join(',') !== '220') {
  throw new Error(`Expected delayed removal timer, got ${removedTimers.join(',')}`);
}
if (!calls.some((entry) => entry[0] === 'dismiss-alerts' && entry[1] === 'chat-1' && entry[2] === 1)) {
  throw new Error(`Expected tab alert dismiss call, got ${JSON.stringify(calls)}`);
}
if (!calls.some((entry) => entry[0] === 'remove')) {
  throw new Error(`Expected final removal after animation, got ${JSON.stringify(calls)}`);
}
"""
    result = _run_status_events_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout
