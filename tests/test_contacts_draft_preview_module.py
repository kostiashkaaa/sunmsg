from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def _run_contacts_harness(harness_body: str) -> subprocess.CompletedProcess[str]:
    module_path = ROOT / 'static' / 'modules' / 'contacts.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

let source = await readFile({str(module_path)!r}, 'utf8');
source = source.replace(
  /import\\s*\\{{[\\s\\S]*?\\}}\\s*from\\s*['"]\\.\\/utils\\.js['"];\\s*/,
  `const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const formatSidebarTime = (value) => String(value || '');
const renderMessagePreviewHtml = (message) => 'preview:' + escapeHtml(message);
const applyEmojiGraphics = () => {{}};`
);
source = source.replace(
  /import\\s*\\{{[\\s\\S]*?\\}}\\s*from\\s*['"]\\.\\/check-glyph\\.js['"];\\s*/,
  `const STANDARD_SINGLE_CHECK_TICK_HTML = 'sent';
const STANDARD_DOUBLE_CHECK_TICK_HTML = 'read';`
);
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64');
const moduleApi = await import(moduleUrl);

globalThis.document = {{
  body: {{ dataset: {{ uiLanguage: 'en' }} }},
}};

{harness_body}
"""
    return subprocess.run(
        ['node', '--input-type=module', '-e', node_harness],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


def _run_contacts_sidebar_harness(harness_body: str) -> subprocess.CompletedProcess[str]:
    module_path = ROOT / 'static' / 'modules' / 'chat-contacts-sidebar.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

let source = await readFile({str(module_path)!r}, 'utf8');
source = source.replace(
  "import {{ withAppRoot }} from './app-url.js';",
  "const withAppRoot = (path) => path;",
);
source = source.replace(
  /import \\{{[\\s\\S]*?\\}} from '\\.\\/motion\\.js';/,
  `const applyListPerfGuard = () => {{}};
const getMotionStaggerStartMs = () => 0;
const getMotionStaggerStepMs = () => 0;
const shouldAnimateListItem = () => false;
const waitForMotionEnd = async () => undefined;`,
);
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64');
const moduleApi = await import(moduleUrl);

globalThis.CSS = {{ escape: (value) => String(value) }};

{harness_body}
"""
    return subprocess.run(
        ['node', '--input-type=module', '-e', node_harness],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


def _run_time_format_harness(harness_body: str) -> subprocess.CompletedProcess[str]:
    module_path = ROOT / 'static' / 'modules' / 'time-format-sync.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

let source = await readFile({str(module_path)!r}, 'utf8');
source = source.replace(
  /import\\s*\\{{[\\s\\S]*?\\}}\\s*from\\s*['"]\\.\\/utils\\.js['"];\\s*/,
  `const formatTime = (value) => 'message:' + String(value || '');
const formatFullTimestamp = (value) => 'full:' + String(value || '');
const formatSidebarTime = (value) => 'sidebar:' + String(value || '');`
);
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64');
const moduleApi = await import(moduleUrl);

globalThis.window = {{
  dispatchEvent: () => {{}},
  Event: class {{}},
}};

{harness_body}
"""
    return subprocess.run(
        ['node', '--input-type=module', '-e', node_harness],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


def test_build_contact_item_hides_active_draft_preview_but_keeps_draft_metadata():
    harness_body = """
const html = moduleApi.buildContactItemHtml({
  chatId: 'chat-a',
  display_name: 'Kmr',
  username: 'kmr',
  has_draft: true,
  draft_text: 'typed draft',
  draft_updated_at: '2026-01-01T10:05:00Z',
  last_message: 'Last message',
  last_message_time: '2026-01-01T10:00:00Z',
  last_sender_id: 'me',
  last_message_is_delivered: true,
}, 'chat-a');

if (html.includes('contact-draft-label')) {
  throw new Error(`Active contact rendered draft preview: ${html}`);
}
if (!html.includes('preview:Last message')) {
  throw new Error(`Active contact did not render last message: ${html}`);
}
if (!html.includes('data-has-draft="1"') || !html.includes('data-draft-preview-hidden="1"')) {
  throw new Error(`Active draft metadata was not preserved hidden: ${html}`);
}
if (!html.includes('data-draft-text="typed draft"')) {
  throw new Error(`Active draft text metadata missing: ${html}`);
}
"""
    result = _run_contacts_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_time_format_uses_last_message_timestamp_when_active_draft_preview_hidden():
    harness_body = """
const timeEl = { textContent: '' };
const contactItem = {
  getAttribute: (name) => ({
    'data-has-draft': '1',
    'data-draft-preview-hidden': '1',
    'data-draft-updated-at': '2026-01-01T10:05:00Z',
    'data-last-message-time': '2026-01-01T10:00:00Z',
  }[name] || ''),
  querySelector: (selector) => selector === '.contact-time' ? timeEl : null,
};
const root = {
  querySelectorAll: (selector) => {
    if (selector === '.msg-time[data-created-at]') return [];
    if (selector === '.contact-item') return [contactItem];
    return [];
  },
};

moduleApi.refreshVisibleTimePreferenceRendering(root);

if (timeEl.textContent !== 'sidebar:2026-01-01T10:00:00Z') {
  throw new Error(`Expected last-message timestamp, got ${timeEl.textContent}`);
}
"""
    result = _run_time_format_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_update_active_contact_last_message_preserves_hidden_draft_metadata():
    harness_body = """
class FakeNode {
  constructor() {
    this.innerHTML = '';
    this._outerHTML = '';
    this.style = { display: 'none' };
  }

  set outerHTML(value) {
    this._outerHTML = String(value);
  }

  get outerHTML() {
    return this._outerHTML;
  }
}

class FakeContact {
  constructor() {
    this.attrs = new Map([
      ['data-saved-messages', '0'],
      ['data-draft-updated-at', '2026-01-01T10:04:00Z'],
    ]);
    this.lastMsg = new FakeNode();
    this.timeMeta = new FakeNode();
  }

  getAttribute(name) {
    return this.attrs.get(name) || '';
  }

  setAttribute(name, value) {
    this.attrs.set(name, String(value));
  }

  removeAttribute(name) {
    this.attrs.delete(name);
  }

  querySelector(selector) {
    if (selector === '.contact-last-msg') return this.lastMsg;
    if (selector === '.contact-time-meta') return this.timeMeta;
    return null;
  }
}

const item = new FakeContact();
moduleApi.updateActiveContactLastMessage(
  item,
  'Last message',
  true,
  { is_delivered: true },
  '2026-01-01T10:00:00Z',
  {
    preserveDraft: true,
    draftText: 'typed draft',
    draftUpdatedAt: '2026-01-01T10:05:00Z',
  },
);

if (item.lastMsg.innerHTML.includes('typed draft') || !item.lastMsg.innerHTML.includes('Last message')) {
  throw new Error(`Visible preview is wrong: ${item.lastMsg.innerHTML}`);
}
if (item.getAttribute('data-has-draft') !== '1') {
  throw new Error('Draft flag was not preserved');
}
if (item.getAttribute('data-draft-text') !== 'typed draft') {
  throw new Error(`Draft text was not preserved: ${item.getAttribute('data-draft-text')}`);
}
if (item.getAttribute('data-draft-preview-hidden') !== '1') {
  throw new Error('Draft preview was not marked hidden');
}
if (item.getAttribute('data-last-message-time') !== '2026-01-01T10:00:00Z') {
  throw new Error(`Last message timestamp changed incorrectly: ${item.getAttribute('data-last-message-time')}`);
}
"""
    result = _run_contacts_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_contacts_refresh_does_not_render_active_chat_draft_preview():
    harness_body = """
class FakeContactItem {
  constructor() {
    this.attrs = new Map();
  }

  getAttribute(name) {
    return this.attrs.get(name) || '';
  }

  setAttribute(name, value) {
    this.attrs.set(name, String(value));
  }

  querySelector() {
    return null;
  }
}

const existing = new FakeContactItem();
const updateCalls = [];
globalThis.document = {
  querySelector: (selector) => selector.includes('chat-a') ? existing : null,
  documentElement: {
    classList: { contains: () => false },
    getAttribute: () => 'full',
  },
};
globalThis.window = {
  matchMedia: () => ({ matches: false }),
};

const controller = moduleApi.initChatContactsSidebar({
  contactsList: null,
  escapeHtml: (value) => String(value ?? ''),
  getPrivateKeyPem: () => '',
  isEncryptedPayload: () => false,
  decryptForDisplay: async (value) => value,
  getCurrentUserId: () => 'me',
  getCurrentChatId: () => 'chat-a',
  applyPinnedState: () => {},
  sortContactsList: () => {},
  buildContactItemHtml: () => '',
  applyEmojiGraphics: () => {},
  applyChatBlockState: () => {},
  updateActiveContactLastMessage: (...args) => updateCalls.push(args),
  hideSidebarTyping: () => {},
  getPinnedContactsCount: () => 0,
  showToast: () => {},
  restoreLastActiveChatSelection: () => {},
  hasAttemptedInitialChatRestore: () => true,
  setHasAttemptedInitialChatRestore: () => {},
  hideAppBootOverlay: () => {},
  onRemovedChatState: () => {},
  clearStoredLastActiveChatId: () => {},
  getStoredLastActiveChatId: () => '',
  onContactRendered: () => {},
});

await controller.updateContact({
  chatId: 'chat-a',
  userId: 'user-a',
  username: 'kmr',
  display_name: 'Kmr',
  has_draft: true,
  draft_text: 'typed draft',
  draft_updated_at: '2026-01-01T10:05:00Z',
  last_message: 'Last message',
  last_message_time: '2026-01-01T10:00:00Z',
  last_sender_id: 'me',
  last_message_is_delivered: true,
});

const call = updateCalls[0];
if (!call) {
  throw new Error('Expected active contact preview update');
}
const [item, message, isSelf, status, timestamp, options] = call;
if (item !== existing || message !== 'Last message' || isSelf !== true) {
  throw new Error(`Wrong visible preview args: ${JSON.stringify({ message, isSelf })}`);
}
if (timestamp !== '2026-01-01T10:00:00Z' || status.is_delivered !== true) {
  throw new Error(`Wrong last-message metadata: ${JSON.stringify({ timestamp, status })}`);
}
if (options.isDraft !== false || options.preserveDraft !== true || options.draftText !== 'typed draft') {
  throw new Error(`Draft should be hidden but preserved: ${JSON.stringify(options)}`);
}
"""
    result = _run_contacts_sidebar_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_contacts_refresh_keeps_sidebar_shell_off_when_rows_are_already_rendered():
    harness_body = """
class FakeClassList {
  constructor(names = []) {
    this.names = new Set(names);
  }

  add(name) {
    this.names.add(name);
  }

  remove(name) {
    this.names.delete(name);
  }

  contains(name) {
    return this.names.has(name);
  }

  toggle(name, force) {
    const enabled = Boolean(force);
    if (enabled) {
      this.add(name);
    } else {
      this.remove(name);
    }
    return enabled;
  }
}

class FakeContactItem {
  constructor(chatId) {
    this.attrs = new Map([['data-chat-id', chatId]]);
    this.classList = new FakeClassList();
  }

  getAttribute(name) {
    return this.attrs.get(name) || '';
  }

  setAttribute(name, value) {
    this.attrs.set(name, String(value));
  }

  removeAttribute(name) {
    this.attrs.delete(name);
  }

  querySelector() {
    return null;
  }

  remove() {
    this.removed = true;
  }
}

const existing = new FakeContactItem('chat-a');
const sidebar = {
  attrs: new Map(),
  classList: new FakeClassList(),
  setAttribute(name, value) {
    this.attrs.set(name, String(value));
  },
};
const loadingEvents = [];
const contactsList = {
  dataset: {},
  children: [existing],
  scrollTop: 24,
  scrollHeight: 160,
  classList: new FakeClassList(),
  closest: (selector) => selector === '.sidebar' ? sidebar : null,
  setAttribute(name, value) {
    this.attrs = this.attrs || new Map();
    this.attrs.set(name, String(value));
  },
  dispatchEvent(event) {
    loadingEvents.push(event.detail);
  },
  querySelector(selector) {
    if (selector === '.contact-item[data-chat-id]') return existing;
    if (selector === '.contact-last-msg-loading') return null;
    return null;
  },
  querySelectorAll(selector) {
    if (selector === '.contact-item[data-chat-id]') return [existing];
    return [];
  },
};

let resolveFetch;
globalThis.CustomEvent = class {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
};
globalThis.document = {
  querySelector: (selector) => selector.includes('chat-a') ? existing : null,
  documentElement: {
    classList: { contains: () => false },
    getAttribute: () => 'full',
  },
};
globalThis.window = {
  authFetch: () => new Promise((resolve) => { resolveFetch = resolve; }),
  requestAnimationFrame: (callback) => callback(),
  matchMedia: () => ({ matches: false }),
  e2e: {},
};

const controller = moduleApi.initChatContactsSidebar({
  contactsList,
  escapeHtml: (value) => String(value ?? ''),
  getPrivateKeyPem: () => '',
  isEncryptedPayload: () => false,
  decryptForDisplay: async (value) => value,
  getCurrentUserId: () => 'me',
  getCurrentChatId: () => 'chat-a',
  applyPinnedState: () => {},
  sortContactsList: () => {},
  buildContactItemHtml: () => '',
  applyEmojiGraphics: () => {},
  applyChatBlockState: () => {},
  updateActiveContactLastMessage: () => {},
  hideSidebarTyping: () => {},
  getPinnedContactsCount: () => 0,
  showToast: () => {},
  restoreLastActiveChatSelection: () => {},
  hasAttemptedInitialChatRestore: () => true,
  setHasAttemptedInitialChatRestore: () => {},
  hideAppBootOverlay: () => {},
  onRemovedChatState: () => {},
  clearStoredLastActiveChatId: () => {},
  getStoredLastActiveChatId: () => '',
  onContactRendered: () => {},
});

const pending = controller.loadContactsNow();

if (sidebar.classList.contains('sidebar--loading')) {
  throw new Error('Rendered sidebar rows must not be replaced by the blocking loading shell.');
}
if (contactsList.classList.contains('contacts-list--loading')) {
  throw new Error('Rendered contacts list must not enter full loading shimmer during refresh.');
}
if (contactsList.dataset.contactsLoading !== '1' || contactsList.dataset.contactsLoadingShell !== '0') {
  throw new Error(`Wrong loading dataset: ${JSON.stringify(contactsList.dataset)}`);
}
if (!loadingEvents[0] || loadingEvents[0].shell !== false || loadingEvents[0].partial !== false) {
  throw new Error(`Wrong loading event: ${JSON.stringify(loadingEvents[0])}`);
}

resolveFetch({
  json: async () => ({
    success: true,
    contacts: [{
      chatId: 'chat-a',
      userId: 'user-a',
      username: 'kmr',
      display_name: 'Kmr',
      last_message: 'after delete',
      last_message_time: '2026-01-01T10:10:00Z',
      last_sender_id: 'me',
      unreadCount: 0,
    }],
  }),
});
await pending;

if (contactsList.dataset.contactsLoading !== '0' || contactsList.dataset.contactsLoadingShell !== '0') {
  throw new Error(`Loading state was not cleared: ${JSON.stringify(contactsList.dataset)}`);
}
"""
    result = _run_contacts_sidebar_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_contacts_refresh_uses_sidebar_shell_when_no_rows_exist_yet():
    harness_body = """
class FakeClassList {
  constructor(names = []) {
    this.names = new Set(names);
  }

  add(name) {
    this.names.add(name);
  }

  remove(name) {
    this.names.delete(name);
  }

  contains(name) {
    return this.names.has(name);
  }

  toggle(name, force) {
    const enabled = Boolean(force);
    if (enabled) {
      this.add(name);
    } else {
      this.remove(name);
    }
    return enabled;
  }
}

const sidebar = {
  attrs: new Map(),
  classList: new FakeClassList(),
  setAttribute(name, value) {
    this.attrs.set(name, String(value));
  },
};
const contactsList = {
  dataset: {},
  children: [],
  scrollTop: 0,
  scrollHeight: 0,
  classList: new FakeClassList(),
  closest: (selector) => selector === '.sidebar' ? sidebar : null,
  setAttribute() {},
  dispatchEvent() {},
  querySelector: () => null,
  querySelectorAll: () => [],
};

let resolveFetch;
globalThis.CustomEvent = class {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
};
globalThis.document = {
  querySelector: () => null,
  documentElement: {
    classList: { contains: () => false },
    getAttribute: () => 'full',
  },
};
globalThis.window = {
  authFetch: () => new Promise((resolve) => { resolveFetch = resolve; }),
  requestAnimationFrame: (callback) => callback(),
  matchMedia: () => ({ matches: false }),
  e2e: {},
};

const controller = moduleApi.initChatContactsSidebar({
  contactsList,
  escapeHtml: (value) => String(value ?? ''),
  getPrivateKeyPem: () => '',
  isEncryptedPayload: () => false,
  decryptForDisplay: async (value) => value,
  getCurrentUserId: () => 'me',
  getCurrentChatId: () => '',
  applyPinnedState: () => {},
  sortContactsList: () => {},
  buildContactItemHtml: () => '',
  applyEmojiGraphics: () => {},
  applyChatBlockState: () => {},
  updateActiveContactLastMessage: () => {},
  hideSidebarTyping: () => {},
  getPinnedContactsCount: () => 0,
  showToast: () => {},
  restoreLastActiveChatSelection: () => {},
  hasAttemptedInitialChatRestore: () => true,
  setHasAttemptedInitialChatRestore: () => {},
  hideAppBootOverlay: () => {},
  onRemovedChatState: () => {},
  clearStoredLastActiveChatId: () => {},
  getStoredLastActiveChatId: () => '',
  onContactRendered: () => {},
});

const pending = controller.loadContactsNow();

if (!sidebar.classList.contains('sidebar--loading')) {
  throw new Error('Empty sidebar must still use the blocking loading shell.');
}
if (!contactsList.classList.contains('contacts-list--loading')) {
  throw new Error('Empty contacts list must expose full loading state.');
}
if (contactsList.dataset.contactsLoadingShell !== '1') {
  throw new Error(`Wrong loading dataset: ${JSON.stringify(contactsList.dataset)}`);
}

resolveFetch({ json: async () => ({ success: true, contacts: [] }) });
await pending;
"""
    result = _run_contacts_sidebar_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout
