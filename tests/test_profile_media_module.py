from pathlib import Path
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[1]


def _run_profile_media_harness(harness_body: str) -> subprocess.CompletedProcess[str]:
    modules_dir = ROOT / 'static' / 'modules'
    with tempfile.TemporaryDirectory(prefix='profile-media-harness-') as tmp_dir:
        tmp_dir_path = Path(tmp_dir)

        utils_source = (modules_dir / 'utils.js').read_text(encoding='utf-8')
        motion_source = (modules_dir / 'motion.js').read_text(encoding='utf-8')
        profile_source = (modules_dir / 'profile-media.js').read_text(encoding='utf-8')
        profile_source = profile_source.replace('./utils.js', './utils.mjs')
        profile_source = profile_source.replace('./motion.js', './motion.mjs')

        (tmp_dir_path / 'utils.mjs').write_text(utils_source, encoding='utf-8')
        (tmp_dir_path / 'motion.mjs').write_text(motion_source, encoding='utf-8')
        tmp_module = tmp_dir_path / 'profile-media.mjs'
        tmp_module.write_text(profile_source, encoding='utf-8')

        node_harness = f"""
Object.defineProperty(globalThis, 'document', {{
  value: {{
    documentElement: {{
      lang: 'ru',
      classList: {{ contains: () => false }},
      getAttribute: () => '',
    }},
  }},
  configurable: true,
}});
Object.defineProperty(globalThis, 'requestAnimationFrame', {{
  value: (callback) => {{ callback(); return 1; }},
  configurable: true,
}});
Object.defineProperty(globalThis, 'window', {{
  value: {{
    location: {{ origin: 'https://sun.test' }},
    SUN_I18N: {{
      translateText: (value) => String(value),
      getLanguage: () => 'ru',
    }},
    getComputedStyle: () => ({{ getPropertyValue: () => '' }}),
    matchMedia: () => ({{ matches: false }}),
    requestAnimationFrame: globalThis.requestAnimationFrame,
    setTimeout,
    clearTimeout,
  }},
  configurable: true,
}});

const moduleApi = await import({tmp_module.as_uri()!r});

{harness_body}
"""
        return subprocess.run(
            ['node', '--input-type=module', '-e', node_harness],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )


def test_profile_media_hydrates_encrypted_photo_through_media_resolver():
    harness_body = """
const calls = [];
window.__sunMediaCacheResolveSource = async (source, options) => {
  calls.push({ source, options });
  return 'blob:https://sun.test/decrypted-photo';
};

const attrs = {};
const mediaEl = {
  dataset: {},
  setAttribute(name, value) {
    attrs[name] = String(value);
  },
};

const hydrated = await moduleApi.hydrateProfileMediaElement(
  mediaEl,
  '/chat_media/17#sun_media_e2ee=encoded',
  'photo',
);

if (!hydrated) {
  throw new Error('encrypted profile photo was not hydrated');
}
if (attrs.src !== 'blob:https://sun.test/decrypted-photo') {
  throw new Error(`expected decrypted blob src, got ${attrs.src}`);
}
if (attrs['data-src'] !== 'https://sun.test/chat_media/17#sun_media_e2ee=encoded') {
  throw new Error(`expected sanitized original data-src, got ${attrs['data-src']}`);
}
if (calls.length !== 1 || calls[0].options.kind !== 'image') {
  throw new Error(`expected image resolver call, got ${JSON.stringify(calls)}`);
}
"""
    result = _run_profile_media_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_profile_media_does_not_assign_encrypted_raw_url_without_resolver():
    harness_body = """
delete window.__sunMediaCacheResolveSource;

const attrs = {};
const mediaEl = {
  dataset: {},
  setAttribute(name, value) {
    attrs[name] = String(value);
  },
};

const hydrated = await moduleApi.hydrateProfileMediaElement(
  mediaEl,
  '/chat_media/18#sun_media_e2ee=encoded',
  'image',
);

if (hydrated) {
  throw new Error('encrypted profile media should not hydrate without resolver');
}
if ('src' in attrs) {
  throw new Error(`raw encrypted URL was assigned to src: ${attrs.src}`);
}
if (attrs['data-src'] !== 'https://sun.test/chat_media/18#sun_media_e2ee=encoded') {
  throw new Error(`expected sanitized data-src to remain, got ${attrs['data-src']}`);
}
"""
    result = _run_profile_media_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_profile_media_grid_no_longer_writes_payload_data_directly_to_src():
    source = (ROOT / 'static' / 'modules' / 'profile-media.js').read_text(encoding='utf-8')

    assert 'hydrateProfileMediaElement(btn.querySelector' in source
    assert '<img src="${escapeHtml(url)}"' not in source
    assert '<video src="${escapeHtml(url)}"' not in source


def test_profile_media_tab_switch_raf_is_sequence_guarded():
    source = (ROOT / 'static' / 'modules' / 'profile-media.js').read_text(encoding='utf-8')

    motion_idx = source.index("const motionSeq = Number(contentEl.dataset.tabSwitchSeq || 0) + 1;")
    raf_idx = source.index('requestAnimationFrame(() => {', motion_idx)
    guard_idx = source.index(
        'if (Number(contentEl.dataset.tabSwitchSeq || 0) !== motionSeq) return;',
        raf_idx,
    )

    assert motion_idx < raf_idx < guard_idx


def test_profile_media_collects_call_messages_into_calls_tab():
    harness_body = """
const media = moduleApi.collectMediaFromMessages([
  {
    id: 41,
    message: '{"__suncall":true,"version":1,"call_type":"video","status":"ended","duration_sec":25}',
    message_type: 'call',
    created_at: '2026-05-01T10:00:00Z',
  },
  {
    id: 40,
    message: 'plain text',
    message_type: 'text',
    created_at: '2026-05-01T09:59:00Z',
  },
]);

if (media.calls.length !== 1) {
  throw new Error(`expected one call entry, got ${JSON.stringify(media)}`);
}
if (media.calls[0].msgId !== 41 || media.calls[0].payload.call_type !== 'video') {
  throw new Error(`unexpected call entry ${JSON.stringify(media.calls[0])}`);
}
if (media.links.length || media.files.length || media.media.length) {
  throw new Error(`call payload leaked into another tab ${JSON.stringify(media)}`);
}
"""
    result = _run_profile_media_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_profile_media_collects_ios_sunfile_payload_variants():
    harness_body = """
const makePayload = (payload) => JSON.stringify(payload);
const media = moduleApi.collectMediaFromMessages([
  {
    id: 14,
    message: makePayload({
      __sunfile: true,
      url: '/chat_media/ios-voice.mp4',
      mime: 'audio/mp4',
      name: 'media_14.mp4',
      media_type: 'voice',
      voice: true,
      duration_seconds: 3,
    }),
    message_type: 'voice',
    created_at: '2026-05-01T10:03:00Z',
  },
  {
    id: 13,
    message: makePayload({
      __sunfile: true,
      file_url: '/chat_media/ios-clip.mov',
      mime: 'video/quicktime',
      filename: 'ios-clip.mov',
    }),
    message_type: 'video',
    created_at: '2026-05-01T10:02:00Z',
  },
  {
    id: 12,
    message: makePayload({
      __sunfile: true,
      url: '/chat_media/ios-photo.jpg',
      mime_type: 'image/jpeg',
      filename: 'ios-photo.jpg',
    }),
    message_type: 'photo',
    created_at: '2026-05-01T10:01:00Z',
  },
  {
    id: 11,
    message: makePayload({
      url: '/chat_media/ios-report.pdf',
      mime: 'application/pdf',
      filename: 'ios-report.pdf',
      size: 2048,
    }),
    message_type: 'file',
    created_at: '2026-05-01T10:00:00Z',
  },
]);

if (media.voices.length !== 1 || media.voices[0].msgId !== 14) {
  throw new Error(`expected one iOS voice entry, got ${JSON.stringify(media.voices)}`);
}
if (media.media.length !== 2 || media.media[0].msgId !== 13 || media.media[1].msgId !== 12) {
  throw new Error(`expected iOS photo/video in media tab, got ${JSON.stringify(media.media)}`);
}
if (media.files.length !== 1 || media.files[0].payload.name !== 'ios-report.pdf') {
  throw new Error(`expected iOS direct file in files tab, got ${JSON.stringify(media.files)}`);
}
if (media.media[1].payload.data !== '/chat_media/ios-photo.jpg') {
  throw new Error(`expected normalized photo data, got ${JSON.stringify(media.media[1].payload)}`);
}
if (media.media[0].payload.data !== '/chat_media/ios-clip.mov') {
  throw new Error(`expected normalized video data, got ${JSON.stringify(media.media[0].payload)}`);
}
"""
    result = _run_profile_media_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_profile_lightbox_proxy_uses_resolved_media_source():
    source = (ROOT / 'static' / 'modules' / 'chat-profile-media-panel.js').read_text(encoding='utf-8')

    assert 'resolveProfileMediaSource' in source
    assert 'const src = await resolveProfileMediaSource(rawSrc, mediaKind);' in source
    assert "proxyMessage.className = 'message profile-lightbox-proxy-message'" in source
    assert 'proxyMessage.appendChild(proxy)' in source
    assert 'chatMessages.appendChild(proxyMessage)' in source
    assert "proxy.setAttribute('data-media-src', src)" in source
    assert "proxy.setAttribute('data-media-src', rawSrc)" not in source
    assert 'proxyMessage.remove()' in source
