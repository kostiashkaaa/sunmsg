from pathlib import Path
import subprocess


def _run_saved_messages_ui_harness(harness_body: str) -> subprocess.CompletedProcess[str]:
    module_path = Path(__file__).resolve().parents[1] / 'static' / 'modules' / 'saved-messages-ui.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

globalThis.window = globalThis.window || {{}};
globalThis.document = globalThis.document || {{ documentElement: {{ lang: 'ru' }} }};

const source = await readFile({str(module_path)!r}, 'utf8');
const patchedSource = source.replace(
  "import {{ tr }} from './utils.js';",
  "const tr = (value) => value;",
);
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(patchedSource, 'utf8').toString('base64');
const moduleApi = await import(moduleUrl);

{harness_body}
"""
    return subprocess.run(
        ['node', '--input-type=module', '-e', node_harness],
        capture_output=True,
        text=True,
        check=False,
    )


def test_saved_messages_status_clears_last_seen_metadata():
    harness_body = """
const statusEl = {
  textContent: '',
  style: { display: 'block' },
  classList: { remove: () => {} },
  dataset: { state: 'offline' },
  _attrs: new Map([['data-last-seen', '2026-05-03 00:00:00']]),
  setAttribute(name, value) { this._attrs.set(name, String(value)); },
};

const ui = moduleApi.createSavedMessagesUiController({
  currentUserId: '42',
  getChatState: () => ({ messages: [{ id: 1 }, { id: 2 }] }),
  chatOnlineStatusEl: statusEl,
});

ui.syncCurrentChatMeta({ chatId: 'chat-1', contactId: '42' });

if (statusEl._attrs.get('data-last-seen') !== '') {
  throw new Error(`Expected data-last-seen to be cleared, got: ${statusEl._attrs.get('data-last-seen')}`);
}
if (statusEl.dataset.state !== 'saved') {
  throw new Error(`Expected dataset.state=saved, got: ${statusEl.dataset.state}`);
}
"""
    result = _run_saved_messages_ui_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_saved_messages_status_uses_total_messages_when_history_is_paginated():
    harness_body = """
const statusEl = {
  textContent: '',
  style: { display: 'block' },
  classList: { remove: () => {} },
  dataset: {},
  setAttribute() {},
};

const loadedMessages = Array.from({ length: 24 }, (_, index) => ({ id: index + 1 }));
const ui = moduleApi.createSavedMessagesUiController({
  currentUserId: '42',
  getChatState: () => ({ messages: loadedMessages, totalMessages: 37 }),
  chatOnlineStatusEl: statusEl,
});

ui.syncCurrentChatMeta({ chatId: 'chat-1', contactId: '42' });

if (statusEl.textContent !== '37 сообщений') {
  throw new Error(`Expected total message count, got: ${statusEl.textContent}`);
}
"""
    result = _run_saved_messages_ui_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_saved_messages_status_primes_total_from_contact_item_before_history_load():
    harness_body = """
const statusEl = {
  textContent: '',
  style: { display: 'block' },
  classList: { remove: () => {} },
  dataset: {},
  setAttribute() {},
};
const state = {
  messages: Array.from({ length: 24 }, (_, index) => ({ id: index + 1 })),
  totalMessages: null,
};
const contactItem = {
  attrs: new Map([
    ['data-contact-id', '42'],
    ['data-message-count', '37'],
  ]),
  getAttribute(name) { return this.attrs.get(name) || ''; },
  setAttribute(name, value) { this.attrs.set(name, String(value)); },
  querySelector() { return null; },
};

const ui = moduleApi.createSavedMessagesUiController({
  currentUserId: '42',
  getChatState: () => state,
  chatOnlineStatusEl: statusEl,
});

ui.applyChatMode({ contactItem, chatId: 'chat-1' });

if (state.totalMessages !== 37) {
  throw new Error(`Expected state.totalMessages=37, got: ${state.totalMessages}`);
}
if (statusEl.textContent !== '37 сообщений') {
  throw new Error(`Expected contact message count, got: ${statusEl.textContent}`);
}
"""
    result = _run_saved_messages_ui_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout
