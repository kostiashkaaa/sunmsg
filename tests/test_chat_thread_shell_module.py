from pathlib import Path
import subprocess


def _run_thread_shell_harness(harness_body: str) -> subprocess.CompletedProcess[str]:
    module_path = Path(__file__).resolve().parents[1] / 'static' / 'chat' / 'thread-shell.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

let source = await readFile({str(module_path)!r}, 'utf8');
source = source.replace(
  /import\\s*\\{{\\s*waitForMotionEnd\\s*\\}}\\s*from\\s*['"]\\.\\.\\/modules\\/motion\\.js['"];\\s*/,
  ''
);
source = source.replace(
  /import\\s*\\{{\\s*showChatSkeleton\\s*\\}}\\s*from\\s*['"]\\.\\.\\/modules\\/chat-skeleton-ui\\.js['"];\\s*/,
  'const showChatSkeleton = (chatMessages) => {{ const row = {{ className: "chat-skeleton-row", remove() {{ const index = chatMessages.childNodes.indexOf(row); if (index >= 0) chatMessages.childNodes.splice(index, 1); }} }}; chatMessages.prepend(row); return () => row.remove(); }};'
);
source = source.replace(
  /export\\s+function\\s+createThreadShell/,
  'function createThreadShell'
);
source = source.replace(
  /export\\s+function\\s+createMobileThreadShell/,
  'function createMobileThreadShell'
);
source += '\\nexport {{ createThreadShell, createMobileThreadShell }};';
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


def test_mobile_reopen_ignores_stale_close_transition():
    harness_body = """
const pendingMotion = [];
globalThis.waitForMotionEnd = (element, fallbackMs) => new Promise((resolve) => {
  pendingMotion.push({ element, fallbackMs, resolve });
});

function createClassList(initial = []) {
  const names = new Set(initial);
  return {
    add: (...items) => items.forEach((item) => names.add(item)),
    remove: (...items) => items.forEach((item) => names.delete(item)),
    contains: (item) => names.has(item),
    values: () => Array.from(names).sort(),
  };
}

function createStyle(initial = {}) {
  const data = { ...initial };
  return {
    get display() {
      return data.display || '';
    },
    set display(value) {
      data.display = String(value || '');
    },
    setProperty(name, value) {
      data[name] = String(value);
    },
    removeProperty(name) {
      delete data[name];
    },
  };
}

const chatArea = {
  classList: createClassList(['mobile-open']),
  style: createStyle(),
  get offsetWidth() {
    return 320;
  },
};
const sidebar = {
  classList: createClassList(),
  style: createStyle({ display: 'none' }),
};

let focusCalls = 0;
let leaveCalls = 0;
const shell = moduleApi.createMobileThreadShell({
  chatArea,
  sidebar,
  prefersReducedMotion: () => false,
  scheduleComposerFocus: () => { focusCalls += 1; },
  leaveCurrentChatRoom: () => { leaveCalls += 1; },
  isMobileViewport: () => true,
});

shell.closeMobileChatView({ leaveRoom: false, animated: true });
if (!chatArea.classList.contains('mobile-closing')) {
  throw new Error('Expected close animation to start before reopen');
}
if (pendingMotion.length !== 1 || pendingMotion[0].element !== chatArea) {
  throw new Error(`Expected one pending close motion, got ${pendingMotion.length}`);
}

shell.openChat();
if (!chatArea.classList.contains('mobile-open')) {
  throw new Error('Reopen should keep chat marked mobile-open');
}
if (chatArea.classList.contains('mobile-closing')) {
  throw new Error('Reopen should clear mobile-closing immediately');
}
if (pendingMotion.length !== 3) {
  throw new Error(`Expected close plus two open motion waits, got ${pendingMotion.length}`);
}

pendingMotion[0].resolve();
await Promise.resolve();

if (!chatArea.classList.contains('mobile-open')) {
  throw new Error(`Stale close transition removed mobile-open: ${chatArea.classList.values().join(',')}`);
}
if (!chatArea.classList.contains('mobile-revealing')) {
  throw new Error(`Stale close transition removed mobile-revealing: ${chatArea.classList.values().join(',')}`);
}
if (!sidebar.classList.contains('mobile-hiding')) {
  throw new Error(`Stale close transition removed mobile-hiding: ${sidebar.classList.values().join(',')}`);
}
if (leaveCalls !== 0) {
  throw new Error(`Unexpected leave room calls: ${leaveCalls}`);
}
if (focusCalls !== 1) {
  throw new Error(`Expected reopen to schedule one composer focus, got ${focusCalls}`);
}
"""
    result = _run_thread_shell_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_stage_loading_does_not_mutate_message_scroll_container():
    harness_body = """
function createClassList(initial = []) {
  const names = new Set(initial);
  return {
    add: (...items) => items.forEach((item) => names.add(item)),
    remove: (...items) => items.forEach((item) => names.delete(item)),
    contains: (item) => names.has(item),
    toggle: (item, force) => {
      const enabled = force === undefined ? !names.has(item) : Boolean(force);
      if (enabled) names.add(item);
      else names.delete(item);
      return enabled;
    },
  };
}

function createStyle(initial = {}) {
  const data = { ...initial };
  return {
    get display() {
      return data.display || '';
    },
    set display(value) {
      data.display = String(value || '');
    },
  };
}

function createElement(initialClasses = []) {
  const attrs = new Map();
  return {
    childNodes: [],
    classList: createClassList(initialClasses),
    style: createStyle(),
    setAttribute(name, value) {
      attrs.set(name, String(value));
    },
    getAttribute(name) {
      return attrs.has(name) ? attrs.get(name) : null;
    },
    removeAttribute(name) {
      attrs.delete(name);
    },
    querySelector(selector) {
      if (selector !== '.message') return null;
      return this.childNodes.find((node) => node.classList?.contains('message')) || null;
    },
    prepend(...nodes) {
      this.childNodes.unshift(...nodes);
    },
  };
}

const chatMessages = createElement(['chat-messages']);
const stageLoader = createElement();
const historyLoader = createElement();
const shell = moduleApi.createThreadShell({
  historyLoadingIndicator: historyLoader,
  chatStageLoader: stageLoader,
  getCurrentChatId: () => 'chat-1',
  getChatMessagesElement: () => chatMessages,
});

shell.setChatStageLoading(true);

if (chatMessages.childNodes.length !== 0) {
  throw new Error(`Stage loading mutated chatMessages children: ${chatMessages.childNodes.length}`);
}
if (chatMessages.getAttribute('aria-busy') !== 'true') {
  throw new Error('Stage loading should mark chatMessages aria-busy');
}
if (!stageLoader.classList.contains('active')) {
  throw new Error('Stage loader should become active');
}
if (historyLoader.classList.contains('active')) {
  throw new Error('History loader should be hidden while stage loader is active');
}

shell.setChatStageLoading(false);

if (chatMessages.childNodes.length !== 0) {
  throw new Error(`Stage loading cleanup mutated chatMessages children: ${chatMessages.childNodes.length}`);
}
if (chatMessages.getAttribute('aria-busy') !== null) {
  throw new Error('Stage loading should clear chatMessages aria-busy');
}
if (stageLoader.classList.contains('active')) {
  throw new Error('Stage loader should become inactive');
}
"""
    result = _run_thread_shell_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_mobile_open_can_skip_reveal_motion_for_initial_restore():
    harness_body = """
const pendingMotion = [];
globalThis.waitForMotionEnd = (element, fallbackMs) => new Promise((resolve) => {
  pendingMotion.push({ element, fallbackMs, resolve });
});

function createClassList(initial = []) {
  const names = new Set(initial);
  return {
    add: (...items) => items.forEach((item) => names.add(item)),
    remove: (...items) => items.forEach((item) => names.delete(item)),
    contains: (item) => names.has(item),
    values: () => Array.from(names).sort(),
  };
}

function createStyle(initial = {}) {
  const data = { ...initial };
  return {
    get display() {
      return data.display || '';
    },
    set display(value) {
      data.display = String(value || '');
    },
    setProperty(name, value) {
      data[name] = String(value);
    },
    removeProperty(name) {
      delete data[name];
    },
  };
}

const chatArea = {
  classList: createClassList(),
  style: createStyle(),
  get offsetWidth() {
    throw new Error('Instant boot restore must not force animation reflow');
  },
};
const sidebar = {
  classList: createClassList(),
  style: createStyle(),
};

const focusCalls = [];
const shell = moduleApi.createMobileThreadShell({
  chatArea,
  sidebar,
  prefersReducedMotion: () => false,
  scheduleComposerFocus: (options) => { focusCalls.push(options); },
  leaveCurrentChatRoom: () => {},
  isMobileViewport: () => true,
});

shell.openChat({ animated: false });

if (!chatArea.classList.contains('mobile-open')) {
  throw new Error('Instant open should mark chat mobile-open');
}
if (chatArea.classList.contains('mobile-revealing')) {
  throw new Error(`Instant open should not add mobile-revealing: ${chatArea.classList.values().join(',')}`);
}
if (sidebar.classList.contains('mobile-hiding')) {
  throw new Error(`Instant open should not animate sidebar hiding: ${sidebar.classList.values().join(',')}`);
}
if (sidebar.style.display !== 'none') {
  throw new Error(`Instant open should hide sidebar immediately, got ${sidebar.style.display}`);
}
if (pendingMotion.length !== 0) {
  throw new Error(`Instant open should not wait for motion, got ${pendingMotion.length}`);
}
if (focusCalls.length !== 1 || focusCalls[0].delay !== 0 || focusCalls[0].force !== true) {
  throw new Error(`Instant open should schedule immediate composer focus: ${JSON.stringify(focusCalls)}`);
}
"""
    result = _run_thread_shell_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_mobile_close_ignores_stale_open_transition():
    harness_body = """
const pendingMotion = [];
globalThis.waitForMotionEnd = (element, fallbackMs) => new Promise((resolve) => {
  pendingMotion.push({ element, fallbackMs, resolve });
});

function createClassList(initial = []) {
  const names = new Set(initial);
  return {
    add: (...items) => items.forEach((item) => names.add(item)),
    remove: (...items) => items.forEach((item) => names.delete(item)),
    contains: (item) => names.has(item),
    values: () => Array.from(names).sort(),
  };
}

function createStyle(initial = {}) {
  const data = { ...initial };
  return {
    get display() {
      return data.display || '';
    },
    set display(value) {
      data.display = String(value || '');
    },
    setProperty(name, value) {
      data[name] = String(value);
    },
    removeProperty(name) {
      delete data[name];
    },
  };
}

const chatArea = {
  classList: createClassList(),
  style: createStyle(),
  get offsetWidth() {
    return 320;
  },
};
const sidebar = {
  classList: createClassList(),
  style: createStyle(),
};

let leaveCalls = 0;
const shell = moduleApi.createMobileThreadShell({
  chatArea,
  sidebar,
  prefersReducedMotion: () => false,
  scheduleComposerFocus: () => {},
  leaveCurrentChatRoom: () => { leaveCalls += 1; },
  isMobileViewport: () => true,
});

shell.openChat();
if (!chatArea.classList.contains('mobile-revealing') || !sidebar.classList.contains('mobile-hiding')) {
  throw new Error('Expected open animation to start before close');
}
if (pendingMotion.length !== 2) {
  throw new Error(`Expected two pending open motion waits, got ${pendingMotion.length}`);
}

shell.closeMobileChatView({ leaveRoom: false, animated: true });
if (!chatArea.classList.contains('mobile-closing')) {
  throw new Error('Expected close animation to start after open');
}
if (chatArea.classList.contains('mobile-revealing')) {
  throw new Error('Close should cancel the open animation class immediately');
}
if (!sidebar.classList.contains('mobile-returning')) {
  throw new Error('Close should keep sidebar returning while chat exits');
}
if (pendingMotion.length !== 3) {
  throw new Error(`Expected two open waits plus one close wait, got ${pendingMotion.length}`);
}

pendingMotion[0].resolve();
pendingMotion[1].resolve();
await Promise.resolve();
await Promise.resolve();

if (!chatArea.classList.contains('mobile-closing')) {
  throw new Error(`Stale open transition removed mobile-closing: ${chatArea.classList.values().join(',')}`);
}
if (chatArea.classList.contains('mobile-revealing')) {
  throw new Error(`Stale open transition restored mobile-revealing: ${chatArea.classList.values().join(',')}`);
}
if (!sidebar.classList.contains('mobile-returning')) {
  throw new Error(`Stale open transition removed mobile-returning: ${sidebar.classList.values().join(',')}`);
}
if (sidebar.style.display === 'none') {
  throw new Error('Stale open transition hid sidebar during close animation');
}

pendingMotion[2].resolve();
await Promise.resolve();

if (chatArea.classList.contains('mobile-revealing') || chatArea.classList.contains('mobile-closing')) {
  throw new Error(`Close completion left transition classes behind: ${chatArea.classList.values().join(',')}`);
}
if (chatArea.classList.contains('mobile-open')) {
  throw new Error(`Close completion left chat mobile-open: ${chatArea.classList.values().join(',')}`);
}
if (sidebar.classList.contains('mobile-returning') || sidebar.classList.contains('mobile-hiding')) {
  throw new Error(`Close completion left sidebar transition classes behind: ${sidebar.classList.values().join(',')}`);
}
if (leaveCalls !== 0) {
  throw new Error(`Unexpected leave room calls: ${leaveCalls}`);
}
"""
    result = _run_thread_shell_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout
