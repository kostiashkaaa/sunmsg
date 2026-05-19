from pathlib import Path
import subprocess


def test_virtual_range_uses_cached_message_heights_not_average_only() -> None:
    module_path = Path(__file__).resolve().parents[1] / 'static' / 'chat' / 'chat-state-shell.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

const source = await readFile({str(module_path)!r}, 'utf8');
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64');
const {{ createChatStateShell }} = await import(moduleUrl);

const chatStates = new Map();
const shell = createChatStateShell({{
  chatStates,
  chatDefaultMessageHeight: 100,
  chatDaySeparatorHeight: 30,
  chatVirtualizationMinMessages: 2,
  chatVirtualWindowSize: 80,
  chatVirtualBuffer: 1,
  getMessageKey: (msg) => `id:${{msg.id}}`,
  getMessageDayKey: () => '2026-01-01',
  formatDaySeparatorLabel: () => 'Today',
  parseUtcDate: () => null,
  getReactionMessageKey: () => '',
  clearPendingReactionOpByMessage: () => {{}},
  syncDeletedMessagesToCache: () => {{}},
  invalidateChatDomSnapshot: () => {{}},
  scheduleProfileMediaPanelRefresh: () => {{}},
  getChatMessagesClientHeight: () => 100,
  onRemoveMessageId: () => {{}},
}});

const messages = Array.from({{ length: 100 }}, (_, index) => ({{
  id: index + 1,
  created_at: '2026-01-01 00:00:00',
}}));
shell.setChatMessages('chat-1', messages, {{ resetHeights: true }});
const state = shell.getChatState('chat-1');
messages.forEach((msg, index) => {{
  state.messageHeights.set(`id:${{msg.id}}`, index === 20 ? 600 : 20);
}});
state.averageMessageHeight = 100;
shell.invalidateHeightIndex(state);

const range = shell.getDesiredRenderRange(state, 2000);
if (range.start <= 40 || range.start > 75) {{
  throw new Error(`Expected cached-height range near tall message, got ${{JSON.stringify(range)}}`);
}}
const total = shell.sumEstimatedHeights(state, 0, state.messages.length);
if (total !== 2610) {{
  throw new Error(`Expected separator + cached heights total 2610, got ${{total}}`);
}}
"""
    result = subprocess.run(
        ['node', '--input-type=module', '-e', node_harness],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr or result.stdout
