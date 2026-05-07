// Message DOM construction — buildMessageElement, ticks, avatar, day separators
import {
    escapeHtml,
    sanitizeFileUri,
    formatTime,
    formatMediaDuration,
    formatFullTimestamp,
    renderMessagePreviewHtml,
    applyEmojiGraphics,
} from './utils.js';
import { renderMessageLinkPreview } from './message-link-preview.js';
import {
    STANDARD_SINGLE_CHECK_TICK_HTML,
    STANDARD_DOUBLE_CHECK_TICK_HTML,
} from './check-glyph.js';

const DEFAULT_AUDIO_WAVEFORM = [
    30, 46, 62, 42, 58, 76, 40, 28, 64, 84, 52, 34,
    66, 48, 72, 36, 54, 80, 44, 32, 60, 74, 50, 38,
    58, 78, 46, 30, 64, 86, 56, 40, 68, 52, 70, 36,
    62, 82, 48, 34, 60, 76, 42, 28, 56, 72, 46, 32,
];

function tr(value) {
    const api = window.SUN_I18N;
    if (api && typeof api.translateText === 'function') {
        return api.translateText(value);
    }
    return String(value ?? '');
}

function activeLocale() {
    const api = window.SUN_I18N;
    const language = api && typeof api.getLanguage === 'function'
        ? api.getLanguage()
        : (document.documentElement.lang === 'en' ? 'en' : 'ru');
    return language === 'en' ? 'en-US' : 'ru-RU';
}

function normalizeWaveform(rawWaveform) {
    let values = [];
    if (Array.isArray(rawWaveform)) {
        values = rawWaveform;
    } else if (typeof rawWaveform === 'string' && rawWaveform.includes(',')) {
        values = rawWaveform.split(',').map((part) => Number(part.trim()));
    }
    const cleaned = values
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value))
        .map((value) => Math.max(8, Math.min(100, Math.round(value))));
    if (cleaned.length >= 8) return cleaned;
    return DEFAULT_AUDIO_WAVEFORM.slice();
}

function hasProvidedWaveform(rawWaveform) {
    if (Array.isArray(rawWaveform)) {
        return rawWaveform.some((value) => Number.isFinite(Number(value)));
    }
    if (typeof rawWaveform === 'string') {
        return rawWaveform.includes(',') && rawWaveform.split(',').some((part) => Number.isFinite(Number(part.trim())));
    }
    return false;
}

function buildWaveBarsHtml(values) {
    return values
        .map((height, index) => `<span class="audio-wave-bar" style="--wave-h:${height}" data-wave-index="${index}"></span>`)
        .join('');
}

function clampUploadProgress(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.min(100, Math.round(numeric)));
}

function resolveMediaAspectRatio(filePayload, fallbackRatio = 4 / 3) {
    const rawWidth = Number(filePayload?.preview_width);
    const rawHeight = Number(filePayload?.preview_height);
    let ratio = Number(filePayload?.preview_aspect_ratio);

    if (Number.isFinite(rawWidth) && rawWidth > 0 && Number.isFinite(rawHeight) && rawHeight > 0) {
        ratio = rawWidth / rawHeight;
    }

    if (!Number.isFinite(ratio) || ratio <= 0) {
        ratio = fallbackRatio;
    }

    return Math.max(0.56, Math.min(1.91, ratio)).toFixed(4);
}

function buildMediaStatusOverlay(filePayload) {
    const isUploading = Boolean(filePayload?.uploading);
    const progress = clampUploadProgress(filePayload?.upload_progress);
    return `
        <div class="media-status-overlay${isUploading ? ' is-uploading' : ''}" data-upload-progress="${progress}" style="--upload-progress:${progress};" aria-hidden="true">
            <span class="media-status-ring"></span>
            <span class="media-status-value">${isUploading ? `${progress}%` : ''}</span>
        </div>`;
}

function buildInlineUploadProgress(filePayload, extraClass = '') {
    const isUploading = Boolean(filePayload?.uploading);
    const progress = clampUploadProgress(filePayload?.upload_progress);
    const classes = [
        'file-upload-inline',
        extraClass,
        isUploading ? 'is-uploading' : 'is-hidden',
    ].filter(Boolean).join(' ');

    return `
        <div class="${classes}" data-file-upload-inline="1" data-upload-progress="${progress}" style="--upload-progress:${progress};">
            <div class="file-upload-inline-row">
                <span class="file-upload-inline-label">${escapeHtml(tr('\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430'))}</span>
                <span class="file-upload-inline-percent">${progress}%</span>
            </div>
            <div class="file-upload-inline-track" aria-hidden="true">
                <span class="file-upload-inline-fill"></span>
            </div>
        </div>`;
}

function bindMessageInteractiveHandlers(messageDiv) {
    if (!messageDiv) return;
    if (messageDiv.dataset.interactiveHandlersBound === '1') return;
    messageDiv.dataset.interactiveHandlersBound = '1';

    const replyQuote = messageDiv.querySelector('.reply-quote[data-scroll-to-msg]');
    if (replyQuote) {
        replyQuote.addEventListener('click', () => {
            const rawId = Number(replyQuote.getAttribute('data-scroll-to-msg'));
            if (!Number.isFinite(rawId) || rawId <= 0) return;
            if (typeof window._scrollToMsg === 'function') {
                window._scrollToMsg(rawId);
            }
        });
    }

    messageDiv.querySelectorAll('.file-msg-media-trigger').forEach((trigger) => {
        trigger.addEventListener('click', () => {
            if (typeof window._openLightbox === 'function') {
                window._openLightbox(trigger);
            }
        });
    });

    messageDiv.querySelectorAll('.file-msg-img').forEach((imgEl) => {
        const onImageLoad = () => window._onMessageMediaLoaded?.(imgEl);
        const onImageError = () => window._onMessageMediaLoadError?.(imgEl);
        imgEl.addEventListener('load', onImageLoad);
        imgEl.addEventListener('error', onImageError);
        if (imgEl.complete) {
            if (Number(imgEl.naturalWidth) > 0) {
                onImageLoad();
            } else {
                onImageError();
            }
        }
    });

    messageDiv.querySelectorAll('.file-msg-video-preview').forEach((videoEl) => {
        const onVideoMetadata = () => {
            window._onVideoPreviewLoaded?.(videoEl);
            window._onMessageMediaLoaded?.(videoEl);
        };
        videoEl.addEventListener('loadedmetadata', onVideoMetadata);
        videoEl.addEventListener('play', () => window._preventInlineVideoPlay?.(videoEl));
        videoEl.addEventListener('error', () => window._onMessageMediaLoadError?.(videoEl));
        if (Number(videoEl.readyState) >= 1) {
            onVideoMetadata();
        }
    });

    messageDiv.querySelectorAll('.file-msg-audio-el').forEach((audioEl) => {
        const onAudioMetadata = () => window._onAudioPlayerMeta?.(audioEl);
        audioEl.addEventListener('loadedmetadata', onAudioMetadata);
        audioEl.addEventListener('timeupdate', () => window._onAudioPlayerTime?.(audioEl));
        audioEl.addEventListener('play', () => window._onAudioPlayerState?.(audioEl));
        audioEl.addEventListener('pause', () => window._onAudioPlayerState?.(audioEl));
        audioEl.addEventListener('ended', () => window._onAudioPlayerState?.(audioEl));
        if (Number(audioEl.readyState) >= 1) {
            onAudioMetadata();
        }
        window._initAudioPlayerState?.(audioEl);
    });

    messageDiv.querySelectorAll('.audio-player-toggle').forEach((toggleBtn) => {
        toggleBtn.addEventListener('click', () => window._toggleAudioPlayer?.(toggleBtn));
    });

    messageDiv.querySelectorAll('.audio-player-progress').forEach((rangeEl) => {
        const setSeekingState = (isSeeking) => {
            window._setAudioSeekState?.(rangeEl, Boolean(isSeeking));
        };
        let activePointerId = null;
        const seekByClientX = (clientX) => {
            window._seekAudioPlayerByClientX?.(rangeEl, Number(clientX));
        };
        const resetPointerSeek = () => {
            activePointerId = null;
            setSeekingState(false);
        };

        rangeEl.addEventListener('pointerdown', (event) => {
            if (!event.isPrimary) return;
            activePointerId = event.pointerId;
            setSeekingState(true);
            seekByClientX(event.clientX);
            try { rangeEl.setPointerCapture(event.pointerId); } catch (_) {}
            event.preventDefault();
        });
        rangeEl.addEventListener('pointermove', (event) => {
            if (activePointerId == null) return;
            if (event.pointerId !== activePointerId) return;
            seekByClientX(event.clientX);
            event.preventDefault();
        });
        rangeEl.addEventListener('pointerup', (event) => {
            if (activePointerId == null || event.pointerId !== activePointerId) return;
            seekByClientX(event.clientX);
            try { rangeEl.releasePointerCapture(event.pointerId); } catch (_) {}
            resetPointerSeek();
        });
        rangeEl.addEventListener('pointercancel', () => {
            resetPointerSeek();
        });
        rangeEl.addEventListener('lostpointercapture', () => {
            resetPointerSeek();
        });

        rangeEl.addEventListener('input', () => window._seekAudioPlayer?.(rangeEl));
        rangeEl.addEventListener('keydown', (event) => window._handleAudioSeekKeydown?.(rangeEl, event));
        rangeEl.addEventListener('mousedown', () => setSeekingState(true));
        rangeEl.addEventListener('mouseup', () => setSeekingState(false));
        rangeEl.addEventListener('touchstart', () => setSeekingState(true), { passive: true });
        rangeEl.addEventListener('touchend', () => setSeekingState(false));
        rangeEl.addEventListener('change', () => setSeekingState(false));
        rangeEl.addEventListener('blur', () => setSeekingState(false));
    });

    messageDiv.querySelectorAll('.audio-player-wave-wrap').forEach((waveWrap) => {
        waveWrap.addEventListener('click', (event) => {
            if (!(event instanceof MouseEvent)) return;
            const rangeEl = waveWrap.querySelector('.audio-player-progress');
            if (!rangeEl) return;
            window._seekAudioPlayerByClientX?.(rangeEl, Number(event.clientX));
        });
        waveWrap.addEventListener('touchstart', (event) => {
            const touch = event.touches?.[0];
            if (!touch) return;
            const rangeEl = waveWrap.querySelector('.audio-player-progress');
            if (!rangeEl) return;
            window._seekAudioPlayerByClientX?.(rangeEl, Number(touch.clientX));
        }, { passive: true });
    });
}

// ?? Tick / delivery status ????????????????????????????????????????????????????

export function getOutgoingStatus(message) {
    if (message?.failed)       return 'failed';
    if (message?.pending)      return 'pending';
    if (message?.is_read)      return 'read';
    if (message?.is_delivered) return 'delivered';
    return 'sent';
}

function getTickVisual(status) {
    if (status === 'failed')    return { className: 'failed',    title: '\u041d\u0435 \u0434\u043e\u0441\u0442\u0430\u0432\u043b\u0435\u043d\u043e', html: '<i class="bi bi-exclamation-circle-fill"></i>' };
    if (status === 'pending')   return { className: 'pending',   title: '\u041e\u0442\u043f\u0440\u0430\u0432\u043a\u0430...',   html: '<i class="bi bi-clock"></i>' };
    if (status === 'read')      return { className: 'read',      title: '\u041f\u0440\u043e\u0447\u0438\u0442\u0430\u043d\u043e',   html: STANDARD_DOUBLE_CHECK_TICK_HTML };
    if (status === 'delivered') return { className: 'delivered', title: '\u0414\u043e\u0441\u0442\u0430\u0432\u043b\u0435\u043d\u043e',  html: STANDARD_DOUBLE_CHECK_TICK_HTML };
    return                             { className: 'sent',      title: '\u041e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u043e',  html: STANDARD_SINGLE_CHECK_TICK_HTML };
}

export function buildTickHtml(message) {
    const visual = getTickVisual(getOutgoingStatus(message));
    const body = visual.html ?? escapeHtml(visual.text ?? '');
    const readAt = String(message?.read_at || '').trim();
    const readAtAttr = visual.className === 'read' && readAt
        ? ` data-read-at="${escapeHtml(readAt)}"`
        : '';
    return `<span class="msg-tick ${visual.className}" title="${visual.title}"${readAtAttr}>${body}</span>`;
}

export function applyTickToElement(tickEl, messageLike) {
    if (!tickEl) return;
    const visual = getTickVisual(getOutgoingStatus(messageLike));
    const wasRead = tickEl.classList.contains('read');
    tickEl.className = `msg-tick ${visual.className}`;
    if (!wasRead && visual.className === 'read') {
        tickEl.classList.add('msg-tick--read-enter');
    }
    tickEl.title = visual.title;
    const readAt = String(messageLike?.read_at || '').trim();
    if (visual.className === 'read' && readAt) {
        tickEl.setAttribute('data-read-at', readAt);
    } else {
        tickEl.removeAttribute('data-read-at');
    }
    if (visual.html) {
        tickEl.innerHTML = visual.html;
    } else {
        tickEl.textContent = visual.text ?? '';
    }
}

// ?? Avatar ????????????????????????????????????????????????????????????????????

export function buildMessageAvatarHtml(msg, { currentDisplayName, currentUsername, currentAvatarUrl } = {}) {
    const isSelf = msg.sender === 'self';
    const activeGroupMembers = Array.isArray(window.currentPartnerData?.members)
        ? window.currentPartnerData.members
        : [];
    const senderUserId = Number(msg.senderUserId || 0);
    const memberMatch = activeGroupMembers.find((member) => {
        const memberUserId = Number(member?.user_id || 0);
        if (senderUserId > 0 && memberUserId === senderUserId) return true;
        const memberPublicKey = String(member?.public_key || '').trim();
        const senderPublicKey = String(msg.senderPublicKey || '').trim();
        return Boolean(memberPublicKey && senderPublicKey && memberPublicKey === senderPublicKey);
    }) || null;
    const currentPartnerKey = String(window.currentPartnerData?.public_key || '').trim();
    const senderPublicKey = String(msg.senderPublicKey || '').trim();
    const isCurrentPartnerSender = Boolean(!isSelf && currentPartnerKey && senderPublicKey && senderPublicKey === currentPartnerKey);
    const displayName = isSelf
        ? (currentDisplayName || currentUsername || '\u0412\u044b')
        : (
            msg.senderDisplayName
            || msg.senderUsername
            || String(memberMatch?.display_name || memberMatch?.username || '').trim()
            || (isCurrentPartnerSender ? window.currentPartnerData?.display_name : '')
            || (isCurrentPartnerSender ? window.currentPartnerData?.username : '')
            || (senderPublicKey ? '\u0423\u0447\u0430\u0441\u0442\u043D\u0438\u043A' : '')
            || '\u0421\u043e\u0431\u0435\u0441\u0435\u0434\u043d\u0438\u043a'
        );
    const avatarUrl = isSelf
        ? (currentAvatarUrl || window.currentAvatarUrl || '')
        : (
            String(msg.senderAvatarUrl || '').trim()
            || String(memberMatch?.avatar_url || '').trim()
            || (isCurrentPartnerSender ? (window.currentPartnerData?.avatar_url || '') : '')
        );
    const initials = (displayName || '?')
        .trim().split(/\s+/).slice(0, 2).map(p => p[0] || '').join('').toUpperCase() || '?';

    if (avatarUrl) {
        return `<span class="message-avatar" aria-hidden="true"><img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName)}"></span>`;
    }
    return `<span class="message-avatar message-avatar--fallback" aria-hidden="true">${escapeHtml(initials)}</span>`;
}

// ?? Message grouping ??????????????????????????????????????????????????????????

const MESSAGE_GROUP_WINDOW_MS = 7 * 60 * 1000;

function parseUtcDateLocal(rawValue) {
    if (!rawValue) return null;
    const s = String(rawValue).replace(' ', 'T');
    const d = new Date(/Z$/i.test(s) ? s : s + 'Z');
    return Number.isFinite(d.getTime()) ? d : null;
}

export function getMessageDayKey(rawValue) {
    const date = parseUtcDateLocal(rawValue);
    if (!date) return '';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

export function isSameMessageGroup(leftMsg, rightMsg) {
    if (!leftMsg || !rightMsg) return false;
    const leftSenderKey = String(leftMsg.senderPublicKey || leftMsg.sender || '');
    const rightSenderKey = String(rightMsg.senderPublicKey || rightMsg.sender || '');
    if (leftSenderKey !== rightSenderKey) return false;
    if (getMessageDayKey(leftMsg.created_at) !== getMessageDayKey(rightMsg.created_at)) return false;
    const lt = parseUtcDateLocal(leftMsg.created_at);
    const rt = parseUtcDateLocal(rightMsg.created_at);
    if (lt && rt && Math.abs(rt.getTime() - lt.getTime()) > MESSAGE_GROUP_WINDOW_MS) return false;
    return true;
}

export function getMessageGroup(messages, index) {
    const list = Array.isArray(messages) ? messages : [];
    const current = list[index];
    if (!current) return { groupClass: 'group-single', showAvatar: true };

    const prev = index > 0 ? list[index - 1] : null;
    const next = index < list.length - 1 ? list[index + 1] : null;
    const samePrev = isSameMessageGroup(prev, current);
    const sameNext = isSameMessageGroup(current, next);

    if (samePrev && sameNext)  return { groupClass: 'group-middle', showAvatar: false };
    if (!samePrev && sameNext) return { groupClass: 'group-start',  showAvatar: false };
    if (samePrev && !sameNext) return { groupClass: 'group-end',    showAvatar: true  };
    return                            { groupClass: 'group-single', showAvatar: true  };
}

const GROUP_SENDER_COLORS = [
    '#6ea8ff',
    '#63c48d',
    '#f2a65a',
    '#d78bff',
    '#63c5da',
    '#f07e7e',
    '#9ac95f',
    '#84a8ff',
];

function resolveGroupSenderColor(msg) {
    const source = String(
        msg?.senderPublicKey
        || msg?.senderUserId
        || msg?.senderDisplayName
        || msg?.senderUsername
        || '',
    ).trim();
    if (!source) return GROUP_SENDER_COLORS[0];
    let hash = 0;
    for (let i = 0; i < source.length; i += 1) {
        hash = ((hash << 5) - hash + source.charCodeAt(i)) | 0;
    }
    return GROUP_SENDER_COLORS[Math.abs(hash) % GROUP_SENDER_COLORS.length];
}

// ?? Day separator ?????????????????????????????????????????????????????????????

export function formatDaySeparatorLabel(rawValue) {
    const date = parseUtcDateLocal(rawValue);
    if (!date) return '';
    const now = new Date();
    const isToday     = now.toDateString() === date.toDateString();
    const yesterday   = new Date(now); yesterday.setDate(now.getDate() - 1);
    const isYesterday = yesterday.toDateString() === date.toDateString();
    if (isToday) return tr('\u0421\u0435\u0433\u043E\u0434\u043D\u044F');
    if (isYesterday) return tr('\u0412\u0447\u0435\u0440\u0430');
    const includeYear = date.getFullYear() !== now.getFullYear();
    return date.toLocaleDateString(activeLocale(), {
        day: 'numeric',
        month: 'long',
        ...(includeYear ? { year: 'numeric' } : {}),
    });
}

export function createDaySeparatorNode(rawValue) {
    const label = formatDaySeparatorLabel(rawValue);
    const el = document.createElement('div');
    el.className = 'day-separator';
    el.setAttribute('data-day-key', getMessageDayKey(rawValue));
    el.setAttribute('data-day-value', rawValue || '');
    el.innerHTML = `<span class="day-separator__label">${escapeHtml(label)}</span>`;
    return el;
}

// ?? File bubble content ???????????????????????????????????????????????????????

function buildFileBubble(filePayload) {
    const safeUri = sanitizeFileUri(filePayload.data, { imageOnlyData: false });
    const rawIsImage = filePayload.mime?.startsWith('image/');
    const rawIsVideo = filePayload.mime?.startsWith('video/');
    const rawIsAudio = filePayload.mime?.startsWith('audio/');
    const attachMode = filePayload.attach_mode === 'file' ? 'file' : 'media';
    const isDocumentVisual = attachMode === 'file' && (rawIsImage || rawIsVideo);
    const isImage = rawIsImage && !isDocumentVisual;
    const isVideo = rawIsVideo && !isDocumentVisual;
    const isAudio = rawIsAudio;
    const caption = filePayload.caption || '';
    const captionHtml = caption ? `<div class="file-caption">${escapeHtml(caption)}</div>` : '';
    const inlineUploadHtml = buildInlineUploadProgress(filePayload);
    let bubbleClass = 'bubble';
    let content;

    if (isImage) {
        const imgSrc = sanitizeFileUri(filePayload.data, { imageOnlyData: true });
        const safeImg = escapeHtml(imgSrc);
        const aspectRatio = resolveMediaAspectRatio(filePayload, 1);
        bubbleClass += ' bubble--image';
        if (caption) bubbleClass += ' bubble--image-has-caption';
        content = `
            <div class="background-layer" style="background-image:url('${safeImg}');"></div>
            <div class="image-wrapper file-msg-media-trigger"
                 style="--media-aspect-ratio:${aspectRatio};"
                 data-media-kind="image"
                 data-caption="${escapeHtml(caption)}">
                ${buildMediaStatusOverlay(filePayload)}
                <img class="file-msg-img" src="${safeImg}"
                     loading="lazy" decoding="async" fetchpriority="low"
                     alt="${escapeHtml(filePayload.name || '')}">
            </div>
            ${captionHtml}`;
    } else if (isVideo) {
        const aspectRatio = resolveMediaAspectRatio(filePayload, 1);
        bubbleClass += ' bubble--video';
        if (caption) bubbleClass += ' bubble--video-has-caption';
        content = `
            <div class="video-preview file-msg-media-trigger"
                 style="--media-aspect-ratio:${aspectRatio};"
                 data-media-kind="video"
                 data-media-src="${escapeHtml(safeUri)}"
                 data-caption="${escapeHtml(caption)}">
                ${buildMediaStatusOverlay(filePayload)}
                <video class="file-msg-video-preview" data-src="${escapeHtml(safeUri)}"
                       preload="none" playsinline muted></video>
                <div class="video-preview-gradient" aria-hidden="true"></div>
                <div class="video-preview-hover"></div>
                <button class="video-preview-play" type="button" tabindex="-1" aria-hidden="true">
                    <i class="bi bi-play-fill"></i>
                </button>
                <span class="video-duration video-preview-duration">00:00</span>
            </div>
            ${captionHtml}`;
    } else if (isAudio) {
        const rawDuration = Number(filePayload.duration_seconds);
        const audioDurationSeconds = Number.isFinite(rawDuration) && rawDuration > 0
            ? Math.max(1, Math.floor(rawDuration))
            : 0;
        const waveformSource = hasProvidedWaveform(filePayload.waveform) ? 'provided' : 'fallback';
        const waveform = normalizeWaveform(filePayload.waveform);
        const waveBars = buildWaveBarsHtml(waveform);
        bubbleClass += ' bubble--audio';
        if (caption) bubbleClass += ' bubble--audio-has-caption';
        content = `
            <div class="file-msg-audio-wrap">
                <div class="file-msg-audio-player" data-waveform-source="${waveformSource}">
                    <audio class="file-msg-audio-el"
                           data-src="${escapeHtml(safeUri)}"
                           data-duration-seconds="${audioDurationSeconds > 0 ? String(audioDurationSeconds) : ''}"
                           preload="none"></audio>
                    <button class="audio-player-toggle" type="button" aria-label="\u0412\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u0435\u0441\u0442\u0438">
                        <i class="bi bi-play-fill"></i>
                    </button>
                    <div class="audio-player-info">
                        <div class="audio-player-track-row">
                            <div class="audio-player-wave-wrap">
                                <div class="audio-player-wave" aria-hidden="true">
                                    <div class="audio-wave-layer audio-wave-layer--base">
                                        ${waveBars}
                                    </div>
                                    <div class="audio-wave-layer audio-wave-layer--played">
                                        ${waveBars}
                                    </div>
                                </div>
                                <input
                                    type="range"
                                    class="audio-player-progress"
                                    min="0"
                                    max="100"
                                    value="0"
                                    step="0.1"
                                    aria-label="\u041F\u043E\u0437\u0438\u0446\u0438\u044F \u0430\u0443\u0434\u0438\u043E" />
                            </div>
                        </div>
                    </div>
                </div>
                ${captionHtml}
                ${buildInlineUploadProgress(filePayload, 'file-upload-inline--audio')}
            </div>`;
    } else {
        const fname = filePayload.name || '\u0424\u0430\u0439\u043b';
        const isUploadingFile = Boolean(filePayload.uploading);
        bubbleClass += ' bubble--file';
        const ext = fname.includes('.') ? fname.split('.').pop().toLowerCase() : '';
        const iconMap = {
            pdf:'bi-file-earmark-pdf', doc:'bi-file-earmark-word', docx:'bi-file-earmark-word',
            xls:'bi-file-earmark-excel', xlsx:'bi-file-earmark-excel',
            zip:'bi-file-earmark-zip', rar:'bi-file-earmark-zip', '7z':'bi-file-earmark-zip',
            mp3:'bi-file-earmark-music', ogg:'bi-file-earmark-music', wav:'bi-file-earmark-music',
            m4a:'bi-file-earmark-music', aac:'bi-file-earmark-music', opus:'bi-file-earmark-music',
            txt:'bi-file-earmark-text', csv:'bi-file-earmark-spreadsheet',
        };
        const icon = iconMap[ext] || 'bi-file-earmark-arrow-down';
        const size = filePayload.size
            ? (filePayload.size < 1048576 ? (filePayload.size / 1024).toFixed(1) + ' KB' : (filePayload.size / 1048576).toFixed(1) + ' MB')
            : ext.toUpperCase() || '\u0424\u0430\u0439\u043b';
        const imageThumbSrc = isDocumentVisual && rawIsImage
            ? sanitizeFileUri(filePayload.data, { imageOnlyData: true })
            : '';
        const useImageThumb = Boolean(imageThumbSrc);
        const useVideoThumb = isDocumentVisual && rawIsVideo;
        const iconWrapClass = `file-icon-wrap${(useImageThumb || useVideoThumb) ? ' file-icon-wrap--media-thumb' : ''}`;
        const iconWrapContent = useImageThumb
            ? `<img class="file-card-thumb-image" src="${escapeHtml(imageThumbSrc)}" loading="lazy" decoding="async" alt="">`
            : useVideoThumb
                ? `<video class="file-card-thumb-video" src="${escapeHtml(safeUri)}" preload="metadata" muted playsinline aria-hidden="true"></video><span class="file-card-thumb-video-badge" aria-hidden="true"><i class="bi bi-play-fill"></i></span>`
                : `<i class="bi ${icon}"></i>`;
        content = `
            <div class="file-msg-card-wrap">
                <a class="file-msg-link${isUploadingFile ? ' is-uploading' : ''}" href="${escapeHtml(safeUri)}" download="${escapeHtml(fname)}" aria-disabled="${isUploadingFile ? 'true' : 'false'}">
                    <div class="${iconWrapClass}">${iconWrapContent}</div>
                    <div class="file-info">
                        <span class="file-info-name">${escapeHtml(fname)}</span>
                        <span class="file-info-size">${escapeHtml(size)}</span>
                    </div>
                </a>
                ${inlineUploadHtml}
            </div>
            ${captionHtml}`;
    }
    return {
        bubbleClass,
        content,
        isMedia: isImage || isVideo,
        hasCaption: Boolean(caption),
    };
}

// ?? Main element builder ??????????????????????????????????????????????????????

export function buildMessageElement(msg, layout = {}, context = {}) {
    const {
        isSelectionMode = false,
        getMessageKey,
        isPinnedMessage,
        isFavoriteMessage,
        buildMessageReactionsHtml,
        renderMessageTextContent,
        currentDisplayName,
        currentUsername,
        currentAvatarUrl,
        isGroupChat = false,
        useMobileReactionInside = false,
    } = context;

    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', msg.sender);
    messageDiv.classList.add(layout.groupClass || 'group-single');
    if (layout.showAvatar) messageDiv.classList.add('show-avatar');
    if (msg.encrypted)    messageDiv.classList.add('encrypted');
    if (msg.id)           messageDiv.setAttribute('data-msg-id', msg.id);
    if (msg.pending)      messageDiv.setAttribute('data-pending', 'true');
    if (msg.clientId)     messageDiv.setAttribute('data-client-id', msg.clientId);
    if (getMessageKey)    messageDiv.setAttribute('data-message-key', getMessageKey(msg));
    if (typeof msg.message === 'string') messageDiv.setAttribute('data-message-content', msg.message);

    const isSelf = msg.sender === 'self';
    const showSenderLabel = Boolean(
        isGroupChat
        && !isSelf
        && (layout.groupClass === 'group-start' || layout.groupClass === 'group-single')
    );
    const activeGroupMembers = Array.isArray(window.currentPartnerData?.members)
        ? window.currentPartnerData.members
        : [];
    const senderUserId = Number(msg.senderUserId || 0);
    const memberMatch = activeGroupMembers.find((member) => {
        const memberUserId = Number(member?.user_id || 0);
        if (senderUserId > 0 && memberUserId === senderUserId) return true;
        const memberPublicKey = String(member?.public_key || '').trim();
        const senderPublicKey = String(msg.senderPublicKey || '').trim();
        return Boolean(memberPublicKey && senderPublicKey && memberPublicKey === senderPublicKey);
    }) || null;
    const senderLabel = escapeHtml(String(
        msg.senderDisplayName
        || msg.senderUsername
        || memberMatch?.display_name
        || memberMatch?.username
        || '\u0423\u0447\u0430\u0441\u0442\u043D\u0438\u043A'
    ));
    const senderColor = showSenderLabel ? resolveGroupSenderColor(msg) : '';
    const senderLabelHtml = showSenderLabel
        ? `<div class="message-sender-label" style="--message-sender-color:${senderColor};">${senderLabel}</div>`
        : '';
    const isPinned = typeof isPinnedMessage === 'function' ? isPinnedMessage(msg) : Boolean(msg.is_pinned);
    const isFavorite = typeof isFavoriteMessage === 'function' ? isFavoriteMessage(msg) : Boolean(msg.is_favorite);
    const avatarHtml = buildMessageAvatarHtml(msg, { currentDisplayName, currentUsername, currentAvatarUrl });
    const ticks = isSelf ? buildTickHtml(msg) : '';

    // Reply quote
    let replyHtml = '';
    if (msg.replyToId) {
        const qName = escapeHtml(msg.replyToSender || '\u0421\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435');
        const qText = renderMessagePreviewHtml(msg.replyToText || '', { maxLen: 120, emptyText: '\u2026' });
        const safeReplyToId = Number(msg.replyToId);
        const replyToAttr = Number.isFinite(safeReplyToId) && safeReplyToId > 0
            ? ` data-scroll-to-msg="${safeReplyToId}"`
            : '';
        replyHtml = `<div class="reply-quote"${replyToAttr}>
            <span class="reply-quote-name">${qName}</span>
            <span class="reply-quote-text">${qText}</span>
        </div>`;
    }

    // Forward source label
    const forwardFromName = String(msg.forwardFromName || msg.forward_from_name || '').trim();
    const forwardHtml = forwardFromName
        ? `<div class="forward-quote">
            <span class="forward-quote-label">\u041F\u0435\u0440\u0435\u0441\u043B\u0430\u043D\u043E \u043E\u0442</span>
            <span class="forward-quote-name">${escapeHtml(forwardFromName)}</span>
        </div>`
        : '';

    // File or text bubble
    let filePayload = null;
    try {
        const parsed = typeof msg.message === 'string' ? JSON.parse(msg.message) : null;
        if (parsed?.__sunfile) filePayload = parsed;
    } catch (_) {}

    let bubbleClass = 'bubble';
    let bubbleContent;
    let isAudioPayload = false;
    let audioDurationSeconds = 0;
    let audioListenedByPartner = false;
    let placeReactionsOutsideBubble = false;
    if (filePayload) {
        const result = buildFileBubble(filePayload);
        bubbleClass  = result.bubbleClass;
        bubbleContent = result.content;
        isAudioPayload = Boolean(filePayload.mime?.startsWith('audio/'));
        placeReactionsOutsideBubble = Boolean(result.isMedia);
        if (isAudioPayload) {
            const rawDuration = Number(filePayload.duration_seconds);
            audioDurationSeconds = Number.isFinite(rawDuration) && rawDuration > 0
                ? Math.max(1, Math.floor(rawDuration))
                : 0;
            if (isSelf) {
                audioListenedByPartner = Boolean(msg.voice_listened_by_partner);
            }
        }
    } else {
        bubbleClass += ' bubble--text';
        bubbleContent = '<div class="message-text"></div>';
    }
    if (useMobileReactionInside) {
        placeReactionsOutsideBubble = false;
    }

    const pinnedLabel = isPinned ? '<span class="msg-pin" title="\u0417\u0430\u043A\u0440\u0435\u043F\u043B\u0435\u043D\u043E"><i class="bi bi-pin-angle-fill"></i></span>' : '';
    const favoriteLabel = isFavorite ? '<span class="msg-favorite" title="\u0412 \u0438\u0437\u0431\u0440\u0430\u043D\u043D\u043E\u043C"><i class="bi bi-star-fill"></i></span>' : '';
    const editedLabel = msg.is_edited ? '<span class="msg-edited">(\u0438\u0437\u043C\u0435\u043D\u0435\u043D\u043E)</span>' : '';
    const audioDurationHtml = isAudioPayload
        ? `<span class="audio-message-duration-wrap" data-audio-listened-wrap="1"><span class="audio-message-duration" data-audio-duration="${audioDurationSeconds > 0 ? String(audioDurationSeconds) : ''}">${formatMediaDuration(audioDurationSeconds)}</span><span class="audio-message-listen-dot" aria-hidden="true"></span></span>`
        : '';
    const reactionsHtml = typeof buildMessageReactionsHtml === 'function'
        ? buildMessageReactionsHtml(msg.id, msg.reactions)
        : '';
    const reactionsInsideHtml = placeReactionsOutsideBubble ? '' : reactionsHtml;
    const reactionsOutsideHtml = placeReactionsOutsideBubble ? reactionsHtml : '';
    const metaHtml = `<div class="msg-meta message-meta">
                    ${audioDurationHtml}
                    ${favoriteLabel}
                    ${pinnedLabel}
                    ${editedLabel}
                    <span class="msg-time" title="${formatFullTimestamp(msg.created_at)}" data-created-at="${msg.created_at || ''}">${formatTime(msg.created_at)}</span>
                    ${ticks}
                </div>`;
    const shouldUseAudioFooter = isAudioPayload && !placeReactionsOutsideBubble && Boolean(reactionsInsideHtml);
    const shouldUseInlineFooter = !isAudioPayload && !placeReactionsOutsideBubble && Boolean(reactionsInsideHtml);
    const bubbleInnerHtml = isAudioPayload
        ? `
                ${senderLabelHtml}
                ${forwardHtml}
                ${replyHtml}
                <div class="audio-message-body">
                    ${bubbleContent}
                    ${shouldUseAudioFooter ? '' : metaHtml}
                </div>
                ${shouldUseAudioFooter
                    ? `<div class="message-footer has-reactions">
                    ${reactionsInsideHtml}
                    ${metaHtml}
                </div>`
                    : reactionsInsideHtml}
            `
        : shouldUseInlineFooter
            ? `
                ${senderLabelHtml}
                ${forwardHtml}
                ${replyHtml}
                ${bubbleContent}
                <div class="message-footer${reactionsInsideHtml ? ' has-reactions' : ''}">
                    ${reactionsInsideHtml}
                    ${metaHtml}
                </div>
            `
        : `
                ${senderLabelHtml}
                ${forwardHtml}
                ${replyHtml}
                ${bubbleContent}
                ${metaHtml}
                ${reactionsInsideHtml}
            `;

    messageDiv.classList.toggle('message-reactions-outside', placeReactionsOutsideBubble);
    messageDiv.classList.toggle('message-pinned', isPinned);
    messageDiv.classList.toggle('message-favorite', isFavorite);
    messageDiv.classList.toggle('message-group-other', showSenderLabel);
    if (isAudioPayload && isSelf) {
        messageDiv.setAttribute('data-audio-listened-by-partner', audioListenedByPartner ? '1' : '0');
    }

    messageDiv.innerHTML = `
        <div class="message-row-track">
            <div class="message-avatar-slot">${avatarHtml}</div>
            <div class="message-stack">
                <div class="${bubbleClass}">
                    ${bubbleInnerHtml}
                </div>
                ${reactionsOutsideHtml}
            </div>
        </div>`;

    if (!filePayload) {
        const textEl = messageDiv.querySelector('.message-text');
        const messageText = String(msg.message ?? '');
        if (textEl) {
            if (typeof renderMessageTextContent === 'function') {
                renderMessageTextContent(textEl, messageText);
            } else {
                textEl.textContent = messageText;
            }
        }
        renderMessageLinkPreview(messageDiv, msg);
    }

    if (filePayload) {
        const bubbleEl = messageDiv.querySelector('.bubble');
        if (bubbleEl && filePayload.mime?.startsWith('image/')) {
            bubbleEl.style.setProperty('--media-aspect-ratio', resolveMediaAspectRatio(filePayload, 1));
        } else if (bubbleEl && filePayload.mime?.startsWith('video/')) {
            bubbleEl.style.setProperty('--media-aspect-ratio', resolveMediaAspectRatio(filePayload, 1));
        }
    }

    bindMessageInteractiveHandlers(messageDiv);
    applyEmojiGraphics(messageDiv);
    if (isSelectionMode) messageDiv.classList.add('selecting');
    return messageDiv;
}
