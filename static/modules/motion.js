const DEFAULT_MOTION_TIMEOUT_MS = 280;
const DEFAULT_MOTION_DEBUG_STORAGE_KEY = 'sun_motion_debug';
const DEFAULT_STAGGER_LIMIT = 24;
const DEFAULT_STAGGER_STEP_MS = 18;
const DEFAULT_STAGGER_START_MS = 60;
const DEFAULT_VELOCITY_PX_PER_MS = 0.16;

let motionDebugPanelEl = null;
let motionDebugTimerId = 0;
let motionDebugBound = false;

function parseNumber(value, fallback = 0) {
    const parsed = Number.parseFloat(String(value ?? '').trim());
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function prefersReducedMotion() {
    if (document.documentElement.classList.contains('perf-lite')) return true;
    if (getMotionLevel() !== 'lite') return false;
    try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (_) {
        return false;
    }
}

export function afterNextFrame(callback) {
    window.requestAnimationFrame(() => {
        window.requestAnimationFrame(callback);
    });
}

function parseTimeMs(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return 0;
    if (text.endsWith('ms')) {
        const ms = Number.parseFloat(text.slice(0, -2));
        return Number.isFinite(ms) ? Math.max(0, ms) : 0;
    }
    if (text.endsWith('s')) {
        const seconds = Number.parseFloat(text.slice(0, -1));
        return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : 0;
    }
    const parsed = Number.parseFloat(text);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function readRootMotionToken(tokenName) {
    if (!tokenName) return '';
    try {
        const rootStyle = window.getComputedStyle(document.documentElement);
        return String(rootStyle.getPropertyValue(tokenName) || '').trim();
    } catch (_) {
        return '';
    }
}

function parseLengthPx(value, fallbackPx = 0) {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return fallbackPx;
    if (text.endsWith('px')) {
        const px = Number.parseFloat(text.slice(0, -2));
        return Number.isFinite(px) ? px : fallbackPx;
    }
    const parsed = Number.parseFloat(text);
    return Number.isFinite(parsed) ? parsed : fallbackPx;
}

export function getMotionDurationTokenMs(tokenName, fallbackMs = DEFAULT_MOTION_TIMEOUT_MS) {
    const parsed = parseTimeMs(readRootMotionToken(tokenName));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
}

export function getMotionDelayTokenMs(tokenName, fallbackMs = 0) {
    const parsed = parseTimeMs(readRootMotionToken(tokenName));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallbackMs;
}

export function getMotionEasingToken(tokenName, fallbackValue = 'cubic-bezier(.4,0,.2,1)') {
    const tokenValue = readRootMotionToken(tokenName);
    return tokenValue || fallbackValue;
}

export function getMotionDistanceTokenPx(tokenName, fallbackPx = 0) {
    return parseLengthPx(readRootMotionToken(tokenName), fallbackPx);
}

export function getMotionLevel() {
    const level = String(
        document.documentElement.getAttribute('data-motion-level')
        || window.SUN_MOTION?.level
        || 'full'
    ).trim().toLowerCase();
    if (level === 'lite' || level === 'balanced' || level === 'full') return level;
    return 'full';
}

export function setMotionLevel(level = 'full', { persist = true } = {}) {
    const normalized = String(level || 'full').trim().toLowerCase();
    const safeLevel = normalized === 'lite' || normalized === 'balanced' || normalized === 'full'
        ? normalized
        : 'full';
    document.documentElement.setAttribute('data-motion-level', safeLevel);
    window.SUN_MOTION = {
        ...(window.SUN_MOTION || {}),
        level: safeLevel,
        preference: safeLevel,
        forceAnimations: safeLevel !== 'lite',
    };
    if (persist) {
        try {
            localStorage.setItem('sun_motion_level', safeLevel);
        } catch (_) {}
    }
    renderMotionDebugPanel();
    return safeLevel;
}

export function isBalancedMotionLevel() {
    return getMotionLevel() === 'balanced';
}

export function isLiteMotionLevel() {
    return getMotionLevel() === 'lite';
}

export function getMotionVelocityPxPerMs() {
    const raw = readRootMotionToken('--motion-velocity-px-per-ms');
    return Math.max(0.05, parseNumber(raw, DEFAULT_VELOCITY_PX_PER_MS));
}

export function getVelocityAwareDurationMs(distancePx, {
    minToken = '--motion-duration-fast',
    maxToken = '--motion-duration-emphasis',
    fallbackMinMs = 200,
    fallbackMaxMs = 500,
    pxPerMs = null,
} = {}) {
    const minMs = getMotionDurationTokenMs(minToken, fallbackMinMs);
    const maxMs = getMotionDurationTokenMs(maxToken, fallbackMaxMs);
    const absDistance = Math.max(0, Math.abs(Number(distancePx) || 0));
    if (absDistance <= 0) return minMs;
    const velocity = pxPerMs == null ? getMotionVelocityPxPerMs() : Math.max(0.05, Number(pxPerMs) || DEFAULT_VELOCITY_PX_PER_MS);
    const byDistance = absDistance / velocity;
    return Math.round(Math.min(maxMs, Math.max(minMs, byDistance)));
}

export function getMotionStaggerStepMs() {
    return getMotionDelayTokenMs('--motion-stagger-step', DEFAULT_STAGGER_STEP_MS);
}

export function getMotionStaggerStartMs() {
    return getMotionDelayTokenMs('--motion-stagger-start', DEFAULT_STAGGER_START_MS);
}

export function getMotionListAnimateLimit() {
    const raw = readRootMotionToken('--motion-list-animate-limit');
    const parsed = Number.parseInt(String(raw || ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_STAGGER_LIMIT;
}

export function shouldAnimateListItem(index, total = 0) {
    const safeIndex = Math.max(0, Number(index) || 0);
    const safeTotal = Math.max(0, Number(total) || 0);
    const baseLimit = getMotionListAnimateLimit();
    const level = getMotionLevel();
    const levelLimit = level === 'lite'
        ? Math.max(4, Math.floor(baseLimit * 0.33))
        : level === 'balanced'
            ? Math.max(8, Math.floor(baseLimit * 0.66))
            : baseLimit;
    if (safeTotal <= 0) return safeIndex < levelLimit;
    return safeIndex < Math.min(levelLimit, safeTotal);
}

export function applyStaggerDelays(elements, {
    baseMs = null,
    stepMs = null,
    propertyName = '--motion-item-delay',
    clear = false,
} = {}) {
    const list = Array.from(elements || []);
    if (!list.length) return;
    if (clear) {
        list.forEach((el) => el?.style?.removeProperty(propertyName));
        return;
    }
    const safeBase = baseMs == null ? getMotionStaggerStartMs() : Math.max(0, Number(baseMs) || 0);
    const safeStep = stepMs == null ? getMotionStaggerStepMs() : Math.max(0, Number(stepMs) || 0);
    list.forEach((el, index) => {
        if (!(el instanceof HTMLElement)) return;
        if (!shouldAnimateListItem(index, list.length)) {
            el.style.setProperty(propertyName, '0ms');
            return;
        }
        const delay = safeBase + (safeStep * index);
        el.style.setProperty(propertyName, `${Math.max(0, Math.round(delay))}ms`);
    });
}

export function applyStaggerToChildren(container, {
    selector = ':scope > *',
    propertyName = '--motion-item-delay',
} = {}) {
    if (!(container instanceof Element)) return;
    const items = Array.from(container.querySelectorAll(selector));
    applyStaggerDelays(items, { propertyName });
}

export function applyListPerfGuard(container, {
    total = null,
    dataAttr = 'data-motion-list-guard',
} = {}) {
    if (!(container instanceof HTMLElement)) return;
    const count = Number.isFinite(Number(total))
        ? Math.max(0, Number(total))
        : container.children.length;
    const level = getMotionLevel();
    const hardLimit = getMotionListAnimateLimit();
    const threshold = level === 'lite'
        ? Math.max(8, Math.floor(hardLimit * 0.8))
        : level === 'balanced'
            ? Math.max(12, hardLimit)
            : Math.max(18, hardLimit + 10);
    if (count > threshold) {
        container.classList.add('motion-list-guard');
        container.setAttribute(dataAttr, '1');
    } else {
        container.classList.remove('motion-list-guard');
        container.removeAttribute(dataAttr);
    }
}

export function getMotionDurationMs(element, fallbackMs = DEFAULT_MOTION_TIMEOUT_MS) {
    if (!element || prefersReducedMotion()) return 0;
    const style = window.getComputedStyle(element);
    const transitionDurations = String(style.transitionDuration || '').split(',').map(parseTimeMs);
    const transitionDelays = String(style.transitionDelay || '').split(',').map(parseTimeMs);
    const animationDurations = String(style.animationDuration || '').split(',').map(parseTimeMs);
    const animationDelays = String(style.animationDelay || '').split(',').map(parseTimeMs);
    const transitionMax = Math.max(0, ...transitionDurations) + Math.max(0, ...transitionDelays);
    const animationMax = Math.max(0, ...animationDurations) + Math.max(0, ...animationDelays);
    return Math.max(transitionMax, animationMax, fallbackMs);
}

export function waitForMotionEnd(element, fallbackMs = DEFAULT_MOTION_TIMEOUT_MS) {
    const timeoutMs = getMotionDurationMs(element, fallbackMs);
    if (!element || timeoutMs <= 0) return Promise.resolve();

    return new Promise((resolve) => {
        let settled = false;
        let timeoutId = 0;

        const finish = () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeoutId);
            element.removeEventListener('transitionend', onEnd);
            element.removeEventListener('animationend', onEnd);
            resolve();
        };

        const onEnd = (event) => {
            if (event.target !== element) return;
            finish();
        };

        element.addEventListener('transitionend', onEnd);
        element.addEventListener('animationend', onEnd);
        timeoutId = window.setTimeout(finish, timeoutMs + 60);
    });
}

export function setMotionOriginFromPoint(element, clientX, clientY) {
    if (!element || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100));
    element.style.setProperty('--m-origin-x', `${x.toFixed(1)}%`);
    element.style.setProperty('--m-origin-y', `${y.toFixed(1)}%`);
}

export function animateSearchPanelEntry(panel, direction = 1) {
    if (!panel || prefersReducedMotion() || typeof panel.animate !== 'function') return null;
    const offsetMagnitude = getMotionDistanceTokenPx('--motion-distance-lg', 24);
    const offset = direction >= 0 ? offsetMagnitude : -offsetMagnitude;
    const duration = getVelocityAwareDurationMs(offsetMagnitude, {
        minToken: '--motion-duration-fast',
        maxToken: '--motion-duration-medium',
        fallbackMinMs: 200,
        fallbackMaxMs: 300,
    });
    return panel.animate(
        [
            { opacity: 0, transform: `translate3d(${offset}px, 0, 0)` },
            { opacity: 1, transform: 'translate3d(0, 0, 0)' },
        ],
        {
            duration,
            easing: getMotionEasingToken('--motion-ease-enter', 'cubic-bezier(.4,0,.2,1)'),
            fill: 'both',
        },
    );
}

function shouldShowMotionDebug() {
    try {
        const url = new URL(window.location.href);
        const fromQuery = String(url.searchParams.get('motionDebug') || '').trim();
        if (fromQuery === '1' || fromQuery.toLowerCase() === 'true') return true;
    } catch (_) {}
    try {
        return String(localStorage.getItem(DEFAULT_MOTION_DEBUG_STORAGE_KEY) || '') === '1';
    } catch (_) {
        return false;
    }
}

function collectMotionDebugSnapshot() {
    const root = document.documentElement;
    const rootStyle = window.getComputedStyle(root);
    let prefersReducedMotionMedia = false;
    try {
        const nativeMatchMedia = window.__sunMotionNativeMatchMedia || window.matchMedia;
        prefersReducedMotionMedia = Boolean(nativeMatchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
    } catch (_) {}
    return {
        motionLevel: getMotionLevel(),
        performanceMode: String(root.getAttribute('data-performance-mode') || 'full'),
        perfLiteClass: root.classList.contains('perf-lite'),
        prefersReducedMotionMedia,
        prefersReducedMotionEffective: prefersReducedMotion(),
        durationFast: rootStyle.getPropertyValue('--motion-duration-fast').trim(),
        durationBase: rootStyle.getPropertyValue('--motion-duration-base').trim(),
        durationMedium: rootStyle.getPropertyValue('--motion-duration-medium').trim(),
        easeEnter: rootStyle.getPropertyValue('--motion-ease-enter').trim(),
        easeInteractive: rootStyle.getPropertyValue('--motion-ease-interactive').trim(),
        staggerStart: rootStyle.getPropertyValue('--motion-stagger-start').trim(),
        staggerStep: rootStyle.getPropertyValue('--motion-stagger-step').trim(),
        listAnimateLimit: rootStyle.getPropertyValue('--motion-list-animate-limit').trim(),
        velocity: rootStyle.getPropertyValue('--motion-velocity-px-per-ms').trim(),
    };
}

function renderMotionDebugPanel() {
    if (!motionDebugPanelEl) return;
    const snapshot = collectMotionDebugSnapshot();
    motionDebugPanelEl.textContent = JSON.stringify(snapshot, null, 2);
}

function ensureMotionDebugPanel() {
    if (motionDebugPanelEl && document.contains(motionDebugPanelEl)) return motionDebugPanelEl;
    const panel = document.createElement('pre');
    panel.id = 'sunMotionDebug';
    panel.className = 'motion-debug-panel';
    panel.setAttribute('aria-live', 'polite');
    document.body.appendChild(panel);
    motionDebugPanelEl = panel;
    return panel;
}

function destroyMotionDebugPanel() {
    if (!motionDebugPanelEl) return;
    motionDebugPanelEl.remove();
    motionDebugPanelEl = null;
}

function toggleMotionDebug(forceVisible = null) {
    const shouldOpen = forceVisible == null
        ? !motionDebugPanelEl
        : Boolean(forceVisible);
    try {
        localStorage.setItem(DEFAULT_MOTION_DEBUG_STORAGE_KEY, shouldOpen ? '1' : '0');
    } catch (_) {}
    if (!shouldOpen) {
        destroyMotionDebugPanel();
        if (motionDebugTimerId) {
            window.clearInterval(motionDebugTimerId);
            motionDebugTimerId = 0;
        }
        return;
    }
    ensureMotionDebugPanel();
    renderMotionDebugPanel();
    if (motionDebugTimerId) window.clearInterval(motionDebugTimerId);
    motionDebugTimerId = window.setInterval(renderMotionDebugPanel, 500);
}

export function initMotionRuntime() {
    if (motionDebugBound) return;
    motionDebugBound = true;
    if (shouldShowMotionDebug()) {
        toggleMotionDebug(true);
    }
    document.addEventListener('keydown', (event) => {
        if (!event.ctrlKey || !event.shiftKey || String(event.key || '').toLowerCase() !== 'm') return;
        event.preventDefault();
        toggleMotionDebug();
    });
}

const RIPPLE_TARGET_SELECTOR = [
    '.ripple-target',
    'button:not([disabled])',
    '.btn',
    '.btn-icon',
    '.contact-item',
    '.context-menu-item',
    '.message-context-menu .menu-item',
    '.profile-more-item',
    '.attach-menu-item',
    '.emoji-category-btn',
    '.emoji-item',
    '.reaction-picker__item',
    '.reaction-pill',
    '.profile-file-row',
    '.profile-audio-row',
    '.profile-link-row',
    '.profile-file-action-btn',
    '.profile-audio-play-btn',
    '.profile-link-jump-btn',
    '.palette-action',
    '.request-action',
].join(',');

const RIPPLE_SKIP_SELECTOR = [
    '[data-no-ripple]',
    '[aria-disabled="true"]',
    '.disabled',
    '.profile-media-tab',
    '.search-overlay__tab',
    'input',
    'textarea',
    'select',
    '[contenteditable="true"]',
].join(',');

export function initSunRipple(root = document) {
    const doc = root?.nodeType === 9 ? root : document;
    if (doc.__sunRippleBound) return () => {};
    doc.__sunRippleBound = true;

    const onPointerDown = (event) => {
        if (event.button !== 0 || prefersReducedMotion()) return;
        const source = event.target instanceof Element ? event.target : null;
        const target = source?.closest(RIPPLE_TARGET_SELECTOR);
        if (!(target instanceof HTMLElement) || !doc.contains(target)) return;
        if (target.matches(RIPPLE_SKIP_SELECTOR) || target.closest(RIPPLE_SKIP_SELECTOR)) return;
        if ('disabled' in target && target.disabled) return;

        const rect = target.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        const diameter = Math.ceil(Math.max(rect.width, rect.height) * 2.1);
        const ripple = doc.createElement('span');
        ripple.className = 'sun-ripple-circle ripple';
        ripple.setAttribute('aria-hidden', 'true');
        ripple.style.width = `${diameter}px`;
        ripple.style.height = `${diameter}px`;
        ripple.style.left = `${event.clientX - rect.left - diameter / 2}px`;
        ripple.style.top = `${event.clientY - rect.top - diameter / 2}px`;

        target.classList.add('sun-ripple-host');
        target.appendChild(ripple);

        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            window.removeEventListener('pointerup', finish);
            window.removeEventListener('pointercancel', finish);
            ripple.classList.add('is-hiding');
            window.setTimeout(() => ripple.remove(), 380);
        };

        window.addEventListener('pointerup', finish, { once: true, passive: true });
        window.addEventListener('pointercancel', finish, { once: true, passive: true });
        window.setTimeout(finish, 700);
    };

    doc.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
    return () => {
        doc.removeEventListener('pointerdown', onPointerDown, { capture: true });
        doc.__sunRippleBound = false;
    };
}
