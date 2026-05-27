from pathlib import Path
import subprocess


def _run_album_harness(harness_body: str) -> subprocess.CompletedProcess[str]:
    module_path = Path(__file__).resolve().parents[1] / 'static' / 'modules' / 'chat-album-runtime.js'
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


def test_album_grid_keeps_loaded_media_source_when_regrouping():
    harness_body = """
globalThis.Node = { DOCUMENT_POSITION_FOLLOWING: 4, TEXT_NODE: 3, ELEMENT_NODE: 1 };
globalThis.requestAnimationFrame = (callback) => {
  callback();
  return 1;
};

function makeClassList(initial = []) {
  const names = new Set(initial);
  return {
    add: (...items) => items.forEach((name) => names.add(name)),
    remove: (...items) => items.forEach((name) => names.delete(name)),
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
function removable() {
  return { remove: () => {} };
}
function makeImage(dataSrc, src) {
  const attrs = new Map([
    ['data-src', dataSrc],
    ['src', src],
    ['data-loaded', '1'],
  ]);
  const wrapper = { classList: makeClassList(['is-loaded']) };
  return {
    currentSrc: src,
    complete: true,
    naturalWidth: 320,
    readyState: 0,
    classList: makeClassList(['file-msg-img', 'is-loaded']),
    getAttribute: (name) => attrs.get(name) || '',
    closest: (selector) => selector.includes('image-wrapper') ? wrapper : null,
  };
}
function makeTrigger(dataSrc) {
  return {
    getAttribute: (name) => {
      if (name === 'data-media-src') return dataSrc;
      if (name === 'data-media-kind') return 'image';
      if (name === 'data-caption') return '';
      if (name === 'data-media-aspect-ratio') return '1';
      return '';
    },
  };
}
function makeBubble() {
  const grid = {
    style: makeStyle(),
    getAttribute: (name) => {
      if (name === 'data-album-rows') return '1';
      if (name === 'data-album-cols') return '2';
      return '';
    },
    querySelectorAll: () => [],
  };
  const bubble = {
    insertedHtml: '',
    classList: makeClassList(['bubble', 'bubble--image']),
    offsetWidth: 320,
    getBoundingClientRect: () => ({ width: 320 }),
    querySelector: (selector) => {
      if (selector === '.message-album-grid') return bubble.insertedHtml ? grid : null;
      if (selector === '.image-wrapper') return removable();
      if (selector === '.background-layer') return removable();
      if (selector === '.message-footer') return {};
      return null;
    },
    querySelectorAll: () => [],
    insertAdjacentHTML: (_position, html) => {
      bubble.insertedHtml = html;
    },
  };
  return bubble;
}
function makeMessage({ albumId, sender, dataSrc, resolvedSrc }) {
  const attrs = new Map([['data-album-id', albumId]]);
  const image = makeImage(dataSrc, resolvedSrc);
  const wrapper = { style: makeStyle({ '--media-aspect-ratio': '1' }) };
  const trigger = makeTrigger(dataSrc);
  const bubble = makeBubble();
  const node = {
    nodeType: 1,
    nextSibling: null,
    bubble,
    classList: makeClassList([sender]),
    getAttribute: (name) => attrs.get(name) || '',
    setAttribute: (name, value) => attrs.set(name, String(value)),
    querySelector: (selector) => {
      if (selector === '.file-msg-img') return image;
      if (selector === '.file-msg-video-preview') return null;
      if (selector === '.image-wrapper, .video-preview') return wrapper;
      if (selector === '.file-msg-media-trigger') return trigger;
      if (selector === '.bubble') return bubble;
      return null;
    },
    compareDocumentPosition: (other) => other === second ? Node.DOCUMENT_POSITION_FOLLOWING : 0,
  };
  return node;
}

const first = makeMessage({
  albumId: 'album-1',
  sender: 'self',
  dataSrc: '/media/one.jpg?sun_media_e2ee=1',
  resolvedSrc: 'blob:one',
});
const second = makeMessage({
  albumId: 'album-1',
  sender: 'self',
  dataSrc: '/media/two.jpg?sun_media_e2ee=1',
  resolvedSrc: 'blob:two',
});
first.nextSibling = second;
const container = {
  querySelectorAll: (selector) => selector.includes('.message[') ? [first, second] : [],
};

moduleApi.processAlbums(container);

const html = first.bubble.insertedHtml;
for (const expected of [
  'class="album-cell file-msg-media-trigger is-loaded"',
  'class="album-cell-img is-loaded"',
  'src="blob:one"',
  'src="blob:two"',
  'data-loaded="1"',
]) {
  if (!html.includes(expected)) {
    throw new Error(`Expected album HTML to contain ${expected}: ${html}`);
  }
}
if (first.getAttribute('data-album-processed') !== '2') {
  throw new Error('Expected primary album node to be marked processed');
}
if (!second.classList.contains('message-album-hidden')) {
  throw new Error('Expected secondary album node to be hidden after grouping');
}
"""
    result = _run_album_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_album_grid_rebuilds_when_pending_sources_change_to_encrypted_urls():
    harness_body = """
globalThis.Node = { DOCUMENT_POSITION_FOLLOWING: 4, TEXT_NODE: 3, ELEMENT_NODE: 1 };
globalThis.requestAnimationFrame = (callback) => {
  callback();
  return 1;
};

function makeClassList(initial = []) {
  const names = new Set(initial);
  return {
    add: (...items) => items.forEach((name) => names.add(name)),
    remove: (...items) => items.forEach((name) => names.delete(name)),
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
function removable() {
  return { remove: () => {} };
}
function makeImage(dataSrc, src) {
  const attrs = new Map([['data-src', dataSrc]]);
  if (src) {
    attrs.set('src', src);
    attrs.set('data-loaded', '1');
  }
  const wrapper = { classList: makeClassList(src ? ['is-loaded'] : []) };
  const image = {
    currentSrc: src,
    complete: Boolean(src),
    naturalWidth: src ? 320 : 0,
    readyState: 0,
    classList: makeClassList(src ? ['file-msg-img', 'is-loaded'] : ['file-msg-img']),
    getAttribute: (name) => attrs.get(name) || '',
    setSource(dataSrcValue, srcValue = '') {
      attrs.set('data-src', dataSrcValue);
      if (srcValue) {
        attrs.set('src', srcValue);
        attrs.set('data-loaded', '1');
        image.currentSrc = srcValue;
        image.complete = true;
        image.naturalWidth = 320;
        image.classList.add('is-loaded');
        wrapper.classList.add('is-loaded');
      } else {
        attrs.delete('src');
        attrs.delete('data-loaded');
        image.currentSrc = '';
        image.complete = false;
        image.naturalWidth = 0;
        image.classList.remove('is-loaded');
        wrapper.classList.remove('is-loaded');
      }
    },
    closest: (selector) => selector.includes('image-wrapper') ? wrapper : null,
  };
  return image;
}
function makeTrigger(dataSrc) {
  return {
    dataSrc,
    getAttribute(name) {
      if (name === 'data-media-src') return this.dataSrc;
      if (name === 'data-media-kind') return 'image';
      if (name === 'data-caption') return '';
      if (name === 'data-media-aspect-ratio') return '1';
      return '';
    },
  };
}
function makeBubble() {
  const bubble = {
    insertedHtml: '',
    classList: makeClassList(['bubble', 'bubble--image']),
    offsetWidth: 320,
    getBoundingClientRect: () => ({ width: 320 }),
    querySelector(selector) {
      if (selector === '.message-album-grid') {
        return bubble.insertedHtml
          ? {
            remove: () => { bubble.insertedHtml = ''; },
            style: makeStyle(),
            getAttribute: (name) => {
              if (name === 'data-album-rows') return '1';
              if (name === 'data-album-cols') return '2';
              return '';
            },
            querySelectorAll: () => [],
          }
          : null;
      }
      if (selector === '.image-wrapper') return removable();
      if (selector === '.background-layer') return removable();
      if (selector === '.message-footer') return {};
      return null;
    },
    querySelectorAll: () => [],
    insertAdjacentHTML: (_position, html) => {
      bubble.insertedHtml = html;
    },
  };
  return bubble;
}
function makeMessage({ albumId, sender, dataSrc, resolvedSrc }) {
  const attrs = new Map([['data-album-id', albumId]]);
  const image = makeImage(dataSrc, resolvedSrc);
  const wrapper = { style: makeStyle({ '--media-aspect-ratio': '1' }) };
  const trigger = makeTrigger(dataSrc);
  const bubble = makeBubble();
  const node = {
    nodeType: 1,
    nextSibling: null,
    image,
    trigger,
    bubble,
    classList: makeClassList([sender]),
    getAttribute: (name) => attrs.get(name) || '',
    setAttribute: (name, value) => attrs.set(name, String(value)),
    removeAttribute: (name) => attrs.delete(name),
    querySelector(selector) {
      if (selector === '.file-msg-img') return image;
      if (selector === '.file-msg-video-preview') return null;
      if (selector === '.image-wrapper, .video-preview') return wrapper;
      if (selector === '.file-msg-media-trigger') return trigger;
      if (selector === '.bubble') return bubble;
      return null;
    },
    compareDocumentPosition: (other) => other === second ? Node.DOCUMENT_POSITION_FOLLOWING : 0,
  };
  return node;
}
function setCommittedSource(message, source) {
  message.image.setSource(source);
  message.trigger.dataSrc = source;
}

const first = makeMessage({
  albumId: 'album-1',
  sender: 'self',
  dataSrc: 'blob:one-preview',
  resolvedSrc: 'blob:one-preview',
});
const second = makeMessage({
  albumId: 'album-1',
  sender: 'self',
  dataSrc: 'blob:two-preview',
  resolvedSrc: 'blob:two-preview',
});
first.nextSibling = second;
const container = {
  querySelectorAll: (selector) => selector.includes('.message[') ? [first, second] : [],
};

moduleApi.processAlbums(container);
if (!first.bubble.insertedHtml.includes('src="blob:two-preview"')) {
  throw new Error(`expected initial album grid to use preview source: ${first.bubble.insertedHtml}`);
}

setCommittedSource(first, '/chat_media/one#sun_media_e2ee=one');
setCommittedSource(second, '/chat_media/two#sun_media_e2ee=two');
moduleApi.processAlbums(container);

const html = first.bubble.insertedHtml;
for (const expected of [
  'data-src="/chat_media/one#sun_media_e2ee=one"',
  'data-src="/chat_media/two#sun_media_e2ee=two"',
]) {
  if (!html.includes(expected)) {
    throw new Error(`Expected rebuilt album HTML to contain ${expected}: ${html}`);
  }
}
for (const stale of ['blob:one-preview', 'blob:two-preview']) {
  if (html.includes(stale)) {
    throw new Error(`Expected rebuilt album HTML to drop stale preview source ${stale}: ${html}`);
  }
}
if (first.getAttribute('data-album-processed') !== '2') {
  throw new Error('Expected rebuilt album node to stay marked processed');
}
"""
    result = _run_album_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout
