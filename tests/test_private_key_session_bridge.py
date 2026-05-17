from pathlib import Path
import subprocess


def test_restore_wrapped_private_key_does_not_consume_session_payload_by_default():
    script_path = Path(__file__).resolve().parents[1] / 'static' / 'modules' / 'private-key-session-bridge.js'

    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';
import vm from 'node:vm';

class FakeEventTarget {{
  constructor() {{
    this.listeners = new Map();
  }}

  addEventListener(type, handler) {{
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }}

  dispatchEvent(event) {{
    const handlers = this.listeners.get(event.type) || [];
    for (const handler of handlers) {{
      handler.call(this, event);
    }}
  }}
}}

function createStorage() {{
  const data = new Map();
  return {{
    getItem(key) {{
      return data.has(key) ? data.get(key) : null;
    }},
    setItem(key, value) {{
      data.set(key, String(value));
    }},
    removeItem(key) {{
      data.delete(key);
    }},
  }};
}}

const captured = {{ consumeSession: null }};
const windowTarget = new FakeEventTarget();
windowTarget.deviceKey = {{
  hasWrappedKey() {{ return true; }},
  async unwrapPrivateKey(options = {{}}) {{
    captured.consumeSession = options.consumeSession;
    return 'pem-from-wrap';
  }},
}};

const context = {{
  window: windowTarget,
  sessionStorage: createStorage(),
  localStorage: createStorage(),
  Event: function Event(type) {{
    this.type = type;
  }},
  console,
}};

context.window.window = context.window;
context.window.sessionStorage = context.sessionStorage;
context.window.localStorage = context.localStorage;
context.window.Event = context.Event;
context.window.console = console;

const source = await readFile({str(script_path)!r}, 'utf8');
vm.runInNewContext(source, context, {{ filename: 'private-key-session-bridge.js' }});

await context.window.sunPrivateKeySession.restoreWrappedPrivateKey();

if (captured.consumeSession !== false) {{
  throw new Error(`Expected consumeSession=false by default, got ${{captured.consumeSession}}`);
}}
if (context.window.sunPrivateKeySession.getPrivateKeyPem() !== 'pem-from-wrap') {{
  throw new Error('Expected restored private key to be available in memory');
}}
"""

    result = subprocess.run(
        ['node', '--input-type=module', '-e', node_harness],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr or result.stdout


def test_stage_private_key_for_redirect_clears_wrapped_artifacts_on_failure():
    script_path = Path(__file__).resolve().parents[1] / 'static' / 'modules' / 'private-key-session-bridge.js'

    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';
import vm from 'node:vm';

class FakeEventTarget {{
  constructor() {{
    this.listeners = new Map();
  }}

  addEventListener(type, handler) {{
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }}

  dispatchEvent(event) {{
    const handlers = this.listeners.get(event.type) || [];
    for (const handler of handlers) {{
      handler.call(this, event);
    }}
  }}
}}

function createStorage() {{
  const data = new Map();
  return {{
    getItem(key) {{
      return data.has(key) ? data.get(key) : null;
    }},
    setItem(key, value) {{
      data.set(key, String(value));
    }},
    removeItem(key) {{
      data.delete(key);
    }},
  }};
}}

const cleanupCalls = {{ session: 0, persistent: 0 }};
const windowTarget = new FakeEventTarget();
windowTarget.deviceKey = {{
  async wrapPrivateKey() {{
    return false;
  }},
  async clearWrappedSession() {{
    cleanupCalls.session += 1;
  }},
  async clearWrappedPersistent() {{
    cleanupCalls.persistent += 1;
  }},
}};

const context = {{
  window: windowTarget,
  sessionStorage: createStorage(),
  localStorage: createStorage(),
  Event: function Event(type) {{
    this.type = type;
  }},
  console,
}};

context.window.window = context.window;
context.window.sessionStorage = context.sessionStorage;
context.window.localStorage = context.localStorage;
context.window.Event = context.Event;
context.window.console = console;

const source = await readFile({str(script_path)!r}, 'utf8');
vm.runInNewContext(source, context, {{ filename: 'private-key-session-bridge.js' }});

const staged = await context.window.sunPrivateKeySession.stagePrivateKeyForRedirect('pem-test', {{
  rememberDevice: false,
  notify: false,
}});
if (staged) {{
  throw new Error('Expected stagePrivateKeyForRedirect to fail when wrapPrivateKey returns false');
}}
if (cleanupCalls.session !== 1 || cleanupCalls.persistent !== 1) {{
  throw new Error(`Expected wrapped key cleanup, got session=${{cleanupCalls.session}} persistent=${{cleanupCalls.persistent}}`);
}}
"""

    result = subprocess.run(
        ['node', '--input-type=module', '-e', node_harness],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr or result.stdout


def test_stage_private_key_for_redirect_forwards_persistent_session_expiry():
    script_path = Path(__file__).resolve().parents[1] / 'static' / 'modules' / 'private-key-session-bridge.js'

    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';
import vm from 'node:vm';

class FakeEventTarget {{
  constructor() {{
    this.listeners = new Map();
  }}

  addEventListener(type, handler) {{
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }}

  dispatchEvent(event) {{
    const handlers = this.listeners.get(event.type) || [];
    for (const handler of handlers) {{
      handler.call(this, event);
    }}
  }}
}}

function createStorage() {{
  const data = new Map();
  return {{
    getItem(key) {{
      return data.has(key) ? data.get(key) : null;
    }},
    setItem(key, value) {{
      data.set(key, String(value));
    }},
    removeItem(key) {{
      data.delete(key);
    }},
  }};
}}

let capturedOptions = null;
const windowTarget = new FakeEventTarget();
windowTarget.deviceKey = {{
  async wrapPrivateKey(_pem, options = {{}}) {{
    capturedOptions = options;
    return true;
  }},
}};

const context = {{
  window: windowTarget,
  sessionStorage: createStorage(),
  localStorage: createStorage(),
  Event: function Event(type) {{
    this.type = type;
  }},
  console,
}};

context.window.window = context.window;
context.window.sessionStorage = context.sessionStorage;
context.window.localStorage = context.localStorage;
context.window.Event = context.Event;
context.window.console = console;

const source = await readFile({str(script_path)!r}, 'utf8');
vm.runInNewContext(source, context, {{ filename: 'private-key-session-bridge.js' }});

const staged = await context.window.sunPrivateKeySession.stagePrivateKeyForRedirect('pem-test', {{
  persistent: true,
  sessionAutoLogoutSeconds: 604800,
  sessionExpiresAt: 2000000000,
  notify: false,
}});
if (!staged) {{
  throw new Error('Expected stagePrivateKeyForRedirect to succeed');
}}
if (
  !capturedOptions
  || capturedOptions.persistent !== true
  || capturedOptions.ttlSeconds !== 604800
  || capturedOptions.expiresAt !== 2000000000
) {{
  throw new Error(`Expected persistent expiry metadata, got ${{JSON.stringify(capturedOptions)}}`);
}}
"""

    result = subprocess.run(
        ['node', '--input-type=module', '-e', node_harness],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr or result.stdout
