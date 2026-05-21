from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def _run_chat_folders_harness(harness_body: str) -> subprocess.CompletedProcess[str]:
    module_path = ROOT / 'static' / 'modules' / 'chat-folders.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

const source = await readFile({str(module_path)!r}, 'utf8');
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64');
const moduleApi = await import(moduleUrl);

class FakeBadge {{
  constructor(text, hidden = false) {{
    this.textContent = text;
    this.style = {{ display: hidden ? 'none' : '' }};
    this.classList = {{ contains: (name) => hidden && name === 'unread-badge--hidden' }};
  }}
}}

class FakeContact {{
  constructor(attrs, badge = null) {{
    this.attrs = new Map(Object.entries(attrs));
    this.badge = badge;
  }}

  getAttribute(name) {{
    return this.attrs.get(name) || '';
  }}

  querySelector(selector) {{
    if (selector === '.unread-badge') return this.badge;
    return null;
  }}
}}

{harness_body}
"""
    return subprocess.run(
        ['node', '--input-type=module', '-e', node_harness],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


def test_chat_folder_matching_uses_system_rules_and_explicit_ids():
    harness_body = """
const direct = new FakeContact({
  'data-chat-id': 'direct-1',
  'data-is-group': '0',
  'data-saved-messages': '0',
  'data-pinned': '0',
}, new FakeBadge('3'));
const group = new FakeContact({
  'data-chat-id': 'group-1',
  'data-is-group': '1',
  'data-saved-messages': '0',
  'data-pinned': '1',
}, null);
const saved = new FakeContact({
  'data-chat-id': 'saved',
  'data-is-group': '0',
  'data-saved-messages': '1',
  'data-pinned': '0',
}, null);

if (!moduleApi.chatMatchesFolder(direct, { title: 'Direct', include: 'direct' })) {
  throw new Error('Direct folder should include direct chat');
}
if (moduleApi.chatMatchesFolder(group, { title: 'Direct', include: 'direct' })) {
  throw new Error('Direct folder should exclude groups');
}
if (moduleApi.chatMatchesFolder(saved, { title: 'Direct', include: 'direct' })) {
  throw new Error('Direct folder should exclude saved messages');
}
if (!moduleApi.chatMatchesFolder(group, { title: 'Pinned', include: 'pinned' })) {
  throw new Error('Pinned folder should include pinned chat');
}
if (!moduleApi.chatMatchesFolder(direct, { title: 'Unread', include: 'unread' })) {
  throw new Error('Unread folder should include unread chat');
}
if (!moduleApi.chatMatchesFolder(group, {
  title: 'Manual',
  include: 'direct',
  included_chat_ids: ['group-1'],
  excluded_chat_ids: [],
})) {
  throw new Error('Explicit include should include chat outside base rule');
}
if (moduleApi.chatMatchesFolder(direct, {
  title: 'Excluded',
  include: 'all',
  included_chat_ids: [],
  excluded_chat_ids: ['direct-1'],
})) {
  throw new Error('Explicit exclude should win');
}
if (moduleApi.chatMatchesFolder(group, {
  title: 'Manual only',
  include: 'all',
  included_chat_ids: ['direct-1'],
  excluded_chat_ids: [],
})) {
  throw new Error('All folder with explicit ids should become manual-only');
}
"""
    result = _run_chat_folders_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_normalize_chat_folders_rejects_reserved_ids_and_sorts():
    harness_body = """
const folders = moduleApi.normalizeChatFolders([
  { id: 'second', title: 'Second', include: 'bad', order: 2 },
  { id: 'all', title: 'Reserved', include: 'all', order: 0 },
  { id: 'first', title: 'First', include: 'groups', order: 1 },
  { id: 'empty', title: '   ', include: 'all', order: 3 },
]);

const packed = JSON.stringify(folders);
const expected = JSON.stringify([
  {
    id: 'first',
    title: 'First',
    include: 'groups',
    included_chat_ids: [],
    excluded_chat_ids: [],
    order: 1,
  },
  {
    id: 'second',
    title: 'Second',
    include: 'all',
    included_chat_ids: [],
    excluded_chat_ids: [],
    order: 2,
  },
]);
if (packed !== expected) {
  throw new Error(`Unexpected normalized folders: ${packed}`);
}
"""
    result = _run_chat_folders_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout
