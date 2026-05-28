from pathlib import Path
import subprocess


def _run_contact_selection_harness(harness_body: str) -> subprocess.CompletedProcess[str]:
    module_path = Path(__file__).resolve().parents[1] / 'static' / 'modules' / 'chat-contact-selection-runtime.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

const source = await readFile({str(module_path)!r}, 'utf8');
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


def test_first_mobile_contact_activation_opens_chat_without_reveal_motion():
    harness_body = """
globalThis.CustomEvent = class CustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
};

let clickHandler = null;
let currentChatId = null;
const openCalls = [];
const attrs = new Map([
  ['data-chat-id', 'chat-1'],
  ['data-contact-id', 'contact-1'],
  ['data-contact-username', 'alice'],
  ['data-is-group', '0'],
  ['data-public-key', 'pub'],
]);
const contactItem = {
  dataset: {},
  hidden: false,
  style: { display: '' },
  getAttribute: (name) => attrs.get(name) || '',
  matches: (selector) => selector === '.contact-item[data-chat-id]',
  closest: () => null,
  querySelector: (selector) => selector === '.contact-name' ? { textContent: 'Alice' } : null,
};
const contactsList = {
  contains: (node) => node === contactItem,
  querySelectorAll: () => [contactItem],
  addEventListener(type, callback) {
    if (type === 'click') clickHandler = callback;
  },
};
const documentRef = {
  getElementById: () => null,
  dispatchEvent: () => {},
};

moduleApi.bindChatContactSelectionRuntime({
  windowRef: { innerWidth: 390 },
  documentRef,
  contactsList,
  messageInput: { value: '' },
  chatArea: { classList: { toggle: () => {}, remove: () => {} } },
  chatTitle: { textContent: '' },
  tabAlertController: { clearAlertForChat: () => {} },
  getCurrentChatId: () => currentChatId,
  setCurrentChatId: (value) => { currentChatId = value; },
  setCurrentContactId: () => {},
  getChatState: () => ({}),
  savedMessagesUi: { applyChatMode: () => false, syncCurrentChatMeta: () => {} },
  onlineStatusController: { reset: () => {} },
  fetchChatHistory: () => Promise.resolve(),
  isMobileViewport: () => true,
  openChat: (options) => { openCalls.push(options); },
  emitSocket: () => {},
  isChatBlocked: () => false,
  getHasAttemptedInitialChatRestore: () => true,
});

if (typeof clickHandler !== 'function') {
  throw new Error('Expected click handler to be bound');
}

clickHandler({ target: { closest: () => contactItem } });

if (openCalls.length !== 1 || openCalls[0].animated !== false) {
  throw new Error(`Expected first mobile open without reveal motion, got ${JSON.stringify(openCalls)}`);
}
"""
    result = _run_contact_selection_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_mobile_contact_switch_keeps_reveal_motion_after_chat_is_active():
    harness_body = """
globalThis.CustomEvent = class CustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
};

let clickHandler = null;
let currentChatId = 'chat-old';
const openCalls = [];
const attrs = new Map([
  ['data-chat-id', 'chat-2'],
  ['data-contact-id', 'contact-2'],
  ['data-contact-username', 'bob'],
  ['data-is-group', '0'],
  ['data-public-key', 'pub'],
]);
const contactItem = {
  dataset: {},
  hidden: false,
  style: { display: '' },
  getAttribute: (name) => attrs.get(name) || '',
  matches: (selector) => selector === '.contact-item[data-chat-id]',
  closest: () => null,
  querySelector: (selector) => selector === '.contact-name' ? { textContent: 'Bob' } : null,
};
const contactsList = {
  contains: (node) => node === contactItem,
  querySelectorAll: () => [contactItem],
  addEventListener(type, callback) {
    if (type === 'click') clickHandler = callback;
  },
};
const documentRef = {
  getElementById: () => null,
  dispatchEvent: () => {},
};

moduleApi.bindChatContactSelectionRuntime({
  windowRef: { innerWidth: 390 },
  documentRef,
  contactsList,
  messageInput: { value: '' },
  chatArea: { classList: { toggle: () => {}, remove: () => {} } },
  chatTitle: { textContent: '' },
  tabAlertController: { clearAlertForChat: () => {} },
  getCurrentChatId: () => currentChatId,
  setCurrentChatId: (value) => { currentChatId = value; },
  setCurrentContactId: () => {},
  getChatState: () => ({}),
  savedMessagesUi: { applyChatMode: () => false, syncCurrentChatMeta: () => {} },
  onlineStatusController: { reset: () => {} },
  fetchChatHistory: () => Promise.resolve(),
  isMobileViewport: () => true,
  openChat: (options) => { openCalls.push(options); },
  emitSocket: () => {},
  isChatBlocked: () => false,
  getHasAttemptedInitialChatRestore: () => true,
});

clickHandler({ target: { closest: () => contactItem } });

if (openCalls.length !== 1 || openCalls[0].animated !== true) {
  throw new Error(`Expected active mobile chat switch to keep reveal motion, got ${JSON.stringify(openCalls)}`);
}
"""
    result = _run_contact_selection_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout
