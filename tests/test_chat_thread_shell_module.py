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
  'const showChatSkeleton = () => () => {{}};'
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
