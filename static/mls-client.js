/**
 * MLS Client — RFC 9420 (Messaging Layer Security)
 *
 * Native implementation of an MLS subset for group chats.
 * Dependency: crypto-v2.js (X25519, Ed25519, HKDF, AES-GCM).
 *
 * Implements:
 *   - KeyPackage: generation, publication, import
 *   - Group: creation, Welcome (invitation), Commit (key update)
 *   - Simplified TreeKEM: a shared epoch secret without the full tree
 *   - Group message encryption / decryption via the epoch key
 *
 * Simplifications relative to RFC 9420:
 *   - The tree is stored as a flat list of leaf nodes (fine for ≤1000 members)
 *   - No support for extensions and capabilities
 *   - Commit = epoch secret update via HKDF with the current roster
 */

'use strict';

const MLS_VERSION = 1;
const MLS_SUITE = 'X25519_AES256GCM_SHA256_Ed25519';
const MLS_MAX_EPOCH_MESSAGES = 1000;

function _cv2() {
    if (typeof window !== 'undefined' && window.cryptoV2) return window.cryptoV2;
    throw new Error('crypto-v2.js must be loaded before mls-client.js');
}

// ── KeyPackage ────────────────────────────────────────────────────────────────
//
// Contains the X25519 init key (for Welcome encryption) and the Ed25519 identity key.
// Signed with the user's Ed25519 key.

async function generateKeyPackage(identityEd25519PrivKey, identityEd25519PubB64u, userId) {
    const cv2 = _cv2();

    // Ephemeral X25519 — used to encrypt the Welcome
    const initKeyPair = await cv2.generateX25519KeyPair();

    const pkg = {
        version: MLS_VERSION,
        cipher_suite: MLS_SUITE,
        user_id: userId,
        identity_key: identityEd25519PubB64u,
        init_key: initKeyPair.publicKeyB64u,
        created_at: Date.now(),
    };

    const toSign = JSON.stringify({
        version: pkg.version,
        cipher_suite: pkg.cipher_suite,
        user_id: pkg.user_id,
        identity_key: pkg.identity_key,
        init_key: pkg.init_key,
        created_at: pkg.created_at,
    });

    pkg.signature = await cv2.ed25519Sign(identityEd25519PrivKey, toSign);
    pkg.sig_alg = 'Ed25519';

    return {
        keyPackage: pkg,
        keyPackageRef: cv2.b64uEncode(
            await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(pkg)))
        ),
        initKeyPrivateJwk: initKeyPair.privateKeyJwk,
    };
}

async function verifyKeyPackage(pkg) {
    const cv2 = _cv2();
    if (!pkg.signature || !pkg.identity_key) return false;
    const pubKey = await cv2.importEd25519Public(pkg.identity_key);
    const toVerify = JSON.stringify({
        version: pkg.version,
        cipher_suite: pkg.cipher_suite,
        user_id: pkg.user_id,
        identity_key: pkg.identity_key,
        init_key: pkg.init_key,
        created_at: pkg.created_at,
    });
    return cv2.ed25519Verify(pubKey, toVerify, pkg.signature);
}

// ── Group ────────────────────────────────────────────────────────────────────

function _makeGroupId(chatId) {
    return `sun-mls-${chatId}`;
}

async function _deriveEpochSecret(groupId, epoch, rosterHash) {
    const cv2 = _cv2();
    const ikm = new TextEncoder().encode(`${groupId}|${epoch}|${rosterHash}`);
    const salt = new Uint8Array(32).buffer;
    return cv2.hkdf(ikm, salt, 'SUN-MLS-EPOCH-v1', 32);
}

async function _rosterHash(memberIdentityKeys) {
    const sorted = [...memberIdentityKeys].sort();
    const data = new TextEncoder().encode(sorted.join('|'));
    const hash = await crypto.subtle.digest('SHA-256', data);
    return _cv2().b64uEncode(hash);
}

// Create a new MLS group
async function createGroup(chatId, creatorIdentityKeyB64u) {
    const groupId = _makeGroupId(chatId);
    const epoch = 0;
    const members = [creatorIdentityKeyB64u];
    const rHash = await _rosterHash(members);
    const epochSecret = await _deriveEpochSecret(groupId, epoch, rHash);

    return {
        groupId,
        chatId,
        epoch,
        members,           // array of identity_key (Ed25519 pub b64u)
        epochSecret: _cv2().b64uEncode(epochSecret),
        rosterHash: rHash,
    };
}

// ── Welcome — group invitation ────────────────────────────────────────────
//
// Welcome = the epoch secret encrypted via X25519 ECDH with the recipient's init_key.
// The inviter generates an ephemeral X25519, runs ECDH with the new member's init_key,
// and encrypts the epoch secret + roster via AES-GCM.

async function createWelcome(
    groupState,
    newMemberKeyPackage,               // the new member's KeyPackage object
    inviterEd25519PrivKey,
    inviterEd25519PubB64u
) {
    const cv2 = _cv2();

    // Verify the new member's KeyPackage
    if (!(await verifyKeyPackage(newMemberKeyPackage))) {
        throw new Error('mls: invalid key package signature');
    }

    // ECDH with the new member's init_key
    const ephemeral = await cv2.generateX25519KeyPair();
    const recipientInitPub = await cv2.importX25519Public(newMemberKeyPackage.init_key);
    const ephPriv = await cv2.importX25519Private(ephemeral.privateKeyJwk);
    const dhOut = await cv2.x25519DH(ephPriv, recipientInitPub);

    const wrappingKey = await cv2.hkdf(dhOut, new Uint8Array(32).buffer, 'SUN-MLS-WELCOME-v1', 32);

    // The new roster includes the new member
    const newMembers = [...groupState.members, newMemberKeyPackage.identity_key];
    const newRHash = await _rosterHash(newMembers);
    const newEpoch = groupState.epoch + 1;
    const newEpochSecret = await _deriveEpochSecret(groupState.groupId, newEpoch, newRHash);

    const welcomePayload = JSON.stringify({
        groupId: groupState.groupId,
        chatId: groupState.chatId,
        epoch: newEpoch,
        members: newMembers,
        rosterHash: newRHash,
        epochSecret: cv2.b64uEncode(newEpochSecret),
    });

    const { ciphertext, iv } = await cv2.aesGcmEncrypt(wrappingKey, welcomePayload);

    const welcome = {
        type: 'welcome',
        version: MLS_VERSION,
        group_id: groupState.groupId,
        epoch: newEpoch,
        sender_identity: inviterEd25519PubB64u,
        ephemeral_key: ephemeral.publicKeyB64u,
        recipient_init_key_ref: newMemberKeyPackage.init_key,
        ct: cv2.b64uEncode(ciphertext),
        iv: cv2.b64uEncode(iv),
    };

    const toSign = JSON.stringify({
        type: welcome.type,
        group_id: welcome.group_id,
        epoch: welcome.epoch,
        recipient_init_key_ref: welcome.recipient_init_key_ref,
        ct: welcome.ct,
        iv: welcome.iv,
    });
    welcome.sig = await cv2.ed25519Sign(inviterEd25519PrivKey, toSign);
    welcome.sig_alg = 'Ed25519';

    // Update group state for the inviter
    const newGroupState = {
        ...groupState,
        epoch: newEpoch,
        members: newMembers,
        epochSecret: cv2.b64uEncode(newEpochSecret),
        rosterHash: newRHash,
    };

    return { welcome, newGroupState };
}

// Accept a Welcome — initialize group state for the new member
async function processWelcome(welcome, myInitKeyPrivJwk, senderEd25519PubB64u) {
    const cv2 = _cv2();

    if (senderEd25519PubB64u) {
        const senderPub = await cv2.importEd25519Public(senderEd25519PubB64u);
        const toVerify = JSON.stringify({
            type: welcome.type,
            group_id: welcome.group_id,
            epoch: welcome.epoch,
            recipient_init_key_ref: welcome.recipient_init_key_ref,
            ct: welcome.ct,
            iv: welcome.iv,
        });
        const ok = await cv2.ed25519Verify(senderPub, toVerify, welcome.sig);
        if (!ok) throw new Error('mls: welcome signature invalid');
    }

    const myInitPriv = await cv2.importX25519Private(myInitKeyPrivJwk);
    const senderEph = await cv2.importX25519Public(welcome.ephemeral_key);
    const dhOut = await cv2.x25519DH(myInitPriv, senderEph);
    const wrappingKey = await cv2.hkdf(dhOut, new Uint8Array(32).buffer, 'SUN-MLS-WELCOME-v1', 32);

    const ptBuf = await cv2.aesGcmDecrypt(
        wrappingKey,
        cv2.b64uDecode(welcome.ct),
        cv2.b64uDecode(welcome.iv)
    );
    const groupState = JSON.parse(new TextDecoder().decode(ptBuf));
    return groupState;
}

// ── Commit — key update / member removal ─────────────────

async function createCommit(
    groupState,
    newMembers,                  // the new identity_key list
    committerEd25519PrivKey,
    committerEd25519PubB64u
) {
    const cv2 = _cv2();
    const newEpoch = groupState.epoch + 1;
    const newRHash = await _rosterHash(newMembers);
    const newEpochSecret = await _deriveEpochSecret(groupState.groupId, newEpoch, newRHash);

    const commit = {
        type: 'commit',
        version: MLS_VERSION,
        group_id: groupState.groupId,
        epoch: groupState.epoch,
        new_epoch: newEpoch,
        new_members: newMembers,
        roster_hash: newRHash,
        sender_identity: committerEd25519PubB64u,
    };

    const toSign = JSON.stringify({
        type: commit.type,
        group_id: commit.group_id,
        epoch: commit.epoch,
        new_epoch: commit.new_epoch,
        roster_hash: commit.roster_hash,
    });
    commit.sig = await cv2.ed25519Sign(committerEd25519PrivKey, toSign);
    commit.sig_alg = 'Ed25519';

    const newGroupState = {
        ...groupState,
        epoch: newEpoch,
        members: newMembers,
        epochSecret: cv2.b64uEncode(newEpochSecret),
        rosterHash: newRHash,
    };

    return { commit, newGroupState };
}

async function processCommit(groupState, commit, senderEd25519PubB64u) {
    const cv2 = _cv2();

    if (commit.epoch !== groupState.epoch) {
        throw new Error(`mls: commit epoch mismatch (got ${commit.epoch}, have ${groupState.epoch})`);
    }

    if (senderEd25519PubB64u) {
        const senderPub = await cv2.importEd25519Public(senderEd25519PubB64u);
        const toVerify = JSON.stringify({
            type: commit.type,
            group_id: commit.group_id,
            epoch: commit.epoch,
            new_epoch: commit.new_epoch,
            roster_hash: commit.roster_hash,
        });
        const ok = await cv2.ed25519Verify(senderPub, toVerify, commit.sig);
        if (!ok) throw new Error('mls: commit signature invalid');
    }

    const verifyHash = await _rosterHash(commit.new_members);
    if (verifyHash !== commit.roster_hash) throw new Error('mls: roster hash mismatch');

    const newEpochSecret = await _deriveEpochSecret(groupState.groupId, commit.new_epoch, commit.roster_hash);

    return {
        ...groupState,
        epoch: commit.new_epoch,
        members: commit.new_members,
        epochSecret: cv2.b64uEncode(newEpochSecret),
        rosterHash: commit.roster_hash,
    };
}

// ── Group encryption / decryption ───────────────────────────────────────

async function encryptGroupMessage(
    groupState,
    plaintext,
    senderEd25519PrivKey,
    senderEd25519PubB64u
) {
    const cv2 = _cv2();
    const epochKey = cv2.b64uDecode(groupState.epochSecret);

    // Derive per-message key from epoch secret + sequence number (prevents reuse)
    const msgSeq = cv2.b64uEncode(cv2.randomBytes(8));
    const msgKey = await cv2.hkdf(
        epochKey,
        new TextEncoder().encode(msgSeq),
        'SUN-MLS-MSG-v1',
        32
    );

    const { ciphertext, iv } = await cv2.aesGcmEncrypt(msgKey, plaintext);

    const payload = {
        v: 3,
        proto: 'mls',
        group_id: groupState.groupId,
        epoch: groupState.epoch,
        seq: msgSeq,
        ct: cv2.b64uEncode(ciphertext),
        iv: cv2.b64uEncode(iv),
        sender: senderEd25519PubB64u,
    };

    const toSign = JSON.stringify({
        v: payload.v,
        proto: payload.proto,
        group_id: payload.group_id,
        epoch: payload.epoch,
        seq: payload.seq,
        ct: payload.ct,
        iv: payload.iv,
    });
    payload.sig = await cv2.ed25519Sign(senderEd25519PrivKey, toSign);
    payload.sig_alg = 'Ed25519';

    return JSON.stringify(payload);
}

async function decryptGroupMessage(groupState, payloadStr, senderEd25519PubB64u = null) {
    const cv2 = _cv2();
    const payload = JSON.parse(payloadStr);

    if (payload.v !== 3 || payload.proto !== 'mls') throw new Error('not_mls_v3');
    if (payload.group_id !== groupState.groupId) throw new Error('mls: group_id mismatch');
    if (payload.epoch !== groupState.epoch) {
        throw new Error(`mls: epoch mismatch (msg=${payload.epoch}, local=${groupState.epoch})`);
    }

    const verifyPub = senderEd25519PubB64u || payload.sender;
    if (verifyPub && payload.sig) {
        const senderPub = await cv2.importEd25519Public(verifyPub);
        const toVerify = JSON.stringify({
            v: payload.v,
            proto: payload.proto,
            group_id: payload.group_id,
            epoch: payload.epoch,
            seq: payload.seq,
            ct: payload.ct,
            iv: payload.iv,
        });
        const ok = await cv2.ed25519Verify(senderPub, toVerify, payload.sig);
        if (!ok) return '[Подпись группового сообщения не прошла проверку]';
    }

    const epochKey = cv2.b64uDecode(groupState.epochSecret);
    const msgKey = await cv2.hkdf(
        epochKey,
        new TextEncoder().encode(payload.seq),
        'SUN-MLS-MSG-v1',
        32
    );

    try {
        const pt = await cv2.aesGcmDecrypt(msgKey, cv2.b64uDecode(payload.ct), cv2.b64uDecode(payload.iv));
        return new TextDecoder().decode(pt);
    } catch {
        return '⚠️ [Ошибка расшифровки группового сообщения]';
    }
}

// ── Group state serialization ────────────────────────────────────────────

function serializeGroupState(state) {
    return JSON.stringify(state);
}

function deserializeGroupState(json) {
    return JSON.parse(json);
}

// ── Public API ────────────────────────────────────────────────────────────────

if (typeof window !== 'undefined') {
    window.MLSClient = {
        generateKeyPackage,
        verifyKeyPackage,
        createGroup,
        createWelcome,
        processWelcome,
        createCommit,
        processCommit,
        encryptGroupMessage,
        decryptGroupMessage,
        serializeGroupState,
        deserializeGroupState,
    };
}
