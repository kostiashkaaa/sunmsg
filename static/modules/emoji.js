import { applyEmojiGraphics } from './utils.js';
import { withAppRoot } from './app-url.js';
import {
    EMOJI_CATEGORY_META,
    EMOJI_CATEGORY_ORDER,
    GIF_CATEGORY_META,
    GIF_CATEGORY_ORDER,
    GIF_ITEMS,
    PICKER_I18N,
    PICKER_TABS,
    STICKER_CATEGORY_META,
    STICKER_CATEGORY_ORDER,
    STICKER_ITEMS,
    resolvePickerLocale,
} from './emoji-picker-data.js';

let emojiData = null;
let emojiLoadFailed = false;
let lastPopulateRequestId = 0;

const RECENT_STORAGE_KEYS = {
    emoji: 'sun_recent_emojis_v1',
    stickers: 'sun_recent_stickers_v1',
    gifs: 'sun_recent_gifs_v1',
};
const MAX_RECENT_ITEMS = {
    emoji: 48,
    stickers: 36,
    gifs: 36,
};
const DEFAULT_TAB = 'emoji';
const TAB_DEFAULT_CATEGORY = {
    emoji: 'frequent',
    stickers: 'recent',
    gifs: 'recent',
};

const DISALLOWED_PICKER_EMOJIS = new Set([
    '\uD83C\uDFF3\uFE0F\u200D\uD83C\uDF08', // rainbow flag
    '\uD83C\uDFF3\uFE0F\u200D\u26A7\uFE0F', // transgender flag
]);
const MOBILE_EMOJI_QUERY = '(max-width: 768px)';
const MOBILE_EMOJI_MIN_HEIGHT = 344;
const MOBILE_EMOJI_MAX_HEIGHT = 520;
const MOBILE_EMOJI_HEIGHT_RATIO = 0.56;
const EMOJI_CLOSE_ANIMATION_MS = 190;
const EMOJI_KEYBOARD_HANDOFF_MS = 720;
const EMOJI_KEYBOARD_INSET_MIN = 80;
const CATEGORY_SCROLL_SYNC_OFFSET = 24;
const SWIPE_DISTANCE_MIN = 52;
const SWIPE_RATIO_MIN = 1.2;

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

const STICKER_LOOKUP = buildItemLookup(STICKER_ITEMS);
const GIF_LOOKUP = buildItemLookup(GIF_ITEMS);

let emojiCloseSeq = 0;
let emojiKeyboardHandoffTimer = null;
let emojiKeyboardHandoffFrame = 0;

function buildItemLookup(groupedItems) {
    const map = new Map();
    Object.values(groupedItems || {}).forEach((items) => {
        items?.forEach((item) => {
            if (!item?.id) return;
            map.set(item.id, item);
        });
    });
    return map;
}

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

function resolveEmojiChatArea(emojiPicker) {
    return emojiPicker?.closest('.chat-area') || document.getElementById('chatArea');
}

function setMobileEmojiSheetState(emojiPicker, isOpen, height = null) {
    const chatArea = resolveEmojiChatArea(emojiPicker);
    if (!chatArea) return;

    chatArea.classList.toggle('emoji-sheet-open', Boolean(isOpen));
    if (isOpen && Number.isFinite(height)) {
        chatArea.style.setProperty('--mobile-emoji-sheet-height', `${Math.round(height)}px`);
    } else if (!isOpen) {
        chatArea.classList.remove('emoji-keyboard-handoff');
        chatArea.style.removeProperty('--mobile-emoji-sheet-height');
    }
}

function clearMobileEmojiSheetState(emojiPicker) {
    setMobileEmojiSheetState(emojiPicker, false);
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

function startEmojiKeyboardHandoff(emojiPicker) {
    const chatArea = resolveEmojiChatArea(emojiPicker);
    if (!chatArea || !isMobileEmojiViewport()) return false;

    stopEmojiKeyboardHandoff(emojiPicker);
    chatArea.classList.add('emoji-keyboard-handoff');
    const startedAt = performance.now();

    const finish = () => {
        stopEmojiKeyboardHandoff(emojiPicker, { clearLayout: true });
    };
    const tick = () => {
        const elapsed = performance.now() - startedAt;
        const keyboardInset = readRootPixelVar('--mobile-composer-bottom-inset');
        if (keyboardInset >= EMOJI_KEYBOARD_INSET_MIN || elapsed >= EMOJI_KEYBOARD_HANDOFF_MS) {
            finish();
            return;
        }
        emojiKeyboardHandoffFrame = window.requestAnimationFrame(tick);
    };

    emojiKeyboardHandoffTimer = window.setTimeout(finish, EMOJI_KEYBOARD_HANDOFF_MS);
    emojiKeyboardHandoffFrame = window.requestAnimationFrame(tick);
    return true;
}

function isAllowedPickerEmoji(value) {
    return typeof value === 'string'
        && value.trim().length > 0
        && !DISALLOWED_PICKER_EMOJIS.has(value);
}

function sanitizeRecentEntry(kind, raw) {
    const value = String(raw || '').trim();
    if (!value) return '';
    if (kind === 'emoji') {
        return isAllowedPickerEmoji(value) ? value : '';
    }
    if (kind === 'stickers') {
        return STICKER_LOOKUP.has(value) ? value : '';
    }
    if (kind === 'gifs') {
        return GIF_LOOKUP.has(value) ? value : '';
    }
    return '';
}

function getRecentItems(kind) {
    const storageKey = RECENT_STORAGE_KEYS[kind];
    const maxItems = MAX_RECENT_ITEMS[kind] || 0;
    if (!storageKey || maxItems <= 0) return [];
    try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        const sanitized = parsed
            .map((entry) => sanitizeRecentEntry(kind, entry))
            .filter(Boolean)
            .slice(0, maxItems);
        if (sanitized.length !== parsed.length) {
            localStorage.setItem(storageKey, JSON.stringify(sanitized));
        }
        return sanitized;
    } catch (error) {
        console.warn(`Failed to read recent ${kind}`, error);
        return [];
    }
}

function saveRecentItems(kind, values) {
    const storageKey = RECENT_STORAGE_KEYS[kind];
    const maxItems = MAX_RECENT_ITEMS[kind] || 0;
    if (!storageKey || maxItems <= 0) return;
    try {
        localStorage.setItem(storageKey, JSON.stringify(values.slice(0, maxItems)));
    } catch (error) {
        console.warn(`Failed to save recent ${kind}`, error);
    }
}

function rememberRecentItem(kind, value) {
    const sanitized = sanitizeRecentEntry(kind, value);
    if (!sanitized) return;
    const list = getRecentItems(kind).filter((entry) => entry !== sanitized);
    list.unshift(sanitized);
    saveRecentItems(kind, list);
}

function resolveEmojiUiLanguage() {
    const explicitLanguage = window.SUN_I18N?.getLanguage?.()
        || window.SUN_BOOTSTRAP?.user?.uiLanguage
        || document.documentElement.lang
        || '';
    return resolvePickerLocale(explicitLanguage);
}

function getEmojiButtonLabel(mode) {
    const localeCode = resolveEmojiUiLanguage();
    if (mode === 'keyboard') {
        return localeCode === 'en' ? 'Show keyboard' : 'Показать клавиатуру';
    }
    return localeCode === 'en' ? 'Show emojis' : 'Показать смайлики';
}

function getLocaleStrings() {
    const localeCode = resolveEmojiUiLanguage();
    return {
        localeCode,
        strings: PICKER_I18N[localeCode] || PICKER_I18N.ru,
    };
}

async function loadEmojiData() {
    if (emojiData) return emojiData;
    if (emojiLoadFailed) return null;

    try {
        const resp = await fetch(withAppRoot('/static/emojis.json'));
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        emojiData = await resp.json();
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

function createCategoryConfig(tab) {
    if (tab === 'stickers') {
        return { order: STICKER_CATEGORY_ORDER, meta: STICKER_CATEGORY_META };
    }
    if (tab === 'gifs') {
        return { order: GIF_CATEGORY_ORDER, meta: GIF_CATEGORY_META };
    }
    return { order: EMOJI_CATEGORY_ORDER, meta: EMOJI_CATEGORY_META };
}

function matchesText(query, values = []) {
    if (!query) return true;
    const compact = query.toLowerCase();
    return values.some((value) => String(value || '').toLowerCase().includes(compact));
}

function buildEmojiSearchResults(data, query, localeCode) {
    const compactQuery = normalizeQuery(query);
    const recent = getRecentItems('emoji');
    const recentSet = new Set(recent);
    const scored = [];
    const seen = new Set();

    EMOJI_CATEGORY_ORDER.filter((category) => category !== 'frequent').forEach((category) => {
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
                score: (recentSet.has(emoji) ? 3 : 0) + (inlineKeywords.length ? 1 : 0),
            });
        });
    });

    scored.sort((left, right) => right.score - left.score || left.emoji.localeCompare(right.emoji));
    return scored.map((entry) => entry.emoji);
}

function buildDefaultEmojiSections(data, localeCode) {
    const sections = [];
    const recent = getRecentItems('emoji');

    EMOJI_CATEGORY_ORDER.forEach((category) => {
        const meta = EMOJI_CATEGORY_META[category];
        const title = getLocalizedTitle(meta, category, localeCode);
        const items = category === 'frequent'
            ? recent
            : (Array.isArray(data?.[category]) ? data[category].filter((emoji) => isAllowedPickerEmoji(emoji)) : []);
        sections.push({
            id: category,
            title,
            items,
            type: 'emoji',
        });
    });
    return sections;
}

function buildStickerSections(query, localeCode, strings) {
    const compactQuery = normalizeQuery(query);
    const recentIds = getRecentItems('stickers');
    const recentItems = recentIds.map((id) => STICKER_LOOKUP.get(id)).filter(Boolean);

    if (compactQuery) {
        const allItems = Object.values(STICKER_ITEMS).flat();
        const recentSet = new Set(recentIds);
        const filtered = allItems
            .filter((item) => matchesText(compactQuery, [item.ru, item.en, ...(item.keywords || [])]))
            .sort((left, right) => {
                const leftScore = recentSet.has(left.id) ? 1 : 0;
                const rightScore = recentSet.has(right.id) ? 1 : 0;
                return rightScore - leftScore || left.en.localeCompare(right.en);
            });
        return [{
            id: 'search',
            title: strings.searchResultsTitle,
            items: filtered,
            type: 'stickers',
        }];
    }

    const sections = [{
        id: 'recent',
        title: strings.recentTitle,
        items: recentItems,
        type: 'stickers',
    }];

    STICKER_CATEGORY_ORDER.filter((category) => category !== 'recent').forEach((category) => {
        const meta = STICKER_CATEGORY_META[category];
        sections.push({
            id: category,
            title: getLocalizedTitle(meta, category, localeCode),
            items: STICKER_ITEMS[category] || [],
            type: 'stickers',
        });
    });
    return sections;
}

function buildGifSections(query, localeCode, strings) {
    const compactQuery = normalizeQuery(query);
    const recentIds = getRecentItems('gifs');
    const recentItems = recentIds.map((id) => GIF_LOOKUP.get(id)).filter(Boolean);

    if (compactQuery) {
        const allItems = Object.values(GIF_ITEMS).flat();
        const recentSet = new Set(recentIds);
        const filtered = allItems
            .filter((item) => matchesText(compactQuery, [item.ru, item.en, ...(item.keywords || [])]))
            .sort((left, right) => {
                const leftScore = recentSet.has(left.id) ? 1 : 0;
                const rightScore = recentSet.has(right.id) ? 1 : 0;
                return rightScore - leftScore || left.en.localeCompare(right.en);
            });
        return [{
            id: 'search',
            title: strings.searchResultsTitle,
            items: filtered,
            type: 'gifs',
        }];
    }

    const sections = [{
        id: 'recent',
        title: strings.recentTitle,
        items: recentItems,
        type: 'gifs',
    }];

    GIF_CATEGORY_ORDER.filter((category) => category !== 'recent').forEach((category) => {
        const meta = GIF_CATEGORY_META[category];
        sections.push({
            id: category,
            title: getLocalizedTitle(meta, category, localeCode),
            items: GIF_ITEMS[category] || [],
            type: 'gifs',
        });
    });
    return sections;
}

function createEmojiItemButton(emoji) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'emoji-item';
    button.dataset.pickerItemKind = 'emoji';
    button.dataset.emoji = emoji;
    button.setAttribute('aria-label', `Эмодзи ${emoji}`);
    button.textContent = emoji;
    return button;
}

function createStickerItemButton(item, localeCode, strings) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'emoji-sticker-item';
    button.dataset.pickerItemKind = 'stickers';
    button.dataset.itemId = item.id;
    button.setAttribute('aria-label', `${strings.stickerHint} ${localeCode === 'en' ? item.en : item.ru}`);
    button.innerHTML = `
        <span class="emoji-sticker-item__emoji">${item.emoji}</span>
        <span class="emoji-sticker-item__label">${localeCode === 'en' ? item.en : item.ru}</span>
    `;
    return button;
}

function createGifItemButton(item, localeCode, strings) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'emoji-gif-item';
    button.dataset.pickerItemKind = 'gifs';
    button.dataset.itemId = item.id;
    if (item.color) {
        button.style.setProperty('--gif-tone', item.color);
    }
    button.setAttribute('aria-label', `${strings.gifHint} ${localeCode === 'en' ? item.en : item.ru}`);
    button.innerHTML = `
        <span class="emoji-gif-item__badge">GIF</span>
        <span class="emoji-gif-item__emoji">${item.emoji}</span>
        <span class="emoji-gif-item__label">${localeCode === 'en' ? item.en : item.ru}</span>
    `;
    return button;
}

function createSectionElement(section, localeCode, strings) {
    const sectionEl = document.createElement('section');
    sectionEl.className = 'emoji-section';
    sectionEl.dataset.sectionCat = section.id;

    const titleEl = document.createElement('h3');
    titleEl.className = 'emoji-section-title';
    titleEl.textContent = section.title;
    sectionEl.appendChild(titleEl);

    const gridEl = document.createElement('div');
    if (section.type === 'stickers') {
        gridEl.className = 'emoji-sticker-grid';
    } else if (section.type === 'gifs') {
        gridEl.className = 'emoji-gif-grid';
    } else {
        gridEl.className = 'emoji-section-grid';
    }

    section.items.forEach((item) => {
        if (section.type === 'stickers') {
            gridEl.appendChild(createStickerItemButton(item, localeCode, strings));
            return;
        }
        if (section.type === 'gifs') {
            gridEl.appendChild(createGifItemButton(item, localeCode, strings));
            return;
        }
        gridEl.appendChild(createEmojiItemButton(item));
    });

    sectionEl.appendChild(gridEl);
    return sectionEl;
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

function renderCategoryButtons(emojiCategories, tab, categoryByTab, localeCode) {
    const config = createCategoryConfig(tab);
    const currentCategory = categoryByTab[tab] || TAB_DEFAULT_CATEGORY[tab];
    const fragment = document.createDocumentFragment();
    emojiCategories.innerHTML = '';

    config.order.forEach((category) => {
        const meta = config.meta?.[category];
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
    setActiveCategory(emojiCategories, currentCategory);
    ensureActiveCategoryVisible(emojiCategories, currentCategory);
    applyEmojiGraphics(emojiCategories);
}

function setActiveTabButtons(emojiPicker, activeTab) {
    emojiPicker.querySelectorAll('[data-picker-tab]').forEach((button) => {
        const isActive = button.dataset.pickerTab === activeTab;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-selected', isActive ? 'true' : 'false');
        if (button.classList.contains('emoji-tab-btn')) {
            button.setAttribute('tabindex', isActive ? '0' : '-1');
        }
    });
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
    const formRect = emojiBtn.closest('#messageForm')?.getBoundingClientRect() || emojiBtn.getBoundingClientRect();
    const anchorGap = 10;

    if (isMobile) {
        const mobileViewportHeight = Math.max(
            viewportHeight,
            Math.round(window.innerHeight || 0),
            Math.round(document.documentElement.clientHeight || 0),
            readRootPixelVar('--app-vh'),
        );
        const maxSheetHeight = Math.max(300, Math.min(MOBILE_EMOJI_MAX_HEIGHT, mobileViewportHeight - 80));
        const sheetHeight = Math.round(Math.min(
            maxSheetHeight,
            Math.max(MOBILE_EMOJI_MIN_HEIGHT, mobileViewportHeight * MOBILE_EMOJI_HEIGHT_RATIO),
        ));
        const sheetWidth = Math.max(0, viewportWidth);
        const left = Math.round(viewportOffsetLeft);
        const top = Math.round(viewportOffsetTop + mobileViewportHeight - sheetHeight);

        emojiPicker.style.setProperty('--emoji-left', `${left}px`);
        emojiPicker.style.setProperty('--emoji-top', `${top}px`);
        emojiPicker.style.setProperty('--emoji-width', `${sheetWidth}px`);
        emojiPicker.style.setProperty('--emoji-height', `${sheetHeight}px`);
        emojiPicker.style.transformOrigin = 'bottom center';
        emojiPicker.dataset.side = 'mobile-sheet';
        setMobileEmojiSheetState(emojiPicker, true, sheetHeight);
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
        if (section.offsetTop <= targetTop) {
            activeCategory = section.dataset.sectionCat || activeCategory;
        }
    });
    return activeCategory;
}

function scrollToCategory(emojiList, categoryId) {
    const section = emojiList.querySelector(`.emoji-section[data-section-cat="${categoryId}"]`);
    if (!section) return false;
    emojiList.scrollTo({
        top: Math.max(0, Math.round(section.offsetTop - 6)),
        behavior: 'smooth',
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
    const emojiContentViewport = document.getElementById('emojiContentViewport');
    if (!emojiBtn || !emojiPicker || !emojiList || !emojiCategories || !emojiSearchInput || !emojiSearchClear || !emojiContentViewport || !messageInput) {
        return;
    }

    let activeTab = DEFAULT_TAB;
    const categoryByTab = { ...TAB_DEFAULT_CATEGORY };
    let searchQuery = '';
    let lastSelectionStart = messageInput.value.length;
    let lastSelectionEnd = lastSelectionStart;
    let handledKeyboardSwitchPointer = false;
    let keyboardSwitchPointerTimer = null;
    let suppressCategorySyncUntil = 0;
    let swipeSession = null;

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
        const placeholder = strings?.searchPlaceholder?.[activeTab] || strings?.searchPlaceholder?.emoji || 'Search';
        emojiSearchInput.placeholder = placeholder;
        emojiSearchClear.hidden = !searchQuery;
    };

    const buildInsertText = (kind, item, localeCode, strings) => {
        if (kind === 'emoji') return item;
        if (kind === 'stickers') return `${item.emoji} `;
        const title = localeCode === 'en' ? item.en : item.ru;
        return `[${strings.gifHint}] ${title} `;
    };

    const refreshCategories = () => {
        const { localeCode } = getLocaleStrings();
        renderCategoryButtons(emojiCategories, activeTab, categoryByTab, localeCode);
    };

    const renderActiveTab = async ({ forceCategoryScroll = false } = {}) => {
        const requestId = ++lastPopulateRequestId;
        const { localeCode, strings } = getLocaleStrings();
        updateSearchUi(strings);
        refreshCategories();

        if (activeTab === 'emoji') {
            setEmojiStatus(emojiList, '<i class="bi bi-hourglass-split"></i>');
            const data = await loadEmojiData();
            if (requestId !== lastPopulateRequestId) return;
            if (!data) {
                setEmojiStatus(emojiList, strings.noEmojiData);
                return;
            }

            const compactQuery = normalizeQuery(searchQuery);
            const sections = compactQuery
                ? [{
                    id: 'search',
                    title: strings.searchResultsTitle,
                    items: buildEmojiSearchResults(data, compactQuery, localeCode),
                    type: 'emoji',
                }]
                : buildDefaultEmojiSections(data, localeCode);

            if (!sections.length || !sections.some((section) => section.items.length)) {
                setEmojiStatus(emojiList, strings.emptySearch);
                return;
            }

            emojiList.innerHTML = '';
            const fragment = document.createDocumentFragment();
            sections.forEach((section) => {
                const sectionEl = createSectionElement(section, localeCode, strings);
                if (!section.items.length) {
                    const emptyEl = document.createElement('div');
                    emptyEl.className = 'emoji-list-status emoji-list-status--inline';
                    emptyEl.textContent = section.id === 'frequent' ? strings.emptyRecentEmoji : strings.emptySearch;
                    sectionEl.appendChild(emptyEl);
                }
                fragment.appendChild(sectionEl);
            });
            emojiList.appendChild(fragment);
            applyEmojiGraphics(emojiList);

            if (!compactQuery) {
                const selectedCategory = categoryByTab.emoji || TAB_DEFAULT_CATEGORY.emoji;
                setActiveCategory(emojiCategories, selectedCategory);
                if (forceCategoryScroll) {
                    scrollToCategory(emojiList, selectedCategory);
                }
            } else {
                setActiveCategory(emojiCategories, '');
            }
            return;
        }

        const sections = activeTab === 'stickers'
            ? buildStickerSections(searchQuery, localeCode, strings)
            : buildGifSections(searchQuery, localeCode, strings);

        if (!sections.length || !sections.some((section) => section.items.length)) {
            const isSticker = activeTab === 'stickers';
            const emptyText = normalizeQuery(searchQuery)
                ? strings.emptySearch
                : (isSticker ? strings.emptyRecentSticker : strings.emptyRecentGif);
            setEmojiStatus(emojiList, emptyText);
            return;
        }

        emojiList.innerHTML = '';
        const fragment = document.createDocumentFragment();
        sections.forEach((section) => {
            const sectionEl = createSectionElement(section, localeCode, strings);
            if (!section.items.length && section.id === 'recent') {
                const emptyEl = document.createElement('div');
                emptyEl.className = 'emoji-list-status emoji-list-status--inline';
                emptyEl.textContent = activeTab === 'stickers' ? strings.emptyRecentSticker : strings.emptyRecentGif;
                sectionEl.appendChild(emptyEl);
            }
            fragment.appendChild(sectionEl);
        });
        emojiList.appendChild(fragment);
        applyEmojiGraphics(emojiList);

        const compactQuery = normalizeQuery(searchQuery);
        if (!compactQuery) {
            const selectedCategory = categoryByTab[activeTab] || TAB_DEFAULT_CATEGORY[activeTab];
            setActiveCategory(emojiCategories, selectedCategory);
            if (forceCategoryScroll) {
                scrollToCategory(emojiList, selectedCategory);
            }
        } else {
            setActiveCategory(emojiCategories, '');
        }
    };

    const setTab = async (nextTab, options = {}) => {
        const normalizedTab = PICKER_TABS.includes(nextTab) ? nextTab : DEFAULT_TAB;
        const shouldRender = options.render !== false;
        if (activeTab === normalizedTab && !options.force) return;
        activeTab = normalizedTab;
        emojiPicker.setAttribute('data-active-tab', activeTab);
        setActiveTabButtons(emojiPicker, activeTab);
        if (shouldRender) {
            await renderActiveTab({ forceCategoryScroll: true });
        }
    };

    const switchTabByDelta = async (delta) => {
        const currentIndex = PICKER_TABS.indexOf(activeTab);
        if (currentIndex < 0) return;
        const nextIndex = Math.max(0, Math.min(PICKER_TABS.length - 1, currentIndex + delta));
        if (nextIndex === currentIndex) return;
        await setTab(PICKER_TABS[nextIndex], { force: true });
    };

    const reposition = () => {
        if (emojiPicker.classList.contains('active')) {
            positionEmojiPicker(emojiPicker, emojiBtn, { preserveSize: true });
            syncEmojiButtonMode(true);
        }
    };

    const closePicker = ({ focusInput = false } = {}) => {
        const wantsKeyboardHandoff = isMobileEmojiViewport()
            && (focusInput || document.activeElement === messageInput);
        if (!emojiPicker.classList.contains('active') && !emojiPicker.classList.contains('is-closing')) {
            if (wantsKeyboardHandoff) {
                startEmojiKeyboardHandoff(emojiPicker);
            } else {
                clearMobileEmojiSheetState(emojiPicker);
            }
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
            startEmojiKeyboardHandoff(emojiPicker);
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

    const openPicker = async () => {
        rememberSelection();
        stopEmojiKeyboardHandoff(emojiPicker);
        emojiCloseSeq += 1;
        searchQuery = '';
        emojiSearchInput.value = '';
        activeTab = DEFAULT_TAB;
        categoryByTab.emoji = TAB_DEFAULT_CATEGORY.emoji;
        emojiPicker.classList.remove('is-closing');
        emojiPicker.classList.add('active');
        emojiPicker.setAttribute('aria-hidden', 'false');
        if (isMobileEmojiViewport() && document.activeElement === messageInput) {
            messageInput.blur();
        }
        document.dispatchEvent(new Event('sun-close-header-dropdown'));
        positionEmojiPicker(emojiPicker, emojiBtn);
        setActiveTabButtons(emojiPicker, activeTab);
        await renderActiveTab({ forceCategoryScroll: true });
        positionEmojiPicker(emojiPicker, emojiBtn);
        syncEmojiButtonMode(true);
    };

    const onCategoryClick = async (button) => {
        const category = String(button.dataset.cat || '').trim();
        if (!category) return;
        categoryByTab[activeTab] = category;
        setActiveCategory(emojiCategories, category);
        ensureActiveCategoryVisible(emojiCategories, category);

        const hasSearch = Boolean(normalizeQuery(searchQuery));
        if (hasSearch) {
            await renderActiveTab();
            return;
        }

        const didScroll = scrollToCategory(emojiList, category);
        if (!didScroll) {
            await renderActiveTab({ forceCategoryScroll: true });
            return;
        }
        suppressCategorySyncUntil = performance.now() + 420;
    };

    emojiBtn.addEventListener('pointerdown', (event) => {
        if (!isMobileEmojiViewport() || !emojiPicker.classList.contains('active')) return;
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

    emojiPicker.addEventListener('click', async (event) => {
        const tabButton = event.target.closest('[data-picker-tab]');
        if (tabButton && emojiPicker.contains(tabButton)) {
            event.preventDefault();
            const tab = String(tabButton.dataset.pickerTab || DEFAULT_TAB);
            await setTab(tab, { force: true });
            return;
        }

        const categoryButton = event.target.closest('.emoji-category-btn');
        if (categoryButton && emojiCategories.contains(categoryButton)) {
            event.preventDefault();
            await onCategoryClick(categoryButton);
            return;
        }

        const itemButton = event.target.closest('[data-picker-item-kind]');
        if (!itemButton || !emojiList.contains(itemButton)) return;
        event.preventDefault();
        event.stopPropagation();

        const { localeCode, strings } = getLocaleStrings();
        const kind = String(itemButton.dataset.pickerItemKind || '').trim();
        let payload = '';

        if (kind === 'emoji') {
            payload = String(itemButton.dataset.emoji || '').trim();
            if (!isAllowedPickerEmoji(payload)) return;
            rememberRecentItem('emoji', payload);
        } else if (kind === 'stickers') {
            const id = String(itemButton.dataset.itemId || '').trim();
            const item = STICKER_LOOKUP.get(id);
            if (!item) return;
            payload = buildInsertText('stickers', item, localeCode, strings);
            rememberRecentItem('stickers', id);
        } else if (kind === 'gifs') {
            const id = String(itemButton.dataset.itemId || '').trim();
            const item = GIF_LOOKUP.get(id);
            if (!item) return;
            payload = buildInsertText('gifs', item, localeCode, strings);
            rememberRecentItem('gifs', id);
        }
        if (!payload) return;

        const selection = getStoredSelection();
        const shouldFocusAfterInsert = !(isMobileEmojiViewport() && emojiPicker.classList.contains('active'));
        const nextSelection = insertAtCursor(messageInput, payload, {
            selectionStart: selection.start,
            selectionEnd: selection.end,
            focusAfter: shouldFocusAfterInsert,
        });
        setStoredSelection(nextSelection.start, nextSelection.end);

        const compactQuery = normalizeQuery(searchQuery);
        const activeCategory = categoryByTab[activeTab] || TAB_DEFAULT_CATEGORY[activeTab];
        if (!compactQuery && (activeCategory === 'frequent' || activeCategory === 'recent')) {
            await renderActiveTab();
        }
    });

    emojiSearchInput.addEventListener('input', async () => {
        searchQuery = emojiSearchInput.value || '';
        await renderActiveTab();
    });

    emojiSearchClear.addEventListener('click', async (event) => {
        event.preventDefault();
        if (!searchQuery) return;
        searchQuery = '';
        emojiSearchInput.value = '';
        await renderActiveTab({ forceCategoryScroll: true });
    });

    emojiSearchInput.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            if (searchQuery) {
                searchQuery = '';
                emojiSearchInput.value = '';
                renderActiveTab({ forceCategoryScroll: true });
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
        categoryByTab[activeTab] = category;
        setActiveCategory(emojiCategories, category);
    }, { passive: true });

    emojiContentViewport.addEventListener('pointerdown', (event) => {
        if (!isMobileEmojiViewport() || event.pointerType === 'mouse') return;
        swipeSession = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            moved: false,
        };
    }, { passive: true });

    emojiContentViewport.addEventListener('pointermove', (event) => {
        if (!swipeSession || swipeSession.pointerId !== event.pointerId) return;
        swipeSession.moved = true;
        swipeSession.lastX = event.clientX;
        swipeSession.lastY = event.clientY;
    }, { passive: true });

    const finishSwipe = async (event) => {
        if (!swipeSession || swipeSession.pointerId !== event.pointerId) return;
        const endX = Number.isFinite(swipeSession.lastX) ? swipeSession.lastX : event.clientX;
        const endY = Number.isFinite(swipeSession.lastY) ? swipeSession.lastY : event.clientY;
        const dx = endX - swipeSession.startX;
        const dy = endY - swipeSession.startY;
        swipeSession = null;
        if (Math.abs(dx) < SWIPE_DISTANCE_MIN) return;
        if (Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO_MIN) return;
        await switchTabByDelta(dx < 0 ? 1 : -1);
    };
    emojiContentViewport.addEventListener('pointerup', finishSwipe, { passive: true });
    emojiContentViewport.addEventListener('pointercancel', () => {
        swipeSession = null;
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
            return;
        }
        if (!emojiPicker.classList.contains('active')) return;
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        const target = event.target;
        if (!target || !(target instanceof HTMLElement)) return;
        if (!target.closest('#emojiPickerTabstrip, #emojiPickerFooter')) return;
        event.preventDefault();
        switchTabByDelta(event.key === 'ArrowRight' ? 1 : -1);
    });

    document.addEventListener('sun-close-emoji-picker', () => closePicker());

    window.addEventListener('resize', reposition, { passive: true });
    window.addEventListener('scroll', reposition, { passive: true });
    window.visualViewport?.addEventListener('resize', reposition);
    window.visualViewport?.addEventListener('scroll', reposition);
    window.addEventListener('sun-ui-language-changed', () => {
        updateSearchUi(getLocaleStrings().strings);
        renderActiveTab();
        syncEmojiButtonMode();
    });

    emojiPicker.setAttribute('data-active-tab', activeTab);
    setActiveTabButtons(emojiPicker, activeTab);
    updateSearchUi(getLocaleStrings().strings);
    syncEmojiButtonMode(false);
}
