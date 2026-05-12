import { applyEmojiGraphics, renderEmojiGraphicHtml } from './utils.js';
import { withAppRoot } from './app-url.js';
import {
    DEFAULT_EMOJI_CATEGORY,
    EMOJI_CATEGORY_META,
    EMOJI_CATEGORY_ORDER,
    EMOJI_PICKER_I18N,
    resolvePickerLocale,
} from './emoji-picker-data.js';

let emojiData = null;
let emojiLoadFailed = false;
let lastPopulateRequestId = 0;

const RECENT_STORAGE_KEY = 'sun_recent_emojis_v1';
const EMOJI_DATA_CACHE_KEY = 'sun_emoji_data_cache_v1';
const EMOJI_DATA_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RECENT_EMOJIS = 48;
const DISALLOWED_PICKER_EMOJIS = new Set([
    '\uD83C\uDFF3\uFE0F\u200D\uD83C\uDF08', // rainbow flag
    '\uD83C\uDFF3\uFE0F\u200D\u26A7\uFE0F', // transgender flag
]);

const MOBILE_EMOJI_QUERY = '(max-width: 768px)';
const MOBILE_EMOJI_MIN_HEIGHT = 400;
const MOBILE_EMOJI_COMPACT_MIN_HEIGHT = 260;
const MOBILE_EMOJI_MAX_HEIGHT = 560;
const MOBILE_EMOJI_HEIGHT_RATIO = 0.60;
const MOBILE_EMOJI_MIN_HEADER_GAP = 8;
const EMOJI_CLOSE_ANIMATION_MS = 190;
const EMOJI_KEYBOARD_HANDOFF_MS = 720;
// Keep in sync with keyboard viewport detection in mobile-viewport.js
// so handoff ends as soon as the keyboard is actually visible.
const EMOJI_KEYBOARD_INSET_MIN = 24;
const MOBILE_OPEN_KEYBOARD_INSET_TTL_MS = 900;
const MOBILE_EMOJI_CHAT_PIN_THRESHOLD = 96;
const CATEGORY_SCROLL_SYNC_OFFSET = 24;

const EMOJI_INLINE_KEYWORDS = {
    '\u{1F602}': ['смех', 'laugh', 'lol'],
    '\u{1F923}': ['смех', 'laugh', 'rofl'],
    '\u{1F60D}': ['любовь', 'love', 'heart'],
    '\u{2764}\u{FE0F}': ['любовь', 'сердце', 'love', 'heart'],
    '\u{1F44D}': ['лайк', 'ok', 'like', 'yes'],
    '\u{1F44E}': ['дизлайк', 'no', 'dislike'],
    '\u{1F389}': ['праздник', 'party', 'celebrate'],
    '\u{1F525}': ['огонь', 'fire', 'hot'],
    '\u{1F62E}': ['удивление', 'wow', 'surprised'],
    '\u{1F622}': ['грусть', 'sad', 'cry'],
    '\u{1F631}': ['шок', 'shock', 'scream'],
    '\u{1F914}': ['думать', 'think', 'hmm'],
};

let emojiCloseSeq = 0;
let emojiKeyboardHandoffTimer = null;
let emojiKeyboardHandoffFrame = 0;
let lastMobileKeyboardInsetPx = 0;
let lastMobileKeyboardInsetAt = 0;

function normalizeQuery(value) {
    return String(value || '').trim().toLowerCase();
}

function isMobileEmojiViewport() {
    return window.matchMedia?.(MOBILE_EMOJI_QUERY)?.matches ?? false;
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

function maxTransitionMs(element, fallbackMs = EMOJI_CLOSE_ANIMATION_MS) {
    if (!element || prefersReducedMotion()) return 0;
    const style = window.getComputedStyle(element);
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

function waitForMotionEnd(element, fallbackMs) {
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
        timeoutId = window.setTimeout(finish, fallbackMs + 60);
    });
}

function readRootPixelVar(name) {
    const raw = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (!raw.endsWith('px')) return 0;
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? value : 0;
}

function readMobileKeyboardInset() {
    const cssInset = readRootPixelVar('--mobile-composer-bottom-inset');
    const vv = window.visualViewport;
    if (!vv) return cssInset;

    const layoutViewportHeight = Math.max(
        Math.round(window.innerHeight || 0),
        Math.round(document.documentElement.clientHeight || 0),
        readRootPixelVar('--app-vh'),
    );
    const visibleBottom = Math.round((vv.offsetTop || 0) + (vv.height || 0));
    const viewportInset = Math.max(0, layoutViewportHeight - visibleBottom);
    return Math.max(cssInset, viewportInset);
}

function readCurrentMobileEmojiSheetHeight(emojiPicker) {
    const cssHeight = readRootPixelVar('--mobile-emoji-sheet-height');
    if (cssHeight > 0) return cssHeight;
    const pickerHeight = Math.round(emojiPicker?.getBoundingClientRect?.().height || 0);
    return pickerHeight > 0 ? pickerHeight : 0;
}

function captureMobileKeyboardInsetSnapshot() {
    if (!isMobileEmojiViewport()) return 0;
    const inset = readMobileKeyboardInset();
    if (inset <= 0) return 0;
    lastMobileKeyboardInsetPx = inset;
    lastMobileKeyboardInsetAt = performance.now();
    return inset;
}

function resolveEmojiChatArea(emojiPicker) {
    return emojiPicker?.closest('.chat-area') || document.getElementById('chatArea');
}

function resolveMobileEmojiChatMessages(chatArea) {
    return chatArea?.querySelector?.('#chatMessages, .chat-messages') || null;
}

function isMobileEmojiChatPinnedToBottom(chatArea) {
    const chatMessages = resolveMobileEmojiChatMessages(chatArea);
    if (!chatMessages) return false;
    const maxScrollTop = Math.max(0, chatMessages.scrollHeight - chatMessages.clientHeight);
    return maxScrollTop - chatMessages.scrollTop <= MOBILE_EMOJI_CHAT_PIN_THRESHOLD;
}

function pinMobileEmojiChatToBottom(chatArea) {
    const chatMessages = resolveMobileEmojiChatMessages(chatArea);
    if (!chatMessages) return;

    const pin = () => {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    };
    window.requestAnimationFrame(() => {
        pin();
        window.requestAnimationFrame(pin);
    });
}

function setMobileEmojiSheetState(emojiPicker, isOpen, height = null) {
    const chatArea = resolveEmojiChatArea(emojiPicker);
    if (!chatArea) return;

    const shouldPinChatToBottom = Boolean(
        isOpen
        && isMobileEmojiViewport()
        && isMobileEmojiChatPinnedToBottom(chatArea),
    );

    chatArea.classList.toggle('emoji-sheet-open', Boolean(isOpen));
    if (isOpen && Number.isFinite(height)) {
        chatArea.style.setProperty('--mobile-emoji-sheet-height', `${Math.round(height)}px`);
        if (shouldPinChatToBottom) {
            pinMobileEmojiChatToBottom(chatArea);
        }
    } else if (!isOpen) {
        chatArea.classList.remove('emoji-keyboard-handoff');
        chatArea.style.removeProperty('--mobile-emoji-sheet-height');
    }
}

function clearMobileEmojiSheetState(emojiPicker) {
    setMobileEmojiSheetState(emojiPicker, false);
}

function resetMobileEmojiShellScroll(emojiPicker) {
    if (!isMobileEmojiViewport()) return;
    const chatArea = resolveEmojiChatArea(emojiPicker);
    if (!chatArea || chatArea.scrollTop === 0) return;
    chatArea.scrollTop = 0;
}

function measureMobileEmojiTopReserve(emojiPicker, emojiBtn, viewportOffsetTop) {
    const chatArea = resolveEmojiChatArea(emojiPicker);
    const header = chatArea?.querySelector?.('.chat-header');
    const headerRect = header?.getBoundingClientRect?.();
    const headerReserve = headerRect
        ? Math.max(0, Math.round(headerRect.bottom - viewportOffsetTop))
        : 0;
    const composerShell = emojiBtn.closest('.chat-input-area') || emojiBtn.closest('#messageForm');
    const composerRect = composerShell?.getBoundingClientRect?.();
    const composerHeight = composerRect ? Math.ceil(composerRect.height) : 0;
    const chatStyles = chatArea ? window.getComputedStyle(chatArea) : null;
    const floatingGap = Number.parseFloat(chatStyles?.getPropertyValue('--floating-composer-gap')) || 8;
    return headerReserve + composerHeight + floatingGap + MOBILE_EMOJI_MIN_HEADER_GAP;
}

function stopEmojiKeyboardHandoff(emojiPicker, { clearLayout = false } = {}) {
    window.clearTimeout(emojiKeyboardHandoffTimer);
    emojiKeyboardHandoffTimer = null;
    if (emojiKeyboardHandoffFrame) {
        window.cancelAnimationFrame(emojiKeyboardHandoffFrame);
        emojiKeyboardHandoffFrame = 0;
    }
    const chatArea = resolveEmojiChatArea(emojiPicker);
    chatArea?.classList.remove('emoji-keyboard-handoff');
    if (clearLayout) {
        clearMobileEmojiSheetState(emojiPicker);
    }
}

function startEmojiKeyboardHandoff(emojiPicker, { targetInset = null } = {}) {
    const chatArea = resolveEmojiChatArea(emojiPicker);
    if (!chatArea || !isMobileEmojiViewport()) return false;

    stopEmojiKeyboardHandoff(emojiPicker);
    chatArea.classList.add('emoji-keyboard-handoff');
    const startedAt = performance.now();
    const targetKeyboardInset = Math.max(
        EMOJI_KEYBOARD_INSET_MIN,
        Math.round(Number.isFinite(targetInset) && targetInset > 0 ? targetInset - 24 : EMOJI_KEYBOARD_INSET_MIN),
    );

    const finish = () => {
        stopEmojiKeyboardHandoff(emojiPicker, { clearLayout: true });
    };
    const tick = () => {
        const elapsed = performance.now() - startedAt;
        const keyboardInset = readMobileKeyboardInset();
        if (keyboardInset >= targetKeyboardInset || elapsed >= EMOJI_KEYBOARD_HANDOFF_MS) {
            finish();
            return;
        }
        emojiKeyboardHandoffFrame = window.requestAnimationFrame(tick);
    };

    emojiKeyboardHandoffTimer = window.setTimeout(finish, EMOJI_KEYBOARD_HANDOFF_MS);
    emojiKeyboardHandoffFrame = window.requestAnimationFrame(tick);
    return true;
}

function waitForMobileKeyboardHidden(timeoutMs = EMOJI_KEYBOARD_HANDOFF_MS) {
    if (!isMobileEmojiViewport() || readMobileKeyboardInset() < EMOJI_KEYBOARD_INSET_MIN) {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        const startedAt = performance.now();
        let frameId = 0;
        let timeoutId = 0;
        const finish = () => {
            if (frameId) window.cancelAnimationFrame(frameId);
            if (timeoutId) window.clearTimeout(timeoutId);
            resolve();
        };
        const tick = () => {
            if (readMobileKeyboardInset() < EMOJI_KEYBOARD_INSET_MIN
                || performance.now() - startedAt >= timeoutMs) {
                finish();
                return;
            }
            frameId = window.requestAnimationFrame(tick);
        };
        timeoutId = window.setTimeout(finish, timeoutMs + 80);
        frameId = window.requestAnimationFrame(tick);
    });
}

function isAllowedPickerEmoji(value) {
    return typeof value === 'string'
        && value.trim().length > 0
        && !DISALLOWED_PICKER_EMOJIS.has(value);
}

function getRecentEmojis() {
    try {
        const raw = localStorage.getItem(RECENT_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        const sanitized = parsed
            .filter((item) => isAllowedPickerEmoji(item))
            .slice(0, MAX_RECENT_EMOJIS);
        if (sanitized.length !== parsed.length) {
            localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(sanitized));
        }
        return sanitized;
    } catch (error) {
        console.warn('Failed to read recent emojis', error);
        return [];
    }
}

function normalizeEmojiDataPayload(value) {
    if (!value || typeof value !== 'object') return null;
    const normalized = {};
    let hasData = false;
    EMOJI_CATEGORY_ORDER.forEach((category) => {
        const source = value[category];
        if (!Array.isArray(source)) return;
        const list = source
            .map((item) => (typeof item === 'string' ? item.trim() : ''))
            .filter((emoji) => isAllowedPickerEmoji(emoji));
        if (!list.length) return;
        normalized[category] = list;
        hasData = true;
    });
    return hasData ? normalized : null;
}

function readCachedEmojiData() {
    try {
        const raw = localStorage.getItem(EMOJI_DATA_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        const savedAt = Number(parsed.savedAt || 0);
        if (!Number.isFinite(savedAt) || savedAt <= 0) return null;
        if ((Date.now() - savedAt) > EMOJI_DATA_CACHE_TTL_MS) return null;
        return normalizeEmojiDataPayload(parsed.data);
    } catch (error) {
        console.warn('Failed to read emoji data cache', error);
        return null;
    }
}

function saveCachedEmojiData(data) {
    try {
        localStorage.setItem(EMOJI_DATA_CACHE_KEY, JSON.stringify({
            savedAt: Date.now(),
            data,
        }));
    } catch (error) {
        console.warn('Failed to persist emoji data cache', error);
    }
}

function saveRecentEmojis(values) {
    try {
        localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(values.slice(0, MAX_RECENT_EMOJIS)));
    } catch (error) {
        console.warn('Failed to save recent emojis', error);
    }
}

function rememberEmoji(emoji) {
    if (!isAllowedPickerEmoji(emoji)) return;
    const list = getRecentEmojis().filter((entry) => entry !== emoji);
    list.unshift(emoji);
    saveRecentEmojis(list);
}

function resolveEmojiUiLanguage() {
    const explicitLanguage = window.SUN_I18N?.getLanguage?.()
        || window.SUN_BOOTSTRAP?.user?.uiLanguage
        || document.documentElement.lang
        || '';
    return resolvePickerLocale(explicitLanguage);
}

function getLocaleStrings() {
    const localeCode = resolveEmojiUiLanguage();
    return {
        localeCode,
        strings: EMOJI_PICKER_I18N[localeCode] || EMOJI_PICKER_I18N.ru,
    };
}

function getEmojiButtonLabel(mode) {
    const localeCode = resolveEmojiUiLanguage();
    if (mode === 'keyboard') {
        return localeCode === 'en' ? 'Show keyboard' : 'Показать клавиатуру';
    }
    return localeCode === 'en' ? 'Show emojis' : 'Показать смайлики';
}

async function loadEmojiData() {
    if (emojiData) return emojiData;
    if (emojiLoadFailed) return null;

    const cachedData = readCachedEmojiData();
    if (cachedData) {
        emojiData = cachedData;
        return emojiData;
    }

    try {
        const resp = await fetch(withAppRoot('/static/emojis.json'));
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const nextData = normalizeEmojiDataPayload(await resp.json());
        if (!nextData) throw new Error('Invalid emoji payload');
        emojiData = nextData;
        saveCachedEmojiData(emojiData);
        return emojiData;
    } catch (error) {
        console.error('Failed to load emojis', error);
        emojiLoadFailed = true;
        return null;
    }
}

function dispatchComposerInput(input, text) {
    try {
        input.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            data: text,
            inputType: 'insertText',
        }));
    } catch (_) {
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

function insertAtCursor(input, text, options = {}) {
    const valueLength = input?.value?.length || 0;
    const optionStart = Number.isFinite(options.selectionStart) ? options.selectionStart : null;
    const optionEnd = Number.isFinite(options.selectionEnd) ? options.selectionEnd : null;
    const liveStart = Number.isFinite(input?.selectionStart) ? input.selectionStart : valueLength;
    const liveEnd = Number.isFinite(input?.selectionEnd) ? input.selectionEnd : liveStart;
    const start = Math.max(0, Math.min(optionStart ?? liveStart, valueLength));
    const end = Math.max(start, Math.min(optionEnd ?? liveEnd, valueLength));
    const value = input.value || '';
    input.value = value.substring(0, start) + text + value.substring(end);
    const cursor = start + text.length;
    try {
        input.setSelectionRange(cursor, cursor);
    } catch (_) {
        input.selectionStart = input.selectionEnd = cursor;
    }
    dispatchComposerInput(input, text);
    if (options.focusAfter !== false) {
        try {
            input.focus({ preventScroll: true });
        } catch (_) {
            input.focus();
        }
    }
    return { start: cursor, end: cursor };
}

function setEmojiStatus(emojiList, html) {
    emojiList.innerHTML = `<div class="emoji-list-status">${html}</div>`;
}

function getLocalizedTitle(meta, categoryId, localeCode) {
    if (!meta) return categoryId;
    return localeCode === 'en' ? meta.titleEn : meta.titleRu;
}

function matchesText(query, values = []) {
    if (!query) return true;
    return values.some((value) => String(value || '').toLowerCase().includes(query));
}

function buildEmojiSearchResults(data, query, localeCode) {
    const compactQuery = normalizeQuery(query);
    const recent = getRecentEmojis();
    const recentSet = new Set(recent);
    const scored = [];
    const seen = new Set();

    EMOJI_CATEGORY_ORDER
        .filter((category) => category !== DEFAULT_EMOJI_CATEGORY)
        .forEach((category) => {
            const entries = Array.isArray(data?.[category]) ? data[category] : [];
            const meta = EMOJI_CATEGORY_META[category];
            const categoryTags = meta?.searchTags || [];
            entries.forEach((emoji) => {
                if (!isAllowedPickerEmoji(emoji) || seen.has(emoji)) return;
                const inlineKeywords = EMOJI_INLINE_KEYWORDS[emoji] || [];
                const queryValues = [
                    emoji,
                    ...categoryTags,
                    ...inlineKeywords,
                    getLocalizedTitle(meta, category, localeCode),
                ];
                if (!matchesText(compactQuery, queryValues)) return;
                seen.add(emoji);
                scored.push({
                    emoji,
                    score: (recentSet.has(emoji) ? 2 : 0) + (inlineKeywords.length ? 1 : 0),
                });
            });
        });

    scored.sort((left, right) => right.score - left.score || left.emoji.localeCompare(right.emoji));
    return scored.map((entry) => entry.emoji);
}

function buildDefaultEmojiSections(data, localeCode) {
    const recent = getRecentEmojis();
    return EMOJI_CATEGORY_ORDER.map((category) => {
        const meta = EMOJI_CATEGORY_META[category];
        const title = getLocalizedTitle(meta, category, localeCode);
        const items = category === DEFAULT_EMOJI_CATEGORY
            ? recent
            : (Array.isArray(data?.[category]) ? data[category].filter((emoji) => isAllowedPickerEmoji(emoji)) : []);
        return {
            id: category,
            title,
            items,
        };
    });
}

function createEmojiItemButton(emoji) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'emoji-item';
    button.dataset.emoji = emoji;
    button.setAttribute('aria-label', `Эмодзи ${emoji}`);
    button.innerHTML = renderEmojiGraphicHtml(emoji, {
        className: 'emoji-graphic',
        alt: emoji,
        loading: 'lazy',
    });
    return button;
}

function createSectionElement(section) {
    const sectionEl = document.createElement('section');
    sectionEl.className = 'emoji-section';
    sectionEl.dataset.sectionCat = section.id;

    const titleEl = document.createElement('h3');
    titleEl.className = 'emoji-section-title';
    titleEl.textContent = section.title;
    sectionEl.appendChild(titleEl);

    const gridEl = document.createElement('div');
    gridEl.className = 'emoji-section-grid';
    section.items.forEach((emoji) => {
        gridEl.appendChild(createEmojiItemButton(emoji));
    });
    sectionEl.appendChild(gridEl);
    return sectionEl;
}

function updateRecentSectionInPlace(emojiList, strings) {
    const recentSection = emojiList.querySelector(`.emoji-section[data-section-cat="${DEFAULT_EMOJI_CATEGORY}"]`);
    if (!recentSection) return false;
    const gridEl = recentSection.querySelector('.emoji-section-grid');
    if (!gridEl) return false;

    const recentItems = getRecentEmojis();
    const fragment = document.createDocumentFragment();
    recentItems.forEach((emoji) => {
        fragment.appendChild(createEmojiItemButton(emoji));
    });
    gridEl.replaceChildren(fragment);

    let emptyEl = recentSection.querySelector('.emoji-list-status--inline');
    if (!recentItems.length) {
        if (!emptyEl) {
            emptyEl = document.createElement('div');
            emptyEl.className = 'emoji-list-status emoji-list-status--inline';
            recentSection.appendChild(emptyEl);
        }
        emptyEl.textContent = strings.emptyRecent;
    } else if (emptyEl) {
        emptyEl.remove();
    }

    return true;
}

function setActiveCategory(emojiCategories, category) {
    emojiCategories?.querySelectorAll('.emoji-category-btn').forEach((button) => {
        const isActive = button.dataset.cat === category;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
}

function ensureActiveCategoryVisible(emojiCategories, category) {
    const activeButton = emojiCategories?.querySelector(`.emoji-category-btn[data-cat="${category}"]`);
    if (!activeButton) return;
    activeButton.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
}

function renderCategoryButtons(emojiCategories, activeCategory, localeCode) {
    const fragment = document.createDocumentFragment();
    emojiCategories.innerHTML = '';

    EMOJI_CATEGORY_ORDER.forEach((category) => {
        const meta = EMOJI_CATEGORY_META[category];
        const title = getLocalizedTitle(meta, category, localeCode);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'emoji-category-btn';
        button.dataset.cat = category;
        button.setAttribute('title', title);
        button.setAttribute('aria-label', title);
        button.setAttribute('role', 'tab');
        button.textContent = meta?.icon || category;
        fragment.appendChild(button);
    });

    emojiCategories.appendChild(fragment);
    setActiveCategory(emojiCategories, activeCategory);
    ensureActiveCategoryVisible(emojiCategories, activeCategory);
    applyEmojiGraphics(emojiCategories);
}

function positionEmojiPicker(emojiPicker, emojiBtn, options = {}) {
    if (!emojiPicker || !emojiBtn) return;

    const vv = window.visualViewport;
    const viewportWidth = Math.round(vv?.width || window.innerWidth);
    const viewportHeight = Math.round(vv?.height || window.innerHeight);
    const viewportOffsetLeft = vv?.offsetLeft || 0;
    const viewportOffsetTop = vv?.offsetTop || 0;
    const margin = 10;
    const isMobile = isMobileEmojiViewport();
    if (isMobile) {
        resetMobileEmojiShellScroll(emojiPicker);
    }
    const formRect = emojiBtn.closest('#messageForm')?.getBoundingClientRect() || emojiBtn.getBoundingClientRect();
    const anchorGap = 10;

    if (isMobile) {
        const preserveSize = Boolean(options.preserveSize);
        const visualViewportHeight = Math.round(vv?.height || 0);
        const layoutViewportHeight = Math.max(
            viewportHeight,
            Math.round(window.innerHeight || 0),
            Math.round(document.documentElement.clientHeight || 0),
            readRootPixelVar('--app-vh'),
        );
        const mobileViewportHeight = visualViewportHeight > 0 ? visualViewportHeight : layoutViewportHeight;
        const topReserve = measureMobileEmojiTopReserve(emojiPicker, emojiBtn, viewportOffsetTop);
        const maxSheetHeight = Math.min(
            MOBILE_EMOJI_MAX_HEIGHT,
            Math.max(MOBILE_EMOJI_COMPACT_MIN_HEIGHT, mobileViewportHeight - 80),
            Math.max(MOBILE_EMOJI_COMPACT_MIN_HEIGHT, mobileViewportHeight - topReserve),
        );
        const defaultSheetHeight = Math.min(
            maxSheetHeight,
            Math.max(MOBILE_EMOJI_MIN_HEIGHT, mobileViewportHeight * MOBILE_EMOJI_HEIGHT_RATIO),
        );
        const preferredMobileSheetHeight = Number.parseFloat(options.preferredMobileSheetHeight);
        const hasPreferredMobileSheetHeight = Number.isFinite(preferredMobileSheetHeight) && preferredMobileSheetHeight > 0;
        const currentSheetHeight = preserveSize
            ? Number.parseFloat(String(emojiPicker.style.getPropertyValue('--emoji-height') || ''))
            : NaN;
        const targetSheetHeight = hasPreferredMobileSheetHeight
            ? preferredMobileSheetHeight
            : (Number.isFinite(currentSheetHeight) && currentSheetHeight > 0 ? currentSheetHeight : defaultSheetHeight);
        const minSheetHeight = hasPreferredMobileSheetHeight ? 0 : MOBILE_EMOJI_MIN_HEIGHT;
        const sheetHeight = Math.round(Math.min(maxSheetHeight, Math.max(minSheetHeight, targetSheetHeight)));
        const sheetWidth = Math.max(0, viewportWidth);
        const left = Math.round(viewportOffsetLeft);
        const sheetBottom = hasPreferredMobileSheetHeight
            ? Math.max(viewportOffsetTop + mobileViewportHeight, layoutViewportHeight)
            : viewportOffsetTop + mobileViewportHeight;
        const top = Math.round(sheetBottom - sheetHeight);
        const layoutSheetHeight = sheetHeight;

        emojiPicker.style.setProperty('--emoji-left', `${left}px`);
        emojiPicker.style.setProperty('--emoji-top', `${top}px`);
        emojiPicker.style.setProperty('--emoji-width', `${sheetWidth}px`);
        emojiPicker.style.setProperty('--emoji-height', `${sheetHeight}px`);
        emojiPicker.style.transformOrigin = 'bottom center';
        emojiPicker.dataset.side = 'mobile-sheet';
        setMobileEmojiSheetState(emojiPicker, true, layoutSheetHeight);
        return;
    }

    clearMobileEmojiSheetState(emojiPicker);

    const preserveSize = Boolean(options.preserveSize);
    const measuredWidth = Math.round(emojiPicker.offsetWidth || 0);
    const measuredHeight = Math.round(emojiPicker.offsetHeight || 0);
    const targetWidth = preserveSize && measuredWidth > 0
        ? measuredWidth
        : Math.max(
            356,
            Math.min(
                430,
                Math.min(viewportWidth - 24, Math.round(Math.max(360, formRect.width - 14))),
            ),
        );
    const targetHeight = preserveSize && measuredHeight > 0
        ? measuredHeight
        : Math.max(334, Math.min(486, viewportHeight - 18));

    emojiPicker.style.setProperty('--emoji-width', `${targetWidth}px`);
    emojiPicker.style.setProperty('--emoji-height', `${targetHeight}px`);

    const pickerLayoutWidth = Math.round(emojiPicker.offsetWidth || targetWidth);
    const pickerLayoutHeight = Math.round(emojiPicker.offsetHeight || targetHeight);
    const pickerWidth = Math.min(pickerLayoutWidth, viewportWidth - margin * 2);
    const pickerHeight = Math.min(pickerLayoutHeight, viewportHeight - margin * 2);

    let left = formRect.left;
    let top = formRect.top - pickerHeight - anchorGap;
    let side = 'top';

    if (top < viewportOffsetTop + margin) {
        top = formRect.bottom + anchorGap;
        side = 'bottom';
    }
    if (left + pickerWidth > formRect.right) {
        left = formRect.right - pickerWidth;
    }

    left = Math.max(viewportOffsetLeft + margin, Math.min(left, viewportOffsetLeft + viewportWidth - pickerWidth - margin));
    top = Math.max(viewportOffsetTop + margin, Math.min(top, viewportOffsetTop + viewportHeight - pickerHeight - margin));

    emojiPicker.style.setProperty('--emoji-left', `${Math.round(left)}px`);
    emojiPicker.style.setProperty('--emoji-top', `${Math.round(top)}px`);
    emojiPicker.style.setProperty('--emoji-width', `${pickerWidth}px`);
    emojiPicker.style.setProperty('--emoji-height', `${pickerHeight}px`);
    emojiPicker.style.transformOrigin = side === 'bottom' ? 'top left' : 'bottom left';
    emojiPicker.dataset.side = side;
}

function findClosestCategory(emojiList) {
    const sections = Array.from(emojiList.querySelectorAll('.emoji-section[data-section-cat]'));
    if (!sections.length) return '';
    const targetTop = emojiList.scrollTop + CATEGORY_SCROLL_SYNC_OFFSET;
    let activeCategory = sections[0].dataset.sectionCat || '';
    sections.forEach((section) => {
        if (getSectionScrollTop(emojiList, section) <= targetTop) {
            activeCategory = section.dataset.sectionCat || activeCategory;
        }
    });
    return activeCategory;
}

function getSectionScrollTop(emojiList, section) {
    if (!emojiList || !section) return 0;
    const listRect = emojiList.getBoundingClientRect();
    const sectionRect = section.getBoundingClientRect();
    const relativeTop = sectionRect.top - listRect.top + emojiList.scrollTop;
    return Number.isFinite(relativeTop) ? relativeTop : section.offsetTop;
}

function scrollToCategory(emojiList, categoryId, options = {}) {
    const section = emojiList.querySelector(`.emoji-section[data-section-cat="${categoryId}"]`);
    if (!section) return false;
    emojiList.scrollTo({
        top: Math.max(0, Math.round(getSectionScrollTop(emojiList, section) - 6)),
        behavior: options.behavior || 'smooth',
    });
    return true;
}

export function initEmojiPicker(messageInput) {
    const emojiBtn = document.getElementById('emojiBtn');
    const emojiPicker = document.getElementById('emojiPicker');
    const emojiList = document.getElementById('emojiList');
    const emojiCategories = document.getElementById('emojiCategories');
    const emojiSearchInput = document.getElementById('emojiSearchInput');
    const emojiSearchClear = document.getElementById('emojiSearchClear');
    if (!emojiBtn || !emojiPicker || !emojiList || !emojiCategories || !emojiSearchInput || !emojiSearchClear || !messageInput) {
        return;
    }

    let activeCategory = DEFAULT_EMOJI_CATEGORY;
    let searchQuery = '';
    let lastSelectionStart = messageInput.value.length;
    let lastSelectionEnd = lastSelectionStart;
    let handledKeyboardSwitchPointer = false;
    let keyboardSwitchPointerTimer = null;
    let suppressCategorySyncUntil = 0;
    let lastRenderedMode = '';
    let lastDefaultRenderKey = '';
    let defaultListNeedsRefresh = true;
    let openRenderSeq = 0;

    const setStoredSelection = (start, end = start) => {
        const valueLength = messageInput.value.length;
        lastSelectionStart = Math.max(0, Math.min(Number.isFinite(start) ? start : valueLength, valueLength));
        lastSelectionEnd = Math.max(lastSelectionStart, Math.min(Number.isFinite(end) ? end : lastSelectionStart, valueLength));
    };

    const rememberSelection = () => {
        if (!Number.isFinite(messageInput.selectionStart)) return;
        setStoredSelection(messageInput.selectionStart, messageInput.selectionEnd);
    };

    const getStoredSelection = () => {
        const valueLength = messageInput.value.length;
        return {
            start: Math.max(0, Math.min(lastSelectionStart, valueLength)),
            end: Math.max(0, Math.min(lastSelectionEnd, valueLength)),
        };
    };

    const focusComposerInput = () => {
        if (messageInput.disabled) return;
        const selection = getStoredSelection();
        try {
            messageInput.focus({ preventScroll: true });
        } catch (_) {
            messageInput.focus();
        }
        try {
            messageInput.setSelectionRange(selection.start, selection.end);
        } catch (_) {
            // Some mobile browsers reject selection changes during keyboard transition.
        }
    };

    const syncEmojiButtonMode = (isOpen = emojiPicker.classList.contains('active')) => {
        const showKeyboardIcon = Boolean(isOpen && isMobileEmojiViewport());
        const icon = emojiBtn.querySelector('i');
        if (icon) {
            icon.className = showKeyboardIcon ? 'bi bi-keyboard' : 'bi bi-emoji-smile';
        }
        emojiBtn.classList.toggle('is-keyboard-mode', showKeyboardIcon);
        emojiBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        emojiBtn.setAttribute('aria-pressed', isOpen ? 'true' : 'false');
        const label = getEmojiButtonLabel(showKeyboardIcon ? 'keyboard' : 'emoji');
        emojiBtn.setAttribute('aria-label', label);
        emojiBtn.setAttribute('title', label);
    };

    const updateSearchUi = (strings) => {
        emojiSearchInput.placeholder = strings.searchPlaceholder;
        emojiSearchClear.hidden = !searchQuery;
    };

    const buildDefaultRenderKey = (localeCode) => {
        const recentKey = getRecentEmojis().join('\u0001');
        return `${localeCode}|${recentKey}`;
    };

    const renderEmojiList = async ({ forceCategoryScroll = false } = {}) => {
        const requestId = ++lastPopulateRequestId;
        const { localeCode, strings } = getLocaleStrings();
        const compactQuery = normalizeQuery(searchQuery);
        const defaultRenderKey = compactQuery ? '' : buildDefaultRenderKey(localeCode);

        if (!compactQuery
            && lastRenderedMode === 'default'
            && !defaultListNeedsRefresh
            && lastDefaultRenderKey === defaultRenderKey
            && emojiList.childElementCount > 0) {
            renderCategoryButtons(emojiCategories, activeCategory, localeCode);
            if (forceCategoryScroll) {
                scrollToCategory(emojiList, activeCategory, { behavior: 'auto' });
            }
            return;
        }

        updateSearchUi(strings);
        renderCategoryButtons(emojiCategories, activeCategory, localeCode);

        const showSpinner = !emojiData && !emojiLoadFailed;
        if (showSpinner) {
            setEmojiStatus(emojiList, '<i class="bi bi-hourglass-split"></i>');
        }

        const data = await loadEmojiData();
        if (requestId !== lastPopulateRequestId) return;
        if (!data) {
            setEmojiStatus(emojiList, strings.noEmojiData);
            return;
        }

        const sections = compactQuery
            ? [{
                id: 'search',
                title: strings.searchResultsTitle,
                items: buildEmojiSearchResults(data, compactQuery, localeCode),
            }]
            : buildDefaultEmojiSections(data, localeCode);

        if (!sections.length || !sections.some((section) => section.items.length)) {
            setEmojiStatus(emojiList, strings.emptySearch);
            return;
        }

        emojiList.innerHTML = '';
        const fragment = document.createDocumentFragment();
        sections.forEach((section) => {
            const sectionEl = createSectionElement(section);
            if (!section.items.length) {
                const emptyEl = document.createElement('div');
                emptyEl.className = 'emoji-list-status emoji-list-status--inline';
                emptyEl.textContent = section.id === DEFAULT_EMOJI_CATEGORY ? strings.emptyRecent : strings.emptySearch;
                sectionEl.appendChild(emptyEl);
            }
            fragment.appendChild(sectionEl);
        });
        emojiList.appendChild(fragment);
        // Keep native glyphs in picker grid to avoid mass image replacement cost on mobile.

        if (!compactQuery) {
            setActiveCategory(emojiCategories, activeCategory);
            if (forceCategoryScroll) {
                scrollToCategory(emojiList, activeCategory, { behavior: 'auto' });
            }
            lastRenderedMode = 'default';
            lastDefaultRenderKey = defaultRenderKey;
            defaultListNeedsRefresh = false;
        } else {
            setActiveCategory(emojiCategories, '');
            lastRenderedMode = 'search';
        }
    };

    const reposition = () => {
        if (emojiPicker.classList.contains('active')) {
            positionEmojiPicker(emojiPicker, emojiBtn, { preserveSize: true });
            syncEmojiButtonMode(true);
        }
    };

    const closePicker = ({ focusInput = false } = {}) => {
        openRenderSeq += 1;
        const wantsKeyboardHandoff = isMobileEmojiViewport()
            && (focusInput || document.activeElement === messageInput);
        const keyboardHandoffTargetInset = wantsKeyboardHandoff
            ? readCurrentMobileEmojiSheetHeight(emojiPicker)
            : 0;
        if (!emojiPicker.classList.contains('active') && !emojiPicker.classList.contains('is-closing')) {
            // Picker is already closed: never restart handoff here, just normalize layout.
            stopEmojiKeyboardHandoff(emojiPicker, { clearLayout: true });
            emojiPicker.setAttribute('aria-hidden', 'true');
            syncEmojiButtonMode(false);
            if (focusInput) focusComposerInput();
            return;
        }

        const closeSeq = ++emojiCloseSeq;
        emojiPicker.classList.remove('active');
        emojiPicker.classList.add('is-closing');
        emojiPicker.setAttribute('aria-hidden', 'true');
        if (wantsKeyboardHandoff) {
            startEmojiKeyboardHandoff(emojiPicker, { targetInset: keyboardHandoffTargetInset });
        }
        syncEmojiButtonMode(false);
        if (focusInput) focusComposerInput();
        waitForMotionEnd(emojiPicker, maxTransitionMs(emojiPicker, EMOJI_CLOSE_ANIMATION_MS)).then(() => {
            if (closeSeq !== emojiCloseSeq) return;
            emojiPicker.classList.remove('is-closing');
            if (!wantsKeyboardHandoff) {
                clearMobileEmojiSheetState(emojiPicker);
            }
        });
    };

    const openPicker = async (options = {}) => {
        rememberSelection();
        stopEmojiKeyboardHandoff(emojiPicker);
        emojiCloseSeq += 1;
        const renderSeq = ++openRenderSeq;
        const shouldOpenMobile = isMobileEmojiViewport();
        const explicitMobileSheetHeight = Number.parseFloat(options.preferredMobileSheetHeight);
        const hasExplicitMobileSheetHeight = Number.isFinite(explicitMobileSheetHeight) && explicitMobileSheetHeight > 0;
        const keyboardInsetBeforeOpen = shouldOpenMobile
            ? (hasExplicitMobileSheetHeight ? explicitMobileSheetHeight : readMobileKeyboardInset())
            : 0;
        if (shouldOpenMobile && options.waitForKeyboard === true && document.activeElement === messageInput) {
            try {
                messageInput.blur();
            } catch (_) {
                // Mobile browsers may reject blur during pointer processing.
            }
            await waitForMobileKeyboardHidden();
            if (renderSeq !== openRenderSeq) return;
        }
        const recentKeyboardInset = (
            shouldOpenMobile
            && lastMobileKeyboardInsetPx > 0
            && (performance.now() - lastMobileKeyboardInsetAt) <= MOBILE_OPEN_KEYBOARD_INSET_TTL_MS
        )
            ? lastMobileKeyboardInsetPx
            : 0;
        const preferredMobileSheetHeight = keyboardInsetBeforeOpen > 0
            ? keyboardInsetBeforeOpen
            : recentKeyboardInset;
        searchQuery = '';
        emojiSearchInput.value = '';
        activeCategory = DEFAULT_EMOJI_CATEGORY;
        emojiPicker.classList.remove('is-closing');
        emojiPicker.classList.add('active');
        emojiPicker.setAttribute('aria-hidden', 'false');
        document.dispatchEvent(new Event('sun-close-header-dropdown'));
        positionEmojiPicker(emojiPicker, emojiBtn, {
            preferredMobileSheetHeight: preferredMobileSheetHeight > 0 ? preferredMobileSheetHeight : null,
        });
        if (shouldOpenMobile && document.activeElement === messageInput) {
            messageInput.blur();
        }
        syncEmojiButtonMode(true);

        const { localeCode } = getLocaleStrings();
        const defaultRenderKey = buildDefaultRenderKey(localeCode);
        const canReuseRenderedDefaultList = lastRenderedMode === 'default'
            && !defaultListNeedsRefresh
            && lastDefaultRenderKey === defaultRenderKey
            && emojiList.childElementCount > 0;

        if (canReuseRenderedDefaultList) {
            setActiveCategory(emojiCategories, activeCategory);
            scrollToCategory(emojiList, activeCategory, { behavior: 'auto' });
            return;
        }

        window.requestAnimationFrame(() => {
            if (renderSeq !== openRenderSeq) return;
            renderEmojiList({ forceCategoryScroll: true }).then(() => {
                if (renderSeq !== openRenderSeq) return;
                positionEmojiPicker(emojiPicker, emojiBtn, { preserveSize: true });
            }).catch(() => {});
        });
    };

    const onCategoryClick = async (button) => {
        const category = String(button.dataset.cat || '').trim();
        if (!category) return;
        activeCategory = category;
        setActiveCategory(emojiCategories, category);
        ensureActiveCategoryVisible(emojiCategories, category);

        if (normalizeQuery(searchQuery)) {
            await renderEmojiList();
            return;
        }

        const didScroll = scrollToCategory(emojiList, category);
        if (!didScroll) {
            await renderEmojiList({ forceCategoryScroll: true });
            return;
        }
        suppressCategorySyncUntil = performance.now() + 420;
    };

    emojiBtn.addEventListener('pointerdown', (event) => {
        if (!isMobileEmojiViewport()) return;
        const keyboardInset = captureMobileKeyboardInsetSnapshot();
        if (!emojiPicker.classList.contains('active')) {
            if (document.activeElement === messageInput && keyboardInset >= EMOJI_KEYBOARD_INSET_MIN) {
                event.preventDefault();
                event.stopPropagation();
                window.clearTimeout(keyboardSwitchPointerTimer);
                handledKeyboardSwitchPointer = true;
                openPicker({ preferredMobileSheetHeight: keyboardInset, waitForKeyboard: true }).catch(() => {});
                keyboardSwitchPointerTimer = window.setTimeout(() => {
                    handledKeyboardSwitchPointer = false;
                }, 450);
            }
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        window.clearTimeout(keyboardSwitchPointerTimer);
        handledKeyboardSwitchPointer = true;
        closePicker({ focusInput: true });
        keyboardSwitchPointerTimer = window.setTimeout(() => {
            handledKeyboardSwitchPointer = false;
        }, 450);
    });

    emojiBtn.addEventListener('click', async (event) => {
        event.stopPropagation();
        if (handledKeyboardSwitchPointer) {
            event.preventDefault();
            window.clearTimeout(keyboardSwitchPointerTimer);
            handledKeyboardSwitchPointer = false;
            return;
        }
        const shouldOpen = !emojiPicker.classList.contains('active');
        if (shouldOpen) {
            await openPicker();
        } else {
            event.preventDefault();
            closePicker({ focusInput: isMobileEmojiViewport() });
        }
    });

    emojiCategories.addEventListener('click', async (event) => {
        const categoryButton = event.target.closest('.emoji-category-btn');
        if (!categoryButton || !emojiCategories.contains(categoryButton)) return;
        event.preventDefault();
        await onCategoryClick(categoryButton);
    });

    emojiList.addEventListener('click', (event) => {
        const itemButton = event.target.closest('.emoji-item');
        if (!itemButton || !emojiList.contains(itemButton)) return;
        event.preventDefault();
        event.stopPropagation();
        const emoji = String(itemButton.dataset.emoji || '').trim();
        if (!isAllowedPickerEmoji(emoji)) return;

        const selection = getStoredSelection();
        const shouldFocusAfterInsert = !(isMobileEmojiViewport() && emojiPicker.classList.contains('active'));
        const nextSelection = insertAtCursor(messageInput, emoji, {
            selectionStart: selection.start,
            selectionEnd: selection.end,
            focusAfter: shouldFocusAfterInsert,
        });
        setStoredSelection(nextSelection.start, nextSelection.end);
        rememberEmoji(emoji);
        const compactQuery = normalizeQuery(searchQuery);
        if (!compactQuery && lastRenderedMode === 'default' && emojiList.childElementCount > 0) {
            const { localeCode, strings } = getLocaleStrings();
            if (updateRecentSectionInPlace(emojiList, strings)) {
                lastDefaultRenderKey = buildDefaultRenderKey(localeCode);
                defaultListNeedsRefresh = false;
                return;
            }
        }
        defaultListNeedsRefresh = true;
    });

    emojiSearchInput.addEventListener('input', async () => {
        searchQuery = emojiSearchInput.value || '';
        await renderEmojiList();
    });

    emojiSearchClear.addEventListener('click', async (event) => {
        event.preventDefault();
        if (!searchQuery) return;
        searchQuery = '';
        emojiSearchInput.value = '';
        await renderEmojiList({ forceCategoryScroll: true });
    });

    emojiSearchInput.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            if (searchQuery) {
                searchQuery = '';
                emojiSearchInput.value = '';
                renderEmojiList({ forceCategoryScroll: true });
                return;
            }
            closePicker();
        }
    });

    emojiList.addEventListener('scroll', () => {
        if (normalizeQuery(searchQuery)) return;
        if (performance.now() < suppressCategorySyncUntil) return;
        const category = findClosestCategory(emojiList);
        if (!category) return;
        activeCategory = category;
        setActiveCategory(emojiCategories, category);
    }, { passive: true });

    ['focus', 'click', 'keyup', 'select', 'input', 'pointerup', 'touchend'].forEach((eventName) => {
        messageInput.addEventListener(eventName, rememberSelection, { passive: true });
    });

    messageInput.addEventListener('focus', () => {
        if (isMobileEmojiViewport() && emojiPicker.classList.contains('active')) {
            closePicker();
        }
    });

    document.addEventListener('click', (event) => {
        if (!event.target.closest('#emojiPicker') && event.target !== emojiBtn && !emojiBtn.contains(event.target)) {
            closePicker();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closePicker();
        }
    });

    document.addEventListener('sun-open-emoji-picker', (event) => {
        const preferredMobileSheetHeight = Number.parseFloat(event?.detail?.preferredMobileSheetHeight);
        openPicker({
            preferredMobileSheetHeight: Number.isFinite(preferredMobileSheetHeight) && preferredMobileSheetHeight > 0
                ? preferredMobileSheetHeight
                : null,
            waitForKeyboard: event?.detail?.waitForKeyboard === true,
        }).catch(() => {});
    });

    document.addEventListener('sun-close-emoji-picker', () => closePicker());

    window.addEventListener('resize', reposition, { passive: true });
    window.addEventListener('scroll', reposition, { passive: true });
    window.visualViewport?.addEventListener('resize', reposition);
    window.visualViewport?.addEventListener('scroll', reposition);
    window.addEventListener('sun-ui-language-changed', () => {
        defaultListNeedsRefresh = true;
        syncEmojiButtonMode();
        const pickerVisible = emojiPicker.classList.contains('active') || emojiPicker.classList.contains('is-closing');
        if (!pickerVisible) return;
        renderEmojiList();
    });

    updateSearchUi(getLocaleStrings().strings);
    syncEmojiButtonMode(false);

    const prewarmEmojiData = () => {
        loadEmojiData()
            .then((data) => {
                if (!data) return;
                if (emojiPicker.classList.contains('active') || emojiPicker.classList.contains('is-closing')) return;
                if (emojiList.childElementCount > 0 && lastRenderedMode === 'default' && !defaultListNeedsRefresh) return;
                return renderEmojiList();
            })
            .catch(() => {});
    };
    if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(() => prewarmEmojiData(), { timeout: 600 });
    } else {
        window.setTimeout(prewarmEmojiData, 80);
    }
}
