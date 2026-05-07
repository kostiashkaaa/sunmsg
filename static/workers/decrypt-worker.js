/* eslint-env worker */

self.window = self;

let decryptModuleReady = false;
try {
    importScripts('/static/crypto.js');
    decryptModuleReady = Boolean(self.e2e && typeof self.e2e.decryptMessageE2E === 'function');
} catch (_) {
    decryptModuleReady = false;
}

const MAX_DECRYPT_CACHE_ENTRIES = 1024;
const decryptCache = new Map();

function isEncryptedPayload(value) {
    return typeof value === 'string'
        && value.trim().startsWith('{')
        && value.includes('encrypted_message');
}

function pruneDecryptCache() {
    while (decryptCache.size > MAX_DECRYPT_CACHE_ENTRIES) {
        const oldestKey = decryptCache.keys().next().value;
        if (!oldestKey) break;
        decryptCache.delete(oldestKey);
    }
}

// \u041B\u0451\u0433\u043A\u0438\u0439 32-\u0431\u0438\u0442\u043D\u044B\u0439 \u0445\u0435\u0448 \u0441\u0442\u0440\u043E\u043A\u0438 (FNV-1a), \u0447\u0442\u043E\u0431\u044B \u043D\u0435 \u0434\u0435\u0440\u0436\u0430\u0442\u044C \u043C\u0435\u0433\u0430\u0431\u0430\u0439\u0442\u044B ciphertext \u0432 Map.
function _hashKey(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(16);
}

async function decryptPayload(privateKeyPem, payload, isSelf) {
    if (!isEncryptedPayload(payload)) return payload;
    if (!privateKeyPem || !decryptModuleReady) return payload;

    const raw = String(payload || '');
    const cacheKey = `${isSelf ? '1' : '0'}:${raw.length}:${_hashKey(raw)}`;
    if (!decryptCache.has(cacheKey)) {
        const promise = self.e2e
            .decryptMessageE2E(privateKeyPem, payload, Boolean(isSelf))
            .catch((err) => {
                // \u041D\u0435 \u0437\u0430\u043B\u0438\u043F\u0430\u0435\u043C \u043D\u0430 \u043E\u0442\u043A\u043B\u043E\u043D\u0451\u043D\u043D\u043E\u043C \u043F\u0440\u043E\u043C\u0438\u0441\u0435 — \u043F\u0440\u043E\u0431\u0443\u0435\u043C \u0437\u0430\u043D\u043E\u0432\u043E \u043F\u0440\u0438 \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u043C \u0437\u0430\u043F\u0440\u043E\u0441\u0435.
                decryptCache.delete(cacheKey);
                throw err;
            });
        decryptCache.set(cacheKey, promise);
        pruneDecryptCache();
    }
    return decryptCache.get(cacheKey);
}

self.addEventListener('message', async (event) => {
    const data = event?.data || {};
    if (data.type !== 'decrypt_batch') return;

    const requestId = String(data.requestId || '');
    const privateKeyPem = String(data.privateKeyPem || '');
    const jobs = Array.isArray(data.jobs) ? data.jobs : [];

    try {
        const results = [];

        for (const job of jobs) {
            const index = Number(job?.index);
            if (!Number.isFinite(index) || index < 0) continue;

            const decryptedMessage = await decryptPayload(privateKeyPem, job?.message, job?.isSelf);

            let decryptedReply = '';
            if (job?.hasReply && job?.replyMessage) {
                try {
                    decryptedReply = await decryptPayload(privateKeyPem, job.replyMessage, job?.replyIsSelf);
                } catch (_) {
                    decryptedReply = '🔒';
                }
            }

            results.push({
                index,
                message: decryptedMessage,
                reply: decryptedReply,
            });
        }

        self.postMessage({
            requestId,
            success: true,
            results,
        });
    } catch (err) {
        self.postMessage({
            requestId,
            success: false,
            error: err?.message || 'Decrypt worker failure.',
        });
    }
});
