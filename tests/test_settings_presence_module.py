from pathlib import Path
import base64
import subprocess


ROOT = Path(__file__).resolve().parents[1]
MODULES = ROOT / 'static' / 'modules'


def _module_url(source: str) -> str:
    encoded = base64.b64encode(source.encode('utf-8')).decode('ascii')
    return f'data:text/javascript;base64,{encoded}'


def _settings_presence_module_url() -> str:
    activity_url = _module_url((MODULES / 'chat-activity.js').read_text(encoding='utf-8'))
    socket_client_source = (MODULES / 'chat-socket-client.js').read_text(encoding='utf-8')
    socket_client_source = socket_client_source.replace(
        "import { getCsrfToken } from './csrf.js';",
        "const getCsrfToken = () => document.querySelector('meta[name=\"csrf-token\"]')?.getAttribute('content') || '';",
    )
    socket_client_source = socket_client_source.replace(
        "import { withAppRoot } from './app-url.js';",
        "const withAppRoot = (path) => path;",
    )
    socket_client_url = _module_url(socket_client_source)
    settings_presence_source = (MODULES / 'settings-presence.js').read_text(encoding='utf-8')
    settings_presence_source = settings_presence_source.replace(
        "from './chat-activity.js'",
        f"from '{activity_url}'",
    )
    settings_presence_source = settings_presence_source.replace(
        "from './chat-socket-client.js'",
        f"from '{socket_client_url}'",
    )
    return _module_url(settings_presence_source)


def test_settings_presence_reports_visibility_changes():
    module_url = _settings_presence_module_url()
    node_harness = f"""
const documentListeners = new Map();
const windowListeners = new Map();
const emitted = [];
const socketOptions = [];
const rawHandlers = new Map();

const fakeSocket = {{
  connected: true,
  on(eventName, handler) {{
    rawHandlers.set(eventName, handler);
    return this;
  }},
  off(eventName, handler) {{
    if (rawHandlers.get(eventName) === handler) rawHandlers.delete(eventName);
    return this;
  }},
  emit(eventName, payload) {{
    emitted.push({{ eventName, payload }});
    return this;
  }},
}};

Object.defineProperty(globalThis, 'navigator', {{
  configurable: true,
  value: {{ onLine: true }},
}});
Object.defineProperty(globalThis, 'document', {{
  configurable: true,
  value: {{
    visibilityState: 'visible',
    body: {{ dataset: {{}} }},
    documentElement: {{ dataset: {{}} }},
    querySelector(selector) {{
      if (selector === 'meta[name="csrf-token"]') {{
        return {{ getAttribute: () => 'csrf-1' }};
      }}
      return null;
    }},
    addEventListener(eventName, handler) {{
      documentListeners.set(eventName, handler);
    }},
    removeEventListener(eventName, handler) {{
      if (documentListeners.get(eventName) === handler) documentListeners.delete(eventName);
    }},
  }},
}});
Object.defineProperty(globalThis, 'window', {{
  configurable: true,
  value: {{
    SUN_BOOTSTRAP: {{
      socketio: {{ path: '/custom-socket.io', transports: ['polling'], upgrade: false }},
      app: {{ root: '' }},
    }},
    SUN_APP_ROOT: '',
    addEventListener(eventName, handler) {{
      windowListeners.set(eventName, handler);
    }},
    removeEventListener(eventName, handler) {{
      if (windowListeners.get(eventName) === handler) windowListeners.delete(eventName);
    }},
  }},
}});
globalThis.io = (options) => {{
  socketOptions.push(options);
  return fakeSocket;
}};

const moduleApi = await import({module_url!r});
const runtime = moduleApi.initSettingsPresence();
if (!runtime) throw new Error('settings presence did not initialize');
if (socketOptions[0]?.path !== '/custom-socket.io') {{
  throw new Error(`Expected custom socket path, got ${{socketOptions[0]?.path}}`);
}}
if (socketOptions[0]?.upgrade !== false) {{
  throw new Error('Expected settings presence to use bootstrap socket upgrade=false');
}}
if (emitted.length !== 1 || emitted[0].eventName !== 'activity_update' || emitted[0].payload.active !== true) {{
  throw new Error(`Initial activity was not reported: ${{JSON.stringify(emitted)}}`);
}}
if (emitted[0].payload.csrf_token !== 'csrf-1') {{
  throw new Error(`CSRF token missing from activity payload: ${{JSON.stringify(emitted[0])}}`);
}}

document.visibilityState = 'hidden';
documentListeners.get('visibilitychange')();
const hiddenEmit = emitted.at(-1);
if (hiddenEmit.eventName !== 'activity_update' || hiddenEmit.payload.active !== false) {{
  throw new Error(`Hidden activity was not reported immediately: ${{JSON.stringify(emitted)}}`);
}}

document.visibilityState = 'visible';
windowListeners.get('focus')();
const visibleEmit = emitted.at(-1);
if (visibleEmit.eventName !== 'activity_update' || visibleEmit.payload.active !== true) {{
  throw new Error(`Visible activity was not restored: ${{JSON.stringify(emitted)}}`);
}}

runtime.dispose();
if (documentListeners.has('visibilitychange') || windowListeners.has('pagehide')) {{
  throw new Error('settings presence did not remove window activity listeners');
}}
"""
    result = subprocess.run(
        ['node', '--input-type=module', '-e', node_harness],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr or result.stdout


def test_settings_presence_skips_embedded_settings():
    module_url = _settings_presence_module_url()
    node_harness = f"""
Object.defineProperty(globalThis, 'window', {{
  configurable: true,
  value: {{ SUN_BOOTSTRAP: {{ socketio: {{}} }} }},
}});
Object.defineProperty(globalThis, 'document', {{
  configurable: true,
  value: {{ visibilityState: 'visible' }},
}});
globalThis.io = () => {{
  throw new Error('embedded settings must not open a socket');
}};

const moduleApi = await import({module_url!r});
const runtime = moduleApi.initSettingsPresence({{ isEmbedded: true }});
if (runtime !== null) throw new Error('embedded settings should not initialize presence');
"""
    result = subprocess.run(
        ['node', '--input-type=module', '-e', node_harness],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr or result.stdout
