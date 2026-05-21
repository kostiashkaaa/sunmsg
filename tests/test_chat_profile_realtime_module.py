from pathlib import Path
import subprocess
import tempfile


def _run_profile_realtime_harness(harness_body: str) -> subprocess.CompletedProcess[str]:
    modules_dir = Path(__file__).resolve().parents[1] / 'static' / 'modules'
    module_path = modules_dir / 'chat-profile-realtime-events.js'
    utils_path = modules_dir / 'utils.js'
    with tempfile.TemporaryDirectory(prefix='profile-realtime-harness-') as tmp_dir:
        tmp_dir_path = Path(tmp_dir)
        tmp_utils = tmp_dir_path / 'utils.mjs'
        tmp_utils.write_text(utils_path.read_text(encoding='utf-8'), encoding='utf-8')

        module_source = module_path.read_text(encoding='utf-8').replace('./utils.js', './utils.mjs')
        tmp_module = tmp_dir_path / 'chat-profile-realtime-events.mjs'
        tmp_module.write_text(module_source, encoding='utf-8')

        node_harness = f"""
const moduleUrl = {tmp_module.as_uri()!r};
const moduleApi = await import(moduleUrl);

{harness_body}
"""
        return subprocess.run(
            ['node', '--input-type=module', '-e', node_harness],
            capture_output=True,
            text=True,
            check=False,
        )


def test_profile_updated_does_not_override_saved_messages_contact():
    harness_body = """
const handlers = {};
const socket = { on: (event, cb) => { handlers[event] = cb; } };

const contactNameEl = { textContent: 'Избранное' };
const contactAvatarEl = { innerHTML: '<i class="bi bi-bookmark-fill"></i>', textContent: '' };
const partnerAvatarEl = { innerHTML: '<i class="bi bi-bookmark-fill"></i>', textContent: '' };
const chatTitleEl = { textContent: 'Избранное' };
const attrs = new Map([['data-saved-messages', '1']]);
const savedContactItem = {
  getAttribute: (name) => attrs.get(name) || '',
  querySelector: (selector) => {
    if (selector === '.contact-name') return contactNameEl;
    if (selector === '.contact-avatar') return contactAvatarEl;
    return null;
  },
};

let setPartnerCalls = 0;
let rerenderCalls = 0;

moduleApi.registerProfileRealtimeSocketHandlers({
  socket,
  escapeHtml: (value) => String(value ?? ''),
  updateOnlineStatusUI: () => {},
  renderProfileHeader: () => {},
  getCurrentContactPublicKey: () => 'self-public-key',
  getCurrentPartnerData: () => ({ display_name: 'Избранное', username: '' }),
  setCurrentPartnerData: () => { setPartnerCalls += 1; },
  getPartnerProfileDrawer: () => null,
  chatTitleEl,
  resolveChatPartnerAvatar: () => partnerAvatarEl,
  rerenderCurrentChat: () => { rerenderCalls += 1; },
  resolveContactItemByPublicKey: () => savedContactItem,
  resolveSidebarAvatarCircle: () => null,
  resolveSidebarDisplayName: () => null,
  resolveSidebarUsername: () => null,
  setCurrentUserIdentity: () => {},
  isSavedContactItem: (item) => item?.getAttribute?.('data-saved-messages') === '1',
});

handlers.profile_updated({
  public_key: 'self-public-key',
  display_name: 'k.m.rr',
  username: 'alice',
  avatar_url: '/static/avatars/new.png',
});

if (contactNameEl.textContent !== 'Избранное') {
  throw new Error(`Saved contact name was overwritten: ${contactNameEl.textContent}`);
}
if (!String(contactAvatarEl.innerHTML).includes('bookmark')) {
  throw new Error(`Saved contact avatar was overwritten: ${contactAvatarEl.innerHTML}`);
}
if (chatTitleEl.textContent !== 'Избранное') {
  throw new Error(`Saved chat title was overwritten: ${chatTitleEl.textContent}`);
}
if (!String(partnerAvatarEl.innerHTML).includes('bookmark')) {
  throw new Error(`Saved chat header avatar was overwritten: ${partnerAvatarEl.innerHTML}`);
}
if (setPartnerCalls !== 0) {
  throw new Error(`Saved contact should not update partner data, calls=${setPartnerCalls}`);
}
if (rerenderCalls !== 1) {
  throw new Error(`Expected one rerender for saved contact, got ${rerenderCalls}`);
}
"""
    result = _run_profile_realtime_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_profile_updated_still_updates_regular_contact():
    harness_body = """
const handlers = {};
const socket = { on: (event, cb) => { handlers[event] = cb; } };

const contactNameEl = { textContent: 'Old Name' };
const contactAvatarEl = { innerHTML: '', textContent: '', removeAttribute: () => {} };
const attrs = new Map([['data-saved-messages', '0']]);
const regularContactItem = {
  getAttribute: (name) => attrs.get(name) || '',
  querySelector: (selector) => {
    if (selector === '.contact-name') return contactNameEl;
    if (selector === '.contact-avatar') return contactAvatarEl;
    return null;
  },
};

moduleApi.registerProfileRealtimeSocketHandlers({
  socket,
  escapeHtml: (value) => String(value ?? ''),
  updateOnlineStatusUI: () => {},
  renderProfileHeader: () => {},
  getCurrentContactPublicKey: () => 'another-public-key',
  getCurrentPartnerData: () => null,
  setCurrentPartnerData: () => {},
  getPartnerProfileDrawer: () => null,
  chatTitleEl: { textContent: '' },
  resolveChatPartnerAvatar: () => ({ innerHTML: '', textContent: '' }),
  rerenderCurrentChat: () => {},
  resolveContactItemByPublicKey: () => regularContactItem,
  resolveSidebarAvatarCircle: () => null,
  resolveSidebarDisplayName: () => null,
  resolveSidebarUsername: () => null,
  setCurrentUserIdentity: () => {},
  isSavedContactItem: (item) => item?.getAttribute?.('data-saved-messages') === '1',
});

handlers.profile_updated({
  public_key: 'regular-public-key',
  display_name: 'New Name',
  username: 'newuser',
  avatar_url: '/static/avatars/new.png',
});

if (contactNameEl.textContent !== 'New Name') {
  throw new Error(`Regular contact name was not updated: ${contactNameEl.textContent}`);
}
if (!String(contactAvatarEl.innerHTML).includes('/static/avatars/new.png')) {
  throw new Error(`Regular contact avatar was not updated: ${contactAvatarEl.innerHTML}`);
}
"""
    result = _run_profile_realtime_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_profile_updated_updates_current_partner_bio_without_reload():
    harness_body = """
const handlers = {};
const socket = { on: (event, cb) => { handlers[event] = cb; } };

const contactAvatarEl = { innerHTML: '', textContent: '', removeAttribute: () => {} };
const contactItem = {
  getAttribute: () => '0',
  querySelector: (selector) => {
    if (selector === '.contact-name') return { textContent: '' };
    if (selector === '.contact-avatar') return contactAvatarEl;
    return null;
  },
};

const drawerClassList = { contains: (token) => token === 'active' };
const profileDrawer = { classList: drawerClassList };
let partnerData = { public_key: 'pk-2', bio: 'old bio', display_name: 'Bob', username: 'bob' };
let renderProfileBioCalls = 0;

moduleApi.registerProfileRealtimeSocketHandlers({
  socket,
  escapeHtml: (value) => String(value ?? ''),
  updateOnlineStatusUI: () => {},
  renderProfileHeader: () => {},
  renderProfileBio: (payload) => {
    renderProfileBioCalls += 1;
    if (payload.bio !== 'new bio') {
      throw new Error(`Expected bio to be propagated, got: ${payload.bio}`);
    }
  },
  getCurrentContactPublicKey: () => 'pk-2',
  getCurrentPartnerData: () => partnerData,
  setCurrentPartnerData: (next) => { partnerData = next; },
  getPartnerProfileDrawer: () => profileDrawer,
  chatTitleEl: { textContent: '' },
  resolveChatPartnerAvatar: () => ({ innerHTML: '', textContent: '', removeAttribute: () => {} }),
  rerenderCurrentChat: () => {},
  resolveContactItemByPublicKey: () => contactItem,
  resolveSidebarAvatarCircle: () => null,
  resolveSidebarDisplayName: () => null,
  resolveSidebarUsername: () => null,
  setCurrentUserIdentity: () => {},
  isSavedContactItem: () => false,
});

handlers.profile_updated({
  public_key: 'pk-2',
  display_name: 'Bob',
  username: 'bob',
  avatar_url: '/static/avatars/new.png',
  bio: 'new bio',
});

if (partnerData.bio !== 'new bio') {
  throw new Error(`Expected partnerData.bio to update, got: ${partnerData.bio}`);
}
if (renderProfileBioCalls !== 1) {
  throw new Error(`Expected renderProfileBio to be called once, got ${renderProfileBioCalls}`);
}
"""
    result = _run_profile_realtime_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_sidebar_spotify_indicator_hides_after_transition():
    harness_body = """
const classNames = new Set(['contact-spotify-indicator--visible']);
let transitionHandler = null;
let removedHandler = null;
const indicator = {
  hidden: false,
  offsetHeight: 16,
  classList: {
    add: (name) => classNames.add(name),
    remove: (name) => classNames.delete(name),
    contains: (name) => classNames.has(name),
  },
  querySelector: () => ({ textContent: '' }),
  addEventListener: (event, handler) => {
    if (event === 'transitionend') transitionHandler = handler;
  },
  removeEventListener: (event, handler) => {
    if (event === 'transitionend') removedHandler = handler;
  },
};
const contactItem = {
  querySelector: (selector) => selector === '[data-contact-spotify]' ? indicator : null,
};

moduleApi.updateSidebarSpotifyIndicator(contactItem, null);

if (indicator.hidden) {
  throw new Error('Indicator was hidden before the hide transition could run');
}
if (classNames.has('contact-spotify-indicator--visible')) {
  throw new Error('Visible class was not removed for hide transition');
}
if (typeof transitionHandler !== 'function') {
  throw new Error('Hide transition handler was not registered');
}

transitionHandler({ target: indicator, propertyName: 'opacity' });

if (!indicator.hidden) {
  throw new Error('Indicator was not hidden after transitionend');
}
if (removedHandler !== transitionHandler) {
  throw new Error('Transition handler was not removed after hide');
}
"""
    result = _run_profile_realtime_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout
