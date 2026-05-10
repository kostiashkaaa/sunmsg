from pathlib import Path
import subprocess


def _run_realtime_ui_harness(harness_body: str) -> subprocess.CompletedProcess[str]:
    module_path = Path(__file__).resolve().parents[1] / 'static' / 'modules' / 'chat-realtime-ui-events.js'
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


def test_realtime_reactions_ignores_superseded_local_echo():
    harness_body = """
const handlers = new Map();
const socket = { on: (eventName, callback) => handlers.set(eventName, callback) };
let updateCalls = 0;
let patchCalls = 0;
let forgetCalls = 0;

moduleApi.registerRealtimeUiSocketHandlers({
  socket,
  getChatState: () => ({ pins: [], favorites: [] }),
  getCurrentChatId: () => 'chat-1',
  getReactionMessageKey: (chatId, messageId) => `${chatId}:${messageId}`,
  getReactionEventTimestamp: () => 101,
  reactionUpdateStampByMessage: new Map(),
  clearPendingReactionOp: () => ({ chatId: 'chat-1', messageId: 55, superseded: true }),
  clearPendingReactionOpByMessage: () => null,
  isSupersededReactionRequest: () => true,
  forgetSupersededReactionRequest: () => { forgetCalls += 1; },
  updateMessageReactionsState: () => { updateCalls += 1; return true; },
  getActiveReactionMessageId: () => 0,
  closeReactionPicker: () => {},
  resolveCurrentChatMessageElement: () => ({ id: 'msg' }),
  patchMessageReactions: () => { patchCalls += 1; },
  rerenderCurrentChat: () => {},
});

const cb = handlers.get('message_reactions_updated');
cb({
  chat_id: 'chat-1',
  message_id: 55,
  request_id: 'req-old',
  updated_at: '2026-05-10T00:00:00.101Z',
  reactions: [],
});

if (forgetCalls !== 1) {
  throw new Error(`Expected forgetSupersededReactionRequest once, got ${forgetCalls}`);
}
if (updateCalls !== 0) {
  throw new Error(`Expected updateMessageReactionsState not to run, got ${updateCalls}`);
}
if (patchCalls !== 0) {
  throw new Error(`Expected patchMessageReactions not to run, got ${patchCalls}`);
}
"""
    result = _run_realtime_ui_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_realtime_reactions_disables_animation_for_current_local_echo():
    harness_body = """
const handlers = new Map();
const socket = { on: (eventName, callback) => handlers.set(eventName, callback) };
const patchCalls = [];

moduleApi.registerRealtimeUiSocketHandlers({
  socket,
  getChatState: () => ({ pins: [], favorites: [] }),
  getCurrentChatId: () => 'chat-1',
  getReactionMessageKey: (chatId, messageId) => `${chatId}:${messageId}`,
  getReactionEventTimestamp: () => 202,
  reactionUpdateStampByMessage: new Map(),
  clearPendingReactionOp: () => ({ chatId: 'chat-1', messageId: 77, superseded: false }),
  clearPendingReactionOpByMessage: () => null,
  isSupersededReactionRequest: () => false,
  forgetSupersededReactionRequest: () => {},
  updateMessageReactionsState: () => true,
  getActiveReactionMessageId: () => 0,
  closeReactionPicker: () => {},
  resolveCurrentChatMessageElement: () => ({ id: 'msg' }),
  patchMessageReactions: (_messageEl, _reactions, options) => { patchCalls.push(options); },
  rerenderCurrentChat: () => {},
});

const cb = handlers.get('message_reactions_updated');
cb({
  chat_id: 'chat-1',
  message_id: 77,
  request_id: 'req-current',
  updated_at: '2026-05-10T00:00:00.202Z',
  reactions: [{ emoji: '👍', count: 1, reactors: [] }],
});

if (patchCalls.length !== 1) {
  throw new Error(`Expected one patch call, got ${patchCalls.length}`);
}
if (patchCalls[0]?.animate !== false) {
  throw new Error(`Expected animate=false for local echo, got ${String(patchCalls[0]?.animate)}`);
}
"""
    result = _run_realtime_ui_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout

