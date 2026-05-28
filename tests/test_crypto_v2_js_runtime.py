"""Node-харнесс тесты для crypto-v2.js (X3DH / Ed25519 / AES-GCM).

Покрывает (audit H2 — ранее v3-стек был без единого теста):
  - X3DH round-trip: initiator → responder восстанавливает plaintext;
  - C4 для v3: неподписанный X3DH-payload помечается '[не проверено]',
    подделанная подпись блокирует показ.

Запускается через node с экспериментальными X25519/Ed25519 в webcrypto.
"""
from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def _run_node_harness(source: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ['node', '--input-type=module', '--no-warnings', '-e', source],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


def _harness_prelude() -> str:
    crypto_v2_path = ROOT / 'static' / 'crypto-v2.js'
    return f"""
import {{ readFile }} from 'node:fs/promises';
import {{ webcrypto }} from 'node:crypto';
import vm from 'node:vm';

const source = await readFile({str(crypto_v2_path)!r}, 'utf8');
const context = {{
  console, crypto: webcrypto, TextEncoder, TextDecoder,
  Uint8Array, ArrayBuffer, btoa, atob, setTimeout, clearTimeout,
}};
context.window = context;
vm.createContext(context);
vm.runInContext(source, context);
const cv2 = context.window.cryptoV2;
"""


def test_x3dh_roundtrip_and_unverified_marking():
    node_harness = _harness_prelude() + """
// Идентичности Alice (отправитель) и Bob (получатель).
const aliceIK = await cv2.generateX25519KeyPair();
const aliceEd = await cv2.generateEd25519KeyPair();
const bobIK = await cv2.generateX25519KeyPair();
const bobSPK = await cv2.generateX25519KeyPair();
const bobOPK = await cv2.generateX25519KeyPair();

const bundle = {
  identityKey: bobIK.publicKeyB64u,
  signedPrekey: bobSPK.publicKeyB64u,
  signedPrekeyId: 1,
  signature: '',
  oneTimePrekey: bobOPK.publicKeyB64u,
  oneTimePrekeyId: 7,
};

const payloadStr = await cv2.encryptMessageX3DH(
  aliceIK.privateKey, aliceIK.publicKeyB64u, aliceEd.privateKey, bundle, 'hello x3dh',
);

// 1) Round-trip: Bob восстанавливает приватные ключи и расшифровывает.
const bobIKpriv = await cv2.importX25519Private(bobIK.privateKeyJwk);
const bobSPKpriv = await cv2.importX25519Private(bobSPK.privateKeyJwk);
const bobOPKpriv = await cv2.importX25519Private(bobOPK.privateKeyJwk);

const decrypted = await cv2.decryptMessageX3DH(
  bobIKpriv, bobSPKpriv, bobOPKpriv, aliceEd.publicKeyB64u, payloadStr,
);
if (decrypted !== 'hello x3dh') {
  throw new Error(`Round-trip failed: ${decrypted}`);
}

// 2) C4: снимаем подпись → расшифровка идёт, но помечена непроверенной.
const stripped = JSON.parse(payloadStr);
delete stripped.sig;
delete stripped.sig_alg;
const bobIKpriv2 = await cv2.importX25519Private(bobIK.privateKeyJwk);
const bobSPKpriv2 = await cv2.importX25519Private(bobSPK.privateKeyJwk);
const bobOPKpriv2 = await cv2.importX25519Private(bobOPK.privateKeyJwk);
const unsignedDec = await cv2.decryptMessageX3DH(
  bobIKpriv2, bobSPKpriv2, bobOPKpriv2, aliceEd.publicKeyB64u, JSON.stringify(stripped),
);
if (!unsignedDec.includes('hello x3dh')) {
  throw new Error(`Unsigned X3DH lost plaintext: ${unsignedDec}`);
}
if (!unsignedDec.includes('[не проверено]')) {
  throw new Error(`Unsigned X3DH not marked unverified: ${unsignedDec}`);
}

// 3) Подделанная подпись → блок.
const tampered = JSON.parse(payloadStr);
tampered.sig = `${tampered.sig.slice(0, -4)}AAAA`;
const bobIKpriv3 = await cv2.importX25519Private(bobIK.privateKeyJwk);
const bobSPKpriv3 = await cv2.importX25519Private(bobSPK.privateKeyJwk);
const bobOPKpriv3 = await cv2.importX25519Private(bobOPK.privateKeyJwk);
const tamperedDec = await cv2.decryptMessageX3DH(
  bobIKpriv3, bobSPKpriv3, bobOPKpriv3, aliceEd.publicKeyB64u, JSON.stringify(tampered),
);
if (!tamperedDec.includes('Подпись')) {
  throw new Error(`Tampered X3DH signature not blocked: ${tamperedDec}`);
}
"""
    result = _run_node_harness(node_harness)
    assert result.returncode == 0, result.stderr or result.stdout
