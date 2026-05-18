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

const TIME_FORMAT_STORAGE_KEY = 'sun_time_format_v1';

function readTimeFormat() {
    try {
        return String(window.localStorage.getItem(TIME_FORMAT_STORAGE_KEY) || '').trim().toLowerCase() === '12h'
            ? '12h'
            : '24h';
    } catch (_) {
        return '24h';
    }
}

function buildTimeFormatOptions() {
    return {
        hour: '2-digit',
        minute: '2-digit',
        hour12: readTimeFormat() === '12h',
    };
}

let profileLocaleListenerBound = false;
let profileSpotifyProgressFrame = 0;
let profileSpotifyVisibilityTimer = 0;

function stopProfileSpotifyProgressTimer() {
    if (!profileSpotifyProgressFrame) return;
    window.cancelAnimationFrame(profileSpotifyProgressFrame);
    profileSpotifyProgressFrame = 0;
}

function updateProfileSpotifyProgress() {
    const card = document.getElementById('profileSpotifyStatusCard');
    const fillEl = document.getElementById('profileSpotifyBarFill');
    if (!card || !fillEl || card.hidden) {
        stopProfileSpotifyProgressTimer();
        return;
    }

    const durationMs = Number(card.dataset.spotifyDurationMs || 0);
    const progressMs = Number(card.dataset.spotifyProgressMs || 0);
    const updatedAtMs = Number(card.dataset.spotifyUpdatedAtMs || 0);
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
        fillEl.style.width = '0%';
        return;
    }

    const elapsedMs = updatedAtMs > 0 ? Math.max(0, Date.now() - updatedAtMs) : 0;
    const liveProgressMs = Math.min(durationMs, Math.max(0, progressMs + elapsedMs));
    const progressPct = Math.min(100, (liveProgressMs / durationMs) * 100);
    fillEl.style.width = `${progressPct.toFixed(3)}%`;
    profileSpotifyProgressFrame = window.requestAnimationFrame(updateProfileSpotifyProgress);
}

function startProfileSpotifyProgressTimer() {
    stopProfileSpotifyProgressTimer();
    profileSpotifyProgressFrame = window.requestAnimationFrame(updateProfileSpotifyProgress);
}

function clearProfileSpotifyVisibilityTimer() {
    if (!profileSpotifyVisibilityTimer) return;
    window.clearTimeout(profileSpotifyVisibilityTimer);
    profileSpotifyVisibilityTimer = 0;
}

function showProfileSpotifyCard(card) {
    clearProfileSpotifyVisibilityTimer();
    if (!card.hidden && !card.classList.contains('profile-spotify-card--hiding')) return;

    card.hidden = false;
    card.setAttribute('aria-hidden', 'false');
    card.classList.remove('profile-spotify-card--hiding');
    card.classList.add('profile-spotify-card--revealing');
    card.style.height = '0px';
    card.style.opacity = '0';
    card.style.transform = 'translateY(-6px)';

    window.requestAnimationFrame(() => {
        card.style.height = `${card.scrollHeight}px`;
        card.style.opacity = '1';
        card.style.transform = 'translateY(0)';
    });

    profileSpotifyVisibilityTimer = window.setTimeout(() => {
        card.classList.remove('profile-spotify-card--revealing');
        card.style.removeProperty('height');
        card.style.removeProperty('opacity');
        card.style.removeProperty('transform');
        profileSpotifyVisibilityTimer = 0;
    }, 260);
}

function hideProfileSpotifyCard(card) {
    stopProfileSpotifyProgressTimer();
    clearProfileSpotifyVisibilityTimer();
    card.setAttribute('aria-hidden', 'true');
    if (card.hidden) return;

    card.classList.remove('profile-spotify-card--revealing');
    card.classList.add('profile-spotify-card--hiding');
    card.style.height = `${card.scrollHeight}px`;
    card.style.opacity = '1';
    card.style.transform = 'translateY(0)';

    window.requestAnimationFrame(() => {
        card.style.height = '0px';
        card.style.opacity = '0';
        card.style.transform = 'translateY(-6px)';
    });

    profileSpotifyVisibilityTimer = window.setTimeout(() => {
        card.hidden = true;
        card.classList.remove('profile-spotify-card--hiding');
        card.style.removeProperty('height');
        card.style.removeProperty('opacity');
        card.style.removeProperty('transform');
        profileSpotifyVisibilityTimer = 0;
    }, 260);
}

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
    window.addEventListener('sun-time-format-changed', refreshProfileLocaleBindings);
    profileLocaleListenerBound = true;
}

function ensureProfileHeroUsernameElement() {
    const heroEl = document.querySelector('#partnerProfileDrawer .profile-hero');
    if (!heroEl) return null;

    let usernameEl = heroEl.querySelector('#profileHeroUsername');
    if (!usernameEl) {
        usernameEl = document.createElement('div');
        usernameEl.id = 'profileHeroUsername';
        usernameEl.className = 'profile-hero-username profile-hero-username--hidden';

        const statusEl = heroEl.querySelector('#profileLastSeen');
        if (statusEl && statusEl.parentNode === heroEl) {
            heroEl.insertBefore(usernameEl, statusEl);
        } else {
            heroEl.appendChild(usernameEl);
        }
    }

    return usernameEl;
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
    let suppressFocusRestore = false;
    let layoutFreezeToken = 0;

    function isMobileTouchViewport() {
        try {
            return window.matchMedia('(max-width: 768px)').matches
                && window.matchMedia('(pointer: coarse)').matches;
        } catch (_) {
            return false;
        }
    }

    function isComposerElement(element) {
        return element instanceof Element
            && Boolean(element.closest('#messageForm, #composerRow'));
    }

    function getVisualViewportKeyboardHeight() {
        const viewport = window.visualViewport;
        if (!viewport) return 0;

        const layoutHeight = Math.round(
            window.innerHeight
            || document.documentElement?.clientHeight
            || viewport.height
            || 0
        );
        const viewportBottom = Math.round((viewport.offsetTop || 0) + (viewport.height || 0));
        return Math.max(0, layoutHeight - viewportBottom);
    }

    function isKeyboardTransitionLikely(activeElement) {
        if (isComposerElement(activeElement)) return true;

        const viewport = window.visualViewport;
        if (!viewport) return false;

        const keyboardHeight = getVisualViewportKeyboardHeight();
        if (keyboardHeight >= 80) return true;

        const screenHeight = Math.round(window.screen?.height || 0);
        const viewportHeight = Math.round(viewport.height || 0);
        return screenHeight > 0
            && viewportHeight > 0
            && screenHeight - viewportHeight >= Math.max(160, Math.round(screenHeight * 0.22));
    }

    function freezeChatLayoutForKeyboardDismiss(activeElement) {
        if (!chatArea || !isMobileTouchViewport() || !isKeyboardTransitionLikely(activeElement)) return 0;

        const messagesEl = document.getElementById('chatMessages') || chatArea.querySelector('.chat-messages');
        const inputEl = document.getElementById('chatInputArea') || chatArea.querySelector('.chat-input-area');
        if (!messagesEl || !inputEl) return 0;

        const areaRect = chatArea.getBoundingClientRect();
        const messagesRect = messagesEl.getBoundingClientRect();
        const inputRect = inputEl.getBoundingClientRect();
        if (areaRect.width <= 0 || areaRect.height <= 0 || inputRect.height <= 0) return 0;

        const px = (value) => `${Math.max(0, Math.round(value))}px`;
        chatArea.style.setProperty('--profile-freeze-messages-top', px(messagesRect.top - areaRect.top));
        chatArea.style.setProperty('--profile-freeze-messages-height', px(messagesRect.height));
        chatArea.style.setProperty('--profile-freeze-composer-top', px(inputRect.top - areaRect.top));
        chatArea.style.setProperty('--profile-freeze-composer-left', px(inputRect.left - areaRect.left));
        chatArea.style.setProperty('--profile-freeze-composer-right', px(areaRect.right - inputRect.right));
        chatArea.style.setProperty('--profile-freeze-composer-height', px(inputRect.height));
        chatArea.classList.add('is-profile-drawer-layout-frozen');

        layoutFreezeToken += 1;
        return layoutFreezeToken;
    }

    function releaseChatLayoutFreeze(token = layoutFreezeToken) {
        if (!chatArea || !token || token !== layoutFreezeToken) return;
        chatArea.classList.remove('is-profile-drawer-layout-frozen');
        chatArea.style.removeProperty('--profile-freeze-messages-top');
        chatArea.style.removeProperty('--profile-freeze-messages-height');
        chatArea.style.removeProperty('--profile-freeze-composer-top');
        chatArea.style.removeProperty('--profile-freeze-composer-left');
        chatArea.style.removeProperty('--profile-freeze-composer-right');
        chatArea.style.removeProperty('--profile-freeze-composer-height');
    }

    function blurComposerForProfile(activeElement) {
        if (!isMobileTouchViewport() || !isComposerElement(activeElement)) return false;
        try {
            activeElement.blur();
            return true;
        } catch (_) {
            return false;
        }
    }

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
        document.getElementById('messageContextMenu')?.dispatchEvent(
            new CustomEvent('sun:context-menu-hide', { detail: { immediate: true } })
        );
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
        const freezeToken = freezeChatLayoutForKeyboardDismiss(lastFocusedElement);
        suppressFocusRestore = blurComposerForProfile(lastFocusedElement);
        drawer.hidden = false;
        drawer.removeAttribute('hidden');
        drawer.classList.remove('active', 'is-closing', 'is-profile-opening');
        drawer.classList.add('is-opening', 'is-profile-opening');
        drawer.removeAttribute('inert');
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
                    if (openSeq === transitionSeq) {
                        drawer.classList.remove('is-profile-opening');
                    }
                    releaseChatLayoutFreeze(freezeToken);
                });
            });
        });
    }

    function close() {
        if (!drawer) return Promise.resolve(false);
        if (phase === 'closing' && transitionPromise) return transitionPromise;
        if (!drawer.classList.contains('active') && phase === 'closed') {
            drawer.hidden = true;
            drawer.setAttribute('aria-hidden', 'true');
            drawer.setAttribute('inert', '');
            setChatProfileMotionState('closed');
            return Promise.resolve(false);
        }

        const closeSeq = ++transitionSeq;
        phase = 'closing';
        clearContentReveal();
        releaseChatLayoutFreeze();
        sheet?.classList.remove('is-dragging');
        chatArea?.classList.remove('is-profile-drawer-dragging');
        drawer.classList.add('is-closing');
        drawer.classList.remove('is-profile-opening');
        drawer.setAttribute('inert', '');
        drawer.setAttribute('aria-hidden', 'true');
        setChatProfileMotionState('closing');

        const target = sheet || drawer;
        const waitMs = getTransitionMs(target, 280);
        transitionPromise = waitForAnimationEnd(target, waitMs).then(() => {
            if (closeSeq !== transitionSeq) return false;
            drawer.classList.remove('active', 'is-closing', 'is-opening', 'is-profile-opening');
            drawer.hidden = true;
            drawer.setAttribute('hidden', '');
            resetDragState();
            setChatProfileMotionState('closed');
            phase = 'closed';
            transitionPromise = null;

            if (!suppressFocusRestore && lastFocusedElement instanceof HTMLElement && document.contains(lastFocusedElement)) {
                try { lastFocusedElement.focus({ preventScroll: true }); } catch (_) {}
            }
            lastFocusedElement = null;
            suppressFocusRestore = false;
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
    const timePart = date.toLocaleTimeString(activeLocale(), buildTimeFormatOptions());
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
    const isGroupProfile = payload._group_profile === true;
    const largeAvatar = document.getElementById('profileLargeAvatar');
    const nameEl = document.getElementById('profileDisplayName');
    const userEl = document.getElementById('profileMetaUsername');
    const usernameLine = document.getElementById('profileUsernameLine');

    if (nameEl) nameEl.textContent = displayName;

    const showUsername = !isSavedMessagesProfile && !isGroupProfile && !!username;
    if (userEl) userEl.textContent = showUsername ? username : '';
    if (usernameLine) usernameLine.classList.toggle('profile-info-line--hidden', !showUsername);

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

function toggleProfileLineVisibility(lineEl, isVisible) {
    if (!lineEl) return;
    lineEl.classList.toggle('profile-info-line--hidden', !isVisible);
    lineEl.style.display = isVisible ? '' : 'none';
}

function setProfileLineInteractive(lineEl, isInteractive) {
    if (!lineEl) return;
    lineEl.classList.toggle('profile-info-line--disabled', !isInteractive);
    if (isInteractive) {
        lineEl.setAttribute('role', 'button');
        lineEl.setAttribute('tabindex', '0');
        lineEl.setAttribute('data-profile-action', 'send-request');
    } else {
        lineEl.removeAttribute('role');
        lineEl.removeAttribute('tabindex');
        lineEl.removeAttribute('data-profile-action');
    }
}

export function renderProfileContactAccess(profile) {
    const requestLine = document.getElementById('profileRequestLine');
    const requestValue = document.getElementById('profileRequestValue');
    const requestLabel = document.getElementById('profileRequestLabel');
    const privateLine = document.getElementById('profilePrivateLine');
    const privateValue = document.getElementById('profilePrivateValue');
    const privateLabel = document.getElementById('profilePrivateLabel');
    if (!requestLine || !privateLine) return;

    const payload = profile || {};
    const isSavedMessagesProfile = payload._saved_messages_profile === true;
    const isGroupProfile = payload._group_profile === true;
    const isContact = Boolean(payload.is_contact);
    const isPrivateProfile = Boolean(payload.private_profile);
    const isBlocked = Boolean(payload.block_state?.is_blocked);
    const requestAlreadySent = Boolean(payload.request_sent || payload.request_pending);
    const canSendRequest = Boolean(payload.can_send_request) && !requestAlreadySent;

    toggleProfileLineVisibility(requestLine, false);
    toggleProfileLineVisibility(privateLine, false);

    if (isSavedMessagesProfile || isGroupProfile) return;

    if (isPrivateProfile) {
        if (privateValue) privateValue.textContent = 'Профиль закрыт';
        if (privateLabel) privateLabel.textContent = 'Запросы недоступны';
        privateLine.classList.add('profile-info-line--disabled');
        toggleProfileLineVisibility(privateLine, true);
        return;
    }

    if (isBlocked || isContact) return;

    if (canSendRequest || requestAlreadySent) {
        if (requestValue) {
            requestValue.textContent = requestAlreadySent
                ? 'Запрос отправлен'
                : 'Отправить запрос';
        }
        if (requestLabel) {
            requestLabel.textContent = requestAlreadySent
                ? 'Ожидает подтверждения'
                : 'Пользователь не в контактах';
        }
        setProfileLineInteractive(requestLine, canSendRequest);
        toggleProfileLineVisibility(requestLine, true);
    }
}

export function renderProfileMeta(profile, { metaUsername, metaCreatedAt, metaUserId, currentPartnerId } = {}) {
    if (!metaUsername || !metaCreatedAt || !metaUserId) return;
    metaUsername.textContent = profile?.username || '';
    metaCreatedAt.dataset.createdAtRaw = String(profile?.created_at || '');
    metaCreatedAt.textContent = formatRegistrationDate(profile?.created_at);
    metaUserId.textContent = String(profile?.user_id || profile?.userId || currentPartnerId || '—');
    ensureProfileLocaleListener();
    refreshProfileLocaleBindings();
}

let _spotifyActionsInitialized = false;

function _getCsrfToken() {
    try {
        const meta = document.querySelector('meta[name="csrf-token"]');
        if (meta) return meta.getAttribute('content') || '';
        const el = document.getElementById('csrfToken');
        return el ? (el.value || el.dataset.csrfToken || '') : '';
    } catch (_) {
        return '';
    }
}

async function _spotifyPost(url, body) {
    const resp = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': _getCsrfToken(),
        },
        body: JSON.stringify(body),
    });
    return resp;
}

function _initSpotifyActions() {
    if (_spotifyActionsInitialized) return;
    _spotifyActionsInitialized = true;

    const saveBtn = document.getElementById('profileSpotifySaveBtn');
    const queueBtn = document.getElementById('profileSpotifyQueueBtn');
    const playlistBtn = document.getElementById('profileSpotifyPlaylistBtn');
    const playlistPicker = document.getElementById('profileSpotifyPlaylistPicker');
    const playlistList = document.getElementById('profileSpotifyPlaylistList');
    const playlistClose = document.getElementById('profileSpotifyPlaylistClose');

    function getTrackId() {
        return document.getElementById('profileSpotifyStatusCard')?.dataset?.spotifyTrackId || '';
    }

    function flashBtn(btn, ok) {
        const orig = btn.querySelector('span:last-child')?.textContent;
        if (!orig) return;
        btn.querySelector('span:last-child').textContent = ok ? '✓' : '✗';
        setTimeout(() => {
            if (btn.querySelector('span:last-child')) {
                btn.querySelector('span:last-child').textContent = orig;
            }
            btn.disabled = false;
        }, 1800);
    }

    saveBtn?.addEventListener('click', async () => {
        const trackId = getTrackId();
        if (!trackId) return;
        saveBtn.disabled = true;
        try {
            const resp = await _spotifyPost('/spotify/track/save', { track_id: trackId });
            flashBtn(saveBtn, resp.ok);
        } catch (_) {
            flashBtn(saveBtn, false);
        }
    });

    queueBtn?.addEventListener('click', async () => {
        const trackId = getTrackId();
        if (!trackId) return;
        queueBtn.disabled = true;
        try {
            const resp = await _spotifyPost('/spotify/track/queue', { track_id: trackId });
            flashBtn(queueBtn, resp.ok);
        } catch (_) {
            flashBtn(queueBtn, false);
        }
    });

    playlistBtn?.addEventListener('click', async () => {
        if (!playlistPicker || !playlistList) return;
        playlistPicker.hidden = false;
        playlistList.textContent = '';
        const loadingEl = document.createElement('div');
        loadingEl.style.cssText = 'padding:8px 10px;color:var(--sub-text);font-size:13px;';
        loadingEl.textContent = 'Загрузка…';
        playlistList.appendChild(loadingEl);

        try {
            const resp = await fetch('/spotify/playlists', { credentials: 'same-origin' });
            const data = await resp.json();
            playlistList.textContent = '';
            const playlists = data.playlists || [];
            if (!playlists.length) {
                const empty = document.createElement('div');
                empty.style.cssText = 'padding:8px 10px;color:var(--sub-text);font-size:13px;';
                empty.textContent = 'Плейлисты не найдены';
                playlistList.appendChild(empty);
                return;
            }
            playlists.forEach(pl => {
                const item = document.createElement('div');
                item.className = 'profile-spotify-playlist-item';
                item.textContent = pl.name;
                item.addEventListener('click', async () => {
                    const trackId = getTrackId();
                    if (!trackId) return;
                    item.style.opacity = '0.5';
                    try {
                        await _spotifyPost('/spotify/track/playlist', {
                            track_id: trackId,
                            playlist_id: pl.id,
                        });
                    } catch (_) { /* ignore */ }
                    playlistPicker.hidden = true;
                });
                playlistList.appendChild(item);
            });
        } catch (_) {
            playlistList.textContent = '';
            const errEl = document.createElement('div');
            errEl.style.cssText = 'padding:8px 10px;color:var(--sub-text);font-size:13px;';
            errEl.textContent = 'Ошибка загрузки';
            playlistList.appendChild(errEl);
        }
    });

    playlistClose?.addEventListener('click', () => {
        if (playlistPicker) playlistPicker.hidden = true;
    });
}

export function renderProfileSpotifyStatus(profile) {
    const card = document.getElementById('profileSpotifyStatusCard');
    if (!card) return;

    const sp = profile?.spotify_status;
    const isPlaying = sp?.is_playing === true;

    if (!isPlaying) {
        hideProfileSpotifyCard(card);
        const actionsEl = document.getElementById('profileSpotifyActions');
        if (actionsEl) actionsEl.hidden = true;
        const pickerEl = document.getElementById('profileSpotifyPlaylistPicker');
        if (pickerEl) pickerEl.hidden = true;
        return;
    }

    const trackEl = document.getElementById('profileSpotifyTrack');
    const artistEl = document.getElementById('profileSpotifyArtist');
    const artEl = document.getElementById('profileSpotifyArt');
    const linkEl = document.getElementById('profileSpotifyTrackLink');
    const fillEl = document.getElementById('profileSpotifyBarFill');

    if (trackEl) trackEl.textContent = sp.track || '';
    if (artistEl) artistEl.textContent = sp.artist || '';

    if (artEl) {
        if (sp.album_art_url) {
            artEl.onerror = () => { artEl.removeAttribute('src'); };
            artEl.src = sp.album_art_url;
            artEl.alt = '';
        } else {
            artEl.removeAttribute('src');
            artEl.alt = '';
        }
    }

    if (linkEl) {
        if (sp.spotify_url) {
            linkEl.href = sp.spotify_url;
        } else {
            linkEl.removeAttribute('href');
        }
    }

    card.dataset.spotifyProgressMs = String(Math.max(0, Number(sp.progress_ms) || 0));
    card.dataset.spotifyDurationMs = String(Math.max(0, Number(sp.duration_ms) || 0));
    card.dataset.spotifyUpdatedAtMs = String(Math.max(0, Number(sp.updated_at) || 0) * 1000);
    card.dataset.spotifyTrackId = String(sp.track_id || '');

    // Show action buttons only if current user has Spotify connected (track_id present)
    const actionsEl = document.getElementById('profileSpotifyActions');
    if (actionsEl) {
        actionsEl.hidden = !sp.track_id;
        if (sp.track_id) _initSpotifyActions();
    }

    showProfileSpotifyCard(card);
    if (fillEl) startProfileSpotifyProgressTimer();
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
    renderProfileContactAccess(merged);
    renderProfileSpotifyStatus(merged);

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
    sendContactRequest,
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

    if (action === 'send-request') {
        const targetUserId = Number(profile?.user_id || profile?.userId || 0);
        if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
            console.warn('[ProfileDrawer] invalid request target user id');
            return;
        }
        if (!profile?.can_send_request) {
            console.warn('[ProfileDrawer] request is unavailable for this profile');
            return;
        }
        const sent = await sendContactRequest?.({
            userId: targetUserId,
            displayName: profile?.display_name || profile?.username || 'пользователь',
        });
        if (sent) {
            profile.can_send_request = false;
            profile.request_sent = true;
            renderProfileContactAccess(profile);
        }
        return;
    }

    if (action === 'more') {
        showToast?.('\u0414\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F \u043F\u043E\u044F\u0432\u044F\u0442\u0441\u044F \u0432 \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u043C \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0438.', 'info');
    }
}
