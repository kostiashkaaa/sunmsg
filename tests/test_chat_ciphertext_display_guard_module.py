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


def test_ciphertext_payload_is_not_rendered_as_chat_text():
    module_path = ROOT / 'static' / 'modules' / 'utils.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

Object.defineProperty(globalThis, 'window', {{
  value: {{ SUN_I18N: {{ translateText: (value) => String(value) }} }},
  configurable: true,
}});
Object.defineProperty(globalThis, 'document', {{
  value: {{ documentElement: {{ lang: 'ru' }} }},
  configurable: true,
}});

const source = await readFile({str(module_path)!r}, 'utf8');
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64');
const utils = await import(moduleUrl);
const encrypted = '{{"encrypted_message":"cipher","encrypted_key_receiver":"receiver","encrypted_key_sender":"sender","iv":"iv"}}';

if (!utils.isEncryptedMessagePayload(encrypted)) {{
  throw new Error('encrypted payload was not detected');
}}

const displayText = utils.resolveMessageDisplayText(encrypted);
if (displayText.includes('encrypted_message') || displayText.includes('encrypted_key_receiver')) {{
  throw new Error(`ciphertext leaked into display text: ${{displayText}}`);
}}
if (!displayText.includes('\\u0417\\u0430\\u0448\\u0438\\u0444\\u0440')) {{
  throw new Error(`display text should be encrypted placeholder: ${{displayText}}`);
}}

const previewHtml = utils.renderMessagePreviewHtml(encrypted, {{ isSelf: true, maxLen: 120 }});
if (previewHtml.includes('encrypted_message') || previewHtml.includes('encrypted_key_receiver')) {{
  throw new Error(`ciphertext leaked into preview: ${{previewHtml}}`);
}}

const plain = 'plain message';
if (utils.resolveMessageDisplayText(plain) !== plain) {{
  throw new Error('plain text should not be changed');
}}
"""
    result = _run_node_harness(node_harness)
    assert result.returncode == 0, result.stderr or result.stdout


def test_message_renderer_uses_display_text_for_dom_content():
    source = (ROOT / 'static' / 'modules' / 'message-rendering.js').read_text(encoding='utf-8')

    assert 'resolveMessageDisplayText' in source
    assert "setAttribute('data-message-content', displayMessageText)" in source
    assert 'renderMessageLinkPreview(messageDiv, { ...msg, message: messageText })' in source
