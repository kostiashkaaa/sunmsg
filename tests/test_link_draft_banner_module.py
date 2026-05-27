from pathlib import Path
import subprocess


def _run_link_draft_harness(harness_body: str) -> subprocess.CompletedProcess[str]:
    module_path = Path(__file__).resolve().parents[1] / 'static' / 'modules' / 'link-draft-banner.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

let source = await readFile({str(module_path)!r}, 'utf8');
source = source.replace(
  /import\\s*\\{{\\s*waitForMotionEnd\\s*\\}}\\s*from\\s*['"]\\.\\/motion\\.js['"];\\s*/,
  'const waitForMotionEnd = (...args) => globalThis.waitForMotionEnd(...args);'
);
source = source.replace(
  /import\\s*\\{{\\s*requestLinkPreviewPayload\\s*\\}}\\s*from\\s*['"]\\.\\/link-preview-shared\\.js['"];\\s*/,
  'const requestLinkPreviewPayload = (...args) => globalThis.requestLinkPreviewPayload(...args);'
);
source = source.replace(
  /import\\s*\\{{\\s*withAppRoot\\s*\\}}\\s*from\\s*['"]\\.\\/app-url\\.js['"];\\s*/,
  'const withAppRoot = (value) => value;'
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


def test_link_draft_hide_invalidates_pending_show_frame():
    harness_body = """
const rafQueue = [];
globalThis.requestAnimationFrame = (handler) => {
  rafQueue.push(handler);
  return rafQueue.length;
};
globalThis.waitForMotionEnd = () => new Promise(() => {});
globalThis.requestLinkPreviewPayload = () => Promise.resolve(null);

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
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    },
    removeAttribute(name) {
      delete this.attrs[name];
    },
  };
}

const barEl = createElement(['link-draft-bar--hidden']);
const inputEl = {
  value: 'https://example.com/a',
  addEventListener() {},
};
const thumbEl = createElement();
const thumbImgEl = createElement();
const controller = moduleApi.initLinkDraftBar({
  barEl,
  inputEl,
  thumbEl,
  thumbImgEl,
});

controller.syncFromInput({ force: true });
if (rafQueue.length !== 1) {
  throw new Error(`Expected one pending show frame, got ${rafQueue.length}`);
}

inputEl.value = '';
controller.syncFromInput({ force: true });
rafQueue.shift()();

if (barEl.classList.contains('is-visible')) {
  throw new Error(`Stale show frame made hidden link draft visible: ${barEl.classList.values().join(',')}`);
}
if (!barEl.classList.contains('is-closing')) {
  throw new Error(`Expected bar to keep closing state, got ${barEl.classList.values().join(',')}`);
}
if (barEl.attrs['aria-hidden'] !== 'true') {
  throw new Error(`Expected aria-hidden=true after hide, got ${barEl.attrs['aria-hidden']}`);
}
"""
    result = _run_link_draft_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout
