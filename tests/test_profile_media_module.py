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
