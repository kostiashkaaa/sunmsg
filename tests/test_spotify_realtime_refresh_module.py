from pathlib import Path
import subprocess
import tempfile


def test_spotify_realtime_refresh_posts_immediately_with_csrf():
    modules_dir = Path(__file__).resolve().parents[1] / 'static' / 'modules'
    with tempfile.TemporaryDirectory(prefix='spotify-refresh-harness-') as tmp_dir:
        tmp_dir_path = Path(tmp_dir)
        for source_name, target_name in (
            ('app-url.js', 'app-url.mjs'),
            ('csrf.js', 'csrf.mjs'),
            ('spotify-realtime-refresh.js', 'spotify-realtime-refresh.mjs'),
        ):
            source = (modules_dir / source_name).read_text(encoding='utf-8')
            source = source.replace('./app-url.js', './app-url.mjs')
            source = source.replace('./csrf.js', './csrf.mjs')
            (tmp_dir_path / target_name).write_text(source, encoding='utf-8')

        module_url = (tmp_dir_path / 'spotify-realtime-refresh.mjs').as_uri()
        node_harness = f"""
const nativeSetTimeout = globalThis.setTimeout.bind(globalThis);
const moduleApi = await import({module_url!r});

let visibilityHandler = null;
let removedVisibilityHandler = null;
let timerCallback = null;
let timerDelay = null;
let clearedTimer = null;
globalThis.window = {{ SUN_BOOTSTRAP: {{ app: {{ root: '' }} }} }};
globalThis.document = {{
  visibilityState: 'visible',
  body: {{ dataset: {{}} }},
  documentElement: {{ dataset: {{}} }},
  querySelector: (selector) => selector === 'meta[name="csrf-token"]'
    ? {{ getAttribute: () => 'csrf-token-value' }}
    : null,
  addEventListener: (event, handler) => {{
    if (event === 'visibilitychange') visibilityHandler = handler;
  }},
  removeEventListener: (event, handler) => {{
    if (event === 'visibilitychange') removedVisibilityHandler = handler;
  }},
}};
globalThis.setTimeout = (callback, delay) => {{
  timerCallback = callback;
  timerDelay = delay;
  return 77;
}};
globalThis.clearTimeout = (timer) => {{
  clearedTimer = timer;
}};

const fetchCalls = [];
const controller = moduleApi.initSpotifyRealtimeRefresh({{
  documentRef: globalThis.document,
  fetchImpl: async (url, options) => {{
    fetchCalls.push({{ url, options }});
    return {{
      status: 200,
      ok: true,
      json: async () => ({{ success: true, configured: true, connected: true }}),
    }};
  }},
}});

if (typeof visibilityHandler !== 'function') {{
  throw new Error('visibilitychange handler was not registered');
}}
if (typeof timerCallback !== 'function' || timerDelay !== 0) {{
  throw new Error(`Expected immediate refresh timer, got delay=${{timerDelay}}`);
}}

timerCallback();
await new Promise((resolve) => nativeSetTimeout(resolve, 0));

if (fetchCalls.length !== 1) {{
  throw new Error(`Expected one refresh call, got ${{fetchCalls.length}}`);
}}
if (fetchCalls[0].url !== '/spotify/refresh') {{
  throw new Error(`Unexpected refresh URL: ${{fetchCalls[0].url}}`);
}}
if (fetchCalls[0].options.method !== 'POST') {{
  throw new Error(`Unexpected method: ${{fetchCalls[0].options.method}}`);
}}
if (fetchCalls[0].options.headers['X-CSRFToken'] !== 'csrf-token-value') {{
  throw new Error('CSRF header was not sent');
}}
if (timerDelay !== 2500) {{
  throw new Error(`Expected follow-up refresh in 2500ms, got ${{timerDelay}}`);
}}

controller.stop();
if (removedVisibilityHandler !== visibilityHandler) {{
  throw new Error('visibilitychange handler was not removed on stop');
}}
if (clearedTimer !== 77) {{
  throw new Error('refresh timer was not cleared on stop');
}}
"""

        result = subprocess.run(
            ['node', '--input-type=module', '-e', node_harness],
            capture_output=True,
            text=True,
            check=False,
        )

    assert result.returncode == 0, result.stderr or result.stdout
