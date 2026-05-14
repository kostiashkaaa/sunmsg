from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def _run_node_harness(source: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ['node', '--input-type=module', '-e', source],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


def test_history_decode_uses_sender_user_id_for_own_messages():
    module_path = ROOT / 'static' / 'modules' / 'chat-history-runtime.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

let source = await readFile({str(module_path)!r}, 'utf8');
source = source.replace(
  "import {{ withAppRoot }} from './app-url.js';",
  "const withAppRoot = (value) => value;",
);
source = source.replace(
  "import {{ normalizeMentionUserIds }} from './chat-mentions.js';",
  "const normalizeMentionUserIds = (value) => Array.isArray(value) ? value : [];",
);
source = source.replace(
  "import {{ normalizeGroupReaders }} from './chat-group-read-receipts.js';",
  "const normalizeGroupReaders = (value) => Array.isArray(value) ? value : [];",
);
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64');
const {{ createChatHistoryRuntime }} = await import(moduleUrl);
const decryptCalls = [];
const encrypted = '{{"encrypted_message":"cipher","encrypted_key_receiver":"receiver","encrypted_key_sender":"sender","iv":"iv"}}';
const runtime = createChatHistoryRuntime({{
  getPrivateKeyPem: () => 'private-key',
  getCurrentUserPublicKey: () => 'pk-current',
  getCurrentUserId: () => '1',
  getCurrentPartnerData: () => ({{ display_name: 'Partner' }}),
  isEncryptedPayload: (value) => typeof value === 'string' && value.includes('encrypted_message'),
  decryptForDisplay: async (_privateKey, _payload, isSelf) => {{
    decryptCalls.push(isSelf);
    return isSelf ? 'self plaintext' : 'other plaintext';
  }},
  normalizeMessageReactions: (value) => value || [],
  enrichDecodedMessagesVisualMeta: async (messages) => messages,
  chatDecryptConcurrency: 2,
  chatDecryptWorkerTimeoutMs: 100,
  WorkerCtor: null,
}});

const decoded = await runtime.decodeChatMessages([{{
  id: 7,
  sender_user_id: 1,
  sender_public_key: 'pk-stale-format',
  message: encrypted,
  message_type: 'text',
  created_at: '2026-05-14T23:00:01Z',
  reactions: [],
}}]);

if (decryptCalls[0] !== true) {{
  throw new Error(`Expected history decrypt to use sender key path: ${{JSON.stringify(decryptCalls)}}`);
}}
if (decoded[0].sender !== 'self' || decoded[0].message !== 'self plaintext') {{
  throw new Error(`Expected own history message plaintext: ${{JSON.stringify(decoded[0])}}`);
}}
"""
    result = _run_node_harness(node_harness)
    assert result.returncode == 0, result.stderr or result.stdout
