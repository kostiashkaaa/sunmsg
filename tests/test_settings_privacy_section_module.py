from pathlib import Path
import subprocess


def test_settings_nav_status_follows_page_visibility(tmp_path):
    module_path = (
        Path(__file__).resolve().parents[1]
        / 'static'
        / 'pages'
        / 'settings'
        / 'privacy-section.js'
    )
    module_copy = tmp_path / 'privacy-section.mjs'
    module_copy.write_text(module_path.read_text(encoding='utf-8'), encoding='utf-8')
    module_url = module_copy.as_uri()
    node_harness = f"""
const documentListeners = new Map();
const windowListeners = new Map();
let documentFocused = false;
class FakeElement {{
  constructor(id = '') {{
    this.id = id;
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.textContent = '';
    this.innerHTML = '';
    this.style = {{}};
    this.listeners = new Map();
    this.classList = {{
      add() {{}},
      remove() {{}},
      toggle() {{}},
      contains() {{ return false; }},
    }};
  }}
  addEventListener(eventName, handler) {{
    this.listeners.set(eventName, handler);
  }}
  dispatchEvent(event) {{
    const handler = this.listeners.get(event.type);
    if (handler) handler.call(this, event);
    return true;
  }}
  setAttribute(name, value) {{
    this[name] = String(value);
  }}
  getAttribute(name) {{
    return this[name] || '';
  }}
  removeAttribute(name) {{
    delete this[name];
  }}
  replaceChildren() {{}}
  appendChild() {{}}
  contains() {{ return false; }}
  querySelector() {{ return null; }}
}}
class FakeInputElement extends FakeElement {{}}
globalThis.Element = FakeElement;
globalThis.HTMLInputElement = FakeInputElement;
globalThis.Event = class {{
  constructor(type) {{
    this.type = type;
  }}
}};

const elements = new Map();
function element(id) {{
  if (!elements.has(id)) elements.set(id, new FakeInputElement(id));
  return elements.get(id);
}}
[
  'username',
  'displayName',
  'languageSelect',
  'bioInput',
  'isPublicSwitch',
  'hideOnlineStatusSwitch',
  'autoDeclineSwitch',
  'muteDialogRequestsSwitch',
  'avatarVisibilitySelect',
  'groupInvitePrivacySelect',
  'timeFormat24hOption',
  'settingsNavProfileStatus',
].forEach(element);
element('languageSelect').value = 'ru';
element('avatarVisibilitySelect').value = 'all';
element('groupInvitePrivacySelect').value = 'all';
element('timeFormat24hOption').checked = true;

Object.defineProperty(globalThis, 'document', {{
  configurable: true,
  value: {{
    visibilityState: 'visible',
    documentElement: new FakeElement('html'),
    getElementById: element,
    querySelector: () => null,
    createElement: () => new FakeElement(),
    hasFocus: () => documentFocused,
    addEventListener(eventName, handler) {{
      documentListeners.set(eventName, handler);
    }},
    execCommand: () => true,
  }},
}});
document.documentElement.lang = 'ru';
Object.defineProperty(globalThis, 'window', {{
  configurable: true,
  value: {{
    localStorage: {{
      getItem: () => null,
      setItem: () => undefined,
    }},
    setTimeout: (handler) => setTimeout(handler, 0),
    clearTimeout: clearTimeout,
    addEventListener(eventName, handler) {{
      windowListeners.set(eventName, handler);
    }},
    SUN_CLIENT_PREFERENCES: null,
    InterfaceTheme: null,
    ChatAppearance: null,
  }},
}});
Object.defineProperty(globalThis, 'navigator', {{
  configurable: true,
  value: {{
    clipboard: {{ writeText: () => Promise.resolve() }},
  }},
}});

const moduleApi = await import({module_url!r});
moduleApi.initPrivacySection({{
  api: {{
    getSettings: () => Promise.resolve({{
      username: 'kmr',
      display_name: 'kmr',
      language: 'ru',
      bio: '',
      is_public: true,
      hide_online_status: false,
      auto_decline_requests: false,
      mute_dialog_requests: false,
      avatar_visibility: 'all',
      group_invite_privacy: 'all',
      online: true,
      last_seen: null,
      client_preferences: {{}},
    }}),
    saveSettings: () => Promise.resolve({{ success: true }}),
  }},
  tr: (value) => String(value),
  i18nApi: {{
    getLanguage: () => 'ru',
    setLanguage: () => undefined,
  }},
  showAlert: () => undefined,
  state: {{
    isLoaded: () => true,
    getBaseline: () => ({{}}),
    setFloatingSaveSaving: () => undefined,
    setLoaded: () => undefined,
    setBaseline: () => undefined,
    syncDirtyState: () => undefined,
    animateFloatingSaveSuccess: () => undefined,
    isDirty: () => false,
  }},
  setServerSettingsControlsEnabled: () => undefined,
  markSettingsReady: () => undefined,
  persistMuteDialogRequestsPreference: () => undefined,
  notifyLanguageUpdate: () => undefined,
  notifyMotionUpdate: () => undefined,
  notifyWeatherLabelUpdate: () => undefined,
  applyAvatarFromSettings: () => undefined,
  downloadSettingsQr: () => undefined,
}});
await new Promise((resolve) => setTimeout(resolve, 0));

const statusEl = element('settingsNavProfileStatus');
if (statusEl.textContent !== 'в сети') {{
  throw new Error(`Expected online after settings load, got ${{statusEl.textContent}}`);
}}

document.visibilityState = 'hidden';
documentListeners.get('visibilitychange')();
if (!statusEl.textContent.startsWith('был(а) в сети')) {{
  throw new Error(`Expected last seen after hiding tab, got ${{statusEl.textContent}}`);
}}

document.visibilityState = 'visible';
windowListeners.get('focus')();
if (statusEl.textContent !== 'в сети') {{
  throw new Error(`Expected online after focus return, got ${{statusEl.textContent}}`);
}}

document.visibilityState = 'visible';
documentListeners.get('visibilitychange')();
if (statusEl.textContent !== 'в сети') {{
  throw new Error(`Visible embedded settings should stay online without iframe focus, got ${{statusEl.textContent}}`);
}}
if (windowListeners.has('blur')) {{
  throw new Error('Settings profile status must not depend on iframe window blur');
}}
"""
    harness_path = tmp_path / 'settings-privacy-harness.mjs'
    harness_path.write_text(node_harness, encoding='utf-8')
    result = subprocess.run(
        ['node', str(harness_path)],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr or result.stdout
