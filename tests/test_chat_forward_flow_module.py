from pathlib import Path
import subprocess


def _run_forward_flow_harness(harness_body: str) -> subprocess.CompletedProcess[str]:
    module_path = Path(__file__).resolve().parents[1] / 'static' / 'modules' / 'chat-forward-flow.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

let source = await readFile({str(module_path)!r}, 'utf8');
source = source.replace(
  /import\\s*\\{{\\s*applyEmojiGraphics,\\s*buildAvatarInitials,\\s*escapeHtml,\\s*generateRequestId\\s*\\}}\\s*from\\s*['"]\\.\\/utils\\.js['"];\\s*/,
  `const applyEmojiGraphics = () => {{}};
const buildAvatarInitials = () => 'A';
const escapeHtml = (value) => String(value ?? '');
const generateRequestId = () => 'req-test';`
);
source = source.replace(
  /import\\s*\\{{\\s*withStableChatScroll\\s*\\}}\\s*from\\s*['"]\\.\\/chat-scroll-stability\\.js['"];\\s*/,
  'const withStableChatScroll = (_referenceNode, mutateFn) => mutateFn();'
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


def test_forward_draft_hide_invalidates_pending_show_frame():
    harness_body = """
const rafQueue = [];
globalThis.requestAnimationFrame = (handler) => {
  rafQueue.push(handler);
  return rafQueue.length;
};

function createClassList(initial = []) {
  const names = new Set(initial);
  return {
    add: (...items) => items.forEach((item) => names.add(item)),
    remove: (...items) => items.forEach((item) => names.delete(item)),
    contains: (item) => names.has(item),
    values: () => Array.from(names).sort(),
  };
}

function createElement(initialClasses = []) {
  return {
    classList: createClassList(initialClasses),
    style: {},
    attrs: {},
    textContent: '',
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    },
  };
}

const forwardDraftBar = createElement(['link-draft-bar--hidden']);
const forwardDraftLabel = createElement();
const forwardDraftText = createElement();
const controller = moduleApi.createChatForwardFlow({
  forwardDraftBar,
  forwardDraftLabel,
  forwardDraftText,
  getCurrentChatId: () => 'chat-2',
  waitForMotionEnd: () => new Promise(() => {}),
  updateVoiceRecordButtonState: () => {},
});

controller.setForwardComposerDraft('chat-2', [
  { messageId: 1, plainText: 'hello', messageType: 'text' },
]);
if (rafQueue.length !== 1) {
  throw new Error(`Expected one pending show frame, got ${rafQueue.length}`);
}

controller.clearForwardComposerDraft('chat-2');
rafQueue.shift()();

if (forwardDraftBar.classList.contains('is-visible')) {
  throw new Error(`Stale show frame made hidden forward draft visible: ${forwardDraftBar.classList.values().join(',')}`);
}
if (!forwardDraftBar.classList.contains('is-closing')) {
  throw new Error(`Expected bar to keep closing state, got ${forwardDraftBar.classList.values().join(',')}`);
}
if (forwardDraftBar.attrs['aria-hidden'] !== 'true') {
  throw new Error(`Expected aria-hidden=true after hide, got ${forwardDraftBar.attrs['aria-hidden']}`);
}
"""
    result = _run_forward_flow_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout
