export function isEncryptedVoiceSource(source) {
    return String(source || '').includes('sun_media_e2ee=');
}

function readAudioSource(audioEl) {
    return String(
        audioEl?.getAttribute?.('src')
        || audioEl?.currentSrc
        || '',
    ).trim();
}

function readAudioDataSource(audioEl) {
    return String(
        audioEl?.getAttribute?.('data-src')
        || audioEl?.dataset?.src
        || '',
    ).trim();
}

function clearEncryptedRuntimeSource(audioEl) {
    const currentSrc = readAudioSource(audioEl);
    if (!currentSrc || !isEncryptedVoiceSource(currentSrc)) return;
    try { audioEl.removeAttribute('src'); } catch (_) {}
    try { audioEl.load?.(); } catch (_) {}
}

function assignResolvedVoiceSource(audioEl, resolvedSrc, expectedDataSrc, expectedSeq) {
    const safeSrc = String(resolvedSrc || '').trim();
    if (!safeSrc || isEncryptedVoiceSource(safeSrc)) return false;
    if (expectedDataSrc && readAudioDataSource(audioEl) !== expectedDataSrc) return false;
    if (expectedSeq && String(audioEl?.dataset?.voiceSourceSeq || '') !== String(expectedSeq)) return false;
    audioEl.setAttribute('src', safeSrc);
    return true;
}

export function createMobileVoicePlaybackController({ windowRef = window } = {}) {
    const pendingSourceByAudio = new WeakMap();

    function prepareAudioSource(audioEl) {
        if (!audioEl || typeof audioEl.getAttribute !== 'function') {
            return { status: 'missing' };
        }

        const currentSrc = readAudioSource(audioEl);
        if (currentSrc && !isEncryptedVoiceSource(currentSrc)) {
            return { status: 'ready', source: currentSrc };
        }
        clearEncryptedRuntimeSource(audioEl);

        const dataSrc = readAudioDataSource(audioEl);
        if (!dataSrc) return { status: 'missing' };

        if (!isEncryptedVoiceSource(dataSrc)) {
            audioEl.setAttribute('src', dataSrc);
            return { status: 'ready', source: dataSrc };
        }

        const resolver = windowRef?.__sunMediaCacheResolveSource;
        if (typeof resolver !== 'function') {
            return { status: 'error', reason: 'resolver-missing' };
        }

        const existing = pendingSourceByAudio.get(audioEl);
        if (existing && existing.dataSrc === dataSrc) {
            return { status: 'pending', promise: existing.promise };
        }

        const nextSeq = Number(audioEl.dataset?.voiceSourceSeq || 0) + 1;
        if (audioEl.dataset) {
            audioEl.dataset.voiceSourceSeq = String(nextSeq);
        }

        let resolvedValue;
        try {
            resolvedValue = resolver(dataSrc, { kind: 'audio' });
        } catch (_) {
            return { status: 'error', reason: 'resolver-failed' };
        }

        if (!resolvedValue || typeof resolvedValue.then !== 'function') {
            const ready = assignResolvedVoiceSource(audioEl, resolvedValue, dataSrc, nextSeq);
            return ready
                ? { status: 'ready', source: readAudioSource(audioEl) }
                : { status: 'error', reason: 'resolver-empty' };
        }

        const promise = Promise.resolve(resolvedValue)
            .then((resolvedSrc) => assignResolvedVoiceSource(audioEl, resolvedSrc, dataSrc, nextSeq))
            .catch(() => false)
            .finally(() => {
                const current = pendingSourceByAudio.get(audioEl);
                if (current?.promise === promise) {
                    pendingSourceByAudio.delete(audioEl);
                }
            });

        pendingSourceByAudio.set(audioEl, { dataSrc, promise });
        return { status: 'pending', promise };
    }

    return { prepareAudioSource };
}
