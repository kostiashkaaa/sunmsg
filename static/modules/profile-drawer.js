import { applyFallbackAvatarTint, buildAvatarInitials } from './utils.js';

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

let profileLocaleListenerBound = false;

function formatSavedMessageCountLabel(rawCount) {
    const safeCount = Math.max(0, Number(rawCount) || 0);
    const api = window.SUN_I18N;
    const language = api && typeof api.getLanguage === 'function'
        ? String(api.getLanguage() || '').toLowerCase()
        : String(document.documentElement.lang || 'ru').toLowerCase();

    if (language.startsWith('en')) {
        return safeCount === 1 ? '1 message' : `${safeCount} messages`;
    }

    const mod10 = safeCount % 10;
    const mod100 = safeCount % 100;
    if (mod10 === 1 && mod100 !== 11) return `${safeCount} \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435`;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${safeCount} \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F`;
    return `${safeCount} \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0439`;
}

function refreshProfileLocaleBindings() {
    const lastSeenEl = document.getElementById('profileLastSeen');
    if (lastSeenEl) {
        const savedMessagesProfile = lastSeenEl.dataset.savedMessagesProfile === '1';
        if (savedMessagesProfile) {
            lastSeenEl.textContent = String(
                lastSeenEl.dataset.messageCountLabel || formatSavedMessageCountLabel(0)
            );
            return;
        }
        const hidden = lastSeenEl.dataset.statusHidden === '1';
        const online = lastSeenEl.dataset.isOnline === '1';
        const lastSeenRaw = lastSeenEl.dataset.lastSeenRaw || '';
        if (hidden) {
            lastSeenEl.textContent = tr('\u0441\u0442\u0430\u0442\u0443\u0441 \u0441\u043A\u0440\u044B\u0442');
        } else if (online) {
            lastSeenEl.textContent = tr('\u0432 \u0441\u0435\u0442\u0438');
        } else {
            lastSeenEl.textContent = formatLastSeenText(lastSeenRaw);
        }
    }

    const createdAtEl = document.getElementById('profileMetaCreatedAt');
    if (createdAtEl && typeof createdAtEl.dataset.createdAtRaw === 'string') {
        createdAtEl.textContent = formatRegistrationDate(createdAtEl.dataset.createdAtRaw);
    }
}

function ensureProfileLocaleListener() {
    if (profileLocaleListenerBound) return;
    window.addEventListener('sun-ui-language-changed', refreshProfileLocaleBindings);
    profileLocaleListenerBound = true;
}

export function initProfileDrawer({
    drawerEl,
    profileSheetEl,
    chatAreaEl,
} = {}) {
    const drawer = drawerEl;
    const sheet = profileSheetEl;
    const chatArea = chatAreaEl || drawer?.closest?.('.chat-area') || document.getElementById('chatArea');
    let phase = 'closed';
    let transitionSeq = 0;
    let transitionPromise = null;
    let contentRevealSeq = 0;
    let lastFocusedElement = null;

    function resetDragState() {
        if (!sheet) return;
        sheet.classList.remove('is-dragging');
        chatArea?.classList.remove('is-profile-drawer-dragging');
        sheet.style.removeProperty('--profile-drag-x');
        sheet.style.removeProperty('--profile-drag-y');
        chatArea?.style.removeProperty('--profile-drag-x');
    }

    function setChatProfileMotionState(state) {
        if (!chatArea) return;
        chatArea.classList.toggle('is-profile-drawer-open', state === 'open');
        chatArea.classList.toggle('is-profile-drawer-closing', state === 'closing');
    }

    function prefersReducedMotion() {
        if (document.documentElement.classList.contains('perf-lite')) {
            return true;
        }
        const motionLevel = String(document.documentElement.getAttribute('data-motion-level') || 'full').toLowerCase();
        if (motionLevel !== 'lite') {
            return false;
        }
        try {
            return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        } catch (_) {
            return false;
        }
    }

    function parseDurationMs(raw, fallbackMs = 0) {
        const value = String(raw || '').trim().toLowerCase();
        if (!value) return fallbackMs;
        if (value.endsWith('ms')) {
            const ms = Number.parseFloat(value.slice(0, -2));
            return Number.isFinite(ms) ? Math.max(0, ms) : fallbackMs;
        }
        if (value.endsWith('s')) {
            const seconds = Number.parseFloat(value.slice(0, -1));
            return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : fallbackMs;
        }
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? Math.max(0, parsed) : fallbackMs;
    }

    function getTransitionMs(element, fallbackMs = 280) {
        if (!element || prefersReducedMotion()) return 0;
        const style = getComputedStyle(element);
        const durations = String(style.transitionDuration || '')
            .split(',')
            .map((item) => parseDurationMs(item, 0));
        const delays = String(style.transitionDelay || '')
            .split(',')
            .map((item) => parseDurationMs(item, 0));
        const durationMax = durations.reduce((maxMs, currentMs) => Math.max(maxMs, currentMs), 0);
        const delayMax = delays.reduce((maxMs, currentMs) => Math.max(maxMs, currentMs), 0);
        const computedMs = durationMax + delayMax;
        return computedMs > 0 ? computedMs : fallbackMs;
    }

    function waitForAnimationEnd(element, fallbackMs) {
        if (!element || fallbackMs <= 0) return Promise.resolve();

        return new Promise((resolve) => {
            let settled = false;
            let timeoutId = 0;
            const onEnd = (event) => {
                if (event?.target !== element) return;
                finish();
            };
            const finish = () => {
                if (settled) return;
                settled = true;
                if (timeoutId) window.clearTimeout(timeoutId);
                element.removeEventListener('transitionend', onEnd);
                element.removeEventListener('animationend', onEnd);
                resolve();
            };
            element.addEventListener('transitionend', onEnd);
            element.addEventListener('animationend', onEnd);
            timeoutId = window.setTimeout(finish, fallbackMs + 50);
        });
    }

    function isOpen() {
        return phase === 'open' || phase === 'opening';
    }

    function clearContentReveal() {
        contentRevealSeq += 1;
        drawer?.classList.remove('profile-content-revealing');
    }

    function revealContent() {
        if (!drawer || prefersReducedMotion()) return;
        clearContentReveal();
        const revealSeq = ++contentRevealSeq;
        void drawer.offsetWidth;
        drawer.classList.add('profile-content-revealing');
        waitForAnimationEnd(drawer, getTransitionMs(drawer, 640)).then(() => {
            if (revealSeq !== contentRevealSeq) return;
            drawer?.classList.remove('profile-content-revealing');
        });
    }

    function open() {
        if (!drawer) return;
        if (
            (phase === 'open' || phase === 'opening')
            && drawer.classList.contains('active')
            && !drawer.classList.contains('is-closing')
        ) {
            setChatProfileMotionState('open');
            return;
        }

        const openSeq = ++transitionSeq;
        phase = 'opening';
        transitionPromise = null;
        lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        drawer.classList.remove('active', 'is-closing', 'is-profile-opening');
        drawer.classList.add('is-opening', 'is-profile-opening');
        drawer.setAttribute('aria-hidden', 'false');
        setChatProfileMotionState('open');
        resetDragState();
        requestAnimationFrame(() => {
            if (openSeq !== transitionSeq) return;
            drawer.classList.add('active');
            requestAnimationFrame(() => {
                if (openSeq !== transitionSeq) return;
                drawer.classList.remove('is-opening');
                phase = 'open';
                waitForAnimationEnd(sheet || drawer, getTransitionMs(sheet || drawer, 460) + 40).then(() => {
                    if (openSeq !== transitionSeq) return;
                    drawer.classList.remove('is-profile-opening');
                });
            });
        });
    }

    function close() {
        if (!drawer) return Promise.resolve(false);
        if (phase === 'closing' && transitionPromise) return transitionPromise;
        if (!drawer.classList.contains('active') && phase === 'closed') {
            setChatProfileMotionState('closed');
            return Promise.resolve(false);
        }

        const closeSeq = ++transitionSeq;
        phase = 'closing';
        clearContentReveal();
        sheet?.classList.remove('is-dragging');
        chatArea?.classList.remove('is-profile-drawer-dragging');
        drawer.classList.add('is-closing');
        drawer.classList.remove('is-profile-opening');
        drawer.setAttribute('aria-hidden', 'true');
        setChatProfileMotionState('closing');

        const target = sheet || drawer;
        const waitMs = getTransitionMs(target, 280);
        transitionPromise = waitForAnimationEnd(target, waitMs).then(() => {
            if (closeSeq !== transitionSeq) return false;
            drawer.classList.remove('active', 'is-closing', 'is-opening', 'is-profile-opening');
            resetDragState();
            setChatProfileMotionState('closed');
            phase = 'closed';
            transitionPromise = null;

            if (lastFocusedElement instanceof HTMLElement && document.contains(lastFocusedElement)) {
                try { lastFocusedElement.focus({ preventScroll: true }); } catch (_) {}
            }
            lastFocusedElement = null;
            return true;
        });

        return transitionPromise;
    }

    if (sheet) {
        let startX = 0;
        let startY = 0;
        let currentX = 0;
        let currentY = 0;
        let isTracking = false;
        let isDragging = false;
        let activePointerId = null;

        const dragBlockedTargetSelector = [
            'a',
            'button',
            'input',
            'label',
            'select',
            'summary',
            'textarea',
            '[contenteditable="true"]',
            '[data-profile-close]',
            '[role="button"]',
            '[role="menuitem"]',
            '[role="tab"]',
            '.profile-action-btn',
            '.profile-media-tab',
            '.profile-meta-copy-btn',
            '.profile-more-item',
            '.profile-topbar-btn',
        ].join(',');

        const isDragBlockedTarget = (target) => (
            target instanceof Element
            && Boolean(target.closest(dragBlockedTargetSelector))
        );

        const captureActivePointer = (event) => {
            if (!event || typeof event.pointerId !== 'number') return;
            try {
                if (
                    typeof sheet.hasPointerCapture === 'function'
                    && typeof sheet.setPointerCapture === 'function'
                    && !sheet.hasPointerCapture(event.pointerId)
                ) {
                    sheet.setPointerCapture(event.pointerId);
                }
            } catch (_) {}
        };

        const beginDrag = (clientX, clientY) => {
            startX = clientX;
            startY = clientY;
            currentX = startX;
            currentY = startY;
            isTracking = true;
            isDragging = false;
        };

        const moveDragTo = (clientX, clientY, event) => {
            if (!isTracking) return false;
            currentX = clientX;
            currentY = clientY;
            const deltaX = currentX - startX;
            const deltaY = currentY - startY;

            if (!isDragging) {
                const absX = Math.abs(deltaX);
                const absY = Math.abs(deltaY);
                if (absX < 8 && absY < 8) return true;
                if (deltaX <= 0 || absY > absX) {
                    isTracking = false;
                    return false;
                }
                isDragging = true;
                sheet.classList.add('is-dragging');
                chatArea?.classList.add('is-profile-drawer-dragging');
                captureActivePointer(event);
            }

            const dragX = Math.max(0, deltaX);
            sheet.style.setProperty('--profile-drag-x', `${dragX}px`);
            chatArea?.style.setProperty('--profile-drag-x', `${dragX}px`);
            if (dragX > 0 && event.cancelable) event.preventDefault();
            return true;
        };

        const startSwipe = (event) => {
            if (isDragBlockedTarget(event.target)) return;
            const touch = event.changedTouches?.[0];
            if (!touch) return;
            beginDrag(touch.clientX, touch.clientY);
        };

        const moveSwipe = (event) => {
            const touch = event.changedTouches?.[0];
            if (!touch) return;
            moveDragTo(touch.clientX, touch.clientY, event);
        };

        const endSwipe = () => {
            if (!isTracking) return;
            const dragDistanceX = Math.max(0, currentX - startX);
            const wasDragging = isDragging;
            isTracking = false;
            isDragging = false;
            if (!wasDragging) return;

            const closeThreshold = Math.max(96, Math.round(sheet.clientWidth * 0.22));
            if (dragDistanceX >= closeThreshold) {
                close();
                return;
            }
            resetDragState();
        };

        const startPointerDrag = (event) => {
            if (
                event.pointerType === 'touch'
                || event.button !== 0
                || !isOpen()
                || isDragBlockedTarget(event.target)
            ) return;
            activePointerId = event.pointerId;
            beginDrag(event.clientX, event.clientY);
        };

        const movePointerDrag = (event) => {
            if (activePointerId !== event.pointerId) return;
            const stillTracking = moveDragTo(event.clientX, event.clientY, event);
            if (!stillTracking) {
                activePointerId = null;
                try { sheet.releasePointerCapture(event.pointerId); } catch (_) {}
            }
        };

        const endPointerDrag = (event) => {
            if (activePointerId !== event.pointerId) return;
            activePointerId = null;
            try { sheet.releasePointerCapture(event.pointerId); } catch (_) {}
            endSwipe();
        };

        sheet.addEventListener('touchstart', startSwipe, { passive: true });
        sheet.addEventListener('touchmove', moveSwipe, { passive: false });
        sheet.addEventListener('touchend', endSwipe);
        sheet.addEventListener('touchcancel', endSwipe);
        sheet.addEventListener('pointerdown', startPointerDrag);
        sheet.addEventListener('pointermove', movePointerDrag);
        sheet.addEventListener('pointerup', endPointerDrag);
        sheet.addEventListener('pointercancel', endPointerDrag);
    }

    return { isOpen, open, close, revealContent, clearContentReveal };
}

export function parseUtcDate(rawValue) {
    if (!rawValue || typeof rawValue !== 'string') return null;
    const normalized = rawValue.includes('T') ? rawValue : `${rawValue.replace(' ', 'T')}Z`;
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
}

export function formatLastSeenText(rawValue) {
    const date = parseUtcDate(rawValue);
    if (!date) return tr('\u043D\u0435 \u0432 \u0441\u0435\u0442\u0438');
    const now = new Date();
    const isToday = now.toDateString() === date.toDateString();
    const timePart = date.toLocaleTimeString(activeLocale(), { hour: '2-digit', minute: '2-digit' });
    if (isToday) return `${tr('\u0431\u044B\u043B(\u0430) \u0432 \u0441\u0435\u0442\u0438')} ${tr('\u0441\u0435\u0433\u043E\u0434\u043D\u044F \u0432')} ${timePart}`;
    return `${tr('\u0431\u044B\u043B(\u0430) \u0432 \u0441\u0435\u0442\u0438')} ${date.toLocaleDateString(activeLocale())}, ${timePart}`;
}

export function formatRegistrationDate(rawValue) {
    const date = parseUtcDate(rawValue);
    return date ? date.toLocaleDateString(activeLocale()) : '—';
}

export function renderProfileHeader(profile, { isChatBlocked, profileOnlineDot } = {}) {
    const payload = profile || {};
    const displayName = payload.display_name || payload.username || '\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C';
    const username = payload.username || '';
    const isSavedMessagesProfile = payload._saved_messages_profile === true;
    const largeAvatar = document.getElementById('profileLargeAvatar');
    const nameEl = document.getElementById('profileDisplayName');
    const userEl = document.getElementById('profileMetaUsername');

    if (nameEl) nameEl.textContent = displayName;
    if (userEl) userEl.textContent = isSavedMessagesProfile ? '' : (username ? `@${username}` : '@unknown');

    if (largeAvatar) {
        if (isSavedMessagesProfile) {
            largeAvatar.classList.add('saved-messages-avatar');
            largeAvatar.removeAttribute('data-avatar-tint');
            largeAvatar.innerHTML = '<i class="bi bi-bookmark-fill" aria-hidden="true"></i>';
        } else {
            largeAvatar.classList.remove('saved-messages-avatar');
            if (payload.avatar_url) {
                largeAvatar.removeAttribute('data-avatar-tint');
                largeAvatar.innerHTML = '';
                const img = document.createElement('img');
                img.src = payload.avatar_url;
                img.alt = '\u0410\u0432\u0430\u0442\u0430\u0440 \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044F';
                img.draggable = false;
                img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
                img.onerror = () => {
                    largeAvatar.innerHTML = '';
                    largeAvatar.textContent = buildAvatarInitials(displayName);
                    applyFallbackAvatarTint(largeAvatar, displayName);
                };
                largeAvatar.appendChild(img);
            } else {
                largeAvatar.textContent = buildAvatarInitials(displayName);
                applyFallbackAvatarTint(largeAvatar, displayName);
            }
        }
    }

    const lastSeenEl = document.getElementById('profileLastSeen');
    if (lastSeenEl) {
        if (isSavedMessagesProfile) {
            const messageCountLabel = formatSavedMessageCountLabel(payload?._message_count);
            lastSeenEl.dataset.savedMessagesProfile = '1';
            lastSeenEl.dataset.messageCountLabel = messageCountLabel;
            lastSeenEl.dataset.lastSeenRaw = '';
            lastSeenEl.dataset.statusHidden = '0';
            lastSeenEl.dataset.isOnline = '0';
            lastSeenEl.textContent = messageCountLabel;
        } else {
            lastSeenEl.dataset.savedMessagesProfile = '0';
            lastSeenEl.dataset.messageCountLabel = '';
            const blocked = typeof isChatBlocked === 'function' ? isChatBlocked() : false;
            lastSeenEl.dataset.lastSeenRaw = String(payload.last_seen || '');
            lastSeenEl.dataset.statusHidden = payload.restricted || blocked ? '1' : '0';
            lastSeenEl.dataset.isOnline = payload.online ? '1' : '0';
            if (payload.restricted || blocked) {
                lastSeenEl.textContent = tr('\u0441\u0442\u0430\u0442\u0443\u0441 \u0441\u043A\u0440\u044B\u0442');
            } else if (payload.online) {
                lastSeenEl.textContent = tr('\u0432 \u0441\u0435\u0442\u0438');
            } else {
                lastSeenEl.textContent = formatLastSeenText(payload.last_seen);
            }
        }
    }

    if (profileOnlineDot) {
        if (isSavedMessagesProfile) {
            profileOnlineDot.classList.remove('active');
            ensureProfileLocaleListener();
            refreshProfileLocaleBindings();
            return;
        }
        const blocked = typeof isChatBlocked === 'function' ? isChatBlocked() : false;
        profileOnlineDot.classList.toggle('active', Boolean(payload.online) && !payload.restricted && !blocked);
    }
    ensureProfileLocaleListener();
    refreshProfileLocaleBindings();
}

export function renderProfileStats(statsPayload) {
    const stats = statsPayload || {};
    const photosEl = document.getElementById('statPhotos');
    const filesEl = document.getElementById('statFiles');
    const linksEl = document.getElementById('statLinks');
    if (photosEl) photosEl.textContent = Number(stats.photos || 0);
    if (filesEl) filesEl.textContent = Number(stats.files || 0);
    if (linksEl) linksEl.textContent = Number(stats.links || 0);
}

export function renderProfileBio(profile) {
    const bioLine = document.getElementById('profileBioLine');
    const bioEl = document.getElementById('profileMetaBio');
    if (!bioLine || !bioEl) return;

    const bio = String(profile?.bio || '').trim();
    bioEl.textContent = bio;
    bioLine.classList.toggle('profile-info-line--hidden', !bio);
    bioLine.style.display = bio ? '' : 'none';
}

export function renderProfileMeta(profile, { metaUsername, metaCreatedAt, metaUserId, currentPartnerId } = {}) {
    if (!metaUsername || !metaCreatedAt || !metaUserId) return;
    metaUsername.textContent = profile?.username ? `@${profile.username}` : '@unknown';
    metaCreatedAt.dataset.createdAtRaw = String(profile?.created_at || '');
    metaCreatedAt.textContent = formatRegistrationDate(profile?.created_at);
    metaUserId.textContent = String(profile?.user_id || profile?.userId || currentPartnerId || '—');
    ensureProfileLocaleListener();
    refreshProfileLocaleBindings();
}

export function renderPartnerProfile(profilePayload, {
    existingProfile = {},
    currentPartnerId = null,
    isChatBlocked,
    profileOnlineDot,
    metaUsername,
    metaCreatedAt,
    metaUserId,
    onRendered,
} = {}) {
    const stats = profilePayload?.stats || { photos: 0, files: 0, links: 0 };
    const merged = {
        ...(existingProfile || {}),
        ...profilePayload,
        stats,
        userId: Number(profilePayload?.user_id || profilePayload?.userId || currentPartnerId || 0) || null,
    };
    const profileDrawer = document.getElementById('partnerProfileDrawer');
    profileDrawer?.classList.toggle('is-saved-messages-profile', merged._saved_messages_profile === true);

    renderProfileHeader(merged, { isChatBlocked, profileOnlineDot });
    renderProfileStats(stats);
    renderProfileMeta(merged, {
        metaUsername,
        metaCreatedAt,
        metaUserId,
        currentPartnerId,
    });
    renderProfileBio(merged);

    if (typeof onRendered === 'function') {
        onRendered(merged);
    }

    return merged;
}

export async function handleProfileAction(action, {
    currentProfile = {},
    closeDrawer,
    isChatBlocked,
    scheduleComposerFocus,
    copyTextToClipboard,
    showToast,
} = {}) {
    const profile = currentProfile || {};

    if (action === 'message') {
        closeDrawer?.();
        if (!(typeof isChatBlocked === 'function' && isChatBlocked())) {
            scheduleComposerFocus?.({ force: true });
        }
        return;
    }

    if (action === 'share') {
        const username = profile.username ? `@${profile.username}` : (profile.display_name || '\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C');
        const shareText = `\u041A\u043E\u043D\u0442\u0430\u043A\u0442 \u0432 SUN Messenger: ${username}`;
        const copied = await copyTextToClipboard?.(shareText);
        showToast?.(
            copied ? '\u041A\u043E\u043D\u0442\u0430\u043A\u0442 \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D \u0432 \u0431\u0443\u0444\u0435\u0440 \u043E\u0431\u043C\u0435\u043D\u0430.' : '\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043A\u043E\u043D\u0442\u0430\u043A\u0442.',
            copied ? 'success' : 'warning',
        );
        return;
    }

    if (action === 'copy-username') {
        const username = profile.username ? `@${profile.username}` : '';
        if (!username) {
            showToast?.('Username \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D.', 'warning');
            return;
        }
        const copied = await copyTextToClipboard?.(username);
        showToast?.(
            copied ? 'Username \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D.' : '\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C username.',
            copied ? 'success' : 'warning',
        );
        return;
    }

    if (action === 'mute') {
        const muteBtn = document.getElementById('muteChatBtn');
        if (muteBtn) {
            muteBtn.click();
        } else {
            showToast?.('\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0435\u0440\u0435\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u0443\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u044F.', 'warning');
        }
        return;
    }

    if (action === 'more') {
        showToast?.('\u0414\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F \u043F\u043E\u044F\u0432\u044F\u0442\u0441\u044F \u0432 \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u043C \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0438.', 'info');
    }
}
