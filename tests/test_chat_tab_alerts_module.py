from pathlib import Path
import subprocess


def _run_tab_alert_harness(harness_body: str) -> subprocess.CompletedProcess[str]:
    module_path = Path(__file__).resolve().parents[1] / 'static' / 'modules' / 'chat-tab-alerts.js'
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


def test_tab_alert_controller_blinks_and_restores_base_title():
    harness_body = """
let titleValue = 'sun';
let intervalCb = null;
let clearCalls = 0;
let intervalStarts = 0;

const controller = moduleApi.createTabAlertController({
  baseTitle: 'sun',
  setTitle: (nextTitle) => { titleValue = String(nextTitle || ''); },
  getTitle: () => titleValue,
  setIntervalFn: (cb, _ms) => { intervalStarts += 1; intervalCb = cb; return 7; },
  clearIntervalFn: (id) => { if (id === 7) clearCalls += 1; },
  blinkIntervalMs: 111,
});

controller.pushAlert('chat-a');
if (controller.getAlertCount() !== 1) {
  throw new Error(`Expected 1 alert, got ${controller.getAlertCount()}`);
}
if (!titleValue.includes('Новое сообщение')) {
  throw new Error(`Expected notification title, got ${titleValue}`);
}
if (intervalStarts !== 1 || typeof intervalCb !== 'function') {
  throw new Error('Blink interval was not initialized');
}

intervalCb();
if (titleValue !== 'sun') {
  throw new Error(`Expected blink phase to toggle title back to base, got ${titleValue}`);
}

controller.clearAlertForChat('chat-a');
if (controller.getAlertCount() !== 0) {
  throw new Error(`Expected alert count reset to 0, got ${controller.getAlertCount()}`);
}
if (titleValue !== 'sun') {
  throw new Error(`Expected base title after clear, got ${titleValue}`);
}
if (clearCalls !== 1) {
  throw new Error(`Expected interval clear call, got ${clearCalls}`);
}
"""
    result = _run_tab_alert_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_tab_alert_controller_accumulates_across_chats_and_clears_all():
    harness_body = """
let titleValue = 'sun';
const controller = moduleApi.createTabAlertController({
  baseTitle: 'sun',
  setTitle: (nextTitle) => { titleValue = String(nextTitle || ''); },
  getTitle: () => titleValue,
  setIntervalFn: () => 1,
  clearIntervalFn: () => {},
});

controller.pushAlert('chat-a');
controller.pushAlert('chat-a');
controller.pushAlert('chat-b');

if (controller.getAlertCount() !== 3) {
  throw new Error(`Expected total 3 alerts, got ${controller.getAlertCount()}`);
}
if (!titleValue.includes('(3)')) {
  throw new Error(`Expected title to include aggregated count, got ${titleValue}`);
}

controller.clearAlertForChat('chat-a');
if (controller.getAlertCount() !== 1) {
  throw new Error(`Expected remaining 1 alert after clearing chat-a, got ${controller.getAlertCount()}`);
}

controller.clearAllAlerts();
if (controller.getAlertCount() !== 0) {
  throw new Error('Expected no alerts after clearAllAlerts');
}
if (titleValue !== 'sun') {
  throw new Error(`Expected base title after clearAllAlerts, got ${titleValue}`);
}
"""
    result = _run_tab_alert_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_tab_alert_controller_dismisses_deleted_message_alerts():
    harness_body = """
let titleValue = 'sun';
let clearCalls = 0;
const controller = moduleApi.createTabAlertController({
  baseTitle: 'sun',
  setTitle: (nextTitle) => { titleValue = String(nextTitle || ''); },
  getTitle: () => titleValue,
  setIntervalFn: () => 1,
  clearIntervalFn: () => { clearCalls += 1; },
});

controller.pushAlert('chat-a');
controller.pushAlert('chat-a');
controller.pushAlert('chat-b');
controller.dismissAlertsForChat('chat-a', 1);

if (controller.getAlertCount() !== 2) {
  throw new Error(`Expected 2 alerts after partial dismiss, got ${controller.getAlertCount()}`);
}
if (!titleValue.includes('(2)')) {
  throw new Error(`Expected title to include remaining count, got ${titleValue}`);
}

controller.dismissAlertsForChat('chat-a', 5);
if (controller.getAlertCount() !== 1) {
  throw new Error(`Expected only chat-b alert after over-dismiss, got ${controller.getAlertCount()}`);
}

controller.dismissAlertsForChat('chat-b', 1);
if (controller.getAlertCount() !== 0 || titleValue !== 'sun') {
  throw new Error(`Expected base title after deleting last alert, got count=${controller.getAlertCount()} title=${titleValue}`);
}
if (clearCalls !== 1) {
  throw new Error(`Expected blinking to stop once, got ${clearCalls}`);
}
"""
    result = _run_tab_alert_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout
