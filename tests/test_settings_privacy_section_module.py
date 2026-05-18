from pathlib import Path
import subprocess


def _privacy_section_test_source(module_path: Path) -> str:
    source = module_path.read_text(encoding='utf-8')
    return source.replace(
        "import { readAppliedDarkMode } from '../../modules/theme-state.js';",
        'const readAppliedDarkMode = () => false;',
    )


def test_settings_nav_status_follows_page_visibility(tmp_path):
    module_path = (
        Path(__file__).resolve().parents[1]
        / 'static'
        / 'pages'
        / 'settings'
        / 'privacy-section.js'
    )
    module_copy = tmp_path / 'privacy-section.mjs'
    module_copy.write_text(_privacy_section_test_source(module_path), encoding='utf-8')
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


def test_sidebar_weather_preferences_autosave_client_preferences(tmp_path):
    module_path = (
        Path(__file__).resolve().parents[1]
        / 'static'
        / 'pages'
        / 'settings'
        / 'privacy-section.js'
    )
    module_copy = tmp_path / 'privacy-section.mjs'
    module_copy.write_text(_privacy_section_test_source(module_path), encoding='utf-8')
    module_url = module_copy.as_uri()
    node_harness = f"""
const documentListeners = new Map();
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
    if (!this.listeners.has(eventName)) this.listeners.set(eventName, []);
    this.listeners.get(eventName).push(handler);
  }}
  dispatchEvent(event) {{
    for (const handler of this.listeners.get(event.type) || []) {{
      handler.call(this, event);
    }}
    return true;
  }}
  setAttribute(name, value) {{ this[name] = String(value); }}
  getAttribute(name) {{ return this[name] || ''; }}
  removeAttribute(name) {{ delete this[name]; }}
  replaceChildren() {{}}
  appendChild() {{}}
  contains() {{ return false; }}
  querySelector() {{ return null; }}
}}
class FakeInputElement extends FakeElement {{}}
globalThis.Element = FakeElement;
globalThis.HTMLInputElement = FakeInputElement;
globalThis.Event = class {{
  constructor(type) {{ this.type = type; }}
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
  'statusTextInput',
  'isPublicSwitch',
  'hideOnlineStatusSwitch',
  'autoDeclineSwitch',
  'muteDialogRequestsSwitch',
  'lastSeenVisibilitySelect',
  'avatarVisibilitySelect',
  'bioVisibilitySelect',
  'forwardLinkPrivacySelect',
  'groupInvitePrivacySelect',
  'voiceMessagePrivacySelect',
  'messagePrivacySelect',
  'readReceiptsPrivacySelect',
  'typingPrivacySelect',
  'voiceListenedPrivacySelect',
  'callPrivacySelect',
  'publicKeySearchPrivacySelect',
  'timeFormat24hOption',
  'settingsNavProfileStatus',
  'sidebarWeatherEnabledSwitch',
  'sidebarWeatherSourceSelect',
  'sidebarWeatherCityInput',
  'sidebarWeatherRotateSelect',
  'sidebarWeatherMetricTemperature',
  'sidebarWeatherMetricHumidity',
].forEach(element);
element('username').value = 'kmr';
element('displayName').value = 'kmr';
element('languageSelect').value = 'ru';
element('avatarVisibilitySelect').value = 'all';
element('bioVisibilitySelect').value = 'all';
element('forwardLinkPrivacySelect').value = 'all';
element('groupInvitePrivacySelect').value = 'all';
element('voiceMessagePrivacySelect').value = 'all';
element('messagePrivacySelect').value = 'all';
element('timeFormat24hOption').checked = true;
element('sidebarWeatherSourceSelect').value = 'auto';
element('sidebarWeatherRotateSelect').value = '60';
element('sidebarWeatherMetricTemperature').value = 'temperature';
element('sidebarWeatherMetricHumidity').value = 'humidity';

Object.defineProperty(globalThis, 'document', {{
  configurable: true,
  value: {{
    visibilityState: 'visible',
    documentElement: new FakeElement('html'),
    getElementById: element,
    querySelector: (selector) => {{
      const metricMatch = String(selector).match(/input\\[name="sidebarWeatherMetricOption"\\]\\[value="([^"]+)"\\]/);
      if (!metricMatch) return null;
      if (metricMatch[1] === 'temperature') return element('sidebarWeatherMetricTemperature');
      if (metricMatch[1] === 'humidity') return element('sidebarWeatherMetricHumidity');
      return null;
    }},
    querySelectorAll: () => [],
    createElement: () => new FakeElement(),
    addEventListener(eventName, handler) {{ documentListeners.set(eventName, handler); }},
    execCommand: () => true,
  }},
}});
document.documentElement.lang = 'ru';

let storageState = {{}};
Object.defineProperty(globalThis, 'window', {{
  configurable: true,
  value: {{
    localStorage: {{
      getItem: (key) => Object.prototype.hasOwnProperty.call(storageState, key) ? storageState[key] : null,
      setItem: (key, value) => {{ storageState[key] = String(value); }},
    }},
    setTimeout: (handler) => setTimeout(handler, 0),
    clearTimeout: clearTimeout,
    addEventListener() {{}},
    SUN_CLIENT_PREFERENCES: {{
      read: () => ({{}}),
      collect: (extra) => {{
        storageState['sun.clientPreferences.v1'] = JSON.stringify(extra || {{}});
        return extra || {{}};
      }},
    }},
    InterfaceTheme: null,
    ChatAppearance: null,
  }},
}});
Object.defineProperty(globalThis, 'navigator', {{
  configurable: true,
  value: {{ clipboard: {{ writeText: () => Promise.resolve() }} }},
}});

const savedPayloads = [];
const moduleApi = await import({module_url!r});
moduleApi.initPrivacySection({{
  api: {{
    getSettings: () => Promise.resolve({{
      username: 'kmr',
      display_name: 'kmr',
      language: 'ru',
      bio: '',
      status_text: '',
      is_public: true,
      hide_online_status: false,
      auto_decline_requests: false,
      mute_dialog_requests: false,
      avatar_visibility: 'all',
      bio_visibility: 'all',
      forward_link_privacy: 'all',
      group_invite_privacy: 'all',
      voice_message_privacy: 'all',
      message_privacy: 'all',
      online: true,
      last_seen: null,
      client_preferences: {{
        sidebarWeatherEnabled: false,
        sidebarWeatherSource: 'auto',
        sidebarWeatherCity: '',
        sidebarWeatherRotateSeconds: 60,
        sidebarWeatherMetrics: ['temperature'],
      }},
    }}),
    saveSettings: (payload) => {{
      savedPayloads.push(payload);
      return Promise.resolve({{ success: true }});
    }},
  }},
  tr: (value) => String(value),
  i18nApi: {{ getLanguage: () => 'ru', setLanguage: () => undefined }},
  showAlert: () => undefined,
  state: {{
    loaded: false,
    baseline: null,
    isLoaded() {{ return this.loaded; }},
    getBaseline() {{ return this.baseline; }},
    setFloatingSaveSaving: () => undefined,
    setLoaded(next) {{ this.loaded = !!next; }},
    setBaseline(next) {{ this.baseline = next; }},
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

element('sidebarWeatherEnabledSwitch').checked = true;
element('sidebarWeatherSourceSelect').value = 'city';
element('sidebarWeatherCityInput').value = 'Москва';
element('sidebarWeatherRotateSelect').value = '30';
element('sidebarWeatherMetricHumidity').checked = true;
element('sidebarWeatherEnabledSwitch').dispatchEvent(new Event('change'));
await new Promise((resolve) => setTimeout(resolve, 0));
await new Promise((resolve) => setTimeout(resolve, 0));

if (savedPayloads.length !== 1) {{
  throw new Error(`Expected one autosave, got ${{savedPayloads.length}}`);
}}
const prefs = savedPayloads[0].client_preferences;
if (!prefs || prefs.sidebarWeatherEnabled !== true) throw new Error('Weather enabled was not saved');
if (prefs.sidebarWeatherSource !== 'city') throw new Error(`Expected city source, got ${{prefs.sidebarWeatherSource}}`);
if (prefs.sidebarWeatherCity !== 'Москва') throw new Error(`Expected saved city, got ${{prefs.sidebarWeatherCity}}`);
if (prefs.sidebarWeatherRotateSeconds !== 30) throw new Error(`Expected 30s rotation, got ${{prefs.sidebarWeatherRotateSeconds}}`);
if (prefs.sidebarWeatherMetrics.join(',') !== 'temperature,humidity') {{
  throw new Error(`Expected weather metrics to persist, got ${{prefs.sidebarWeatherMetrics.join(',')}}`);
}}
"""
    harness_path = tmp_path / 'settings-weather-autosave-harness.mjs'
    harness_path.write_text(node_harness, encoding='utf-8')
    result = subprocess.run(
        ['node', str(harness_path)],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr or result.stdout


def test_privacy_preferences_autosave_server_fields(tmp_path):
    module_path = (
        Path(__file__).resolve().parents[1]
        / 'static'
        / 'pages'
        / 'settings'
        / 'privacy-section.js'
    )
    module_copy = tmp_path / 'privacy-section.mjs'
    module_copy.write_text(_privacy_section_test_source(module_path), encoding='utf-8')
    module_url = module_copy.as_uri()
    node_harness = f"""
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
    if (!this.listeners.has(eventName)) this.listeners.set(eventName, []);
    this.listeners.get(eventName).push(handler);
  }}
  dispatchEvent(event) {{
    for (const handler of this.listeners.get(event.type) || []) {{
      handler.call(this, event);
    }}
    return true;
  }}
  setAttribute(name, value) {{ this[name] = String(value); }}
  getAttribute(name) {{ return this[name] || ''; }}
  removeAttribute(name) {{ delete this[name]; }}
  replaceChildren() {{}}
  appendChild() {{}}
  contains() {{ return false; }}
  querySelector() {{ return null; }}
}}
class FakeInputElement extends FakeElement {{}}
globalThis.Element = FakeElement;
globalThis.HTMLInputElement = FakeInputElement;
globalThis.Event = class {{
  constructor(type) {{ this.type = type; }}
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
  'statusTextInput',
  'isPublicSwitch',
  'hideOnlineStatusSwitch',
  'autoDeclineSwitch',
  'muteDialogRequestsSwitch',
  'lastSeenVisibilitySelect',
  'avatarVisibilitySelect',
  'bioVisibilitySelect',
  'forwardLinkPrivacySelect',
  'groupInvitePrivacySelect',
  'voiceMessagePrivacySelect',
  'messagePrivacySelect',
  'timeFormat24hOption',
  'settingsNavProfileStatus',
  'sidebarWeatherEnabledSwitch',
  'sidebarWeatherSourceSelect',
  'sidebarWeatherCityInput',
  'sidebarWeatherRotateSelect',
  'sidebarWeatherMetricTemperature',
].forEach(element);
element('username').value = 'kmr';
element('displayName').value = 'kmr';
element('languageSelect').value = 'ru';
element('avatarVisibilitySelect').value = 'all';
element('bioVisibilitySelect').value = 'all';
element('forwardLinkPrivacySelect').value = 'all';
element('groupInvitePrivacySelect').value = 'all';
element('voiceMessagePrivacySelect').value = 'all';
element('messagePrivacySelect').value = 'all';
element('readReceiptsPrivacySelect').value = 'all';
element('typingPrivacySelect').value = 'all';
element('voiceListenedPrivacySelect').value = 'all';
element('callPrivacySelect').value = 'all';
element('publicKeySearchPrivacySelect').value = 'all';
element('lastSeenVisibilitySelect').value = 'all';
element('timeFormat24hOption').checked = true;
element('sidebarWeatherSourceSelect').value = 'auto';
element('sidebarWeatherRotateSelect').value = '60';
element('sidebarWeatherMetricTemperature').value = 'temperature';

Object.defineProperty(globalThis, 'document', {{
  configurable: true,
  value: {{
    visibilityState: 'visible',
    documentElement: new FakeElement('html'),
    getElementById: element,
    querySelector: (selector) => {{
      if (String(selector).includes('sidebarWeatherMetricOption')) return element('sidebarWeatherMetricTemperature');
      return null;
    }},
    querySelectorAll: () => [],
    createElement: () => new FakeElement(),
    addEventListener() {{}},
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
    addEventListener() {{}},
    SUN_CLIENT_PREFERENCES: {{
      read: () => ({{}}),
      collect: (extra) => extra || {{}},
    }},
    InterfaceTheme: null,
    ChatAppearance: null,
  }},
}});
Object.defineProperty(globalThis, 'navigator', {{
  configurable: true,
  value: {{ clipboard: {{ writeText: () => Promise.resolve() }} }},
}});

const savedPayloads = [];
const moduleApi = await import({module_url!r});
moduleApi.initPrivacySection({{
  api: {{
    getSettings: () => Promise.resolve({{
      username: 'kmr',
      display_name: 'kmr',
      language: 'ru',
      bio: '',
      status_text: '',
      is_public: true,
      hide_online_status: false,
      auto_decline_requests: false,
      mute_dialog_requests: false,
      avatar_visibility: 'all',
      bio_visibility: 'all',
      forward_link_privacy: 'all',
      group_invite_privacy: 'all',
      voice_message_privacy: 'all',
      message_privacy: 'all',
      read_receipts_privacy: 'all',
      typing_privacy: 'all',
      voice_listened_privacy: 'all',
      call_privacy: 'all',
      public_key_search_privacy: 'all',
      online: true,
      last_seen: null,
      client_preferences: {{}},
    }}),
    saveSettings: (payload) => {{
      savedPayloads.push(payload);
      return Promise.resolve({{ success: true }});
    }},
  }},
  tr: (value) => String(value),
  i18nApi: {{ getLanguage: () => 'ru', setLanguage: () => undefined }},
  showAlert: () => undefined,
  state: {{
    loaded: false,
    baseline: null,
    isLoaded() {{ return this.loaded; }},
    getBaseline() {{ return this.baseline; }},
    setFloatingSaveSaving: () => undefined,
    setLoaded(next) {{ this.loaded = !!next; }},
    setBaseline(next) {{ this.baseline = next; }},
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

element('hideOnlineStatusSwitch').checked = true;
element('avatarVisibilitySelect').value = 'contacts';
element('groupInvitePrivacySelect').value = 'nobody';
element('readReceiptsPrivacySelect').value = 'contacts';
element('typingPrivacySelect').value = 'nobody';
element('voiceListenedPrivacySelect').value = 'contacts';
element('callPrivacySelect').value = 'contacts';
element('publicKeySearchPrivacySelect').value = 'nobody';
element('hideOnlineStatusSwitch').dispatchEvent(new Event('change'));
await new Promise((resolve) => setTimeout(resolve, 0));
await new Promise((resolve) => setTimeout(resolve, 0));

if (savedPayloads.length !== 1) {{
  throw new Error(`Expected one privacy autosave, got ${{savedPayloads.length}}`);
}}
const payload = savedPayloads[0];
if (payload.client_preferences) throw new Error('Privacy autosave must not send client_preferences');
if (payload.username || payload.display_name || payload.bio) throw new Error('Privacy autosave must not save profile fields');
if (payload.hide_online_status !== true) throw new Error('hide_online_status was not saved');
if (payload.last_seen_visibility !== 'nobody') throw new Error(`Expected nobody last seen, got ${{payload.last_seen_visibility}}`);
if (payload.avatar_visibility !== 'contacts') throw new Error(`Expected contacts avatar, got ${{payload.avatar_visibility}}`);
if (payload.group_invite_privacy !== 'nobody') throw new Error(`Expected nobody group invite, got ${{payload.group_invite_privacy}}`);
if (payload.read_receipts_privacy !== 'contacts') throw new Error(`Expected contacts read receipts, got ${{payload.read_receipts_privacy}}`);
if (payload.typing_privacy !== 'nobody') throw new Error(`Expected nobody typing, got ${{payload.typing_privacy}}`);
if (payload.voice_listened_privacy !== 'contacts') throw new Error(`Expected contacts voice listened, got ${{payload.voice_listened_privacy}}`);
if (payload.call_privacy !== 'contacts') throw new Error(`Expected contacts calls, got ${{payload.call_privacy}}`);
if (payload.public_key_search_privacy !== 'nobody') throw new Error(`Expected nobody key search, got ${{payload.public_key_search_privacy}}`);
"""
    harness_path = tmp_path / 'settings-privacy-autosave-harness.mjs'
    harness_path.write_text(node_harness, encoding='utf-8')
    result = subprocess.run(
        ['node', str(harness_path)],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr or result.stdout
