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


def test_bottom_pinned_force_render_skips_anchor_shift_before_bottom_scroll():
    harness_body = """
const frames = [];
const scrollWrites = [];
let scrollTopValue = 120;

function makeClassList(initial = []) {
  const names = new Set(initial);
  return {
    add: (...items) => items.forEach((item) => names.add(item)),
    remove: (...items) => items.forEach((item) => names.delete(item)),
    toggle: (name, enabled) => enabled ? names.add(name) : names.delete(name),
    contains: (name) => names.has(name),
  };
}

function makeStyle(initialHeight = 0) {
  let height = `${initialHeight}px`;
  return {
    get height() {
      return height;
    },
    set height(value) {
      height = String(value || '0px');
    },
    removeProperty: () => {},
  };
}

function getNodeHeight(node) {
  if (node?.isSpacer) return Number.parseFloat(node.style.height || '0') || 0;
  return Number(node?.offsetHeight || 0);
}

function makeSpacer(height) {
  const spacer = {
    isSpacer: true,
    style: makeStyle(height),
    classList: makeClassList(['chat-virtual-spacer']),
    getBoundingClientRect: () => ({ height: getNodeHeight(spacer) }),
  };
  return spacer;
}

function makeMessageNode(key, height) {
  return {
    isMessage: true,
    offsetHeight: height,
    classList: makeClassList(['message']),
    style: { removeProperty: () => {} },
    getAttribute: (name) => (name === 'data-message-key' ? key : ''),
    querySelector: () => null,
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ height }),
  };
}

const state = {
  initialized: true,
  messages: [
    { id: 1, created_at: '2026-01-01 00:00:00' },
    { id: 2, created_at: '2026-01-01 00:01:00' },
    { id: 3, created_at: '2026-01-01 00:02:00' },
  ],
  lastRenderRange: null,
  messageHeights: new Map(),
  averageMessageHeight: 50,
  renderedKeys: new Set(['id:1', 'id:2', 'id:3']),
};

const topSpacer = makeSpacer(50);
const oldSecondMessage = makeMessageNode('id:2', 100);
const oldThirdMessage = makeMessageNode('id:3', 100);
const bottomSpacer = makeSpacer(0);

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
  clientHeight: 100,
  childNodes: [topSpacer, oldSecondMessage, oldThirdMessage, bottomSpacer],
  classList: { contains: () => false },
  get scrollTop() {
    return scrollTopValue;
  },
  set scrollTop(value) {
    scrollTopValue = value;
    scrollWrites.push(value);
  },
  get scrollHeight() {
    return this.childNodes.reduce((total, node) => total + getNodeHeight(node), 0);
  },
  get firstElementChild() {
    return this.childNodes[0] || null;
  },
  get lastElementChild() {
    return this.childNodes[this.childNodes.length - 1] || null;
  },
  contains(node) {
    return this.childNodes.includes(node);
  },
  querySelector: () => null,
  querySelectorAll(selector) {
    if (selector === '.message[data-message-key]') {
      return this.childNodes.filter((node) => node?.isMessage);
    }
    if (selector === '.chat-virtual-spacer') {
      return this.childNodes.filter((node) => node?.isSpacer);
    }
    return [];
  },
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

function estimatedHeight(msg) {
  return state.messageHeights.get(`id:${msg.id}`) || state.averageMessageHeight;
}

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
  sumEstimatedHeights: (_state, start, end) => state.messages
    .slice(start, end)
    .reduce((total, msg) => total + estimatedHeight(msg), 0),
  getDesiredRenderRange: () => ({ start: 1, end: 3 }),
  createVirtualSpacer: (height) => makeSpacer(height),
  createDaySeparatorNode: () => null,
  messageGroup: () => ({ groupClass: 'group-single' }),
  messageItem: (msg) => makeMessageNode(`id:${msg.id}`, 100),
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
  triggerChatHistoryRevealAnimation: () => {},
  prefersReducedMotionSetting: () => false,
  scrollToBottom: () => {},
  syncSavedMessagesMeta: () => {},
});

runtime.setKeepChatPinnedToBottom(true);
runtime.renderChatMessages('chat-1', { force: true, scrollToBottom: true });

if (scrollWrites.length !== 1 || scrollWrites[0] !== 200) {
  throw new Error(`Expected one final bottom scrollTop write [200], got ${JSON.stringify(scrollWrites)}`);
}
if (frames.length === 0) {
  throw new Error('Expected follow-up frame to keep bottom pinned after layout.');
}
"""
    result = _run_render_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_initial_stable_render_suppresses_message_enter_animation():
    harness_body = """
const state = {
  initialized: true,
  messages: [{ id: 1, sender: 'self', created_at: '2026-05-23 02:37:00' }],
  lastRenderRange: null,
  messageHeights: new Map(),
  averageMessageHeight: 72,
  renderedKeys: new Set(),
};

function makeClassList(initial = []) {
  const names = new Set(initial);
  return {
    add: (...items) => items.forEach((item) => names.add(item)),
    remove: (...items) => items.forEach((item) => names.delete(item)),
    toggle: (name, enabled) => enabled ? names.add(name) : names.delete(name),
    contains: (name) => names.has(name),
  };
}

const messageNode = {
  isMessage: true,
  offsetHeight: 44,
  classList: makeClassList(),
  style: { removeProperty: () => {} },
  dataset: {},
  getAttribute: (name) => (name === 'data-message-key' ? 'id:1' : ''),
  querySelector: () => null,
  querySelectorAll: () => [],
  getBoundingClientRect: () => ({ height: 44 }),
};

const chatMessages = {
  scrollTop: 0,
  scrollHeight: 160,
  clientHeight: 100,
  childNodes: [],
  style: { visibility: '' },
  classList: makeClassList(),
  get firstElementChild() { return this.childNodes[0] || null; },
  get lastElementChild() { return this.childNodes[this.childNodes.length - 1] || null; },
  querySelector(selector) {
    if (selector === '.message[data-message-key]') {
      return this.childNodes.find((node) => node?.isMessage) || null;
    }
    return null;
  },
  querySelectorAll(selector) {
    if (selector === '.message[data-message-key]') {
      return this.childNodes.filter((node) => node?.isMessage);
    }
    return [];
  },
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

let enterAnimationCalls = 0;
const documentRef = {
  createDocumentFragment: () => ({
    appendChild: () => {},
  }),
};
const runtime = moduleApi.createChatMessageRenderRuntime({
  documentRef,
  requestAnimationFrameFn: (callback) => { callback(); return 1; },
  cancelAnimationFrameFn: () => {},
  getCurrentChatId: () => 'chat-1',
  getCurrentContactId: () => 'contact-1',
  getChatMessages: () => chatMessages,
  getChatState: () => state,
  getMessageKey: (msg) => `id:${msg.id}`,
  getMessageDayKey: () => '',
  sumEstimatedHeights: () => 44,
  getDesiredRenderRange: () => ({ start: 0, end: 1 }),
  createVirtualSpacer: (height) => ({
    isSpacer: true,
    style: { height: `${height}px` },
    classList: { contains: (name) => name === 'chat-virtual-spacer' },
  }),
  createDaySeparatorNode: () => null,
  messageGroup: () => ({ groupClass: 'group-single' }),
  messageItem: () => messageNode,
  applyMessageEnterAnimation: () => { enterAnimationCalls += 1; },
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
  triggerChatHistoryRevealAnimation: () => {},
  prefersReducedMotionSetting: () => false,
  scrollToBottom: () => {},
  syncSavedMessagesMeta: () => {},
});

await runtime.renderChatMessagesStable('chat-1', { scrollToBottom: true });

if (enterAnimationCalls !== 0) {
  throw new Error(`Initial stable render should not animate loaded messages, got ${enterAnimationCalls}`);
}
if (chatMessages.style.visibility !== '') {
  throw new Error('Hydration visibility mask should be cleared after stable render');
}
if (!chatMessages.childNodes.includes(messageNode)) {
  throw new Error('Expected message node to render');
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


def test_force_render_preserves_loaded_media_state_for_same_message_source():
    harness_body = """
const frames = [];
const state = {
  initialized: true,
  messages: [{ id: 1, created_at: '2026-01-01 00:00:00' }],
  lastRenderRange: { start: 0, end: 1 },
  messageHeights: new Map([['id:1', 120]]),
  averageMessageHeight: 120,
  renderedKeys: new Set(['id:1']),
};
function makeClassList(initial = []) {
  const names = new Set(initial);
  return {
    add: (name) => names.add(name),
    remove: (name) => names.delete(name),
    toggle: (name, enabled) => enabled ? names.add(name) : names.delete(name),
    contains: (name) => names.has(name),
  };
}
function makeStyle(initial = {}) {
  const props = new Map(Object.entries(initial));
  return {
    setProperty: (name, value) => props.set(name, String(value)),
    getPropertyValue: (name) => props.get(name) || '',
  };
}
function makeImage({ dataSrc, src = '', loaded = false, background = '' }) {
  const attrs = new Map([['data-src', dataSrc]]);
  if (src) attrs.set('src', src);
  if (loaded) attrs.set('data-loaded', '1');
  const wrapper = { classList: makeClassList(loaded ? ['is-loaded'] : []) };
  const bgLayer = { style: makeStyle(background ? { 'background-image': background } : {}) };
  const bubble = { querySelector: (selector) => selector === '.background-layer' ? bgLayer : null };
  const classList = makeClassList(['file-msg-img']);
  if (loaded) classList.add('is-loaded');
  const image = {
    currentSrc: src,
    complete: loaded,
    naturalWidth: loaded ? 320 : 0,
    readyState: 0,
    classList,
    getAttribute: (name) => attrs.get(name) || '',
    setAttribute: (name, value) => {
      attrs.set(name, String(value));
      if (name === 'src') image.currentSrc = String(value);
    },
    closest: (selector) => {
      if (selector.includes('image-wrapper') || selector.includes('album-cell')) return wrapper;
      if (selector.includes('.bubble')) return bubble;
      return null;
    },
    attrs,
    wrapper,
    bgLayer,
  };
  return image;
}
function makeMessageNode(key, mediaEl) {
  return {
    isMessage: true,
    offsetHeight: 120,
    classList: makeClassList(),
    style: { removeProperty: () => {} },
    getAttribute: (name) => (name === 'data-message-key' ? key : ''),
    querySelector: () => null,
    querySelectorAll: (selector) => selector.includes('.file-msg-img') ? [mediaEl] : [],
    getBoundingClientRect: () => ({ height: 120 }),
  };
}
const oldImage = makeImage({
  dataSrc: '/media/photo.jpg?sun_media_e2ee=1',
  src: 'blob:cached-photo',
  loaded: true,
  background: "url('blob:cached-photo')",
});
const existingNode = makeMessageNode('id:1', oldImage);
const newImage = makeImage({ dataSrc: '/media/photo.jpg?sun_media_e2ee=1' });
const newNode = makeMessageNode('id:1', newImage);
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
  scrollTop: 0,
  scrollHeight: 240,
  clientHeight: 120,
  childNodes: [existingNode],
  classList: { contains: () => false },
  get firstElementChild() { return this.childNodes[0] || null; },
  get lastElementChild() { return this.childNodes[this.childNodes.length - 1] || null; },
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
  sumEstimatedHeights: () => 120,
  getDesiredRenderRange: () => ({ start: 0, end: 1 }),
  createVirtualSpacer: (height) => ({
    isSpacer: true,
    style: { height: `${height}px` },
    classList: { contains: (name) => name === 'chat-virtual-spacer' },
  }),
  createDaySeparatorNode: () => ({ isSeparator: true }),
  messageGroup: () => ({ groupClass: 'group-single' }),
  messageItem: () => newNode,
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

runtime.renderChatMessages('chat-1', { force: true, scrollTop: 0 });

if (newImage.getAttribute('src') !== 'blob:cached-photo') {
  throw new Error(`Expected restored media src, got ${newImage.getAttribute('src')}`);
}
if (newImage.getAttribute('data-loaded') !== '1') {
  throw new Error('Expected loaded media state to be restored');
}
if (!newImage.wrapper.classList.contains('is-loaded')) {
  throw new Error('Expected media wrapper loaded class to be restored');
}
if (newImage.bgLayer.style.getPropertyValue('background-image') !== "url('blob:cached-photo')") {
  throw new Error('Expected background layer to keep the loaded photo');
}
"""
    result = _run_render_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout
