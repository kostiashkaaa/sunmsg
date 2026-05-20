from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def test_show_chat_content_can_reveal_without_initialized_rerender():
    module_path = ROOT / 'static' / 'modules' / 'chat-content-visibility-runtime.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

const source = await readFile({str(module_path)!r}, 'utf8');
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64');
const {{ createChatContentVisibilityRuntime }} = await import(moduleUrl);

function makeClassList() {{
  const values = new Set();
  return {{
    toggle(name, force) {{
      if (force) values.add(name);
      else values.delete(name);
    }},
    contains(name) {{
      return values.has(name);
    }},
  }};
}}

function makeElement() {{
  return {{
    classList: makeClassList(),
    style: {{}},
  }};
}}

const renderCalls = [];
const runtime = createChatContentVisibilityRuntime({{
  chatPlaceholder: makeElement(),
  chatMessages: makeElement(),
  chatInputArea: makeElement(),
  chatHeaderActions: makeElement(),
  getCurrentChatId: () => 'chat-1',
  getChatState: () => ({{ initialized: true }}),
  resolveSavedChatScrollTop: () => NaN,
  scheduleVirtualChatRender: (...args) => renderCalls.push(args),
  requestAnimationFrameFn: (handler) => handler(),
  setKeepChatPinnedToBottom: () => {{}},
  isChatNearBottom: () => false,
  updateJumpToNewMessagesButton: () => {{}},
}});

runtime.showChatContent(true, {{ renderInitializedChat: false }});
if (renderCalls.length !== 0) {{
  throw new Error(`Reveal-only show should not render initialized chat: ${{JSON.stringify(renderCalls)}}`);
}}

runtime.showChatContent(true);
if (renderCalls.length !== 1 || renderCalls[0][1]?.scrollToBottom !== true || renderCalls[0][1]?.force !== true) {{
  throw new Error(`Default show should still render initialized chat: ${{JSON.stringify(renderCalls)}}`);
}}
"""
    result = subprocess.run(
        ['node', '--input-type=module', '-e', node_harness],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr or result.stdout
