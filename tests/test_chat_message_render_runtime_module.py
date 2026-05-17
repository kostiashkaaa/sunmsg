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
