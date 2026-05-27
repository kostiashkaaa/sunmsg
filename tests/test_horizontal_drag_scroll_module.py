from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def _run_drag_scroll_harness(harness_body: str) -> subprocess.CompletedProcess[str]:
    module_path = ROOT / 'static' / 'modules' / 'horizontal-drag-scroll.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

const source = await readFile({str(module_path)!r}, 'utf8');
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64');
const moduleApi = await import(moduleUrl);

globalThis.HTMLElement = class HTMLElement {{}};

class FakeClassList {{
  constructor() {{
    this.names = new Set();
  }}

  add(name) {{
    this.names.add(name);
  }}

  remove(name) {{
    this.names.delete(name);
  }}

  contains(name) {{
    return this.names.has(name);
  }}
}}

class FakeElement extends HTMLElement {{
  constructor() {{
    super();
    this.scrollWidth = 320;
    this.clientWidth = 160;
    this.scrollLeft = 40;
    this.classList = new FakeClassList();
    this.listeners = new Map();
    this.captured = [];
    this.released = [];
  }}

  addEventListener(type, listener) {{
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }}

  removeEventListener(type, listener) {{
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter((item) => item !== listener));
  }}

  setPointerCapture(pointerId) {{
    this.captured.push(pointerId);
  }}

  releasePointerCapture(pointerId) {{
    this.released.push(pointerId);
  }}

  dispatch(type, event) {{
    const payload = {{
      isPrimary: true,
      pointerType: 'mouse',
      button: 0,
      pointerId: 1,
      clientX: 0,
      clientY: 0,
      cancelable: true,
      defaultPrevented: false,
      stopped: false,
      preventDefault() {{ this.defaultPrevented = true; }},
      stopImmediatePropagation() {{ this.stopped = true; }},
      ...event,
    }};
    for (const listener of this.listeners.get(type) || []) {{
      listener(payload);
    }}
    return payload;
  }}
}}

{harness_body}
"""
    return subprocess.run(
        ['node', '--input-type=module', '-e', node_harness],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


def test_horizontal_drag_scroll_moves_overflowing_element_and_suppresses_click():
    harness_body = """
const element = new FakeElement();
moduleApi.initHorizontalDragScroll(element);

element.dispatch('pointerdown', { clientX: 100, clientY: 10 });
const move = element.dispatch('pointermove', { clientX: 70, clientY: 12 });
if (element.scrollLeft !== 70) {
  throw new Error(`Expected scrollLeft 70, got ${element.scrollLeft}`);
}
if (!move.defaultPrevented) {
  throw new Error('Drag move should prevent default after horizontal lock');
}
if (!element.classList.contains('is-drag-scrolling')) {
  throw new Error('Dragging class was not applied');
}
if (element.captured[0] !== 1) {
  throw new Error('Pointer was not captured after drag lock');
}

element.dispatch('pointerup', { clientX: 70, clientY: 12 });
if (element.classList.contains('is-drag-scrolling')) {
  throw new Error('Dragging class was not removed on pointerup');
}

const click = element.dispatch('click', {});
if (!click.defaultPrevented || !click.stopped) {
  throw new Error('Click after drag should be suppressed');
}
"""
    result = _run_drag_scroll_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_horizontal_drag_scroll_keeps_small_clicks_and_non_overflowing_tabs_native():
    harness_body = """
const clickElement = new FakeElement();
moduleApi.initHorizontalDragScroll(clickElement);
clickElement.dispatch('pointerdown', { clientX: 100, clientY: 10 });
clickElement.dispatch('pointermove', { clientX: 97, clientY: 11 });
const click = clickElement.dispatch('click', {});
if (click.defaultPrevented || click.stopped) {
  throw new Error('Small pointer movement should remain a normal click');
}

const shortElement = new FakeElement();
shortElement.scrollWidth = 120;
shortElement.clientWidth = 160;
moduleApi.initHorizontalDragScroll(shortElement);
shortElement.dispatch('pointerdown', { clientX: 100, clientY: 10 });
shortElement.dispatch('pointermove', { clientX: 70, clientY: 10 });
if (shortElement.scrollLeft !== 40) {
  throw new Error(`Non-overflowing element should not scroll, got ${shortElement.scrollLeft}`);
}
"""
    result = _run_drag_scroll_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout
