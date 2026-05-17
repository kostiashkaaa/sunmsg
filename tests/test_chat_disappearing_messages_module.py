import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _run_node_harness(source: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ['node', '--input-type=module', '-e', source],
        cwd=ROOT,
        text=True,
        capture_output=True,
        timeout=10,
        check=False,
    )


def test_disappearing_timer_labels_and_visible_copy():
    module_path = (ROOT / 'static' / 'modules' / 'chat-disappearing-messages.js').as_posix()
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

const source = await readFile('{module_path}', 'utf8');
const mod = await import(`data:text/javascript;charset=utf-8,${{encodeURIComponent(source)}}`);

const checks = [
  [mod.formatTimerLabel(0), 'Выкл.'],
  [mod.formatTimerLabel(86400), '24 часа'],
  [mod.formatTimerSummary(0), 'Новые сообщения остаются в чате.'],
  [mod.formatTimerSummary(3600), 'Новые сообщения удаляются через 1 час после отправки.'],
  [mod.formatTimerPillText(300), 'Новые сообщения будут удаляться через 5 мин.'],
  [mod.formatTimerPillText(0), ''],
];

for (const [actual, expected] of checks) {{
  if (actual !== expected) {{
    throw new Error(`Expected "${{expected}}", got "${{actual}}"`);
  }}
}}
"""
    result = _run_node_harness(node_harness)
    assert result.returncode == 0, result.stderr


def test_expiring_messages_do_not_render_overlay_badges():
    renderer = ROOT / 'static' / 'modules' / 'message-rendering.js'
    source = renderer.read_text(encoding='utf-8')

    assert 'expiry-badge' not in source


def test_disappearing_pill_marks_chat_area_enabled_state():
    module_path = (ROOT / 'static' / 'modules' / 'chat-disappearing-messages.js').as_posix()
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

const source = await readFile('{module_path}', 'utf8');
const mod = await import(`data:text/javascript;charset=utf-8,${{encodeURIComponent(source)}}`);

function makeElement() {{
  const classes = new Set();
  return {{
    hidden: false,
    textContent: '',
    attributes: new Map(),
    classList: {{
      toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
      contains: (name) => classes.has(name),
    }},
    setAttribute: function(name, value) {{ this.attributes.set(name, String(value)); }},
    querySelector: () => null,
    closest: () => null,
  }};
}}

const elements = {{
  chatArea: makeElement(),
  disappearingPillWrap: makeElement(),
  disappearingPillTitle: makeElement(),
  disappearingPillText: makeElement(),
}};
const documentRef = {{
  getElementById: (id) => elements[id] || null,
  querySelectorAll: () => [],
}};
const controller = mod.createDisappearingMessagesController({{
  socketEmit: () => {{}},
  getCurrentChatId: () => 'chat-1',
  documentRef,
}});

controller.setAutoDeleteSeconds('chat-1', 300);
if (!elements.chatArea.classList.contains('chat-area--disappearing-enabled')) {{
  throw new Error('Chat area must reserve space when disappearing messages are enabled.');
}}
if (elements.disappearingPillWrap.hidden !== false) {{
  throw new Error('Disappearing pill should be visible when timer is enabled.');
}}
if (elements.disappearingPillTitle.textContent !== 'В этом чате включено автоудаление') {{
  throw new Error(`Unexpected pill title: ${{elements.disappearingPillTitle.textContent}}`);
}}

controller.setAutoDeleteSeconds('chat-1', 0);
if (elements.chatArea.classList.contains('chat-area--disappearing-enabled')) {{
  throw new Error('Chat area reserve class must be removed when timer is disabled.');
}}
if (elements.disappearingPillWrap.hidden !== true) {{
  throw new Error('Disappearing pill should be hidden when timer is disabled.');
}}
controller.destroy();
"""
    result = _run_node_harness(node_harness)
    assert result.returncode == 0, result.stderr
