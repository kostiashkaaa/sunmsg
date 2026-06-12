import os
import base64
import hashlib
import json
import re
from cryptography.hazmat.primitives.asymmetric import rsa, ed25519
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.backends import default_backend
from cryptography.exceptions import InvalidSignature

_CHAT_ID_RE = re.compile(r'^[0-9a-f]{64}$')

def normalize_public_key(public_key):
    public_key = public_key.strip()
    public_key = public_key.replace('-----BEGIN PUBLIC KEY-----', '')
    public_key = public_key.replace('-----END PUBLIC KEY-----', '')
    public_key = public_key.replace('\n', '')
    return public_key

def normalize_private_key(key_pem):
    key_pem = key_pem.strip()
    if not key_pem.startswith('-----BEGIN RSA PRIVATE KEY-----'):
        key_pem = '-----BEGIN RSA PRIVATE KEY-----\n' + key_pem
    if not key_pem.endswith('-----END RSA PRIVATE KEY-----'):
        key_pem += '\n-----END RSA PRIVATE KEY-----'
    lines = key_pem.strip().splitlines()
    key_lines = []
    inside_key = False
    for line in lines:
        if '-----BEGIN' in line:
            inside_key = True
            key_lines.append(line)
        elif '-----END' in line:
            inside_key = False
            key_lines.append(line)
        elif inside_key:
            key_lines.append(line.strip())
    return '\n'.join(key_lines)

def clean_public_key(public_key):
    public_key = public_key.replace("-----BEGIN PUBLIC KEY-----", "").replace("-----END PUBLIC KEY-----", "")
    return public_key.strip()

def add_pem_headers(public_key):
    normalized_public_key = normalize_public_key(str(public_key or ''))
    key_lines = [normalized_public_key[i:i+64] for i in range(0, len(normalized_public_key), 64)]
    return "-----BEGIN PUBLIC KEY-----\n" + "\n".join(key_lines) + "\n-----END PUBLIC KEY-----"

def generate_keys():
    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
        backend=default_backend()
    )
    private_key_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption()
    ).decode('utf-8')

    public_key = private_key.public_key()
    public_key_pem = public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode('utf-8')

    return private_key_pem, public_key_pem

def generate_symmetric_key():
    return os.urandom(32)


def generate_chat_id(key1, key2):
    keys = sorted([key1, key2])
    combined_keys = ''.join(keys)
    chat_id = hashlib.sha256(combined_keys.encode('utf-8')).hexdigest()
    return chat_id


def is_valid_chat_id(chat_id):
    if not isinstance(chat_id, str):
        return False
    return _CHAT_ID_RE.fullmatch(chat_id.strip()) is not None


# NaCl box ciphertext: base64url or standard base64, min 49 bytes decoded
# (24-byte nonce + 16-byte poly1305 tag + ≥1 byte plaintext → ≥41 bytes,
#  but TweetNaCl boxes are typically 200–50 000 chars encoded).
_B64_RE = re.compile(r'^[A-Za-z0-9+/\-_]+=*$')
_CIPHERTEXT_MIN_LEN = 40   # encoded chars; anything shorter is suspicious

# ── Ed25519 / X25519 keys (crypto v2) ────────────────────────────────────────

_B64U_RE = re.compile(r'^[A-Za-z0-9\-_]+$')

def _b64u_decode(s: str) -> bytes:
    s = s.replace('-', '+').replace('_', '/')
    padding = 4 - len(s) % 4
    if padding != 4:
        s += '=' * padding
    return base64.b64decode(s)

def is_valid_ed25519_public_key(key_b64u: str) -> bool:
    if not isinstance(key_b64u, str):
        return False
    key_b64u = key_b64u.strip()
    if not _B64U_RE.fullmatch(key_b64u):
        return False
    try:
        raw = _b64u_decode(key_b64u)
        if len(raw) != 32:
            return False
        ed25519.Ed25519PublicKey.from_public_bytes(raw)
        return True
    except Exception:
        return False

def is_valid_x25519_public_key(key_b64u: str) -> bool:
    if not isinstance(key_b64u, str):
        return False
    key_b64u = key_b64u.strip()
    if not _B64U_RE.fullmatch(key_b64u):
        return False
    try:
        raw = _b64u_decode(key_b64u)
        return len(raw) == 32
    except Exception:
        return False

def verify_ed25519_signature(public_key_b64u: str, message: str | bytes, signature_b64u: str) -> bool:
    try:
        raw_key = _b64u_decode(public_key_b64u)
        pub = ed25519.Ed25519PublicKey.from_public_bytes(raw_key)
        sig = _b64u_decode(signature_b64u)
        data = message.encode('utf-8') if isinstance(message, str) else message
        pub.verify(sig, data)
        return True
    except InvalidSignature:
        return False
    except Exception:
        return False


# ── v3 payload validation (X25519/DR/MLS) ──────────────────────────────────────

_PROTO_VALIDATORS = {
    'x3dh': {'required': ['sender_ik', 'ephemeral_key', 'spk_id', 'ct', 'iv', 'sig']},
    'dr':   {'required': ['header', 'ct', 'iv', 'sig']},
    'mls':  {'required': ['group_id', 'epoch', 'seq', 'ct', 'iv', 'sig']},
}

_B64U_MIN_CT_BYTES = 16   # AES-GCM tag alone is 16 bytes

def is_valid_v3_payload(raw: str) -> bool:
    if not isinstance(raw, str) or len(raw) > 256 * 1024:
        return False
    try:
        payload = json.loads(raw)
    except Exception:
        return False
    if payload.get('v') != 3:
        return False
    proto = payload.get('proto', '')
    spec = _PROTO_VALIDATORS.get(proto)
    if spec is None:
        return False
    for field in spec['required']:
        if not payload.get(field):
            return False
    # Check the ciphertext size
    try:
        ct_bytes = _b64u_decode(payload['ct'])
        if len(ct_bytes) < _B64U_MIN_CT_BYTES:
            return False
    except Exception:
        return False
    return True


def looks_like_ciphertext(value: str) -> bool:
    """Return True if value looks like a NaCl base64 ciphertext, False otherwise."""
    if not isinstance(value, str):
        return False
    v = value.strip()
    if len(v) < _CIPHERTEXT_MIN_LEN:
        return False
    try:
        decoded = base64.b64decode(v + '==', altchars=b'-_', validate=False)
        return len(decoded) >= 25  # nonce alone is 24 bytes
    except Exception:
        return False
