from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def _run_node_harness(source: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ['node', '--input-type=module', '-e', source],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


def test_encrypted_image_preview_does_not_write_raw_media_url_to_img_src():
    module_path = ROOT / 'static' / 'modules' / 'utils.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

Object.defineProperty(globalThis, 'window', {{
  value: {{
    location: {{ origin: 'https://sun.test' }},
    SUN_I18N: {{ translateText: (value) => String(value) }},
  }},
  configurable: true,
}});
Object.defineProperty(globalThis, 'document', {{
  value: {{ documentElement: {{ lang: 'ru' }} }},
  configurable: true,
}});

const source = await readFile({str(module_path)!r}, 'utf8');
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64');
const utils = await import(moduleUrl);
const payload = JSON.stringify({{
  __sunfile: true,
  name: 'photo.jpg',
  mime: 'image/jpeg',
  data: '/chat_media/17#sun_media_e2ee=encoded',
}});
const html = utils.renderMessagePreviewHtml(payload, {{ isSelf: true, maxLen: 120 }});

if (!html.includes('data-src="https://sun.test/chat_media/17#sun_media_e2ee=encoded"')) {{
  throw new Error(`encrypted preview should keep source in data-src: ${{html}}`);
}}
if (/<img[^>]*\\ssrc="/.test(html)) {{
  throw new Error(`encrypted preview must not assign raw source to img src: ${{html}}`);
}}
"""
    result = _run_node_harness(node_harness)
    assert result.returncode == 0, result.stderr or result.stdout


def test_plain_image_preview_keeps_immediate_img_src():
    module_path = ROOT / 'static' / 'modules' / 'utils.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

Object.defineProperty(globalThis, 'window', {{
  value: {{
    location: {{ origin: 'https://sun.test' }},
    SUN_I18N: {{ translateText: (value) => String(value) }},
  }},
  configurable: true,
}});
Object.defineProperty(globalThis, 'document', {{
  value: {{ documentElement: {{ lang: 'ru' }} }},
  configurable: true,
}});

const source = await readFile({str(module_path)!r}, 'utf8');
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64');
const utils = await import(moduleUrl);
const payload = JSON.stringify({{
  __sunfile: true,
  name: 'photo.jpg',
  mime: 'image/jpeg',
  data: '/chat_media/photo.jpg',
}});
const html = utils.renderMessagePreviewHtml(payload, {{ isSelf: false, maxLen: 120 }});

if (!html.includes('src="https://sun.test/chat_media/photo.jpg"')) {{
  throw new Error(`plain preview should keep immediate img src: ${{html}}`);
}}
if (!html.includes('data-src="https://sun.test/chat_media/photo.jpg"')) {{
  throw new Error(`plain preview should keep canonical data-src: ${{html}}`);
}}
"""
    result = _run_node_harness(node_harness)
    assert result.returncode == 0, result.stderr or result.stdout


def test_chat_media_runtime_hydrates_preview_thumb_with_media_resolver():
    module_path = ROOT / 'static' / 'modules' / 'chat-media-runtime.js'
    voice_module_path = ROOT / 'static' / 'modules' / 'mobile-voice-playback.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

const rawSrc = 'https://sun.test/chat_media/17#sun_media_e2ee=encoded';
const attrs = new Map([['data-src', rawSrc]]);
const thumb = {{
  classList: {{
    contains: () => false,
    add(name) {{ this.added = name; }},
  }},
  querySelector: () => null,
  innerHTML: '',
}};

class FakeImage {{
  constructor() {{
    this.tagName = 'IMG';
    this.dataset = {{}};
    this.currentSrc = '';
  }}
  getAttribute(name) {{
    return attrs.get(name) || '';
  }}
  setAttribute(name, value) {{
    attrs.set(name, String(value));
    if (name === 'src') this.currentSrc = String(value);
  }}
  removeAttribute(name) {{
    attrs.delete(name);
    if (name === 'src') this.currentSrc = '';
  }}
  closest(selector) {{
    return selector === '.msg-preview-thumb' ? thumb : null;
  }}
    matches(selector) {{
    return selector.includes('.msg-preview-thumb img[data-src]');
  }}
  querySelectorAll() {{
    return [];
  }}
}}

const image = new FakeImage();
const resolverCalls = [];
Object.defineProperty(globalThis, 'HTMLImageElement', {{ value: FakeImage, configurable: true }});
Object.defineProperty(globalThis, 'HTMLElement', {{ value: class {{}}, configurable: true }});
Object.defineProperty(globalThis, 'HTMLMediaElement', {{ value: class {{}}, configurable: true }});
Object.defineProperty(globalThis, 'document', {{
  value: {{
    baseURI: 'https://sun.test/',
    body: {{}},
    documentElement: {{}},
    addEventListener() {{}},
    querySelectorAll(selector) {{
      return selector.includes('.msg-preview-thumb img[data-src]') ? [image] : [];
    }},
  }},
  configurable: true,
}});
Object.defineProperty(globalThis, 'MutationObserver', {{
  value: class {{
    constructor(callback) {{ this.callback = callback; }}
    observe(root, options) {{ globalThis.__previewThumbObserved = Boolean(root && options?.childList && options?.subtree); }}
  }},
  configurable: true,
}});
Object.defineProperty(globalThis, 'window', {{
  value: {{
    location: {{ origin: 'https://sun.test' }},
    __sunMediaCacheResolveSource: async (source, options) => {{
      resolverCalls.push({{ source, options }});
      return 'blob:https://sun.test/decrypted-preview';
    }},
  }},
  configurable: true,
}});

const source = await readFile({str(module_path)!r}, 'utf8');
const voiceSource = await readFile({str(voice_module_path)!r}, 'utf8');
const voiceModuleUrl = 'data:text/javascript;base64,' + Buffer.from(voiceSource, 'utf8').toString('base64');
const patchedSource = source.replace(
  "import {{ createMobileVoicePlaybackController, isEncryptedVoiceSource }} from './mobile-voice-playback.js';",
  `import {{ createMobileVoicePlaybackController, isEncryptedVoiceSource }} from '${{voiceModuleUrl}}';`,
);
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(patchedSource, 'utf8').toString('base64');
const mediaRuntime = await import(moduleUrl);
mediaRuntime.initChatMediaRuntime({{}});
await new Promise((resolve) => setTimeout(resolve, 0));

if (attrs.get('src') !== 'blob:https://sun.test/decrypted-preview') {{
  throw new Error(`preview thumb was not hydrated to resolved blob: ${{attrs.get('src')}}`);
}}
if (resolverCalls.length !== 1 || resolverCalls[0].source !== rawSrc || resolverCalls[0].options.kind !== 'image') {{
  throw new Error(`unexpected resolver calls: ${{JSON.stringify(resolverCalls)}}`);
}}
if (!globalThis.__previewThumbObserved) {{
  throw new Error('preview thumb MutationObserver was not installed');
}}
"""
    result = _run_node_harness(node_harness)
    assert result.returncode == 0, result.stderr or result.stdout


def test_file_card_and_search_media_thumbnails_do_not_inline_encrypted_sources():
    rendering = (ROOT / 'static' / 'modules' / 'message-rendering.js').read_text(encoding='utf-8')
    mutations = (ROOT / 'static' / 'modules' / 'chat-message-mutations.js').read_text(encoding='utf-8')
    search = (ROOT / 'static' / 'modules' / 'search-overlay-global-content.js').read_text(encoding='utf-8')
    media_runtime = (ROOT / 'static' / 'modules' / 'chat-media-runtime.js').read_text(encoding='utf-8')

    assert 'function buildInlineMediaThumbAttrs(src)' in rendering
    assert '<img class="file-card-thumb-image" ${buildInlineMediaThumbAttrs(imageThumbSrc)}' in rendering
    assert '<video class="file-card-thumb-video" ${buildInlineMediaThumbAttrs(safeUri)}' in rendering
    assert '<img class="file-card-thumb-image" src=' not in rendering
    assert '<video class="file-card-thumb-video" src=' not in rendering

    assert "thumbImgEl.setAttribute('data-src', thumbSrc)" in mutations
    assert "thumbVideoEl.setAttribute('data-src', fileSrc)" in mutations
    assert 'win._hydrateMediaPreviewThumbs?.(fileLinkEl)' in mutations

    assert '<video ${buildMediaThumbAttrs(src)}' in search
    assert '<img ${buildMediaThumbAttrs(src)}' in search
    assert 'window._hydrateMediaPreviewThumbs?.(card)' in search
    assert '.file-card-thumb-image[data-src]' in media_runtime
    assert '.file-card-thumb-video[data-src]' in media_runtime
    assert '.search-global-media-card img[data-src]' in media_runtime
    assert '.search-global-media-card video[data-src]' in media_runtime


def test_mobile_preview_surfaces_call_thumbnail_hydration_directly():
    contacts = (ROOT / 'static' / 'modules' / 'contacts.js').read_text(encoding='utf-8')
    sidebar = (ROOT / 'static' / 'modules' / 'chat-contacts-sidebar.js').read_text(encoding='utf-8')
    banners = (ROOT / 'static' / 'modules' / 'message-thread-banners.js').read_text(encoding='utf-8')
    media_runtime = (ROOT / 'static' / 'modules' / 'chat-media-runtime.js').read_text(encoding='utf-8')
    profile_media = (ROOT / 'static' / 'modules' / 'profile-media.js').read_text(encoding='utf-8')

    assert 'window._hydrateMediaPreviewThumbs?.(lastMsgEl)' in contacts
    assert 'window._hydrateMediaPreviewThumbs?.(lastMsgEl)' in sidebar
    assert banners.count('window._hydrateMediaPreviewThumbs?.(textEl)') >= 2
    assert 'function forcePreviewThumbNetworkLoad(mediaEl)' in media_runtime
    assert "mediaEl.setAttribute?.('loading', 'eager')" in media_runtime
    assert "mediaEl.setAttribute?.('preload', 'metadata')" in media_runtime
    assert 'function forceProfileMediaNetworkLoad(mediaEl, mediaKind)' in profile_media
    assert "mediaEl.setAttribute('loading', 'eager')" in profile_media
