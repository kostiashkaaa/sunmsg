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
const EMOJI_CLOSE_ANIMATION_MS = 240;
const MOBILE_EMOJI_CHAT_PIN_THRESHOLD = 96;
const MOBILE_EMOJI_TAP_CANCEL_PX = 10;
const MOBILE_KEYBOARD_HANDOFF_DELTA_PX = 24;
const MOBILE_KEYBOARD_HANDOFF_MAX_MS = 900;
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

function setMobileEmojiSheetState(emojiPicker, isOpen) {
    const chatArea = resolveEmojiChatArea(emojiPicker);
    if (!chatArea) return;

    const shouldPinChatToBottom = Boolean(
        isOpen
        && isMobileEmojiViewport()
        && isMobileEmojiChatPinnedToBottom(chatArea),
    );

    // The emoji sheet has a fixed CSS height (--mobile-emoji-sheet-height set in
    // the stylesheet) — JS only toggles the open class. No height measuring.
    chatArea.classList.toggle('emoji-sheet-open', Boolean(isOpen));
    document.documentElement.classList.toggle('mobile-emoji-sheet-open', Boolean(isOpen));
    if (isOpen && shouldPinChatToBottom) {
        pinMobileEmojiChatToBottom(chatArea);
    }
    // Toggling the sheet class changes the composer height. Notify the viewport
    // runtime so it recomputes the message-list insets explicitly instead of
    // relying on a visualViewport resize event that may never fire (e.g. when
    // the sheet opens without a keyboard hand-off).
    document.dispatchEvent(new CustomEvent('sun:emoji-sheet-toggled', {
        detail: { open: Boolean(isOpen) },
    }));
}

function clearMobileEmojiSheetState(emojiPicker) {
    setMobileEmojiSheetState(emojiPicker, false);
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

let emojiLoadRetryAt = 0;
const EMOJI_LOAD_RETRY_DELAY_MS = 8000;

async function loadEmojiData() {
    if (emojiData) return emojiData;
    // Allow retry after a cooldown so that a transient network error on the
    // first open does not permanently break the picker for the session.
    if (emojiLoadFailed && performance.now() < emojiLoadRetryAt) return null;

    const cachedData = readCachedEmojiData();
    if (cachedData) {
        emojiLoadFailed = false;
        emojiData = cachedData;
        return emojiData;
    }

    try {
        emojiLoadFailed = false;
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
        emojiLoadRetryAt = performance.now() + EMOJI_LOAD_RETRY_DELAY_MS;
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

    // Mobile picker is a pure-CSS bottom sheet — no JS positioning needed.
    if (isMobileEmojiViewport()) {
        emojiPicker.dataset.side = 'mobile-sheet';
        return;
    }

    // Desktop: anchor the floating picker above the composer.
    // position:fixed uses layout-viewport coordinates (same as getBoundingClientRect).
    const layoutW = Math.round(window.innerWidth || document.documentElement.clientWidth || 0);
    const layoutH = Math.round(window.innerHeight || document.documentElement.clientHeight || 0);
    const usableH = layoutH;
    const margin = 10;
    const formRect = emojiBtn.closest('#messageForm')?.getBoundingClientRect() || emojiBtn.getBoundingClientRect();
    const anchorGap = 10;

    const preserveSize = Boolean(options.preserveSize);
    const measuredWidth = Math.round(emojiPicker.offsetWidth || 0);
    const measuredHeight = Math.round(emojiPicker.offsetHeight || 0);
    const targetWidth = preserveSize && measuredWidth > 0
        ? measuredWidth
        : Math.max(
            356,
            Math.min(
                430,
                Math.min(layoutW - 24, Math.round(Math.max(360, formRect.width - 14))),
            ),
        );
    const targetHeight = preserveSize && measuredHeight > 0
        ? measuredHeight
        : Math.max(334, Math.min(486, usableH - 18));

    emojiPicker.style.setProperty('--emoji-width', `${targetWidth}px`);
    emojiPicker.style.setProperty('--emoji-height', `${targetHeight}px`);

    const pickerLayoutWidth = Math.round(emojiPicker.offsetWidth || targetWidth);
    const pickerLayoutHeight = Math.round(emojiPicker.offsetHeight || targetHeight);
    const pickerWidth = Math.min(pickerLayoutWidth, layoutW - margin * 2);
    const pickerHeight = Math.min(pickerLayoutHeight, usableH - margin * 2);

    let left = formRect.left;
    let top = formRect.top - pickerHeight - anchorGap;
    let side = 'top';

    if (top < margin) {
        top = formRect.bottom + anchorGap;
        side = 'bottom';
    }
    if (left + pickerWidth > formRect.right) {
        left = formRect.right - pickerWidth;
    }

    left = Math.max(margin, Math.min(left, layoutW - pickerWidth - margin));
    top = Math.max(margin, Math.min(top, usableH - pickerHeight - margin));

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

    const closePicker = ({ focusInput = false, keyboardOpening = false } = {}) => {
        openRenderSeq += 1;
        const isMobile = isMobileEmojiViewport();
        // The keyboard is (about to be) on screen if we are going to focus the
        // input ourselves, or if the input just received focus on its own.
        const keyboardComing = isMobile && (focusInput || keyboardOpening);

        if (!emojiPicker.classList.contains('active') && !emojiPicker.classList.contains('is-closing')) {
            // Already closed — just normalize state.
            clearMobileEmojiSheetState(emojiPicker);
            emojiPicker.setAttribute('aria-hidden', 'true');
            syncEmojiButtonMode(false);
            if (focusInput) focusComposerInput();
            return;
        }

        const closeSeq = ++emojiCloseSeq;
        emojiPicker.classList.remove('active');
        emojiPicker.setAttribute('aria-hidden', 'true');
        syncEmojiButtonMode(false);

        // When the keyboard is coming up the sheet MUST collapse instantly:
        // otherwise the still-tall closing sheet keeps .chat-input-area
        // expanded while the browser shrinks the viewport for the keyboard,
        // pushing the composer underneath it. Instant collapse makes the flex
        // column correct before the keyboard animates in.
        if (keyboardComing) {
            const chatArea = resolveEmojiChatArea(emojiPicker);
            const visualViewport = window.visualViewport;
            const startViewportHeight = Number(visualViewport?.height || window.innerHeight || 0);
            let handoffTimer = 0;
            emojiPicker.classList.add('is-closing-instant');
            chatArea?.classList.add('emoji-sheet-keyboard-handoff');
            document.documentElement.classList.add('mobile-emoji-keyboard-handoff');
            clearMobileEmojiSheetState(emojiPicker);
            if (focusInput) focusComposerInput();

            const releaseKeyboardHandoff = () => {
                if (closeSeq !== emojiCloseSeq) return;
                if (handoffTimer) {
                    window.clearTimeout(handoffTimer);
                    handoffTimer = 0;
                }
                visualViewport?.removeEventListener('resize', maybeReleaseKeyboardHandoff);
                visualViewport?.removeEventListener('scroll', maybeReleaseKeyboardHandoff);
                emojiPicker.classList.remove('is-closing-instant');
                chatArea?.classList.remove('emoji-sheet-keyboard-handoff');
                document.documentElement.classList.remove('mobile-emoji-keyboard-handoff');
            };

            function maybeReleaseKeyboardHandoff() {
                if (closeSeq !== emojiCloseSeq) return;
                const currentViewportHeight = Number(visualViewport?.height || window.innerHeight || 0);
                if (
                    !startViewportHeight
                    || currentViewportHeight <= startViewportHeight - MOBILE_KEYBOARD_HANDOFF_DELTA_PX
                    || document.activeElement !== messageInput
                ) {
                    releaseKeyboardHandoff();
                }
            }

            visualViewport?.addEventListener('resize', maybeReleaseKeyboardHandoff, { passive: true });
            visualViewport?.addEventListener('scroll', maybeReleaseKeyboardHandoff, { passive: true });
            handoffTimer = window.setTimeout(releaseKeyboardHandoff, MOBILE_KEYBOARD_HANDOFF_MAX_MS);
            window.requestAnimationFrame(() => {
                window.requestAnimationFrame(maybeReleaseKeyboardHandoff);
            });
            return;
        }

        emojiPicker.classList.add('is-closing');

        waitForMotionEnd(emojiPicker, maxTransitionMs(emojiPicker, EMOJI_CLOSE_ANIMATION_MS)).then(() => {
            if (closeSeq !== emojiCloseSeq) return;
            emojiPicker.classList.remove('is-closing');
            clearMobileEmojiSheetState(emojiPicker);
        });
    };

    const openPicker = async (options = {}) => {
        rememberSelection();
        emojiCloseSeq += 1;
        const renderSeq = ++openRenderSeq;
        const shouldOpenMobile = isMobileEmojiViewport();

        searchQuery = '';
        emojiSearchInput.value = '';
        activeCategory = DEFAULT_EMOJI_CATEGORY;
        emojiPicker.classList.remove('is-closing');
        resolveEmojiChatArea(emojiPicker)?.classList.remove('emoji-sheet-keyboard-handoff');
        document.documentElement.classList.remove('mobile-emoji-keyboard-handoff');
        emojiPicker.classList.add('active');
        emojiPicker.setAttribute('aria-hidden', 'false');
        document.dispatchEvent(new Event('sun-close-header-dropdown'));

        if (shouldOpenMobile) {
            // Mark the chat-area first so CSS docks the composer before the
            // native keyboard blur starts resizing the viewport.
            setMobileEmojiSheetState(emojiPicker, true);
            if (document.activeElement === messageInput) {
                messageInput.blur();
            }
        } else {
            positionEmojiPicker(emojiPicker, emojiBtn);
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
                if (!isMobileEmojiViewport()) {
                    positionEmojiPicker(emojiPicker, emojiBtn, { preserveSize: true });
                }
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

    // On mobile we handle the toggle on pointerdown and preventDefault so the
    // emoji button never steals focus from the textarea — this keeps the
    // emoji-sheet <-> keyboard switch a single clean transition.
    emojiBtn.addEventListener('pointerdown', (event) => {
        if (!isMobileEmojiViewport()) return;
        event.preventDefault();
        event.stopPropagation();
        window.clearTimeout(keyboardSwitchPointerTimer);
        handledKeyboardSwitchPointer = true;
        keyboardSwitchPointerTimer = window.setTimeout(() => {
            handledKeyboardSwitchPointer = false;
        }, 450);
        if (emojiPicker.classList.contains('active')) {
            // Emoji sheet -> keyboard
            closePicker({ focusInput: true });
        } else {
            // Keyboard / nothing -> emoji sheet
            openPicker().catch(() => {});
        }
    });

    emojiBtn.addEventListener('click', async (event) => {
        event.stopPropagation();
        if (handledKeyboardSwitchPointer) {
            // Already handled on pointerdown (mobile path).
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

    const selectEmojiItem = (itemButton, options = {}) => {
        const emoji = String(itemButton?.dataset?.emoji || '').trim();
        if (!isAllowedPickerEmoji(emoji)) return false;

        const selection = getStoredSelection();
        const shouldFocusAfterInsert = options.focusAfter
            ?? !(isMobileEmojiViewport() && emojiPicker.classList.contains('active'));
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
                return true;
            }
        }
        defaultListNeedsRefresh = true;
        return true;
    };

    // Immediate tactile feedback: pop the emoji the moment the finger lands,
    // before the mobile pointerup/click path that actually inserts it.
    const playEmojiTapFeedback = (itemButton) => {
        if (!itemButton) return;
        itemButton.classList.remove('emoji-item--tapped');
        // Force reflow so the animation restarts on rapid repeated taps.
        void itemButton.offsetWidth;
        itemButton.classList.add('emoji-item--tapped');
        window.setTimeout(() => {
            itemButton.classList.remove('emoji-item--tapped');
        }, 300);
    };

    const playComposerInsertFeedback = () => {
        if (!isMobileEmojiViewport()) return;
        const feedbackTarget = messageInput.closest('.composer-input-visual-wrap') || messageInput;
        feedbackTarget.classList.remove('composer-emoji-insert-feedback');
        void feedbackTarget.offsetWidth;
        feedbackTarget.classList.add('composer-emoji-insert-feedback');
        window.setTimeout(() => {
            feedbackTarget.classList.remove('composer-emoji-insert-feedback');
        }, 180);
    };

    let pendingEmojiPointer = null;
    let suppressNextEmojiClick = false;
    let suppressNextEmojiClickTimer = 0;

    const clearPendingEmojiPointer = (pointerId) => {
        if (!pendingEmojiPointer) return;
        if (Number.isFinite(pointerId) && pendingEmojiPointer.pointerId !== pointerId) return;
        pendingEmojiPointer = null;
    };

    const suppressNextClickAfterPointerSelect = () => {
        suppressNextEmojiClick = true;
        window.clearTimeout(suppressNextEmojiClickTimer);
        suppressNextEmojiClickTimer = window.setTimeout(() => {
            suppressNextEmojiClick = false;
        }, 500);
    };

    const restorePendingEmojiSelection = (pending) => {
        if (!pending?.selected || messageInput.value !== pending.valueAfter) return;
        messageInput.value = pending.valueBefore;
        setStoredSelection(pending.selectionBefore.start, pending.selectionBefore.end);
        try {
            messageInput.setSelectionRange(pending.selectionBefore.start, pending.selectionBefore.end);
        } catch (_) {
            // Some mobile browsers reject selection changes during touch scroll.
        }
        messageInput.dispatchEvent(new Event('input', { bubbles: true }));
    };

    emojiList.addEventListener('pointerdown', (event) => {
        const itemButton = event.target.closest('.emoji-item');
        if (!itemButton || !emojiList.contains(itemButton)) return;
        playEmojiTapFeedback(itemButton);
        if (!isMobileEmojiViewport() || event.pointerType === 'mouse' || event.isPrimary === false) return;
        pendingEmojiPointer = {
            pointerId: event.pointerId,
            itemButton,
            startX: event.clientX,
            startY: event.clientY,
            moved: false,
            selected: false,
            selectFrame: 0,
            valueBefore: messageInput.value,
            valueAfter: '',
            selectionBefore: getStoredSelection(),
        };
        pendingEmojiPointer.selectFrame = window.requestAnimationFrame(() => {
            const pending = pendingEmojiPointer;
            if (!pending || pending.pointerId !== event.pointerId || pending.moved || pending.selected) return;
            pending.selected = selectEmojiItem(itemButton, { focusAfter: false });
            if (pending.selected) {
                pending.valueAfter = messageInput.value;
                playComposerInsertFeedback();
                suppressNextClickAfterPointerSelect();
            }
        });
    }, { passive: true });

    emojiList.addEventListener('pointermove', (event) => {
        const pending = pendingEmojiPointer;
        if (!pending || pending.pointerId !== event.pointerId) return;
        const dx = event.clientX - pending.startX;
        const dy = event.clientY - pending.startY;
        pending.moved = pending.moved || (dx * dx + dy * dy) > (MOBILE_EMOJI_TAP_CANCEL_PX * MOBILE_EMOJI_TAP_CANCEL_PX);
        if (pending.moved) {
            if (pending.selectFrame) {
                window.cancelAnimationFrame(pending.selectFrame);
                pending.selectFrame = 0;
            }
            restorePendingEmojiSelection(pending);
        }
    }, { passive: true });

    emojiList.addEventListener('pointercancel', (event) => {
        if (pendingEmojiPointer?.pointerId === event.pointerId) {
            if (pendingEmojiPointer.selectFrame) {
                window.cancelAnimationFrame(pendingEmojiPointer.selectFrame);
            }
            restorePendingEmojiSelection(pendingEmojiPointer);
        }
        clearPendingEmojiPointer(event.pointerId);
    }, { passive: true });

    emojiList.addEventListener('pointerup', (event) => {
        const pending = pendingEmojiPointer;
        if (!pending || pending.pointerId !== event.pointerId) return;
        pendingEmojiPointer = null;
        const itemButton = event.target.closest('.emoji-item');
        if (pending.moved || itemButton !== pending.itemButton || !emojiList.contains(itemButton)) return;

        event.preventDefault();
        event.stopPropagation();
        if (pending.selectFrame) {
            window.cancelAnimationFrame(pending.selectFrame);
        }
        if (!pending.selected && selectEmojiItem(itemButton, { focusAfter: false })) {
            playComposerInsertFeedback();
            suppressNextClickAfterPointerSelect();
        }
    });

    emojiList.addEventListener('click', (event) => {
        const itemButton = event.target.closest('.emoji-item');
        if (!itemButton || !emojiList.contains(itemButton)) return;
        event.preventDefault();
        event.stopPropagation();
        if (suppressNextEmojiClick) {
            suppressNextEmojiClick = false;
            window.clearTimeout(suppressNextEmojiClickTimer);
            return;
        }
        selectEmojiItem(itemButton);
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
            // The keyboard is opening (the input just got focus) — collapse the
            // sheet instantly so the composer is not left under the keyboard.
            closePicker({ keyboardOpening: true });
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

    document.addEventListener('sun-open-emoji-picker', () => {
        openPicker().catch(() => {});
    });

    document.addEventListener('sun-close-emoji-picker', () => closePicker());

    // Reposition is only meaningful for the desktop floating picker; the mobile
    // sheet is pinned by CSS and must not be touched on viewport resize.
    window.addEventListener('resize', reposition, { passive: true });
    window.addEventListener('scroll', reposition, { passive: true });
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
