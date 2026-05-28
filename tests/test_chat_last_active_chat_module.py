from pathlib import Path
import subprocess


def _run_last_active_harness(harness_body: str) -> subprocess.CompletedProcess[str]:
    module_path = Path(__file__).resolve().parents[1] / 'static' / 'modules' / 'chat-last-active-chat.js'
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


def test_restore_marks_initial_restore_click_only_during_handler():
    harness_body = """
let clickedWithFlag = false;
let clickCount = 0;
const contactItem = {
  dataset: {},
  getAttribute: (name) => (name === 'data-chat-id' ? 'chat-1' : ''),
  click() {
    clickCount += 1;
    clickedWithFlag = this.dataset.chatInitialRestore === '1';
  },
};

const contactsList = {
  querySelectorAll: (selector) => (selector === '.contact-item' ? [contactItem] : []),
};

let syncedContact = null;
const controller = moduleApi.createLastActiveChatController({
  storageKey: 'last',
  storage: null,
  getStoredString: () => '',
  setStoredString: () => {},
  getCurrentChatId: () => '',
  contactsList,
  initialRequestedChatId: 'chat-1',
  syncBrowserUrlForActiveChat: (item) => { syncedContact = item; },
});

const restored = controller.restoreLastActiveChatSelection();

if (!restored) {
  throw new Error('Expected initial chat to restore');
}
if (clickCount !== 1 || !clickedWithFlag) {
  throw new Error(`Expected click with initial restore flag, count=${clickCount}, flag=${clickedWithFlag}`);
}
if (contactItem.dataset.chatInitialRestore !== undefined) {
  throw new Error('Initial restore flag should be cleaned after click');
}
if (syncedContact !== contactItem) {
  throw new Error('Expected restored contact to sync browser URL');
}
"""
    result = _run_last_active_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout
