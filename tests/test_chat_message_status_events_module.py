from pathlib import Path
import subprocess


def _run_status_events_harness(harness_body: str) -> subprocess.CompletedProcess[str]:
    module_path = Path(__file__).resolve().parents[1] / 'static' / 'modules' / 'chat-message-status-events.js'
    motion_path = Path(__file__).resolve().parents[1] / 'static' / 'modules' / 'message-delete-motion.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

let source = await readFile({str(module_path)!r}, 'utf8');
let motionSource = await readFile({str(motion_path)!r}, 'utf8');
motionSource = motionSource.replace(
  /export\\s+function\\s+createMessageDeleteMotionController/,
  'function createMessageDeleteMotionController'
);
source = source.replace(
  /import\\s*\\{{\\s*createMessageDeleteMotionController\\s*\\}}\\s*from\\s*['"]\\.\\/message-delete-motion\\.js['"];\\s*/,
  motionSource
);
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
  message: 'Слишком много сообщений. Подождите немного.',
  request_id: 'client-123',
});

if (canceled.join(',') !== 'client-123') {
  throw new Error(`Expected canceled client-123, got ${canceled.join(',')}`);
}
if (failed.join(',') !== 'client-123') {
  throw new Error(`Expected failed client-123, got ${failed.join(',')}`);
}
if (toasts.length !== 1 || toasts[0].message !== 'Слишком много сообщений. Подождите немного.' || toasts[0].type !== 'warning') {
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


def test_delete_event_near_bottom_rerenders_to_bottom_with_motion_snapshot():
    harness_body = """
const handlers = new Map();
const socket = { on: (eventName, callback) => handlers.set(eventName, callback) };
const calls = [];
let containerRectReads = 0;
let messageRectReads = 0;
const makeNode = (id, key) => ({
  getAttribute: (name) => {
    if (name === 'data-msg-id') return String(id);
    if (name === 'data-message-key') return key;
    return '';
  },
  getBoundingClientRect: () => {
    messageRectReads += 1;
    return { top: 80, bottom: 120 };
  },
  classList: {
    add: (name) => classes.add(`${id}:${name}`),
  },
});
const chatMessages = {
  scrollTop: 900,
  scrollHeight: 1200,
  getBoundingClientRect: () => {
    containerRectReads += 1;
    return { top: 20, bottom: 620 };
  },
  querySelectorAll: () => [
    makeNode(20, 'id:20'),
    makeNode(21, 'id:21'),
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
  isChatNearBottom: () => true,
  setTimeoutFn: (handler) => {
    handler();
    return 1;
  },
});

handlers.get('messages_deleted')({ chat_id: 'chat-1', msg_ids: [20] });

const rerender = calls.find((entry) => entry[0] === 'rerender')?.[1];
if (!rerender || rerender.scrollToBottom !== true) {
  throw new Error(`Expected bottom-pinned delete rerender, got ${JSON.stringify(calls)}`);
}
if (rerender.anchorMessageKey || rerender.preserveHeightDelta) {
  throw new Error(`Bottom delete must not preserve top anchor ${JSON.stringify(rerender)}`);
}
if (containerRectReads !== 1 || messageRectReads !== 2) {
  throw new Error(`Bottom delete should capture one motion snapshot, got ${containerRectReads}/${messageRectReads}`);
}
if (calls.map((entry) => entry[0]).join(',') !== 'remove,rerender,contacts') {
  throw new Error(`Delete should update state and rerender in the same event turn, got ${JSON.stringify(calls)}`);
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


def test_delete_event_animates_survivors_and_dismisses_tab_alerts():
    harness_body = """
const handlers = new Map();
const socket = { on: (eventName, callback) => handlers.set(eventName, callback) };
const calls = [];
const rafCallbacks = [];
const timers = [];
let phase = 'before';
const survivorStyle = { transition: '', transform: '', willChange: '' };
const ghostStyle = {};
const ghostClasses = new Set();
const ghostNode = {
  style: ghostStyle,
  classList: { add: (name) => ghostClasses.add(name) },
  removeAttribute: () => {},
  setAttribute: () => {},
  remove: () => { ghostNode.removed = true; },
};
const messageNode = {
  getAttribute: (name) => {
    if (name === 'data-msg-id') return '20';
    if (name === 'data-message-key') return 'id:20';
    return '';
  },
  getBoundingClientRect: () => ({ top: 80, left: 0, bottom: 120, width: 220, height: 40 }),
  cloneNode: () => ghostNode,
  classList: {
    contains: () => false,
  },
};
const survivorNode = {
  getAttribute: (name) => {
    if (name === 'data-msg-id') return '21';
    if (name === 'data-message-key') return 'id:21';
    return '';
  },
  getBoundingClientRect: () => (
    phase === 'before'
      ? { top: 130, left: 0, bottom: 170, width: 220, height: 40 }
      : { top: 90, left: 0, bottom: 130, width: 220, height: 40 }
  ),
  style: survivorStyle,
  classList: {
    contains: () => false,
  },
};
const chatMessages = {
  scrollTop: 50,
  scrollHeight: 500,
  ownerDocument: { body: { appendChild: () => {} } },
  getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 300, width: 320, height: 300 }),
  querySelectorAll: () => (phase === 'before' ? [messageNode, survivorNode] : [survivorNode]),
};

moduleApi.registerMessageStatusSocketHandlers({
  socket,
  isBlockedChat: () => false,
  removeChatMessages: (chatId, ids) => calls.push(['remove', chatId, ids]),
  getCurrentChatId: () => 'chat-1',
  rerenderCurrentChat: (options) => {
    calls.push(['rerender', options]);
    phase = 'after';
  },
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
    timers.push({ handler, delay });
    return 1;
  },
  requestAnimationFrameFn: (handler) => {
    rafCallbacks.push(handler);
    return rafCallbacks.length;
  },
});

handlers.get('messages_deleted')({ chat_id: 'chat-1', msg_ids: [20] });

if (calls.map((entry) => entry[0]).join(',') !== 'remove,dismiss-alerts,rerender,contacts') {
  throw new Error(`Delete should not wait for animation before state removal: ${JSON.stringify(calls)}`);
}
if (survivorStyle.transform !== 'translate3d(0.00px, 40.00px, 0)') {
  throw new Error(`Expected FLIP start transform on survivor, got ${survivorStyle.transform}`);
}
if (!ghostClasses.has('message-delete-ghost')) {
  throw new Error(`Deleted message should be cloned as a ghost, got ${Array.from(ghostClasses).join(',')}`);
}
rafCallbacks.splice(0).forEach((handler) => handler());
if (!String(survivorStyle.transition).includes('transform 180ms') || survivorStyle.transform !== '') {
  throw new Error(`Expected survivor transform to animate back, got ${JSON.stringify(survivorStyle)}`);
}
if (ghostStyle.opacity !== '0' || !String(ghostStyle.transform).includes('scale(0.97)')) {
  throw new Error(`Expected ghost fade/scale animation, got ${JSON.stringify(ghostStyle)}`);
}
if (!calls.some((entry) => entry[0] === 'dismiss-alerts' && entry[1] === 'chat-1' && entry[2] === 1)) {
  throw new Error(`Expected tab alert dismiss call, got ${JSON.stringify(calls)}`);
}
if (timers.map((entry) => entry.delay).join(',') !== '240,240') {
  throw new Error(`Expected only cleanup timers after same-frame removal, got ${timers.map((entry) => entry.delay).join(',')}`);
}
"""
    result = _run_status_events_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout
