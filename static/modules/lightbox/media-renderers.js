export function getLightboxPartnerName() {
    return (window.currentPartnerData?.display_name || document.getElementById('chatTitle')?.textContent || 'Собеседник').trim();
}

function getElementSource(mediaEl) {
    if (!mediaEl) return '';
    return String(mediaEl.currentSrc || mediaEl.getAttribute?.('src') || '').trim();
}

function getElementRawSource(mediaEl) {
    if (!mediaEl) return '';
    return String(mediaEl.getAttribute?.('data-src') || '').trim();
}

export function resolveLightboxTriggerSource(trigger) {
    const kind = trigger?.getAttribute?.('data-media-kind') === 'video' ? 'video' : 'image';
    const mediaEl = kind === 'video'
        ? trigger?.querySelector?.('.file-msg-video-preview, .album-cell-video')
        : trigger?.querySelector?.('.file-msg-img, .album-cell-img');
    const loadedSrc = getElementSource(mediaEl);
    const rawSrc = String(trigger?.getAttribute?.('data-media-src') || getElementRawSource(mediaEl) || loadedSrc || '').trim();
    return {
        kind,
        src: loadedSrc || rawSrc,
        rawSrc,
    };
}

export function buildLightboxMediaItems({ formatFullTimestamp }) {
    const partnerName = getLightboxPartnerName();

    // Collect triggers: album cells from visible (non-hidden) messages first,
    // then fall back to plain .file-msg-media-trigger on non-album messages.
    // Skip triggers inside .message-album-hidden nodes.
    const triggers = Array.from(
        document.querySelectorAll('#chatMessages .file-msg-media-trigger')
    ).filter((trigger) => {
        const msg = trigger.closest('.message');
        if (!msg) return false;
        // Skip media triggers that belong to a hidden secondary album node
        if (msg.classList.contains('message-album-hidden')) return false;
        return true;
    });

    return triggers.map((trigger) => {
        const messageEl = trigger.closest('.message');
        // For album cells the footer lives in the primary node; for hidden nodes use primary via album-id
        const timeEl = messageEl?.querySelector('.msg-time');
        const tickEl = messageEl?.querySelector('.msg-tick');
        const createdAt = timeEl?.getAttribute('data-created-at') || '';
        const sender = messageEl?.classList.contains('self') ? 'Вы' : (partnerName || 'Собеседник');
        const datetime = timeEl?.getAttribute('title') || formatFullTimestamp(createdAt);
        const time = (timeEl?.textContent || '').trim();
        let tick = '';
        if (tickEl) {
            if (tickEl.classList.contains('pending')) {
                tick = '⌛';
            } else if (tickEl.classList.contains('read') || tickEl.classList.contains('delivered')) {
                tick = '✓✓';
            } else if (tickEl.classList.contains('sent')) {
                tick = '✓';
            } else {
                tick = (tickEl.textContent || '').trim();
            }
        }
        const { kind, src, rawSrc } = resolveLightboxTriggerSource(trigger);
        // Thumbnail: the already-loaded small img in the bubble (for instant preview in lightbox)
        const thumbImg = trigger.querySelector('.file-msg-img, .album-cell-img');
        const thumbnail = (thumbImg?.currentSrc || thumbImg?.getAttribute('src') || '').trim();
        return { kind, src, rawSrc, caption: trigger.getAttribute('data-caption') || '', sender, datetime, time, tick, thumbnail };
    });
}

export function syncLightboxVideoUi({ getEls, videoState, formatMediaDuration }) {
    const els = getEls();
    if (!els.video) return;
    const duration = Number.isFinite(els.video.duration) ? els.video.duration : 0;
    const current = Number.isFinite(els.video.currentTime) ? els.video.currentTime : 0;
    if (els.videoPlayToggle) {
        els.videoPlayToggle.innerHTML = `<i class="bi ${els.video.paused ? 'bi-play-fill' : 'bi-pause-fill'}"></i>`;
    }
    if (els.videoCenterPlay) {
        els.videoCenterPlay.classList.toggle('is-hidden', !els.video.paused);
    }
    if (els.videoProgress && !videoState.seeking) {
        const ratio = duration > 0 ? current / duration : 0;
        els.videoProgress.value = String(Math.max(0, Math.min(1000, Math.round(ratio * 1000))));
    }
    if (els.videoTime) {
        els.videoTime.textContent = `${formatMediaDuration(current)} / ${formatMediaDuration(duration)}`;
    }
    if (els.videoVolume) {
        const vol = els.video.muted ? 0 : Math.round((Number.isFinite(els.video.volume) ? els.video.volume : 1) * 100);
        els.videoVolume.value = String(Math.max(0, Math.min(100, vol)));
    }
}

export function toggleLightboxVideoPlay({ getEls }) {
    const els = getEls();
    if (!els.video) return;
    if (els.video.paused) {
        els.video.play().catch(() => {});
    } else {
        els.video.pause();
    }
}
