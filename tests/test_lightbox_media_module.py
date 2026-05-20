from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def _run_media_renderers_harness(harness_body: str) -> subprocess.CompletedProcess[str]:
    module_path = ROOT / 'static' / 'modules' / 'lightbox' / 'media-renderers.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

Object.defineProperty(globalThis, 'window', {{
  value: {{
    currentPartnerData: {{ display_name: 'Alice' }},
  }},
  configurable: true,
}});

const moduleSourceText = await readFile({str(module_path)!r}, 'utf8');
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(moduleSourceText, 'utf8').toString('base64');
const moduleApi = await import(moduleUrl);

{harness_body}
"""
    return subprocess.run(
        ['node', '--input-type=module', '-e', node_harness],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


def test_lightbox_prefers_loaded_media_source_over_raw_encrypted_source():
    harness_body = """
const rawSrc = 'https://sun.test/chat_media/17#sun_media_e2ee=encoded';
const blobSrc = 'blob:https://sun.test/decrypted-photo';
const timeEl = {
  textContent: '12:40',
  getAttribute(name) {
    if (name === 'data-created-at') return '2026-05-20T09:40:00Z';
    if (name === 'title') return '20 May 2026, 12:40';
    return '';
  },
};
const messageEl = {
  classList: { contains: (name) => name === 'self' },
  querySelector(selector) {
    if (selector === '.msg-time') return timeEl;
    if (selector === '.msg-tick') return null;
    return null;
  },
};
const imageEl = {
  currentSrc: blobSrc,
  getAttribute(name) {
    if (name === 'src') return '';
    if (name === 'data-src') return rawSrc;
    return '';
  },
};
const trigger = {
  getAttribute(name) {
    if (name === 'data-media-kind') return 'image';
    if (name === 'data-media-src') return rawSrc;
    if (name === 'data-caption') return 'caption';
    return '';
  },
  querySelector(selector) {
    if (selector.includes('.file-msg-img') || selector.includes('.album-cell-img')) return imageEl;
    return null;
  },
  closest(selector) {
    return selector === '.message' ? messageEl : null;
  },
};
Object.defineProperty(globalThis, 'document', {
  value: {
    querySelectorAll(selector) {
      return selector === '#chatMessages .file-msg-media-trigger' ? [trigger] : [];
    },
    getElementById() { return null; },
  },
  configurable: true,
});

const source = moduleApi.resolveLightboxTriggerSource(trigger);
if (source.src !== blobSrc || source.rawSrc !== rawSrc || source.kind !== 'image') {
  throw new Error(`unexpected trigger source ${JSON.stringify(source)}`);
}

const items = moduleApi.buildLightboxMediaItems({ formatFullTimestamp: () => '' });
if (items.length !== 1) throw new Error(`expected one item, got ${items.length}`);
if (items[0].src !== blobSrc) throw new Error(`expected loaded blob src, got ${items[0].src}`);
if (items[0].rawSrc !== rawSrc) throw new Error(`expected raw encrypted src, got ${items[0].rawSrc}`);
if (items[0].thumbnail !== blobSrc) throw new Error(`expected blob thumbnail, got ${items[0].thumbnail}`);
"""
    result = _run_media_renderers_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_lightbox_core_resolves_encrypted_sources_and_invalidates_navigation_races():
    source = (ROOT / 'static' / 'modules' / 'lightbox' / 'core.js').read_text(encoding='utf-8')

    assert "window.__sunMediaCacheResolveSource" in source
    assert "sun_media_e2ee=" in source
    assert "els.img.removeAttribute('src')" in source
    assert "els.video.removeAttribute('src')" in source
    assert "lightboxTransitionSeq += 1;" in source
