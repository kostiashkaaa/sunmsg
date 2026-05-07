export function getLightboxPartnerName() {
    return (window.currentPartnerData?.display_name || document.getElementById('chatTitle')?.textContent || 'Собеседник').trim();
}

export function buildLightboxMediaItems({ formatFullTimestamp }) {
    const partnerName = getLightboxPartnerName();
    return Array.from(document.querySelectorAll('#chatMessages .file-msg-media-trigger')).map((trigger) => {
        const messageEl = trigger.closest('.message');
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
        const kind = trigger.getAttribute('data-media-kind') === 'video' ? 'video' : 'image';
        const src = trigger.getAttribute('data-media-src')
            || trigger.querySelector('.file-msg-img, .file-msg-video-preview')?.getAttribute('src')
            || '';
        return { kind, src, caption: trigger.getAttribute('data-caption') || '', sender, datetime, time, tick };
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