from pathlib import Path
import subprocess


def _run_render_harness(harness_body: str) -> subprocess.CompletedProcess[str]:
    module_path = Path(__file__).resolve().parents[1] / 'static' / 'modules' / 'chat-message-render-runtime.js'
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


def test_scroll_to_bottom_render_sets_scroll_top_before_next_frame():
    harness_body = """
const frames = [];
const state = {
  initialized: true,
  messages: [{ id: 1, created_at: '2026-01-01 00:00:00' }],
  lastRenderRange: null,
  messageHeights: new Map(),
  averageMessageHeight: 100,
  renderedKeys: new Set(),
};
const messageNode = {
  isMessage: true,
  offsetHeight: 80,
  classList: {
    remove: () => {},
    add: () => {},
    toggle: () => {},
    contains: () => false,
  },
  style: {
    removeProperty: () => {},
  },
  getAttribute: (name) => (name === 'data-message-key' ? 'id:1' : ''),
  querySelector: () => null,
  querySelectorAll: () => [],
  getBoundingClientRect: () => ({ height: 80 }),
};
const documentRef = {
  createDocumentFragment: () => ({
    children: [],
    appendChild(node) {
      if (node) this.children.push(node);
      return node;
    },
  }),
};
const chatMessages = {
  scrollTop: 20,
  scrollHeight: 300,
  clientHeight: 100,
  children: [],
  classList: { contains: () => false },
  querySelector: () => null,
  querySelectorAll: (selector) => (
    selector === '.message[data-message-key]'
      ? chatMessages.children.filter((node) => node?.isMessage)
      : []
  ),
  replaceChildren(fragment) {
    this.children = [...fragment.children];
    this.scrollHeight = 500;
  },
};

const runtime = moduleApi.createChatMessageRenderRuntime({
  documentRef,
  requestAnimationFrameFn: (callback) => {
    frames.push(callback);
    return frames.length;
  },
  cancelAnimationFrameFn: () => {},
  getCurrentChatId: () => 'chat-1',
  getCurrentContactId: () => 'contact-1',
  getChatMessages: () => chatMessages,
  getChatState: () => state,
  findMessageIndex: () => -1,
  getMessageKey: (msg) => `id:${msg.id}`,
  getMessageDayKey: () => '',
  sumEstimatedHeights: () => 500,
  getDesiredRenderRange: () => ({ start: 0, end: 1 }),
  createVirtualSpacer: (height) => ({ isSpacer: true, height }),
  createDaySeparatorNode: () => ({ isSeparator: true }),
  messageGroup: () => ({ groupClass: 'group-single' }),
  messageItem: () => messageNode,
  applyMessageEnterAnimation: () => {},
  syncMessageBubbleLayoutClasses: () => {},
  isSelectionMode: () => false,
  hasSelectedMessage: () => false,
  disconnectLazyMediaHydrationObserver: () => {},
  registerMediaElementsForLazyHydration: () => {},
  schedulePostRenderUiRefresh: () => {},
  saveChatScrollPosition: () => {},
  resizeComposerInput: () => {},
  updateChatMessagesBottomInset: () => {},
  isMobileViewport: () => false,
  triggerChatHistoryRevealAnimation: () => {},
  prefersReducedMotionSetting: () => false,
  scrollToBottom: () => {},
  syncSavedMessagesMeta: () => {},
});

runtime.renderChatMessages('chat-1', { scrollToBottom: true });

if (chatMessages.scrollTop !== 400) {
  throw new Error(`Expected immediate bottom scrollTop 400, got ${chatMessages.scrollTop}`);
}
if (frames.length === 0) {
  throw new Error('Expected follow-up frame to keep bottom pinned after layout.');
}
"""
    result = _run_render_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_force_prepend_render_can_reuse_existing_message_nodes():
    harness_body = """
const frames = [];
const state = {
  initialized: true,
  messages: [
    { id: 1, created_at: '2026-01-01 00:00:00' },
    { id: 2, created_at: '2026-01-01 00:01:00' },
  ],
  lastRenderRange: { start: 0, end: 1 },
  messageHeights: new Map([['id:1', 80]]),
  averageMessageHeight: 80,
  renderedKeys: new Set(['id:1']),
};
function makeClassList() {
  const names = new Set();
  return {
    add: (name) => names.add(name),
    remove: (name) => names.delete(name),
    toggle: (name, enabled) => enabled ? names.add(name) : names.delete(name),
    contains: (name) => names.has(name),
  };
}
function makeMessageNode(key) {
  return {
    isMessage: true,
    offsetHeight: 80,
    classList: makeClassList(),
    style: { removeProperty: () => {} },
    getAttribute: (name) => (name === 'data-message-key' ? key : ''),
    querySelector: () => null,
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ height: 80 }),
  };
}
const existingNode = makeMessageNode('id:1');
let messageItemCalls = [];
const documentRef = {
  createDocumentFragment: () => ({
    children: [],
    appendChild(node) {
      if (node) this.children.push(node);
      return node;
    },
  }),
};
const chatMessages = {
  scrollTop: 20,
  scrollHeight: 300,
  clientHeight: 100,
  childNodes: [existingNode],
  classList: { contains: () => false },
  querySelector: () => null,
  querySelectorAll: (selector) => (
    selector === '.message[data-message-key]'
      ? chatMessages.childNodes.filter((node) => node?.isMessage)
      : []
  ),
  insertBefore(node, before) {
    const currentIndex = this.childNodes.indexOf(node);
    if (currentIndex >= 0) this.childNodes.splice(currentIndex, 1);
    const beforeIndex = before ? this.childNodes.indexOf(before) : -1;
    if (beforeIndex >= 0) this.childNodes.splice(beforeIndex, 0, node);
    else this.childNodes.push(node);
    return node;
  },
  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index >= 0) this.childNodes.splice(index, 1);
    return node;
  },
};

const runtime = moduleApi.createChatMessageRenderRuntime({
  documentRef,
  requestAnimationFrameFn: (callback) => {
    frames.push(callback);
    return frames.length;
  },
  cancelAnimationFrameFn: () => {},
  getCurrentChatId: () => 'chat-1',
  getCurrentContactId: () => 'contact-1',
  getChatMessages: () => chatMessages,
  getChatState: () => state,
  getMessageKey: (msg) => `id:${msg.id}`,
  getMessageDayKey: () => '',
  sumEstimatedHeights: () => 160,
  getDesiredRenderRange: () => ({ start: 0, end: 2 }),
  createVirtualSpacer: (height) => ({
    isSpacer: true,
    height,
    style: { height: `${height}px` },
    classList: { contains: (name) => name === 'chat-virtual-spacer' },
  }),
  createDaySeparatorNode: () => ({ isSeparator: true }),
  messageGroup: () => ({ groupClass: 'group-single' }),
  messageItem: (msg) => {
    messageItemCalls.push(msg.id);
    if (msg.id === 1) throw new Error('Existing media node was remounted');
    return makeMessageNode(`id:${msg.id}`);
  },
  applyMessageEnterAnimation: () => {},
  syncMessageBubbleLayoutClasses: () => {},
  isSelectionMode: () => false,
  hasSelectedMessage: () => false,
  registerMediaElementsForLazyHydration: () => {},
  unregisterMediaElementsForLazyHydration: () => {},
  schedulePostRenderUiRefresh: () => {},
  saveChatScrollPosition: () => {},
  resizeComposerInput: () => {},
  updateChatMessagesBottomInset: () => {},
  isMobileViewport: () => false,
  prefersReducedMotionSetting: () => false,
  scrollToBottom: () => {},
  syncSavedMessagesMeta: () => {},
});

runtime.renderChatMessages('chat-1', { force: true, reuseExistingNodes: true });

if (messageItemCalls.length !== 1 || messageItemCalls[0] !== 2) {
  throw new Error(`Expected only new message to mount, got ${JSON.stringify(messageItemCalls)}`);
}
if (!chatMessages.childNodes.includes(existingNode)) {
  throw new Error('Existing node was removed from the rendered list');
}
"""
    result = _run_render_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout
