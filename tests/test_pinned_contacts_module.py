from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def _run_pinned_contacts_harness(harness_body: str) -> subprocess.CompletedProcess[str]:
    module_path = ROOT / 'static' / 'modules' / 'pinned-contacts.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

let source = await readFile({str(module_path)!r}, 'utf8');
source = source.replace(
  "import {{ withAppRoot }} from './app-url.js';",
  "const withAppRoot = (path) => path;",
);
source = source.replace(
  /import \\{{[\\s\\S]*?\\}} from '\\.\\/motion\\.js';/,
  `const afterNextFrame = (callback) => callback();
const getMotionDurationTokenMs = (_token, fallback) => fallback;
const getMotionEasingToken = (_token, fallback) => fallback;
const getVelocityAwareDurationMs = (_distance, options) => options.fallbackMinMs;
const waitForMotionEnd = async () => undefined;`,
);
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64');
const moduleApi = await import(moduleUrl);

class FakeClassList {{
  constructor(names = []) {{
    this.names = new Set(names);
  }}

  contains(name) {{
    return this.names.has(name);
  }}
}}

function detachNode(node) {{
  const parent = node.parentNode;
  if (!parent || !Array.isArray(parent.children)) return;
  const index = parent.children.indexOf(node);
  if (index >= 0) parent.children.splice(index, 1);
  node.parentNode = null;
}}

class FakeFragment {{
  constructor() {{
    this.children = [];
  }}

  appendChild(node) {{
    detachNode(node);
    this.children.push(node);
    node.parentNode = this;
    return node;
  }}
}}

class FakeItem {{
  constructor(attrs) {{
    this.attrs = new Map(Object.entries(attrs));
    this.parentNode = null;
  }}

  getAttribute(name) {{
    return this.attrs.get(name) || '';
  }}

  setAttribute(name, value) {{
    this.attrs.set(name, String(value));
  }}

  removeAttribute(name) {{
    this.attrs.delete(name);
  }}

  getBoundingClientRect() {{
    return {{ top: 0 }};
  }}
}}

class FakeContactsList {{
  constructor(items) {{
    this.children = [];
    this.classList = new FakeClassList(['is-hydrating-contacts']);
    items.forEach((item) => this.appendChild(item));
  }}

  querySelectorAll(selector) {{
    if (selector !== '.contact-item') {{
      throw new Error(`Unexpected selector: ${{selector}}`);
    }}
    return [...this.children];
  }}

  appendChild(node) {{
    if (node instanceof FakeFragment) {{
      [...node.children].forEach((child) => this.appendChild(child));
      return node;
    }}
    detachNode(node);
    this.children.push(node);
    node.parentNode = this;
    return node;
  }}
}}

globalThis.document = {{
  documentElement: {{
    classList: new FakeClassList(),
    getAttribute: () => 'lite',
  }},
  createDocumentFragment: () => new FakeFragment(),
}};
globalThis.window = {{
  matchMedia: () => ({{ matches: true }}),
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


def test_sort_contacts_list_keeps_saved_messages_before_pins_and_activity():
    harness_body = """
const saved = new FakeItem({
  'data-chat-id': 'saved',
  'data-saved-messages': '1',
  'data-pinned': '0',
  'data-last-message-time': '2026-01-01T10:00:00Z',
});
const pinned = new FakeItem({
  'data-chat-id': 'pinned',
  'data-saved-messages': '0',
  'data-pinned': '1',
  'data-pin-order': '0',
  'data-last-message-time': '2026-01-01T10:02:00Z',
});
const active = new FakeItem({
  'data-chat-id': 'active',
  'data-saved-messages': '0',
  'data-pinned': '0',
  'data-last-message-time': '2026-01-01T10:05:00Z',
});
const list = new FakeContactsList([active, pinned, saved]);

moduleApi.sortContactsList(list);

const order = list.children.map((item) => item.getAttribute('data-chat-id')).join(',');
if (order !== 'saved,pinned,active') {
  throw new Error(`Unexpected order: ${order}`);
}
"""
    result = _run_pinned_contacts_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_sort_contacts_list_skips_layout_reads_while_hydrating():
    harness_body = """
let rectReads = 0;
FakeItem.prototype.getBoundingClientRect = function () {
  rectReads += 1;
  return { top: 0 };
};

const older = new FakeItem({
  'data-chat-id': 'older',
  'data-saved-messages': '0',
  'data-pinned': '0',
  'data-last-message-time': '2026-01-01T10:00:00Z',
});
const newer = new FakeItem({
  'data-chat-id': 'newer',
  'data-saved-messages': '0',
  'data-pinned': '0',
  'data-last-message-time': '2026-01-01T10:05:00Z',
});
const list = new FakeContactsList([older, newer]);

moduleApi.sortContactsList(list);

const order = list.children.map((item) => item.getAttribute('data-chat-id')).join(',');
if (order !== 'newer,older') {
  throw new Error(`Unexpected order: ${order}`);
}
if (rectReads !== 0) {
  throw new Error(`Hydrating sort should not read layout, got ${rectReads}`);
}
"""
    result = _run_pinned_contacts_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_sort_contacts_list_skips_flip_measurement_for_guarded_lists():
    harness_body = """
let rectReads = 0;
FakeItem.prototype.getBoundingClientRect = function () {
  rectReads += 1;
  return { top: 0 };
};
globalThis.document.documentElement.getAttribute = () => 'full';
globalThis.window.matchMedia = () => ({ matches: false });

const older = new FakeItem({
  'data-chat-id': 'older',
  'data-saved-messages': '0',
  'data-pinned': '0',
  'data-last-message-time': '2026-01-01T10:00:00Z',
});
const newer = new FakeItem({
  'data-chat-id': 'newer',
  'data-saved-messages': '0',
  'data-pinned': '0',
  'data-last-message-time': '2026-01-01T10:05:00Z',
});
const list = new FakeContactsList([older, newer]);
list.classList.names = new Set(['motion-list-guard']);

moduleApi.sortContactsList(list);

const order = list.children.map((item) => item.getAttribute('data-chat-id')).join(',');
if (order !== 'newer,older') {
  throw new Error(`Unexpected order: ${order}`);
}
if (rectReads !== 0) {
  throw new Error(`Guarded list sort should not read layout, got ${rectReads}`);
}
"""
    result = _run_pinned_contacts_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout
