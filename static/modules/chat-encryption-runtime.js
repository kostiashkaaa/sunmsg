export function createChatEncryptionRuntime({
    windowRef = window,
    getCurrentChatId,
    isCurrentChatGroup,
    getCurrentContactPublicKey,
    getCurrentUserPublicKey,
    loadContacts,
    getPrivateKeyPem,
} = {}) {
    function isEncryptedPayload(value) {
        return typeof value === 'string'
            && value.trim().startsWith('{')
            && value.includes('encrypted_message');
    }

    async function encryptForCurrentChat(plainText) {
        if (!getCurrentChatId?.()) {
            throw new Error('\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0447\u0430\u0442 \u043F\u0435\u0440\u0435\u0434 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u043E\u0439 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F.');
        }
        if (isCurrentChatGroup?.()) {
            return plainText;
        }
        const currentContactPublicKey = getCurrentContactPublicKey?.();
        if (!currentContactPublicKey) {
            loadContacts?.();
            throw new Error('\u041D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u043A\u043B\u044E\u0447 \u0441\u043E\u0431\u0435\u0441\u0435\u0434\u043D\u0438\u043A\u0430. \u041E\u0431\u043D\u043E\u0432\u0438\u0442\u0435 \u0441\u043F\u0438\u0441\u043E\u043A \u043A\u043E\u043D\u0442\u0430\u043A\u0442\u043E\u0432.');
        }
        if (!getPrivateKeyPem?.()) {
            throw new Error('\u041D\u0435\u0442 \u043F\u0440\u0438\u0432\u0430\u0442\u043D\u043E\u0433\u043E \u043A\u043B\u044E\u0447\u0430. \u0412\u043E\u0439\u0434\u0438\u0442\u0435 \u0437\u0430\u043D\u043E\u0432\u043E \u0441 \u0432\u0430\u0448\u0438\u043C \u043A\u043B\u044E\u0447\u043E\u043C.');
        }
        const currentUserPublicKey = getCurrentUserPublicKey?.();
        if (!currentUserPublicKey) {
            throw new Error('\u041D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u0432\u0430\u0448 \u043F\u0443\u0431\u043B\u0438\u0447\u043D\u044B\u0439 \u043A\u043B\u044E\u0447. \u041E\u0431\u043D\u043E\u0432\u0438\u0442\u0435 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443 \u0438 \u0432\u043E\u0439\u0434\u0438\u0442\u0435 \u0437\u0430\u043D\u043E\u0432\u043E.');
        }
        return windowRef.e2e.encryptMessageE2E(
            currentContactPublicKey,
            currentUserPublicKey,
            plainText,
        );
    }

    function createEncryptForChatSnapshot({
        chatId,
        isGroup,
        contactPublicKey,
        userPublicKey,
    } = {}) {
        const sourceChatId = String(chatId || '').trim();
        const sourceContactPublicKey = String(contactPublicKey || '').trim();
        const sourceUserPublicKey = String(userPublicKey || '').trim();
        const sourceChatIsGroup = Boolean(isGroup);

        return async (plainText) => {
            if (!sourceChatId) {
                throw new Error('\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0447\u0430\u0442 \u043F\u0435\u0440\u0435\u0434 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u043E\u0439 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F.');
            }
            if (sourceChatIsGroup) {
                return plainText;
            }
            if (!sourceContactPublicKey) {
                loadContacts?.();
                throw new Error('\u041D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u043A\u043B\u044E\u0447 \u0441\u043E\u0431\u0435\u0441\u0435\u0434\u043D\u0438\u043A\u0430. \u041E\u0431\u043D\u043E\u0432\u0438\u0442\u0435 \u0441\u043F\u0438\u0441\u043E\u043A \u043A\u043E\u043D\u0442\u0430\u043A\u0442\u043E\u0432.');
            }
            if (!getPrivateKeyPem?.()) {
                throw new Error('\u041D\u0435\u0442 \u043F\u0440\u0438\u0432\u0430\u0442\u043D\u043E\u0433\u043E \u043A\u043B\u044E\u0447\u0430. \u0412\u043E\u0439\u0434\u0438\u0442\u0435 \u0437\u0430\u043D\u043E\u0432\u043E \u0441 \u0432\u0430\u0448\u0438\u043C \u043A\u043B\u044E\u0447\u043E\u043C.');
            }
            if (!sourceUserPublicKey) {
                throw new Error('\u041D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u0432\u0430\u0448 \u043F\u0443\u0431\u043B\u0438\u0447\u043D\u044B\u0439 \u043A\u043B\u044E\u0447. \u041E\u0431\u043D\u043E\u0432\u0438\u0442\u0435 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443 \u0438 \u0432\u043E\u0439\u0434\u0438\u0442\u0435 \u0437\u0430\u043D\u043E\u0432\u043E.');
            }
            return windowRef.e2e.encryptMessageE2E(sourceContactPublicKey, sourceUserPublicKey, plainText);
        };
    }

    async function decryptForDisplay(privateKeyPem, encryptedPayload, isSelf) {
        if (!privateKeyPem || !isEncryptedPayload(encryptedPayload)) {
            return encryptedPayload;
        }

        if (!windowRef.e2e || !windowRef.e2e.decryptMessageE2E) {
            return '[E2E \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E: crypto.js \u043D\u0435 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D]';
        }

        return await windowRef.e2e.decryptMessageE2E(privateKeyPem, encryptedPayload, isSelf);
    }

    return {
        encryptForCurrentChat,
        createEncryptForChatSnapshot,
        isEncryptedPayload,
        decryptForDisplay,
    };
}
