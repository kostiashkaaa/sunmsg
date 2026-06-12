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


def test_unsigned_messages_are_marked_unverified_when_sender_key_is_known():
    """Security policy (audit C4):

    An unsigned message still decrypts, but when the sender's public key is
    known to us it MUST be flagged as unverified (the '[не проверено]' UI
    marker) rather than silently displayed as trusted. A tampered signature
    still blocks display. Genuinely old messages with no known sender key
    are not flagged.
    """
    crypto_path = ROOT / 'static' / 'crypto.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';
import {{ webcrypto }} from 'node:crypto';
import vm from 'node:vm';

const source = await readFile({str(crypto_path)!r}, 'utf8');
const context = {{
  console,
  crypto: webcrypto,
  TextEncoder,
  TextDecoder,
  Uint8Array,
  ArrayBuffer,
  setTimeout,
  clearTimeout,
  btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
  atob: (value) => Buffer.from(value, 'base64').toString('binary'),
}};
context.window = context;
vm.createContext(context);
vm.runInContext(source, context);

async function makeRsaOaepKeyPair() {{
  const pair = await webcrypto.subtle.generateKey({{
    name: 'RSA-OAEP',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256',
  }}, true, ['encrypt', 'decrypt']);
  const spki = await webcrypto.subtle.exportKey('spki', pair.publicKey);
  const pkcs8 = await webcrypto.subtle.exportKey('pkcs8', pair.privateKey);
  return {{
    publicPem: context.window.e2e.arrayBufferToBase64(spki),
    privatePem: context.window.e2e.arrayBufferToBase64(pkcs8),
  }};
}}

const receiver = await makeRsaOaepKeyPair();
const sender = await makeRsaOaepKeyPair();
const unsignedPayload = await context.window.e2e.encryptMessageE2E(
  receiver.publicPem,
  sender.publicPem,
  'legacy plaintext',
  '',
);
if (unsignedPayload.includes('signature')) {{
  throw new Error('Expected legacy payload without signature');
}}
// Ключ отправителя известен, подписи нет → расшифровать и пометить непроверенным.
const decryptedUnsigned = await context.window.e2e.decryptMessageE2E(
  receiver.privatePem,
  unsignedPayload,
  false,
  sender.publicPem,
);
if (!decryptedUnsigned.includes('legacy plaintext')) {{
  throw new Error(`Unsigned message lost its plaintext: ${{decryptedUnsigned}}`);
}}
if (!decryptedUnsigned.includes('[не проверено]')) {{
  throw new Error(`Unsigned message was not marked unverified: ${{decryptedUnsigned}}`);
}}

// Ключ отправителя неизвестен (старое сообщение) → расшифровать БЕЗ маркера.
const decryptedNoKey = await context.window.e2e.decryptMessageE2E(
  receiver.privatePem,
  unsignedPayload,
  false,
  '',
);
if (decryptedNoKey !== 'legacy plaintext') {{
  throw new Error(`Legacy message without known key rendered incorrectly: ${{decryptedNoKey}}`);
}}

const signedPayload = await context.window.e2e.encryptMessageE2E(
  receiver.publicPem,
  sender.publicPem,
  'signed plaintext',
  sender.privatePem,
);
const tampered = JSON.parse(signedPayload);
tampered.signature = `${{tampered.signature.slice(0, -4)}}AAAA`;
const decryptedTampered = await context.window.e2e.decryptMessageE2E(
  receiver.privatePem,
  JSON.stringify(tampered),
  false,
  sender.publicPem,
);
if (!decryptedTampered.includes('\\u041F\\u043E\\u0434\\u043F\\u0438\\u0441\\u044C')) {{
  throw new Error(`Tampered signed message was not blocked: ${{decryptedTampered}}`);
}}
"""
    result = _run_node_harness(node_harness)
    assert result.returncode == 0, result.stderr or result.stdout
