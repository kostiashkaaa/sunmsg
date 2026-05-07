from pathlib import Path
import subprocess


def _run_sidebar_status_harness(harness_body: str) -> subprocess.CompletedProcess[str]:
    module_path = Path(__file__).resolve().parents[1] / 'static' / 'modules' / 'chat-sidebar-status.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

const source = await readFile({str(module_path)!r}, 'utf8');
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64');
const moduleApi = await import(moduleUrl);

{harness_body}
"""
    return subprocess.run(
        ['node', '--input-type=module', '-e', node_harness],
        capture_output=True,
        text=True,
        check=False,
    )


def test_compute_sidebar_status_snapshot_only_exposes_sync_and_device_state():
    harness_body = """
const offline = moduleApi.computeSidebarStatusSnapshot({
  hasNetwork: false,
  socketConnected: false,
  hasSocketConnectedOnce: true,
  hasSocketConnectionIssue: true,
});
if (offline.overallState !== 'danger' || offline.action !== 'sync') {
  throw new Error(`Unexpected offline snapshot: ${JSON.stringify(offline)}`);
}
if (offline.syncChipState !== 'danger') {
  throw new Error(`Expected syncChipState=danger, got ${offline.syncChipState}`);
}
const removedFields = ['network' + 'ChipState', 'vault' + 'ChipState', 'session' + 'State'];
for (const field of removedFields) {
  if (field in offline) {
    throw new Error(`Removed status field leaked into snapshot: ${field}`);
  }
}

const syncRecover = moduleApi.computeSidebarStatusSnapshot({
  hasNetwork: true,
  socketConnected: false,
  hasSocketConnectedOnce: true,
  hasSocketConnectionIssue: true,
});
if (syncRecover.overallState !== 'warn' || syncRecover.action !== 'sync') {
  throw new Error(`Unexpected sync snapshot: ${JSON.stringify(syncRecover)}`);
}
if (syncRecover.syncChipState !== 'warn') {
  throw new Error(`Expected syncChipState=warn, got ${syncRecover.syncChipState}`);
}

const deviceReady = moduleApi.computeSidebarStatusSnapshot({
  hasNetwork: true,
  socketConnected: true,
  hasSocketConnectedOnce: true,
  hasSocketConnectionIssue: false,
});
if (deviceReady.action !== 'device' || deviceReady.overallState !== 'ok') {
  throw new Error(`Expected device-ready snapshot, got ${JSON.stringify(deviceReady)}`);
}
if (!String(deviceReady.title).includes('Устройство')) {
  throw new Error(`Expected device title, got ${deviceReady.title}`);
}
"""
    result = _run_sidebar_status_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_sync_sidebar_status_bar_applies_only_sync_dom_state():
    harness_body = """
const ui = {
  sidebarSyncChip: { dataset: {}, setAttribute(name, value) { this[name] = value; } },
  sidebarStatusBar: { dataset: {}, title: '', setAttribute(name, value) { this[name] = value; } },
  sidebarStatusTitle: { textContent: '' },
  sidebarStatusHint: { textContent: '' },
};

const snapshot = moduleApi.computeSidebarStatusSnapshot({
  hasNetwork: true,
  socketConnected: true,
  hasSocketConnectedOnce: true,
  hasSocketConnectionIssue: false,
});
moduleApi.syncSidebarStatusBar(ui, snapshot);

if (ui.sidebarSyncChip.dataset.state !== 'ok') {
  throw new Error(`Unexpected sync chip state: ${ui.sidebarSyncChip.dataset.state}`);
}
if (ui.sidebarStatusBar.dataset.action !== 'device') {
  throw new Error(`Expected device action, got ${ui.sidebarStatusBar.dataset.action}`);
}
if (!ui.sidebarStatusBar['aria-label'] || !String(ui.sidebarStatusBar['aria-label']).includes(snapshot.title)) {
  throw new Error('ARIA label was not applied to sidebar status bar');
}
if (ui.sidebarStatusTitle.textContent !== snapshot.title) {
  throw new Error('sidebarStatusTitle did not receive snapshot title');
}
"""
    result = _run_sidebar_status_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_run_sidebar_status_action_executes_sync_and_device_callbacks():
    harness_body = """
let syncRefreshes = 0;
let activityReports = 0;
let socketConnects = 0;
let openedSettingsTab = null;
let openedQr = 0;
let lastToast = null;
let socketIssue = false;

const depsBase = {
  getHasNetwork: () => true,
  syncSidebarStatusBar: () => { syncRefreshes += 1; },
  showToast: (message, level) => { lastToast = `${level}:${message}`; },
  isSocketConnected: () => false,
  setSocketConnectionIssue: (value) => { socketIssue = Boolean(value); },
  socketConnect: () => { socketConnects += 1; },
  reportActivity: () => { activityReports += 1; },
  getVisibilityState: () => 'visible',
  getHasPrivateKey: () => false,
  openMyQrModal: null,
  openSettingsOverlay: (tab) => { openedSettingsTab = tab; },
};

moduleApi.runSidebarStatusAction('sync', depsBase);
if (socketConnects !== 1 || !socketIssue) {
  throw new Error('sync action should request socket reconnect and set connection issue');
}

moduleApi.runSidebarStatusAction('device', depsBase);
if (openedSettingsTab !== 'keys') {
  throw new Error(`device action should open settings keys tab, got ${openedSettingsTab}`);
}

const depsWithKey = {
  ...depsBase,
  getHasPrivateKey: () => true,
  openMyQrModal: () => { openedQr += 1; },
};
moduleApi.runSidebarStatusAction('device', depsWithKey);
if (openedQr !== 1) {
  throw new Error('device action should open QR modal when private key is available');
}
if (!lastToast || !lastToast.startsWith('info:')) {
  throw new Error(`Expected sync action info toast, got ${lastToast}`);
}
"""
    result = _run_sidebar_status_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout
