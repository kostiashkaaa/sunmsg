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


def test_mobile_voice_playback_prepares_plain_source_synchronously() -> None:
    module_path = ROOT / 'static' / 'modules' / 'mobile-voice-playback.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

const source = await readFile({str(module_path)!r}, 'utf8');
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64');
const {{ createMobileVoicePlaybackController }} = await import(moduleUrl);

const attrs = new Map([['data-src', '/chat_media/voice.ogg']]);
const audio = {{
  dataset: {{}},
  currentSrc: '',
  getAttribute(name) {{ return attrs.get(name) || ''; }},
  setAttribute(name, value) {{ attrs.set(name, String(value)); }},
  removeAttribute(name) {{ attrs.delete(name); }},
  load() {{ this.loaded = true; }},
}};

const controller = createMobileVoicePlaybackController({{ windowRef: {{}} }});
const state = controller.prepareAudioSource(audio);

if (state.status !== 'ready') throw new Error(`expected ready, got ${{state.status}}`);
if (attrs.get('src') !== '/chat_media/voice.ogg') throw new Error(`plain src was not assigned: ${{attrs.get('src')}}`);
"""
    result = _run_node_harness(node_harness)
    assert result.returncode == 0, result.stderr or result.stdout


def test_mobile_voice_playback_resolves_encrypted_source_once() -> None:
    module_path = ROOT / 'static' / 'modules' / 'mobile-voice-playback.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

const source = await readFile({str(module_path)!r}, 'utf8');
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64');
const {{ createMobileVoicePlaybackController }} = await import(moduleUrl);

const rawSrc = '/chat_media/17#sun_media_e2ee=encoded';
const attrs = new Map([['data-src', rawSrc]]);
const audio = {{
  dataset: {{}},
  currentSrc: '',
  getAttribute(name) {{ return attrs.get(name) || ''; }},
  setAttribute(name, value) {{ attrs.set(name, String(value)); }},
  removeAttribute(name) {{ attrs.delete(name); }},
  load() {{ this.loaded = true; }},
}};
let resolverCalls = 0;
let resolverArgs = null;
let resolveSource;
const controller = createMobileVoicePlaybackController({{
  windowRef: {{
    __sunMediaCacheResolveSource(sourceValue, options) {{
      resolverCalls += 1;
      resolverArgs = {{ sourceValue, options }};
      return new Promise((resolve) => {{ resolveSource = resolve; }});
    }},
  }},
}});

const first = controller.prepareAudioSource(audio);
const second = controller.prepareAudioSource(audio);

if (first.status !== 'pending' || second.status !== 'pending') {{
  throw new Error(`expected pending states: ${{first.status}}/${{second.status}}`);
}}
if (first.promise !== second.promise) throw new Error('duplicate prepare did not reuse pending promise');
if (resolverCalls !== 1) throw new Error(`expected one resolver call, got ${{resolverCalls}}`);
if (resolverArgs.sourceValue !== rawSrc || resolverArgs.options.kind !== 'audio') {{
  throw new Error(`unexpected resolver args: ${{JSON.stringify(resolverArgs)}}`);
}}
if (attrs.has('src')) throw new Error(`encrypted raw src must not be assigned before resolve: ${{attrs.get('src')}}`);

resolveSource('blob:https://sun.test/voice');
const ready = await first.promise;

if (!ready) throw new Error('encrypted source did not resolve ready');
if (attrs.get('src') !== 'blob:https://sun.test/voice') throw new Error(`resolved blob was not assigned: ${{attrs.get('src')}}`);
"""
    result = _run_node_harness(node_harness)
    assert result.returncode == 0, result.stderr or result.stdout


def test_mobile_voice_playback_never_assigns_raw_encrypted_fallback() -> None:
    module_path = ROOT / 'static' / 'modules' / 'mobile-voice-playback.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

const source = await readFile({str(module_path)!r}, 'utf8');
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64');
const {{ createMobileVoicePlaybackController }} = await import(moduleUrl);

const rawSrc = '/chat_media/17#sun_media_e2ee=encoded';
const attrs = new Map([['data-src', rawSrc], ['src', rawSrc]]);
const audio = {{
  dataset: {{}},
  currentSrc: rawSrc,
  getAttribute(name) {{ return attrs.get(name) || ''; }},
  setAttribute(name, value) {{ attrs.set(name, String(value)); }},
  removeAttribute(name) {{ attrs.delete(name); }},
  load() {{ this.loaded = true; }},
}};
const controller = createMobileVoicePlaybackController({{
  windowRef: {{ __sunMediaCacheResolveSource: async () => '' }},
}});

const state = controller.prepareAudioSource(audio);
const ready = await state.promise;

if (state.status !== 'pending') throw new Error(`expected pending, got ${{state.status}}`);
if (ready) throw new Error('empty encrypted resolver result must not be ready');
if (attrs.has('src')) throw new Error(`raw encrypted src must be removed, got ${{attrs.get('src')}}`);
if (!audio.loaded) throw new Error('audio.load should reset the removed encrypted runtime source');
"""
    result = _run_node_harness(node_harness)
    assert result.returncode == 0, result.stderr or result.stdout


def test_mobile_voice_playback_times_out_stalled_encrypted_source() -> None:
    module_path = ROOT / 'static' / 'modules' / 'mobile-voice-playback.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';
import {{ setTimeout as delay }} from 'node:timers/promises';

const source = await readFile({str(module_path)!r}, 'utf8');
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64');
const {{ createMobileVoicePlaybackController }} = await import(moduleUrl);

const rawSrc = '/chat_media/17#sun_media_e2ee=encoded';
const attrs = new Map([['data-src', rawSrc]]);
const audio = {{
  dataset: {{}},
  currentSrc: '',
  getAttribute(name) {{ return attrs.get(name) || ''; }},
  setAttribute(name, value) {{ attrs.set(name, String(value)); }},
  removeAttribute(name) {{ attrs.delete(name); }},
  load() {{ this.loaded = true; }},
}};
let resolverCalls = 0;
let resolveStalled;
const controller = createMobileVoicePlaybackController({{
  windowRef: {{
    setTimeout,
    clearTimeout,
    __sunMediaCacheResolveSource() {{
      resolverCalls += 1;
      return new Promise((resolve) => {{ resolveStalled = resolve; }});
    }},
  }},
  sourceResolveTimeoutMs: 5,
}});

const stalled = controller.prepareAudioSource(audio);
if (stalled.status !== 'pending') throw new Error(`expected pending, got ${{stalled.status}}`);

const ready = await stalled.promise;
if (ready) throw new Error('stalled encrypted source must time out as not ready');
if (attrs.has('src')) throw new Error(`timed-out source must not assign src: ${{attrs.get('src')}}`);

resolveStalled('blob:https://sun.test/late-voice');
await delay(0);
if (attrs.has('src')) throw new Error(`late source must not assign after timeout: ${{attrs.get('src')}}`);

const retry = controller.prepareAudioSource(audio);
if (retry.status !== 'pending') throw new Error(`retry should start fresh pending resolve, got ${{retry.status}}`);
if (retry.promise === stalled.promise) throw new Error('retry reused timed-out pending promise');
if (resolverCalls !== 2) throw new Error(`expected a fresh resolver call after timeout, got ${{resolverCalls}}`);
"""
    result = _run_node_harness(node_harness)
    assert result.returncode == 0, result.stderr or result.stdout
