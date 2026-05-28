/**
 * Double Ratchet Algorithm — Signal Protocol (RFC draft)
 *
 * Реализует полный DR для 1:1 сообщений:
 *   - Diffie-Hellman ratchet (X25519)
 *   - Symmetric-key ratchet (HKDF-SHA256)
 *   - Пропущенные ключи (out-of-order messages, до MAX_SKIP)
 *
 * Инициализация:
 *   - Инициатор: DR.initSender(masterSecret, bobDHPublicKeyB64u)
 *   - Получатель: DR.initReceiver(masterSecret, bobDHPrivateKeyJwk)
 *
 * masterSecret — 64 байта от X3DH (первые 32 — RK, следующие 32 — CK).
 * Состояние сериализуется в JSON для хранения в БД / IndexedDB.
 */

'use strict';

const DR_MAX_SKIP = 100;
const DR_INFO_RK = 'SUN-DR-RK-v1';
const DR_INFO_CK = 'SUN-DR-CK-v1';
const DR_INFO_MK = 'SUN-DR-MK-v1';

// ── Зависимость от crypto-v2.js ───────────────────────────────────────────────
function _cv2() {
    if (typeof window !== 'undefined' && window.cryptoV2) return window.cryptoV2;
    throw new Error('crypto-v2.js must be loaded before double-ratchet.js');
}

// ── KDF функции рэтчета ───────────────────────────────────────────────────────

async function _kdfRK(rootKey, dhOutput) {
    // Возвращает [newRootKey (32), newChainKey (32)]
    const cv2 = _cv2();
    const out = await cv2.hkdf(dhOutput, rootKey, DR_INFO_RK, 64);
    return [out.slice(0, 32), out.slice(32, 64)];
}

async function _kdfCK(chainKey) {
    // Возвращает [newChainKey (32), messageKey (32)]
    const cv2 = _cv2();
    const mk = await cv2.hkdf(chainKey, new Uint8Array(32).buffer, DR_INFO_MK, 32);
    const ck = await cv2.hkdf(chainKey, new Uint8Array([1]).buffer, DR_INFO_CK, 32);
    return [ck, mk];
}

// ── Состояние рэтчета ─────────────────────────────────────────────────────────

function _emptyState() {
    return {
        // DH ключи
        DHs: null,          // { publicKeyB64u, privateKeyJwk } — наша текущая DH пара
        DHr: null,          // string — публичный ключ собеседника (b64u)
        // Корневой ключ и цепочечные ключи (b64u raw bytes)
        RK: null,
        CKs: null,          // Sending chain key
        CKr: null,          // Receiving chain key
        // Счётчики
        Ns: 0,              // Sent messages in current chain
        Nr: 0,              // Received messages in current chain
        PN: 0,              // Messages in previous sending chain
        // Пропущенные ключи: Map<"dhPub:msgNum" → messageKeyB64u>
        MKSKIPPED: {},
    };
}

// ── Сериализация / десериализация ─────────────────────────────────────────────

function _serializeState(state) {
    return JSON.stringify(state);
}

function _deserializeState(json) {
    return JSON.parse(json);
}

// ── DH операции ───────────────────────────────────────────────────────────────

async function _dhGenerate() {
    const cv2 = _cv2();
    const kp = await cv2.generateX25519KeyPair();
    return { publicKeyB64u: kp.publicKeyB64u, privateKeyJwk: kp.privateKeyJwk };
}

async function _dhCompute(ourPrivJwk, theirPubB64u) {
    const cv2 = _cv2();
    const priv = await cv2.importX25519Private(ourPrivJwk);
    const pub = await cv2.importX25519Public(theirPubB64u);
    return cv2.x25519DH(priv, pub);
}

// ── Инициализация ─────────────────────────────────────────────────────────────

async function initSender(masterSecretBuf, recipientDHPublicB64u) {
    const state = _emptyState();
    state.DHs = await _dhGenerate();
    state.DHr = recipientDHPublicB64u;

    const RK = new Uint8Array(masterSecretBuf.slice(0, 32)).buffer;
    const dhOut = await _dhCompute(state.DHs.privateKeyJwk, state.DHr);
    const [newRK, newCKs] = await _kdfRK(RK, dhOut);

    state.RK = _cv2().b64uEncode(newRK);
    state.CKs = _cv2().b64uEncode(newCKs);
    state.CKr = null;
    return state;
}

async function initReceiver(masterSecretBuf, ourDHKeyPair) {
    // ourDHKeyPair — та же пара, чей публичный ключ был в prekey bundle
    const state = _emptyState();
    state.DHs = ourDHKeyPair;   // { publicKeyB64u, privateKeyJwk }
    state.DHr = null;
    state.RK = _cv2().b64uEncode(new Uint8Array(masterSecretBuf.slice(0, 32)).buffer);
    state.CKs = null;
    state.CKr = null;
    return state;
}

// ── Encrypt ───────────────────────────────────────────────────────────────────

async function encrypt(state, plaintext, associatedData = '') {
    const cv2 = _cv2();

    const [newCKs, mk] = await _kdfCK(cv2.b64uDecode(state.CKs));
    state.CKs = cv2.b64uEncode(newCKs);

    const { ciphertext, iv } = await cv2.aesGcmEncrypt(mk, plaintext);

    const header = {
        dh: state.DHs.publicKeyB64u,
        pn: state.PN,
        n: state.Ns,
    };
    state.Ns++;

    return {
        header,
        ciphertext: cv2.b64uEncode(ciphertext),
        iv: cv2.b64uEncode(iv),
        ad: associatedData,
    };
}

// ── Decrypt ───────────────────────────────────────────────────────────────────

async function decrypt(state, message, senderEd25519PubB64u = null) {
    const cv2 = _cv2();
    const { header, ciphertext, iv } = message;

    // Проверяем пропущенные ключи
    const skippedKey = _getSkippedKey(state, header.dh, header.n);
    if (skippedKey) {
        return _decryptWithKey(cv2.b64uDecode(skippedKey), ciphertext, iv);
    }

    let needRatchet = false;

    // DH рэтчет если получили новый DH публичный ключ
    if (state.DHr === null || header.dh !== state.DHr) {
        // Пропустить оставшиеся ключи текущей цепочки приёма
        if (state.CKr !== null) {
            await _skipMessageKeys(state, header.pn);
        }

        needRatchet = true;
        await _skipMessageKeys(state, header.pn);

        // Переключаем DH ratchet
        state.PN = state.Ns;
        state.Ns = 0;
        state.Nr = 0;
        state.DHr = header.dh;

        const dhOut1 = await _dhCompute(state.DHs.privateKeyJwk, state.DHr);
        const [newRK1, newCKr] = await _kdfRK(cv2.b64uDecode(state.RK), dhOut1);

        state.RK = cv2.b64uEncode(newRK1);
        state.CKr = cv2.b64uEncode(newCKr);

        // Генерируем новую DH пару для следующей отправки
        state.DHs = await _dhGenerate();
        const dhOut2 = await _dhCompute(state.DHs.privateKeyJwk, state.DHr);
        const [newRK2, newCKs] = await _kdfRK(cv2.b64uDecode(state.RK), dhOut2);

        state.RK = cv2.b64uEncode(newRK2);
        state.CKs = cv2.b64uEncode(newCKs);
    }

    await _skipMessageKeys(state, header.n);

    const [newCKr, mk] = await _kdfCK(cv2.b64uDecode(state.CKr));
    state.CKr = cv2.b64uEncode(newCKr);
    state.Nr++;

    return _decryptWithKey(mk, ciphertext, iv);
}

async function _decryptWithKey(mkBuf, ciphertextB64u, ivB64u) {
    const cv2 = _cv2();
    try {
        const pt = await cv2.aesGcmDecrypt(mkBuf, cv2.b64uDecode(ciphertextB64u), cv2.b64uDecode(ivB64u));
        return new TextDecoder().decode(pt);
    } catch {
        return '⚠️ [Ошибка расшифровки DR сообщения]';
    }
}

// ── Пропущенные ключи ─────────────────────────────────────────────────────────

function _getSkippedKey(state, dhPub, msgNum) {
    const key = `${dhPub}:${msgNum}`;
    return state.MKSKIPPED[key] ?? null;
}

async function _skipMessageKeys(state, until) {
    const cv2 = _cv2();
    if (!state.CKr) return;
    if (state.Nr > until) return;

    const toSkip = until - state.Nr;
    if (toSkip > DR_MAX_SKIP) throw new Error(`DR: too many skipped messages (${toSkip})`);

    while (state.Nr < until) {
        const [newCKr, mk] = await _kdfCK(cv2.b64uDecode(state.CKr));
        state.CKr = cv2.b64uEncode(newCKr);
        const mapKey = `${state.DHr}:${state.Nr}`;
        state.MKSKIPPED[mapKey] = cv2.b64uEncode(mk);
        state.Nr++;
    }

    // Ограничиваем размер буфера пропущенных ключей
    const keys = Object.keys(state.MKSKIPPED);
    if (keys.length > DR_MAX_SKIP) {
        const toRemove = keys.slice(0, keys.length - DR_MAX_SKIP);
        for (const k of toRemove) delete state.MKSKIPPED[k];
    }
}

// ── Упаковка для отправки на сервер ───────────────────────────────────────────

async function encryptAndPackage(state, plaintext, senderEd25519PrivKey, senderEd25519PubB64u) {
    const cv2 = _cv2();
    const msg = await encrypt(state, plaintext);

    const payload = {
        v: 3,
        proto: 'dr',
        header: msg.header,
        ct: msg.ciphertext,
        iv: msg.iv,
    };

    const toSign = JSON.stringify({
        v: payload.v,
        proto: payload.proto,
        header: payload.header,
        ct: payload.ct,
        iv: payload.iv,
    });

    if (senderEd25519PrivKey) {
        payload.sig = await cv2.ed25519Sign(senderEd25519PrivKey, toSign);
        payload.sig_alg = 'Ed25519';
        payload.sender_ed_pub = senderEd25519PubB64u;
    }

    return { state, payloadStr: JSON.stringify(payload) };
}

async function decryptPackage(state, payloadStr) {
    const cv2 = _cv2();
    const payload = JSON.parse(payloadStr);
    if (payload.v !== 3 || payload.proto !== 'dr') throw new Error('not_dr_v3');

    // Подпись Ed25519 в DR-payload обязательна: encryptAndPackage всегда её
    // ставит. Её отсутствие означает stripping → помечаем непроверенным.
    let unverified = false;
    if (payload.sig && payload.sender_ed_pub) {
        const pubKey = await cv2.importEd25519Public(payload.sender_ed_pub);
        const toVerify = JSON.stringify({
            v: payload.v,
            proto: payload.proto,
            header: payload.header,
            ct: payload.ct,
            iv: payload.iv,
        });
        const ok = await cv2.ed25519Verify(pubKey, toVerify, payload.sig);
        if (!ok) return { state, plaintext: '[Подпись сообщения не прошла проверку]' };
    } else {
        unverified = true;
    }

    const plaintext = await decrypt(state, { header: payload.header, ciphertext: payload.ct, iv: payload.iv });
    return { state, plaintext: unverified ? '⚠️ [не проверено] ' + plaintext : plaintext };
}

// ── Сериализация состояния ────────────────────────────────────────────────────

function serializeSession(state) {
    return _serializeState(state);
}

function deserializeSession(json) {
    return _deserializeState(json);
}

// ── Public API ────────────────────────────────────────────────────────────────

if (typeof window !== 'undefined') {
    window.DoubleRatchet = {
        initSender,
        initReceiver,
        encrypt,
        decrypt,
        encryptAndPackage,
        decryptPackage,
        serializeSession,
        deserializeSession,
    };
}
