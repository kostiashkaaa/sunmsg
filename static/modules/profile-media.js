// Media tabs renderer for the partner profile drawer.
// Source of truth: already decrypted chat messages from local chat state.

import { parseSunCallPayload, parseSunFilePayload, sanitizeFileUri, tr, activeLocale, escapeHtml } from './utils.js';
import { getMotionDurationTokenMs, waitForMotionEnd } from './motion.js';

const URL_REGEX = /\bhttps?:\/\/[^\s<>"'`]+/gi;

const TAB_DEFINITIONS = [
    { key: 'media', label: '\u041C\u0435\u0434\u0438\u0430' },
    { key: 'files', label: '\u0424\u0430\u0439\u043B\u044B' },
    { key: 'audio', label: '\u0410\u0443\u0434\u0438\u043E' },
    { key: 'voices', label: '\u0413\u043E\u043B\u043E\u0441\u043E\u0432\u044B\u0435' },
    { key: 'calls', label: '\u0417\u0432\u043E\u043D\u043A\u0438' },
    { key: 'links', label: '\u0421\u0441\u044B\u043B\u043A\u0438' },
];

const TAB_SWITCH_ANIMATION_MS = getMotionDurationTokenMs('--motion-duration-medium', 260);

function getTabIndex(key) {
    return TAB_DEFINITIONS.findIndex((tab) => tab.key === key);
}

function applyTabSwitchAnimation(contentEl, previousTabKey, nextTabKey) {
    if (!contentEl || !previousTabKey || previousTabKey === nextTabKey) return;

    const previousIndex = getTabIndex(previousTabKey);
    const nextIndex = getTabIndex(nextTabKey);
    const isBackward = previousIndex >= 0 && nextIndex >= 0 && nextIndex < previousIndex;

    contentEl.classList.remove('is-tab-switching', 'is-tab-switch-active', 'is-tab-switch-forward', 'is-tab-switch-backward');
    // Reflow to restart animation when user switches tabs quickly.
    void contentEl.offsetWidth;

    contentEl.classList.add('is-tab-switching', isBackward ? 'is-tab-switch-backward' : 'is-tab-switch-forward');
    requestAnimationFrame(() => {
        contentEl.classList.add('is-tab-switch-active');
    });

    const motionSeq = Number(contentEl.dataset.tabSwitchSeq || 0) + 1;
    contentEl.dataset.tabSwitchSeq = String(motionSeq);
    waitForMotionEnd(contentEl, TAB_SWITCH_ANIMATION_MS + 40).then(() => {
        if (Number(contentEl.dataset.tabSwitchSeq || 0) !== motionSeq) return;
        contentEl.classList.remove('is-tab-switching', 'is-tab-switch-active', 'is-tab-switch-forward', 'is-tab-switch-backward');
    });
}


function isVoicePayload(payload, messageType = '') {
    if (!payload || typeof payload !== 'object') return false;

    const normalizedType = String(messageType || '').toLowerCase();
    if (normalizedType === 'voice' || normalizedType === 'voice_message') return true;

    const mime = String(payload.mime || '').toLowerCase();
    const name = String(payload.name || '').toLowerCase();
    const hasWaveform = Array.isArray(payload.waveform) && payload.waveform.length > 0;
    const hasDuration = Number(payload.duration_seconds) > 0;
    const looksLikeVoiceName = /^voice[-_]|^voice\b|^recording\b|^audio message\b|^ptt\b|^\u0433\u043E\u043B\u043E\u0441/i.test(name);

    if (hasWaveform && (looksLikeVoiceName || mime.startsWith('audio/'))) return true;
    if (looksLikeVoiceName && hasDuration && mime.startsWith('audio/')) return true;
    return false;
}

function classifyFile(payload, messageType = '') {
    if (!payload || typeof payload !== 'object') return null;

    const mime = String(payload.mime || '').toLowerCase();
    const name = String(payload.name || '').toLowerCase();
    const attachMode = String(payload.attach_mode || '').toLowerCase();
    const isVisualByMimeOrName = mime.startsWith('image/')
        || mime.startsWith('video/')
        || (!mime.startsWith('audio/')
            && /\.(png|jpe?g|gif|webp|avif|bmp|svg|mp4|mov|m4v|avi|mkv|webm)$/i.test(name));
    if (attachMode === 'file' && isVisualByMimeOrName) {
        return 'file';
    }

    if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(name)) return 'photo';
    if (mime.startsWith('audio/') || /\.(mp3|m4a|wav|ogg|opus|aac|webm)$/i.test(name)) {
        return isVoicePayload(payload, messageType) ? 'voice' : 'audio';
    }
    if (mime.startsWith('video/') || /\.(mp4|mov|m4v|avi|mkv|webm)$/i.test(name)) return 'video';
    return 'file';
}

function extractLinks(text) {
    if (!text || typeof text !== 'string') return [];
    const matches = text.match(URL_REGEX);
    if (!matches) return [];
    return matches.map((url) => url.replace(/[),.;:!?]+$/, ''));
}

function fileExtension(name) {
    const match = String(name || '').match(/\.([a-z0-9]{1,8})$/i);
    return match ? match[1].toLowerCase() : '';
}

function fileIconClass(payload) {
    const mime = String(payload?.mime || '').toLowerCase();
    const ext = fileExtension(payload?.name);
    if (ext === 'pdf') return 'icon-pdf';
    if (['doc', 'docx', 'rtf', 'odt'].includes(ext)) return 'icon-doc';
    if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return 'icon-xls';
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'icon-zip';
    if (mime.startsWith('image/')) return 'icon-img';
    if (mime.startsWith('video/')) return 'icon-vid';
    if (mime.startsWith('audio/')) return 'icon-aud';
    if (['txt', 'md', 'log'].includes(ext)) return 'icon-txt';
    return 'icon-default';
}

function formatBytes(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(seconds) {
    const s = Number(seconds);
    if (!Number.isFinite(s) || s <= 0) return '';
    const mm = Math.floor(s / 60);
    const ss = Math.floor(s % 60);
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function formatShortDate(rawIso) {
    if (!rawIso) return '';
    const normalized = rawIso.includes('T') ? rawIso : `${rawIso.replace(' ', 'T')}Z`;
    const d = new Date(normalized);
    if (Number.isNaN(d.getTime())) return '';

    const now = new Date();
    const isThisYear = d.getFullYear() === now.getFullYear();
    if (isThisYear) {
        return d.toLocaleString(activeLocale(), {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
        });
    }
    return d.toLocaleDateString(activeLocale(), {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    });
}


function normalizeProfileMediaKind(kind) {
    const normalized = String(kind || '').toLowerCase();
    if (normalized === 'photo' || normalized === 'image') return 'image';
    if (normalized === 'video') return 'video';
    if (normalized === 'audio' || normalized === 'voice') return 'audio';
    if (normalized === 'file') return 'file';
    return 'other';
}

function isEncryptedMediaReference(source) {
    return String(source || '').includes('sun_media_e2ee=');
}

export async function resolveProfileMediaSource(rawUri, kind = 'other') {
    const mediaKind = normalizeProfileMediaKind(kind);
    const safeUri = sanitizeFileUri(rawUri, { imageOnlyData: mediaKind === 'image' });
    if (!safeUri || safeUri === '#') return '';

    const resolver = window.__sunMediaCacheResolveSource;
    if (typeof resolver !== 'function') {
        return isEncryptedMediaReference(safeUri) ? '' : safeUri;
    }

    try {
        const resolved = String(await resolver(safeUri, { kind: mediaKind }) || '').trim();
        if (resolved) return resolved;
    } catch (_) {}
    return isEncryptedMediaReference(safeUri) ? '' : safeUri;
}

function forceProfileMediaNetworkLoad(mediaEl, mediaKind) {
    if (!mediaEl || typeof mediaEl.setAttribute !== 'function') return;
    if (mediaKind === 'image') {
        try { mediaEl.loading = 'eager'; } catch (_) {}
        mediaEl.setAttribute('loading', 'eager');
        mediaEl.setAttribute('decoding', 'async');
        return;
    }
    if (mediaKind === 'video') {
        mediaEl.setAttribute('preload', 'metadata');
        mediaEl.setAttribute('playsinline', '');
        mediaEl.muted = true;
    }
}

export async function hydrateProfileMediaElement(mediaEl, rawUri, kind = 'other') {
    if (!mediaEl || typeof mediaEl.setAttribute !== 'function') return false;
    const mediaKind = normalizeProfileMediaKind(kind);
    const safeUri = sanitizeFileUri(rawUri, { imageOnlyData: mediaKind === 'image' });
    if (!safeUri || safeUri === '#') return false;
    forceProfileMediaNetworkLoad(mediaEl, mediaKind);

    const nextSeq = Number(mediaEl.dataset?.profileMediaSourceSeq || 0) + 1;
    if (mediaEl.dataset) {
        mediaEl.dataset.profileMediaSourceSeq = String(nextSeq);
    }
    mediaEl.setAttribute('data-src', safeUri);

    const resolvedSource = await resolveProfileMediaSource(safeUri, mediaKind);
    if (!resolvedSource) return false;
    if (mediaEl.dataset && mediaEl.dataset.profileMediaSourceSeq !== String(nextSeq)) return false;
    mediaEl.setAttribute('src', resolvedSource);
    return true;
}

function normalizeWaveform(rawWaveform) {
    let values = [];
    if (Array.isArray(rawWaveform)) {
        values = rawWaveform;
    } else if (typeof rawWaveform === 'string' && rawWaveform.includes(',')) {
        values = rawWaveform.split(',').map((part) => Number(part.trim()));
    }

    const normalized = values
        .map((value) => {
            const n = Number(value);
            if (!Number.isFinite(n)) return null;
            return Math.max(6, Math.min(100, Math.round(n)));
        })
        .filter((value) => value != null);

    return normalized.length ? normalized : [22, 36, 54, 42, 68, 52, 38, 26, 44, 58, 34, 18];
}

function buildWaveBarsHtml(rawWaveform, maxBars = 28) {
    const waveform = normalizeWaveform(rawWaveform).slice(0, maxBars);
    return waveform.map((value) => {
        const height = Math.max(6, Math.min(22, Math.round((Number(value) / 100) * 22)));
        return `<span class="profile-audio-wave-bar" data-height="${height}"></span>`;
    }).join('');
}

export function collectMediaFromMessages(messages) {
    const result = { media: [], files: [], audio: [], voices: [], calls: [], links: [] };
    if (!Array.isArray(messages)) return result;

    for (const msg of messages) {
        if (!msg || msg.pending) continue;

        const text = typeof msg.message === 'string' ? msg.message : '';
        if (!text) continue;

        const callPayload = parseSunCallPayload(text);
        if (callPayload) {
            result.calls.push({
                msgId: msg.id,
                payload: callPayload,
                createdAt: msg.created_at,
                sender: msg.sender,
                messageType: msg.message_type || 'call',
            });
            continue;
        }

        const filePayload = parseSunFilePayload(text);
        if (filePayload) {
            const kind = classifyFile(filePayload, msg.message_type);
            const entry = {
                msgId: msg.id,
                payload: filePayload,
                createdAt: msg.created_at,
                sender: msg.sender,
                messageType: msg.message_type || '',
                mediaKind: kind,
            };

            if (kind === 'photo' || kind === 'video') result.media.push(entry);
            else if (kind === 'voice') result.voices.push(entry);
            else if (kind === 'audio') result.audio.push(entry);
            else result.files.push(entry);

            const captionLinks = extractLinks(filePayload.caption || '');
            for (const url of captionLinks) {
                result.links.push({ msgId: msg.id, url, createdAt: msg.created_at, sender: msg.sender });
            }
            continue;
        }

        const urls = extractLinks(text);
        for (const url of urls) {
            result.links.push({ msgId: msg.id, url, createdAt: msg.created_at, sender: msg.sender });
        }
    }

    for (const key of Object.keys(result)) {
        result[key].sort((a, b) => Number(b.msgId || 0) - Number(a.msgId || 0));
    }
    return result;
}

export function renderMediaTabs({
    tabsEl,
    contentEl,
    emptyEl,
    media,
    activeKey,
    onTabChange,
    onItemClick,
}) {
    if (!tabsEl || !contentEl) return null;
    const previousActive = tabsEl.getAttribute('data-active-tab') || contentEl.getAttribute('data-active-tab') || '';

    const available = TAB_DEFINITIONS.filter((tab) => (media[tab.key] || []).length > 0);

    if (!available.length) {
        tabsEl.innerHTML = '';
        contentEl.innerHTML = '';
        tabsEl.removeAttribute('data-active-tab');
        contentEl.removeAttribute('data-active-tab');
        if (emptyEl) {
            emptyEl.classList.remove('profile-media-empty--hidden');
            emptyEl.style.display = '';
        }
        return null;
    }

    if (emptyEl) {
        emptyEl.classList.add('profile-media-empty--hidden');
        emptyEl.style.display = 'none';
    }

    const nextActive = activeKey && available.some((tab) => tab.key === activeKey)
        ? activeKey
        : available[0].key;

    tabsEl.innerHTML = available.map((tab) => `
        <button type="button" class="profile-media-tab${tab.key === nextActive ? ' active' : ''}"
                data-tab-key="${tab.key}" role="tab" aria-selected="${tab.key === nextActive}">
            <span class="profile-media-tab-label">${escapeHtml(tr(tab.label))}</span>
        </button>
    `).join('');
    tabsEl.setAttribute('data-active-tab', nextActive);
    contentEl.setAttribute('data-active-tab', nextActive);

    tabsEl.querySelectorAll('.profile-media-tab').forEach((btn) => {
        btn.addEventListener('click', () => {
            const key = btn.getAttribute('data-tab-key');
            if (key && key !== nextActive) onTabChange?.(key);
        });
    });

    renderTabContent(contentEl, nextActive, media[nextActive] || [], onItemClick);
    applyTabSwitchAnimation(contentEl, previousActive, nextActive);
    return nextActive;
}

function renderTabContent(contentEl, key, items, onItemClick) {
    if (!items.length) {
        contentEl.innerHTML = `<div class="profile-media-empty"><i class="bi bi-folder2-open"></i><span>${escapeHtml(tr('\u0417\u0434\u0435\u0441\u044C \u043F\u043E\u043A\u0430 \u043F\u0443\u0441\u0442\u043E'))}</span></div>`;
        return;
    }

    if (key === 'media') {
        renderMediaGrid(contentEl, items, onItemClick);
    } else if (key === 'files') {
        renderFileList(contentEl, items, onItemClick);
    } else if (key === 'audio' || key === 'voices') {
        renderAudioList(contentEl, items, key === 'voices', onItemClick);
    } else if (key === 'calls') {
        renderCallList(contentEl, items, onItemClick);
    } else if (key === 'links') {
        renderLinkList(contentEl, items, onItemClick);
    }
}

function renderMediaGrid(contentEl, items, onItemClick) {
    contentEl.innerHTML = '<div class="profile-media-grid"></div>';
    const grid = contentEl.firstElementChild;

    items.forEach((entry) => {
        const url = String(entry.payload?.data || '');
        const isVideo = entry.mediaKind === 'video';
        const mediaKind = isVideo ? 'video' : 'image';
        const safeUrl = sanitizeFileUri(url, { imageOnlyData: mediaKind === 'image' });
        if (!safeUrl || safeUrl === '#') return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `profile-media-grid-item${isVideo ? ' is-video' : ' is-photo'}`;
        btn.setAttribute('data-msg-id', String(entry.msgId || ''));

        if (isVideo) {
            btn.innerHTML = `
                <video data-src="${escapeHtml(safeUrl)}" preload="metadata" muted playsinline></video>
                <span class="profile-media-grid-duration">${escapeHtml(formatDuration(entry.payload?.duration_seconds) || '')}</span>
            `;
        } else {
            btn.innerHTML = `<img data-src="${escapeHtml(safeUrl)}" alt="" loading="lazy" decoding="async">`;
        }

        hydrateProfileMediaElement(btn.querySelector(isVideo ? 'video' : 'img'), safeUrl, mediaKind).catch(() => {});
        btn.addEventListener('click', () => onItemClick?.({ kind: isVideo ? 'video' : 'photo', entry }));
        grid.appendChild(btn);
    });
}

function renderFileList(contentEl, items, onItemClick) {
    contentEl.innerHTML = '<div class="profile-file-list"></div>';
    const list = contentEl.firstElementChild;

    items.forEach((entry) => {
        const p = entry.payload || {};
        const ext = fileExtension(p.name) || (p.mime || '').split('/').pop() || 'file';
        const sizeText = formatBytes(p.size);
        const dateText = formatShortDate(entry.createdAt);
        const sub = [sizeText, dateText].filter(Boolean).join(' • ');

        const row = document.createElement('div');
        row.className = 'profile-file-row';
        row.setAttribute('data-msg-id', String(entry.msgId || ''));
        row.innerHTML = `
            <div class="profile-file-icon ${fileIconClass(p)}">${escapeHtml(ext.slice(0, 4))}</div>
            <div class="profile-file-meta">
                <div class="profile-file-name" title="${escapeHtml(p.name || '')}">${escapeHtml(p.name || tr('\u0424\u0430\u0439\u043B'))}</div>
                <div class="profile-file-sub">${escapeHtml(sub)}</div>
            </div>
            <div class="profile-file-actions">
                <button type="button" class="profile-file-action-btn" data-action="download" title="${escapeHtml(tr('\u0421\u043A\u0430\u0447\u0430\u0442\u044C'))}" aria-label="${escapeHtml(tr('\u0421\u043A\u0430\u0447\u0430\u0442\u044C'))}">
                    <i class="bi bi-download"></i>
                </button>
                <button type="button" class="profile-file-action-btn" data-action="jump" title="${escapeHtml(tr('\u041F\u0435\u0440\u0435\u0439\u0442\u0438 \u043A \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044E'))}" aria-label="${escapeHtml(tr('\u041F\u0435\u0440\u0435\u0439\u0442\u0438 \u043A \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044E'))}">
                    <i class="bi bi-arrow-up-right-square"></i>
                </button>
            </div>
        `;

        row.addEventListener('click', (event) => {
            const actionBtn = event.target.closest('[data-action]');
            const action = actionBtn?.getAttribute('data-action') || 'jump';
            event.stopPropagation();
            onItemClick?.({ kind: 'file', entry, action });
        });

        list.appendChild(row);
    });
}

function renderAudioList(contentEl, items, isVoice, onItemClick) {
    contentEl.innerHTML = '<div class="profile-audio-list"></div>';
    const list = contentEl.firstElementChild;

    items.forEach((entry) => {
        const p = entry.payload || {};
        const url = String(p.data || '');
        const title = isVoice ? tr('\u0413\u043E\u043B\u043E\u0441\u043E\u0432\u043E\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435') : (p.name || tr('\u0410\u0443\u0434\u0438\u043E'));
        const dateText = formatShortDate(entry.createdAt);
        const dur = formatDuration(p.duration_seconds);
        const sub = [dur, dateText].filter(Boolean).join(' • ');

        const row = document.createElement('div');
        row.className = `profile-audio-row${isVoice ? ' profile-audio-row--voice' : ''}`;
        row.setAttribute('data-msg-id', String(entry.msgId || ''));
        row.innerHTML = `
            <button type="button" class="profile-audio-play-btn" data-action="play" aria-label="${escapeHtml(tr('\u0412\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u0435\u0441\u0442\u0438'))}">
                <i class="bi bi-play-fill"></i>
            </button>
            <div class="profile-audio-meta">
                <div class="profile-audio-title">${escapeHtml(title)}</div>
                <div class="profile-audio-sub">${escapeHtml(sub)}</div>
                ${isVoice ? `<div class="profile-audio-wave" aria-hidden="true">${buildWaveBarsHtml(p.waveform)}</div>` : ''}
            </div>
            <button type="button" class="profile-file-action-btn" data-action="jump" title="${escapeHtml(tr('\u041F\u0435\u0440\u0435\u0439\u0442\u0438 \u043A \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044E'))}" aria-label="${escapeHtml(tr('\u041F\u0435\u0440\u0435\u0439\u0442\u0438 \u043A \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044E'))}">
                <i class="bi bi-arrow-up-right-square"></i>
            </button>
        `;

        const playBtn = row.querySelector('[data-action="play"]');
        let audioEl = null;
        let isPlaying = false;
        let voiceListenReported = false;

        const togglePlayback = (event) => {
            if (event) event.stopPropagation();

            list.querySelectorAll('audio[data-profile-audio]').forEach((a) => {
                if (a !== audioEl) {
                    a.pause();
                    const parentRow = a.closest('.profile-audio-row');
                    parentRow?.classList.remove('is-playing');
                    const icon = parentRow?.querySelector('[data-action="play"] i');
                    if (icon) icon.className = 'bi bi-play-fill';
                }
            });

            if (!audioEl) {
                audioEl = document.createElement('audio');
                audioEl.src = url;
                audioEl.preload = 'metadata';
                audioEl.setAttribute('data-profile-audio', '1');
                audioEl.style.display = 'none';
                audioEl.addEventListener('ended', () => {
                    isPlaying = false;
                    row.classList.remove('is-playing');
                    const icon = playBtn.querySelector('i');
                    if (icon) icon.className = 'bi bi-play-fill';
                });
                row.appendChild(audioEl);
            }

            const icon = playBtn.querySelector('i');
            if (isPlaying) {
                audioEl.pause();
                isPlaying = false;
                row.classList.remove('is-playing');
                if (icon) icon.className = 'bi bi-play-fill';
            } else {
                audioEl.play().catch(() => {});
                isPlaying = true;
                row.classList.add('is-playing');
                if (icon) icon.className = 'bi bi-pause-fill';
                if (isVoice && !voiceListenReported) {
                    onItemClick?.({ kind: 'voice', entry, action: 'play' });
                    voiceListenReported = true;
                }
            }
        };

        playBtn?.addEventListener('click', togglePlayback);
        row.addEventListener('click', (event) => {
            const jumpBtn = event.target.closest('[data-action="jump"]');
            if (jumpBtn) {
                event.stopPropagation();
                onItemClick?.({ kind: isVoice ? 'voice' : 'audio', entry, action: 'jump' });
                return;
            }
            if (isVoice) togglePlayback(event);
        });

        list.appendChild(row);
    });
}

function callStatusLabel(status, durationSec) {
    const normalized = String(status || '').trim();
    if (normalized === 'ended') return formatDuration(durationSec) || tr('\u0417\u0430\u0432\u0435\u0440\u0448\u0451\u043D');
    if (normalized === 'cancelled') return tr('\u041E\u0442\u043C\u0435\u043D\u0451\u043D');
    if (normalized === 'rejected') return tr('\u041E\u0442\u043A\u043B\u043E\u043D\u0451\u043D');
    if (normalized === 'failed') return tr('\u0421\u0431\u043E\u0439 \u0441\u043E\u0435\u0434\u0438\u043D\u0435\u043D\u0438\u044F');
    return tr('\u041F\u0440\u043E\u043F\u0443\u0449\u0435\u043D');
}

function renderCallList(contentEl, items, onItemClick) {
    contentEl.innerHTML = '<div class="profile-call-list"></div>';
    const list = contentEl.firstElementChild;

    items.forEach((entry) => {
        const payload = entry.payload || {};
        const callType = String(payload.call_type || '').trim() === 'video' ? 'video' : 'audio';
        const isVideo = callType === 'video';
        const status = String(payload.status || '').trim();
        const dateText = formatShortDate(entry.createdAt);
        const title = isVideo ? tr('\u0412\u0438\u0434\u0435\u043E\u0437\u0432\u043E\u043D\u043E\u043A') : tr('\u0417\u0432\u043E\u043D\u043E\u043A');
        const sub = [callStatusLabel(status, payload.duration_sec), dateText].filter(Boolean).join(' \u2022 ');
        const icon = isVideo ? 'bi-camera-video-fill' : 'bi-telephone-fill';
        const row = document.createElement('div');
        row.className = `profile-call-row${status && status !== 'ended' ? ' profile-call-row--missed' : ''}`;
        row.setAttribute('data-msg-id', String(entry.msgId || ''));
        row.innerHTML = `
            <div class="profile-call-icon" aria-hidden="true">
                <i class="bi ${icon}"></i>
            </div>
            <div class="profile-call-meta">
                <div class="profile-call-title">${escapeHtml(title)}</div>
                <div class="profile-call-sub">${escapeHtml(sub)}</div>
            </div>
            <div class="profile-call-actions">
                <button type="button" class="profile-call-action-btn profile-call-action-btn--repeat" data-action="call" aria-label="${escapeHtml(tr('\u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u044C \u0437\u0432\u043E\u043D\u043E\u043A'))}">
                    <i class="bi ${isVideo ? 'bi-camera-video' : 'bi-telephone'}"></i>
                </button>
                <button type="button" class="profile-call-action-btn" data-action="jump" aria-label="${escapeHtml(tr('\u041F\u0435\u0440\u0435\u0439\u0442\u0438 \u043A \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044E'))}">
                    <i class="bi bi-arrow-up-right-square"></i>
                </button>
            </div>
        `;

        row.addEventListener('click', (event) => {
            const actionBtn = event.target.closest('[data-action]');
            const action = actionBtn?.getAttribute('data-action') || 'jump';
            event.stopPropagation();
            onItemClick?.({ kind: 'call', entry, action });
        });

        list.appendChild(row);
    });
}

function renderLinkList(contentEl, items, onItemClick) {
    contentEl.innerHTML = '<div class="profile-link-list"></div>';
    const list = contentEl.firstElementChild;

    const seen = new Map();
    for (const item of items) {
        if (!seen.has(item.url)) seen.set(item.url, item);
    }

    [...seen.values()].forEach((entry) => {
        let host = '';
        try {
            host = new URL(entry.url).hostname.replace(/^www\./, '');
        } catch (_) {
            host = entry.url;
        }

        const dateText = formatShortDate(entry.createdAt);
        const row = document.createElement('div');
        row.className = 'profile-link-row';
        row.setAttribute('data-msg-id', String(entry.msgId || ''));
        row.innerHTML = `
            <div class="profile-link-title">${escapeHtml(host)}</div>
            <div class="profile-link-url">${escapeHtml(entry.url)}</div>
            <div class="profile-link-footer">
                <span class="profile-link-date">${escapeHtml(dateText)}</span>
                <button type="button" class="profile-link-jump-btn" data-action="jump" aria-label="${escapeHtml(tr('\u041F\u0435\u0440\u0435\u0439\u0442\u0438 \u043A \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044E'))}">
                    <i class="bi bi-arrow-up-right-square"></i>
                    <span>${escapeHtml(tr('\u0432 \u0447\u0430\u0442'))}</span>
                </button>
            </div>
        `;

        row.addEventListener('click', (event) => {
            const jumpBtn = event.target.closest('[data-action="jump"]');
            event.stopPropagation();
            if (jumpBtn) {
                onItemClick?.({ kind: 'link', entry, action: 'jump' });
            } else {
                onItemClick?.({ kind: 'link', entry, action: 'open' });
            }
        });

        list.appendChild(row);
    });
}
