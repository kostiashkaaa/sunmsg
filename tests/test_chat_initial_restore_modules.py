from pathlib import Path
import subprocess


def _run_module_harness(module_relative_path: str, harness_body: str) -> subprocess.CompletedProcess[str]:
    module_path = Path(__file__).resolve().parents[1] / module_relative_path
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


def test_last_active_restore_marks_contact_during_click_and_clears_flag():
    harness_body = """
const contactItem = {
  dataset: {},
  clickCount: 0,
  getAttribute(name) {
    return name === 'data-chat-id' ? 'chat-1' : '';
  },
  click() {
    this.clickCount += 1;
    if (this.dataset.chatInitialRestore !== '1') {
      throw new Error(`Expected restore flag during click, got ${this.dataset.chatInitialRestore}`);
    }
  },
};
const contactsList = {
  querySelectorAll(selector) {
    if (selector !== '.contact-item') {
      throw new Error(`Unexpected selector ${selector}`);
    }
    return [contactItem];
  },
};
const syncedItems = [];

const controller = moduleApi.createLastActiveChatController({
  storageKey: 'sun:last-chat',
  storage: null,
  getStoredString: () => '',
  setStoredString: () => {},
  contactsList,
  initialRequestedChatId: 'chat-1',
  syncBrowserUrlForActiveChat: (item) => syncedItems.push(item),
});

const restored = controller.restoreLastActiveChatSelection();
if (!restored) {
  throw new Error('Expected requested chat to be restored');
}
if (contactItem.clickCount !== 1) {
  throw new Error(`Expected one click, got ${contactItem.clickCount}`);
}
if (Object.prototype.hasOwnProperty.call(contactItem.dataset, 'chatInitialRestore')) {
  throw new Error('Restore flag should be cleared after click returns');
}
if (syncedItems.length !== 1 || syncedItems[0] !== contactItem) {
  throw new Error('Expected restored contact to sync browser URL');
}
"""
    result = _run_module_harness('static/modules/chat-last-active-chat.js', harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_contact_selection_initial_restore_waits_for_history_and_skips_mobile_motion():
    harness_body = """
globalThis.CustomEvent = class CustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
};

const listeners = {};
const chatArea = {
  classList: {
    toggles: [],
    toggle(name, enabled) {
      this.toggles.push([name, enabled]);
    },
  },
};
const chatTitle = { textContent: '' };
const documentEvents = [];
const documentRef = {
  getElementById: () => null,
  dispatchEvent: (event) => documentEvents.push(event),
};
const contactsList = {
  addEventListener(type, handler) {
    listeners[type] = handler;
  },
  contains(item) {
    return item === contactItem;
  },
  querySelectorAll() {
    return [contactItem];
  },
};
const contactItem = {
  dataset: { chatInitialRestore: '1' },
  hidden: false,
  style: {},
  tabIndex: 0,
  matches(selector) {
    return selector === '.contact-item[data-chat-id]';
  },
  closest(selector) {
    return selector === '.contact-item' ? this : null;
  },
  getBoundingClientRect() {
    return { top: 0, bottom: 20 };
  },
  getAttribute(name) {
    const values = {
      'data-chat-id': 'chat-1',
      'data-contact-id': 'user-1',
      'data-public-key': 'public-key',
      'data-is-group': '0',
      'data-blocked-by-me': '0',
      'data-blocked-me': '0',
      'data-members-count': '0',
      'data-contact-username': 'sun',
    };
    return values[name] || '';
  },
  querySelector(selector) {
    if (selector === '.contact-name') {
      return { textContent: 'Sun User' };
    }
    return null;
  },
  focus() {},
};
const started = [];
const settled = [];
const openCalls = [];
const fetchedChatIds = [];
let resolveHistory;
const historyPromise = new Promise((resolve) => {
  resolveHistory = resolve;
});

moduleApi.bindChatContactSelectionRuntime({
  windowRef: { innerWidth: 390 },
  documentRef,
  contactsList,
  chatArea,
  chatTitle,
  tabAlertController: { clearAlertForChat: () => {} },
  savedMessagesUi: {
    applyChatMode: () => false,
    syncCurrentChatMeta: () => {},
  },
  onlineStatusController: { reset: () => {} },
  setCurrentPartnerLegacyGlobals: () => ({ partnerId: 'user-1' }),
  getChatState: () => ({}),
  fetchChatHistory: (chatId) => {
    fetchedChatIds.push(chatId);
    return historyPromise;
  },
  isMobileViewport: () => true,
  openChat: (options) => openCalls.push(options),
  onInitialChatRestoreStart: () => started.push('start'),
  onInitialChatRestoreSettled: () => settled.push('settled'),
  getHasAttemptedInitialChatRestore: () => true,
});

listeners.click({ target: contactItem });
if (started.length !== 1) {
  throw new Error(`Expected one initial restore start, got ${started.length}`);
}
if (settled.length !== 0) {
  throw new Error(`Initial restore should wait for history before settling, got ${settled.length}`);
}
if (fetchedChatIds.length !== 1 || fetchedChatIds[0] !== 'chat-1') {
  throw new Error(`Expected history load for chat-1, got ${JSON.stringify(fetchedChatIds)}`);
}
if (openCalls.length !== 1 || openCalls[0].animated !== false) {
  throw new Error(`Expected mobile open without animation, got ${JSON.stringify(openCalls)}`);
}
if (documentEvents.length !== 1 || documentEvents[0].detail.chatId !== 'chat-1') {
  throw new Error('Expected chat opened event for restored chat');
}

resolveHistory();
await historyPromise;
await Promise.resolve();

if (settled.length !== 1) {
  throw new Error(`Expected restore to settle after history, got ${settled.length}`);
}
"""
    result = _run_module_harness('static/modules/chat-contact-selection-runtime.js', harness_body)
    assert result.returncode == 0, result.stderr or result.stdout
