export function createChatEncryptionRuntime({
    windowRef = window,
    getCurrentChatId,
    getCurrentContactId,
    isCurrentChatGroup,
    getCurrentContactPublicKey,
    getCurrentUserPublicKey,
    getCurrentGroupMemberPublicKeys,
    loadContacts,
    getPrivateKeyPem,
    getCsrfToken,
} = {}) {
    const V3_PROTOS = new Set(['x3dh', 'dr', 'mls']);

    function isEncryptedPayload(value) {
        if (typeof value !== 'string') return false;
        const normalized = value.trim();
        if (!normalized.startsWith('{')) return false;
        try {
            const payload = JSON.parse(normalized);
            if (!payload || typeof payload !== 'object') return false;
            // v=3 Double Ratchet / X3DH / MLS
            if (payload.v === 3 && V3_PROTOS.has(payload.proto) && payload.ciphertext) return true;
            // v=2 RSA legacy
            return Boolean(
                payload.encrypted_message
                || payload.encryptedMessage
                || (
                    payload.v
                    && payload.iv
                    && (
                        payload.encrypted_key
                        || payload.encrypted_key_receiver
                        || payload.encrypted_key_sender
                        || Array.isArray(payload.encrypted_keys)
                    )
                )
            );
        } catch (_) {
            return false;
        }
    }

    async function encryptForCurrentChat(plainText) {
        const chatId = getCurrentChatId?.();
        if (!chatId) {
            throw new Error('\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0447\u0430\u0442 \u043F\u0435\u0440\u0435\u0434 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u043E\u0439 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F.');
        }

        // \u2500\u2500 v=3: \u0435\u0441\u043B\u0438 \u0435\u0441\u0442\u044C DR-\u0441\u0435\u0441\u0441\u0438\u044F \u0438\u043B\u0438 MLS-\u0433\u0440\u0443\u043F\u043F\u0430 \u2014 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u044C \u0438\u0445 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
        if (isCurrentChatGroup?.()) {
            const mlsResult = await _tryEncryptMls(chatId, plainText);
            if (mlsResult !== null) return mlsResult;
        } else {
            const drResult = await _tryEncryptDr(chatId, plainText);
            if (drResult !== null) return drResult;
        }

        // \u2500\u2500 v=2: RSA fallback \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
        const currentUserPublicKey = getCurrentUserPublicKey?.();
        const privateKeyPem = getPrivateKeyPem?.();
        if (isCurrentChatGroup?.()) {
            if (!currentUserPublicKey) throw new Error('\u041D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u0432\u0430\u0448 \u043F\u0443\u0431\u043B\u0438\u0447\u043D\u044B\u0439 \u043A\u043B\u044E\u0447. \u041E\u0431\u043D\u043E\u0432\u0438\u0442\u0435 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443 \u0438 \u0432\u043E\u0439\u0434\u0438\u0442\u0435 \u0437\u0430\u043D\u043E\u0432\u043E.');
            if (!privateKeyPem) throw new Error('\u041D\u0435\u0442 \u043F\u0440\u0438\u0432\u0430\u0442\u043D\u043E\u0433\u043E \u043A\u043B\u044E\u0447\u0430. \u0412\u043E\u0439\u0434\u0438\u0442\u0435 \u0437\u0430\u043D\u043E\u0432\u043E \u0441 \u0432\u0430\u0448\u0438\u043C \u043A\u043B\u044E\u0447\u043E\u043C.');
            const groupPublicKeys = await getCurrentGroupMemberPublicKeys?.(chatId);
            if (!Array.isArray(groupPublicKeys) || !groupPublicKeys.length) {
                throw new Error('\u041D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B \u043A\u043B\u044E\u0447\u0438 \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u043E\u0432 \u0433\u0440\u0443\u043F\u043F\u044B.');
            }
            return windowRef.e2e.encryptMessageE2EForRecipients(groupPublicKeys, currentUserPublicKey, plainText, privateKeyPem);
        }
        const currentContactPublicKey = getCurrentContactPublicKey?.();
        if (!currentContactPublicKey) { loadContacts?.(); throw new Error('\u041D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u043A\u043B\u044E\u0447 \u0441\u043E\u0431\u0435\u0441\u0435\u0434\u043D\u0438\u043A\u0430. \u041E\u0431\u043D\u043E\u0432\u0438\u0442\u0435 \u0441\u043F\u0438\u0441\u043E\u043A \u043A\u043E\u043D\u0442\u0430\u043A\u0442\u043E\u0432.'); }
        if (!privateKeyPem) throw new Error('\u041D\u0435\u0442 \u043F\u0440\u0438\u0432\u0430\u0442\u043D\u043E\u0433\u043E \u043A\u043B\u044E\u0447\u0430. \u0412\u043E\u0439\u0434\u0438\u0442\u0435 \u0437\u0430\u043D\u043E\u0432\u043E \u0441 \u0432\u0430\u0448\u0438\u043C \u043A\u043B\u044E\u0447\u043E\u043C.');
        if (!currentUserPublicKey) throw new Error('\u041D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u0432\u0430\u0448 \u043F\u0443\u0431\u043B\u0438\u0447\u043D\u044B\u0439 \u043A\u043B\u044E\u0447. \u041E\u0431\u043D\u043E\u0432\u0438\u0442\u0435 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443 \u0438 \u0432\u043E\u0439\u0434\u0438\u0442\u0435 \u0437\u0430\u043D\u043E\u0432\u043E.');
        return windowRef.e2e.encryptMessageE2E(currentContactPublicKey, currentUserPublicKey, plainText, privateKeyPem);
    }

    async function _tryEncryptDr(chatId, plainText, peerUserId = getCurrentContactId?.()) {
        const normalizedPeerUserId = normalizePeerUserId(peerUserId);
        if (!normalizedPeerUserId) return null;
        if (!windowRef.DoubleRatchet) return null;
        const session = await _loadDrSession(chatId);
        if (!session) return null;
        try {
            const v2keys = windowRef.deviceKey?.loadV2PrivateKeys ? await windowRef.deviceKey.loadV2PrivateKeys() : null;
            const v2pub = windowRef.deviceKey?.loadV2PublicKeys ? windowRef.deviceKey.loadV2PublicKeys() : null;
            if (!v2keys?.ed25519Private || !v2pub?.ed25519Public) return null;
            const ed25519PrivKey = await windowRef.cryptoV2.importEd25519Private(v2keys.ed25519Private);
            const { cipherPayload, newState } = await windowRef.DoubleRatchet.encryptAndPackage(
                session, plainText, ed25519PrivKey, v2pub.ed25519Public
            );
            await _saveDrSession(chatId, newState, normalizedPeerUserId);
            windowRef.e2eeStatusUI?.setStatus('dr');
            return cipherPayload;
        } catch (_) { return null; }
    }

    async function _tryEncryptMls(chatId, plainText) {
        if (!windowRef.MLSClient) return null;
        const groupState = await _loadMlsGroup(chatId);
        if (!groupState) return null;
        try {
            const v2keys = windowRef.deviceKey?.loadV2PrivateKeys ? await windowRef.deviceKey.loadV2PrivateKeys() : null;
            const v2pub = windowRef.deviceKey?.loadV2PublicKeys ? windowRef.deviceKey.loadV2PublicKeys() : null;
            if (!v2keys?.ed25519Private || !v2pub?.ed25519Public) return null;
            const ed25519PrivKey = await windowRef.cryptoV2.importEd25519Private(v2keys.ed25519Private);
            const { cipherPayload, newState } = await windowRef.MLSClient.encryptGroupMessage(
                groupState, plainText, ed25519PrivKey, v2pub.ed25519Public
            );
            await _saveMlsGroup(chatId, newState);
            windowRef.e2eeStatusUI?.setStatus('mls');
            return cipherPayload;
        } catch (_) { return null; }
    }

    function createEncryptForChatSnapshot({
        chatId,
        isGroup,
        contactPublicKey,
        userPublicKey,
        contactId,
    } = {}) {
        const sourceChatId = String(chatId || '').trim();
        const sourceContactPublicKey = String(contactPublicKey || '').trim();
        const sourceUserPublicKey = String(userPublicKey || '').trim();
        const sourceContactId = normalizePeerUserId(contactId);
        const sourceChatIsGroup = Boolean(isGroup);

        return async (plainText) => {
            if (!sourceChatId) {
                throw new Error('\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0447\u0430\u0442 \u043F\u0435\u0440\u0435\u0434 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u043E\u0439 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F.');
            }

            // \u2500\u2500 v=3 \u043F\u043E\u043F\u044B\u0442\u043A\u0430 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
            if (sourceChatIsGroup) {
                const mlsResult = await _tryEncryptMls(sourceChatId, plainText);
                if (mlsResult !== null) return mlsResult;
            } else {
                const drResult = await _tryEncryptDr(sourceChatId, plainText, sourceContactId);
                if (drResult !== null) return drResult;
            }

            // \u2500\u2500 v=2: RSA fallback \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
            const privateKeyPem = getPrivateKeyPem?.();
            if (sourceChatIsGroup) {
                if (!sourceUserPublicKey) throw new Error('\u041D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u0432\u0430\u0448 \u043F\u0443\u0431\u043B\u0438\u0447\u043D\u044B\u0439 \u043A\u043B\u044E\u0447. \u041E\u0431\u043D\u043E\u0432\u0438\u0442\u0435 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443 \u0438 \u0432\u043E\u0439\u0434\u0438\u0442\u0435 \u0437\u0430\u043D\u043E\u0432\u043E.');
                if (!privateKeyPem) throw new Error('\u041D\u0435\u0442 \u043F\u0440\u0438\u0432\u0430\u0442\u043D\u043E\u0433\u043E \u043A\u043B\u044E\u0447\u0430. \u0412\u043E\u0439\u0434\u0438\u0442\u0435 \u0437\u0430\u043D\u043E\u0432\u043E \u0441 \u0432\u0430\u0448\u0438\u043C \u043A\u043B\u044E\u0447\u043E\u043C.');
                const groupPublicKeys = await getCurrentGroupMemberPublicKeys?.(sourceChatId);
                if (!Array.isArray(groupPublicKeys) || !groupPublicKeys.length) {
                    throw new Error('\u041D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B \u043A\u043B\u044E\u0447\u0438 \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u043E\u0432 \u0433\u0440\u0443\u043F\u043F\u044B.');
                }
                return windowRef.e2e.encryptMessageE2EForRecipients(groupPublicKeys, sourceUserPublicKey, plainText, privateKeyPem);
            }
            if (!sourceContactPublicKey) { loadContacts?.(); throw new Error('\u041D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u043A\u043B\u044E\u0447 \u0441\u043E\u0431\u0435\u0441\u0435\u0434\u043D\u0438\u043A\u0430. \u041E\u0431\u043D\u043E\u0432\u0438\u0442\u0435 \u0441\u043F\u0438\u0441\u043E\u043A \u043A\u043E\u043D\u0442\u0430\u043A\u0442\u043E\u0432.'); }
            if (!privateKeyPem) throw new Error('\u041D\u0435\u0442 \u043F\u0440\u0438\u0432\u0430\u0442\u043D\u043E\u0433\u043E \u043A\u043B\u044E\u0447\u0430. \u0412\u043E\u0439\u0434\u0438\u0442\u0435 \u0437\u0430\u043D\u043E\u0432\u043E \u0441 \u0432\u0430\u0448\u0438\u043C \u043A\u043B\u044E\u0447\u043E\u043C.');
            if (!sourceUserPublicKey) throw new Error('\u041D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u0432\u0430\u0448 \u043F\u0443\u0431\u043B\u0438\u0447\u043D\u044B\u0439 \u043A\u043B\u044E\u0447. \u041E\u0431\u043D\u043E\u0432\u0438\u0442\u0435 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443 \u0438 \u0432\u043E\u0439\u0434\u0438\u0442\u0435 \u0437\u0430\u043D\u043E\u0432\u043E.');
            return windowRef.e2e.encryptMessageE2E(sourceContactPublicKey, sourceUserPublicKey, plainText, privateKeyPem);
        };
    }

    async function decryptForDisplay(privateKeyPem, encryptedPayload, isSelf, expectedSenderPublicKey = '') {
        if (!isEncryptedPayload(encryptedPayload)) {
            return encryptedPayload;
        }

        let payload;
        try { payload = JSON.parse(encryptedPayload); } catch (_) { return encryptedPayload; }

        // \u2500\u2500 v=3: Double Ratchet / X3DH / MLS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
        if (payload?.v === 3) {
            return _decryptV3(payload, encryptedPayload);
        }

        // \u2500\u2500 v=2: RSA legacy \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
        if (!privateKeyPem) return encryptedPayload;
        if (!windowRef.e2e || !windowRef.e2e.decryptMessageE2E) {
            return '[E2E \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E: crypto.js \u043D\u0435 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D]';
        }
        const result = await windowRef.e2e.decryptMessageE2E(privateKeyPem, encryptedPayload, isSelf, expectedSenderPublicKey);
        windowRef.e2eeStatusUI?.setStatus('legacy');
        return result;
    }

    async function _decryptV3(payload, rawPayload) {
        const proto = payload.proto;
        const chatId = getCurrentChatId?.();

        try {
            if (proto === 'dr' || proto === 'x3dh') {
                if (!windowRef.DoubleRatchet) return '[DR: \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E]';
                const session = await _loadDrSession(chatId);
                if (!session) return '[DR: \u043D\u0435\u0442 \u0441\u0435\u0441\u0441\u0438\u0438]';
                const { plaintext, newState } = await windowRef.DoubleRatchet.decryptPackage(session, rawPayload);
                await _saveDrSession(chatId, newState, getCurrentContactId?.());
                windowRef.e2eeStatusUI?.setStatus(proto);
                return plaintext;
            }
            if (proto === 'mls') {
                if (!windowRef.MLSClient) return '[MLS: \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E]';
                const groupState = await _loadMlsGroup(chatId);
                if (!groupState) return '[MLS: \u043D\u0435\u0442 \u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u044F \u0433\u0440\u0443\u043F\u043F\u044B]';
                const { plaintext, newState } = await windowRef.MLSClient.decryptGroupMessage(groupState, rawPayload);
                await _saveMlsGroup(chatId, newState);
                windowRef.e2eeStatusUI?.setStatus('mls');
                return plaintext;
            }
        } catch (err) {
            console.warn('[E2EE v3] decrypt error', proto, err);
            return `[E2EE: \u043E\u0448\u0438\u0431\u043A\u0430 \u0440\u0430\u0441\u0448\u0438\u0444\u0440\u043E\u0432\u043A\u0438 (${proto})]`;
        }
        return rawPayload;
    }

    async function _loadDrSession(chatId) {
        if (!chatId) return null;
        try {
            const resp = await fetch(`/api/crypto/dr-session/${encodeURIComponent(chatId)}`, { credentials: 'same-origin' });
            if (!resp.ok) return null;
            const data = await resp.json();
            const sessionState = data?.session_state || data?.session;
            if (!sessionState) return null;
            return windowRef.DoubleRatchet.deserializeSession(sessionState);
        } catch (_) { return null; }
    }

    function normalizePeerUserId(value) {
        const numberValue = Number(value);
        if (!Number.isSafeInteger(numberValue) || numberValue <= 0) return null;
        return numberValue;
    }

    async function _saveDrSession(chatId, state, peerUserId) {
        if (!chatId || !state) return;
        const normalizedPeerUserId = normalizePeerUserId(peerUserId);
        if (!normalizedPeerUserId) return;
        try {
            const serialized = windowRef.DoubleRatchet.serializeSession(state);
            const csrfToken = typeof getCsrfToken === 'function' ? getCsrfToken() : '';
            const headers = { 'Content-Type': 'application/json' };
            if (csrfToken) headers['X-CSRFToken'] = csrfToken;
            await fetch(`/api/crypto/dr-session/${encodeURIComponent(chatId)}`, {
                method: 'POST',
                credentials: 'same-origin',
                headers,
                body: JSON.stringify({
                    session_state: serialized,
                    peer_user_id: normalizedPeerUserId,
                }),
            });
        } catch (_) { /* non-fatal */ }
    }

    function _mlsGroupStorageKey(chatId) {
        return `mls_group_state_${chatId}`;
    }

    async function _loadMlsGroup(chatId) {
        if (!chatId || !windowRef.MLSClient) return null;
        try {
            const raw = sessionStorage.getItem(_mlsGroupStorageKey(chatId));
            if (!raw) return null;
            return windowRef.MLSClient.deserializeGroupState(raw);
        } catch (_) { return null; }
    }

    async function _saveMlsGroup(chatId, state) {
        if (!chatId || !state || !windowRef.MLSClient) return;
        try {
            const serialized = windowRef.MLSClient.serializeGroupState(state);
            sessionStorage.setItem(_mlsGroupStorageKey(chatId), serialized);
        } catch (_) { /* sessionStorage full or unavailable */ }
    }

    return {
        encryptForCurrentChat,
        createEncryptForChatSnapshot,
        isEncryptedPayload,
        decryptForDisplay,
    };
}
