from pathlib import Path
import re
import subprocess


def test_mnemonic_wordlist_is_standard_bip39_english_list():
    script_path = Path(__file__).resolve().parents[1] / 'static' / 'mnemonic.js'
    source = script_path.read_text(encoding='utf-8')
    match = re.search(r'const WORDLIST = "([^"]+)";', source)
    assert match is not None

    words = match.group(1).split(' ')
    assert len(words) == 2048
    assert len(set(words)) == 2048
    assert words[0] == 'abandon'
    assert words[-1] == 'zoo'


def test_mnemonic_vault_supports_legacy_word_count_and_rejects_wrong_phrase():
    script_path = Path(__file__).resolve().parents[1] / 'static' / 'mnemonic.js'

    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

const source = await readFile({str(script_path)!r}, 'utf8');
const moduleUrl = `data:text/javascript;base64,${{Buffer.from(source, 'utf8').toString('base64')}}`;

const prevWindow = globalThis.window;
globalThis.window = {{
  crypto: globalThis.crypto,
  atob: (value) => Buffer.from(String(value), 'base64').toString('binary'),
  btoa: (value) => Buffer.from(String(value), 'binary').toString('base64'),
}};

await import(moduleUrl);

const phrase12 = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu';
const privateKeyPem = 'legacy-private-key-pem';

const vault = await globalThis.window.mnemonic.createVault(phrase12, privateKeyPem);
const restoredPem = await globalThis.window.mnemonic.decryptVault(phrase12, vault);
if (restoredPem !== privateKeyPem) {{
  throw new Error('Expected vault decryption to work with a 12-word legacy phrase');
}}

let shortPhraseRejected = false;
try {{
  await globalThis.window.mnemonic.decryptVault('one two three', vault);
}} catch (error) {{
  shortPhraseRejected = String(error?.message || '').includes('12');
}}
if (!shortPhraseRejected) {{
  throw new Error('Expected short phrase to be rejected with validation error');
}}

let wrongPhraseRejected = false;
try {{
  await globalThis.window.mnemonic.decryptVault('alpha beta gamma delta epsilon zeta eta theta iota kappa lambda nu', vault);
}} catch (_) {{
  wrongPhraseRejected = true;
}}
if (!wrongPhraseRejected) {{
  throw new Error('Expected wrong mnemonic phrase to fail vault decryption');
}}

globalThis.window = prevWindow;
"""

    result = subprocess.run(
        ['node', '--input-type=module', '-e', node_harness],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr or result.stdout


def test_mnemonic_vault_reports_webcrypto_unavailable_on_insecure_context():
    script_path = Path(__file__).resolve().parents[1] / 'static' / 'mnemonic.js'

    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

const source = await readFile({str(script_path)!r}, 'utf8');
const moduleUrl = `data:text/javascript;base64,${{Buffer.from(source, 'utf8').toString('base64')}}`;

const prevWindow = globalThis.window;
globalThis.window = {{
  atob: (value) => Buffer.from(String(value), 'base64').toString('binary'),
  btoa: (value) => Buffer.from(String(value), 'binary').toString('base64'),
}};

await import(moduleUrl);

let gotExpectedMessage = false;
try {{
  await globalThis.window.mnemonic.generateMnemonic();
}} catch (error) {{
  const text = String(error?.message || '');
  gotExpectedMessage = text.includes('HTTPS') || text.includes('localhost');
}}

globalThis.window = prevWindow;

if (!gotExpectedMessage) {{
  throw new Error('Expected a clear WebCrypto/HTTPS error when crypto.subtle is unavailable');
}}
"""

    result = subprocess.run(
        ['node', '--input-type=module', '-e', node_harness],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr or result.stdout
