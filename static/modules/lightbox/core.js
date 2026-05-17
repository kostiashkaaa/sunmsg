import { escapeHtml, formatFullTimestamp, formatMediaDuration } from '../utils.js';
import { afterNextFrame, waitForMotionEnd } from '../motion.js';
import {
    buildLightboxMediaItems,
    syncLightboxVideoUi,
    toggleLightboxVideoPlay,
} from './media-renderers.js';
import { bindLightboxGestures } from './gestures.js';
import { bindLightboxAccessibility } from './accessibility.js';

const LIGHTBOX_MIN_ZOOM = 1;
const LIGHTBOX_MAX_ZOOM = 4;
const LIGHTBOX_UI_IDLE_MS = 2200;

const lightboxState = {
    zoom: 1,
    panX: 0,
    panY: 0,
    originX: 50,
    originY: 50,
    dragging: false,
    dragStartX: 0,
    dragStartY: 0,
    dragPanX: 0,
    dragPanY: 0,
    touchMode: '',
    touchStartX: 0,
    touchStartY: 0,
    pinchStartDistance: 0,
    pinchStartZoom: 1,
    pinchStartCenterX: 0,
    pinchStartCenterY: 0,
    pinchStartPanX: 0,
    pinchStartPanY: 0,
    zoomPanelHideTimer: 0,
    mediaKind: 'image',
};

const lightboxVideoState = {
    hideTimer: 0,
    controlsVisible: true,
    seeking: false,
};

const lightboxCaptionState = {
    hideTimer: 0,
};

let lightboxImages = [];
let lightboxIndex = 0;
let lightboxTransitionSeq = 0;

function _getLightboxEls() {
    return {
        root: document.getElementById('lightbox'),
        stageWrap: document.getElementById('lightboxStageWrap'),
        stage: document.getElementById('lightboxStage'),
        main: document.getElementById('lightboxMain'),
        imageWrap: document.getElementById('lightboxImageWrap'),
        img: document.getElementById('lightboxImg'),
        videoWrap: document.getElementById('lightboxVideoWrap'),
        video: document.getElementById('lightboxVideo'),
        videoControls: document.getElementById('lightboxVideoControls'),
        videoPlayToggle: document.getElementById('lightboxVideoPlayToggle'),
        videoCenterPlay: document.getElementById('lightboxVideoCenterPlay'),
        videoProgress: document.getElementById('lightboxVideoProgress'),
        videoTime: document.getElementById('lightboxVideoTime'),
        videoVolume: document.getElementById('lightboxVideoVolume'),
        videoFullscreen: document.getElementById('lightboxVideoFullscreen'),
        sender: document.getElementById('lightboxSender'),
        datetime: document.getElementById('lightboxDatetime'),
        caption: document.getElementById('lightboxCaption'),
        counter: document.getElementById('lightboxCounter'),
        prev: document.getElementById('lightboxPrev'),
        next: document.getElementById('lightboxNext'),
        close: document.getElementById('lightboxClose'),
        zoomToggle: document.getElementById('lightboxZoomToggle'),
        zoomPanel: document.getElementById('lightboxZoomPanel'),
        zoomOut: document.getElementById('lightboxZoomOut'),
        zoomIn: document.getElementById('lightboxZoomIn'),
        zoomRange: document.getElementById('lightboxZoomRange'),
        zoomValue: document.getElementById('lightboxZoomValue'),
    };
}

function _isLightboxOpen() {
    return !!document.getElementById('lightbox')?.classList.contains('active');
}

function _isImageLightboxActive() {
    return lightboxState.mediaKind !== 'video';
}

function _clearLightboxZoomHideTimer() {
    if (!lightboxState.zoomPanelHideTimer) return;
    clearTimeout(lightboxState.zoomPanelHideTimer);
    lightboxState.zoomPanelHideTimer = 0;
}

function _hideLightboxZoomPanel(immediate = false) {
    const els = _getLightboxEls();
    if (!els.zoomPanel) return;
    _clearLightboxZoomHideTimer();
    if (immediate) {
        els.zoomPanel.classList.remove('is-visible');
        return;
    }
    lightboxState.zoomPanelHideTimer = setTimeout(() => {
        els.zoomPanel.classList.remove('is-visible');
        lightboxState.zoomPanelHideTimer = 0;
    }, 1300);
}

function _showLightboxZoomPanel() {
    const els = _getLightboxEls();
    if (!els.zoomPanel) return;
    _clearLightboxZoomHideTimer();
    els.zoomPanel.classList.add('is-visible');
    _hideLightboxZoomPanel(false);
}

function _clearVideoControlsHideTimer() {
    if (!lightboxVideoState.hideTimer) return;
    clearTimeout(lightboxVideoState.hideTimer);
    lightboxVideoState.hideTimer = 0;
}

function _clearLightboxCaptionHideTimer() {
    if (!lightboxCaptionState.hideTimer) return;
    clearTimeout(lightboxCaptionState.hideTimer);
    lightboxCaptionState.hideTimer = 0;
}

function _setLightboxCaptionVisible(visible) {
    const els = _getLightboxEls();
    if (!els.caption) return;
    const hasText = !!(els.caption.textContent || '').trim();
    const canShow = visible && hasText && _isLightboxOpen();
    els.caption.classList.toggle('is-visible', canShow);
}

function _scheduleLightboxCaptionHide() {
    _clearLightboxCaptionHideTimer();
    if (!_isLightboxOpen()) return;
    if (!_isImageLightboxActive() && lightboxVideoState.seeking) return;
    const els = _getLightboxEls();
    if (!els.caption || !(els.caption.textContent || '').trim()) return;
    lightboxCaptionState.hideTimer = setTimeout(() => {
        _setLightboxCaptionVisible(false);
        lightboxCaptionState.hideTimer = 0;
    }, LIGHTBOX_UI_IDLE_MS);
}

function _setVideoControlsVisible(visible) {
    const els = _getLightboxEls();
    if (!els.videoWrap) return;
    lightboxVideoState.controlsVisible = visible;
    els.videoWrap.classList.toggle('is-idle', !visible);
}

function _scheduleVideoControlsHide() {
    const els = _getLightboxEls();
    if (!els.video || !els.videoWrap) return;
    _clearVideoControlsHideTimer();
    if (!_isLightboxOpen() || lightboxVideoState.seeking) {
        _setVideoControlsVisible(true);
        return;
    }
    lightboxVideoState.hideTimer = setTimeout(() => {
        _setVideoControlsVisible(false);
        lightboxVideoState.hideTimer = 0;
    }, LIGHTBOX_UI_IDLE_MS);
}

function _showLightboxOverlay() {
    if (!_isLightboxOpen()) return;
    _setLightboxCaptionVisible(true);
    _scheduleLightboxCaptionHide();
    if (!_isImageLightboxActive()) {
        _setVideoControlsVisible(true);
        _scheduleVideoControlsHide();
    }
}

function _syncLightboxVideoUi() {
    syncLightboxVideoUi({
        getEls: _getLightboxEls,
        videoState: lightboxVideoState,
        formatMediaDuration,
    });
}

function _toggleLightboxVideoPlay() {
    toggleLightboxVideoPlay({ getEls: _getLightboxEls });
}

function _buildLightboxMediaItems() {
    return buildLightboxMediaItems({ formatFullTimestamp });
}

function _clampLightboxPan() {
    if (!_isImageLightboxActive()) return;
    const els = _getLightboxEls();
    if (!els.root || !els.imageWrap) return;
    const viewportRect = els.root.getBoundingClientRect();
    const wrapRect = els.imageWrap.getBoundingClientRect();
    if (!viewportRect.width || !viewportRect.height || !wrapRect.width || !wrapRect.height) return;

    let dx = 0;
    let dy = 0;
    if (wrapRect.width <= viewportRect.width) {
        dx = (viewportRect.left + viewportRect.width / 2) - (wrapRect.left + wrapRect.width / 2);
    } else if (wrapRect.left > viewportRect.left) {
        dx = viewportRect.left - wrapRect.left;
    } else if (wrapRect.right < viewportRect.right) {
        dx = viewportRect.right - wrapRect.right;
    }

    if (wrapRect.height <= viewportRect.height) {
        dy = (viewportRect.top + viewportRect.height / 2) - (wrapRect.top + wrapRect.height / 2);
    } else if (wrapRect.top > viewportRect.top) {
        dy = viewportRect.top - wrapRect.top;
    } else if (wrapRect.bottom < viewportRect.bottom) {
        dy = viewportRect.bottom - wrapRect.bottom;
    }

    lightboxState.panX += dx;
    lightboxState.panY += dy;
}

function _syncLightboxZoomUi() {
    const els = _getLightboxEls();
    if (!els.zoomRange || !els.zoomValue || !els.zoomToggle) return;
    if (!_isImageLightboxActive()) return;
    els.zoomRange.value = String(lightboxState.zoom);
    els.zoomValue.textContent = `${Math.round(lightboxState.zoom * 100)}%`;
    const iconClass = lightboxState.zoom > 1.02 ? 'bi bi-arrows-angle-contract' : 'bi bi-search';
    els.zoomToggle.innerHTML = `<i class="${iconClass}"></i>`;
}

function _updateLightboxBottomInset() {
    const els = _getLightboxEls();
    if (!els.root) return;

    let avoidBottom = window.matchMedia('(max-width: 768px)').matches ? 20 : 14;
    const chatInputArea = document.getElementById('chatInputArea');
    if (chatInputArea) {
        const cs = window.getComputedStyle(chatInputArea);
        const isVisible = cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
        if (isVisible) {
            const rect = chatInputArea.getBoundingClientRect();
            if (rect.height > 0 && rect.top < window.innerHeight) {
                const occupied = Math.max(0, window.innerHeight - rect.top);
                avoidBottom = Math.max(avoidBottom, Math.ceil(occupied) + 10);
            }
        }
    }

    const counterH = Math.max(16, Math.ceil(els.counter?.offsetHeight || 16));
    const bottomReserve = Math.max(86, avoidBottom + counterH + 28);

    els.root.style.setProperty('--lb-avoid-bottom', `${avoidBottom}px`);
    els.root.style.setProperty('--lb-bottom-reserve', `${bottomReserve}px`);
}

function _applyLightboxTransform(skipClamp = false) {
    if (!_isImageLightboxActive()) return;
    const els = _getLightboxEls();
    if (!els.imageWrap || !els.img) return;
    els.imageWrap.style.transformOrigin = '50% 50%';
    els.imageWrap.style.transform = `translate3d(${lightboxState.panX}px, ${lightboxState.panY}px, 0) scale(${lightboxState.zoom})`;
    if (!skipClamp && lightboxState.zoom > 1.001) {
        _clampLightboxPan();
        els.imageWrap.style.transform = `translate3d(${lightboxState.panX}px, ${lightboxState.panY}px, 0) scale(${lightboxState.zoom})`;
    }
    if (lightboxState.zoom > 1.02) {
        els.img.style.cursor = lightboxState.dragging ? 'grabbing' : 'grab';
    } else {
        els.img.style.cursor = 'zoom-in';
    }
    _syncLightboxZoomUi();
}

function _setLightboxZoom(nextZoom, keepPan = false, interaction = '', focalPoint = null) {
    if (!_isImageLightboxActive()) return;
    const els = _getLightboxEls();
    const clamped = Math.max(LIGHTBOX_MIN_ZOOM, Math.min(LIGHTBOX_MAX_ZOOM, nextZoom));
    const prevZoom = lightboxState.zoom;

    lightboxState.originX = 50;
    lightboxState.originY = 50;

    if (clamped <= 1.001) {
        lightboxState.zoom = clamped;
        lightboxState.panX = 0;
        lightboxState.panY = 0;
        _applyLightboxTransform();
        if (interaction) _showLightboxZoomPanel();
        return;
    }

    const useFocal = !!(focalPoint && Number.isFinite(focalPoint.x) && Number.isFinite(focalPoint.y) && els.imageWrap);
    if (useFocal) {
        const rect = els.imageWrap.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const dX = focalPoint.x - centerX;
        const dY = focalPoint.y - centerY;
        const ratio = clamped / Math.max(prevZoom, 0.0001);
        lightboxState.panX = lightboxState.panX + dX * (1 - ratio);
        lightboxState.panY = lightboxState.panY + dY * (1 - ratio);
    } else if (!keepPan) {
        lightboxState.panX = 0;
        lightboxState.panY = 0;
    }

    lightboxState.zoom = clamped;
    _applyLightboxTransform();
    if (interaction) _showLightboxZoomPanel();
}

function _resetLightboxView() {
    lightboxState.dragging = false;
    lightboxState.touchMode = '';
    lightboxState.originX = 50;
    lightboxState.originY = 50;
    if (_isImageLightboxActive()) {
        _setLightboxZoom(1, false);
        _hideLightboxZoomPanel(true);
    }
    _updateLightboxBottomInset();
}

function _goPrevLightbox() {
    if (lightboxIndex <= 0) return;
    lightboxIndex -= 1;
    _renderLightbox();
}

function _goNextLightbox() {
    if (lightboxIndex >= lightboxImages.length - 1) return;
    lightboxIndex += 1;
    _renderLightbox();
}

function _closeLightbox() {
    const els = _getLightboxEls();
    if (!els.root) return;
    const closeSeq = ++lightboxTransitionSeq;
    if (els.video) {
        els.video.pause();
    }
    _clearVideoControlsHideTimer();
    _clearLightboxCaptionHideTimer();
    lightboxVideoState.seeking = false;
    _setLightboxCaptionVisible(false);
    _hideLightboxZoomPanel(true);
    els.root.classList.add('is-closing');
    els.root.classList.remove('active');
    els.root.setAttribute('aria-hidden', 'true');

    waitForMotionEnd(els.root, 260).then(() => {
        if (closeSeq !== lightboxTransitionSeq) return;
        if (els.video) {
            els.video.removeAttribute('src');
            els.video.load();
        }
        els.root.classList.remove('is-closing');
        els.root.removeAttribute('data-media-kind');
        _resetLightboxView();
        const prevOverflow = document.body.getAttribute('data-lightbox-prev-overflow');
        document.body.style.overflow = prevOverflow || '';
        document.body.removeAttribute('data-lightbox-prev-overflow');
    });
}

const _preloadCache = new Map();

function _preloadLightboxNeighbors() {
    const indices = [lightboxIndex - 1, lightboxIndex + 1];
    indices.forEach((i) => {
        const item = lightboxImages[i];
        if (!item || item.kind === 'video') return;
        const url = item.src;
        if (!url || _preloadCache.has(url)) return;
        const img = new window.Image();
        img.src = url;
        _preloadCache.set(url, img);
        if (_preloadCache.size > 12) {
            const firstKey = _preloadCache.keys().next().value;
            _preloadCache.delete(firstKey);
        }
    });
}

function _renderLightbox() {
    const cur = lightboxImages[lightboxIndex];
    const els = _getLightboxEls();
    if (!cur || !els.img) return;
    const isVideo = cur.kind === 'video';
    lightboxState.mediaKind = isVideo ? 'video' : 'image';
    if (els.root) {
        els.root.setAttribute('data-media-kind', isVideo ? 'video' : 'image');
    }

    if (els.imageWrap) els.imageWrap.style.display = isVideo ? 'none' : '';
    if (els.videoWrap) els.videoWrap.style.display = isVideo ? 'flex' : 'none';
    if (els.zoomToggle) els.zoomToggle.style.display = isVideo ? 'none' : '';
    if (els.zoomPanel) els.zoomPanel.classList.remove('is-visible');

    if (!isVideo) {
        if (els.video) els.video.pause();
        _clearVideoControlsHideTimer();
        // Show thumbnail instantly, then swap in full-res once loaded
        const targetSeq = ++lightboxTransitionSeq;
        if (cur.thumbnail && cur.thumbnail !== cur.src && !cur.thumbnail.startsWith('data:')) {
            els.img.src = cur.thumbnail;
            els.imageWrap?.classList.add('is-loading-full');
            const fullImg = new window.Image();
            fullImg.onload = () => {
                if (lightboxTransitionSeq !== targetSeq) return;
                els.img.src = cur.src;
                els.imageWrap?.classList.remove('is-loading-full');
            };
            fullImg.onerror = () => {
                if (lightboxTransitionSeq !== targetSeq) return;
                els.imageWrap?.classList.remove('is-loading-full');
            };
            fullImg.src = cur.src;
        } else {
            els.img.src = cur.src;
        }
        _preloadLightboxNeighbors();
    } else if (els.video) {
        els.video.pause();
        els.video.src = cur.src;
        els.video.currentTime = 0;
        _setVideoControlsVisible(true);
        _syncLightboxVideoUi();
        _scheduleVideoControlsHide();
    }
    if (els.sender) els.sender.textContent = cur.sender || '';
    if (els.datetime) els.datetime.textContent = cur.datetime || '';
    if (els.caption) {
        const captionText = (cur.caption || '').trim();
        if (!captionText) {
            els.caption.innerHTML = '';
        } else {
            const metaParts = [];
            if (cur.tick) metaParts.push(`<span class="lightbox-caption-tick">${escapeHtml(cur.tick)}</span>`);
            if (cur.time) metaParts.push(`<span class="lightbox-caption-time">${escapeHtml(cur.time)}</span>`);
            const metaHtml = metaParts.length
                ? `<div class="lightbox-caption-meta">${metaParts.join('')}</div>`
                : '';
            els.caption.innerHTML = `
                <span class="lightbox-caption-text">${escapeHtml(captionText)}</span>
                ${metaHtml}
            `;
        }
        _setLightboxCaptionVisible(false);
    }
    if (els.counter) {
        const mediaLabel = isVideo ? 'Видео' : 'Фото';
        els.counter.textContent = lightboxImages.length > 1
            ? `${mediaLabel} ${lightboxIndex + 1} / ${lightboxImages.length}`
            : mediaLabel;
    }
    if (els.prev) els.prev.disabled = lightboxIndex === 0;
    if (els.next) els.next.disabled = lightboxIndex === lightboxImages.length - 1;
    _resetLightboxView();
    if (isVideo) _syncLightboxVideoUi();
    requestAnimationFrame(_updateLightboxBottomInset);
    if (_isLightboxOpen()) _showLightboxOverlay();
}

export function initLightbox() {
    const els = _getLightboxEls();

    els.prev?.addEventListener('click', (e) => { e.stopPropagation(); _goPrevLightbox(); });
    els.next?.addEventListener('click', (e) => { e.stopPropagation(); _goNextLightbox(); });
    els.close?.addEventListener('click', (e) => { e.stopPropagation(); _closeLightbox(); });

    els.root?.addEventListener('click', (e) => {
        if (e.target === els.root || e.target === els.stageWrap) _closeLightbox();
    });

    els.img?.addEventListener('load', () => {
        if (!_isImageLightboxActive()) return;
        _resetLightboxView();
        requestAnimationFrame(_updateLightboxBottomInset);
    });

    els.video?.addEventListener('click', (e) => {
        if (!_isLightboxOpen() || _isImageLightboxActive()) return;
        if (e.target.closest('.lightbox-video-controls')) return;
        _toggleLightboxVideoPlay();
    });

    els.video?.addEventListener('loadedmetadata', () => {
        if (!_isLightboxOpen() || _isImageLightboxActive()) return;
        _syncLightboxVideoUi();
    });
    els.video?.addEventListener('play', () => {
        _syncLightboxVideoUi();
        _showLightboxOverlay();
    });
    els.video?.addEventListener('pause', () => {
        _syncLightboxVideoUi();
        _showLightboxOverlay();
    });
    els.video?.addEventListener('timeupdate', () => {
        _syncLightboxVideoUi();
    });
    els.video?.addEventListener('ended', () => {
        _syncLightboxVideoUi();
        _showLightboxOverlay();
    });

    els.videoPlayToggle?.addEventListener('click', (e) => {
        e.stopPropagation();
        _toggleLightboxVideoPlay();
    });
    els.videoCenterPlay?.addEventListener('click', (e) => {
        e.stopPropagation();
        _toggleLightboxVideoPlay();
    });

    els.videoProgress?.addEventListener('mousedown', () => {
        lightboxVideoState.seeking = true;
        _clearVideoControlsHideTimer();
        _clearLightboxCaptionHideTimer();
        _showLightboxOverlay();
    });
    els.videoProgress?.addEventListener('touchstart', () => {
        lightboxVideoState.seeking = true;
        _clearVideoControlsHideTimer();
        _clearLightboxCaptionHideTimer();
        _showLightboxOverlay();
    }, { passive: true });
    els.videoProgress?.addEventListener('input', (e) => {
        if (!els.video) return;
        const duration = Number.isFinite(els.video.duration) ? els.video.duration : 0;
        if (duration <= 0) return;
        els.video.currentTime = Math.max(0, Math.min(1, Number(e.target.value) / 1000)) * duration;
        _syncLightboxVideoUi();
    });
    els.videoProgress?.addEventListener('touchend', () => {
        lightboxVideoState.seeking = false;
        _showLightboxOverlay();
    }, { passive: true });

    els.videoVolume?.addEventListener('input', (e) => {
        if (!els.video) return;
        const volume = Math.max(0, Math.min(1, Number(e.target.value) / 100));
        els.video.volume = volume;
        els.video.muted = volume <= 0.001;
    });

    els.videoFullscreen?.addEventListener('click', (e) => {
        e.stopPropagation();
        const target = els.videoWrap || els.video;
        if (!target) return;
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
            return;
        }
        target.requestFullscreen?.().catch(() => {});
    });

    document.addEventListener('mouseup', () => {
        if (!lightboxVideoState.seeking) return;
        lightboxVideoState.seeking = false;
        _showLightboxOverlay();
    });

    bindLightboxGestures({
        els,
        state: lightboxState,
        isOpen: _isLightboxOpen,
        isImageActive: _isImageLightboxActive,
        setZoom: _setLightboxZoom,
        applyTransform: _applyLightboxTransform,
        goNext: _goNextLightbox,
        goPrev: _goPrevLightbox,
        showZoomPanel: _showLightboxZoomPanel,
        hideZoomPanel: _hideLightboxZoomPanel,
        clearZoomHideTimer: _clearLightboxZoomHideTimer,
        showOverlay: _showLightboxOverlay,
    });

    bindLightboxAccessibility({
        els,
        isOpen: _isLightboxOpen,
        isImageActive: _isImageLightboxActive,
        showOverlay: _showLightboxOverlay,
        close: _closeLightbox,
        goPrev: _goPrevLightbox,
        goNext: _goNextLightbox,
        toggleVideoPlay: _toggleLightboxVideoPlay,
        setZoom: _setLightboxZoom,
        getZoom: () => lightboxState.zoom,
        updateBottomInset: _updateLightboxBottomInset,
        applyTransform: _applyLightboxTransform,
    });

    window._openLightbox = function (target) {
        if (!els.root) return;
        const openSeq = ++lightboxTransitionSeq;
        els.root.classList.remove('is-closing', 'active');
        els.root.setAttribute('aria-hidden', 'false');
        lightboxImages = _buildLightboxMediaItems();
        if (target instanceof HTMLElement) {
            const src = target.getAttribute('data-media-src')
                || target.querySelector('.file-msg-img, .file-msg-video-preview')?.getAttribute('src')
                || '';
            lightboxIndex = lightboxImages.findIndex(
                (item) => item.src === src && item.kind === (target.getAttribute('data-media-kind') || 'image'),
            );
        } else {
            lightboxIndex = lightboxImages.findIndex((item) => item.src === String(target || ''));
        }
        if (lightboxIndex === -1) lightboxIndex = 0;
        _renderLightbox();
        if (!document.body.hasAttribute('data-lightbox-prev-overflow')) {
            document.body.setAttribute('data-lightbox-prev-overflow', document.body.style.overflow || '');
        }
        document.body.style.overflow = 'hidden';
        afterNextFrame(() => {
            if (openSeq !== lightboxTransitionSeq) return;
            els.root.classList.add('active');
            _showLightboxOverlay();
        });
    };
}