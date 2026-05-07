import { applyEmojiGraphics } from './utils.js';
import { withAppRoot } from './app-url.js';

let emojiData = null;
let emojiLoadFailed = false;
let lastPopulateRequestId = 0;

const RECENT_STORAGE_KEY = 'sun_recent_emojis_v1';
const MAX_RECENT_EMOJIS = 48;
const DEFAULT_CATEGORY = 'frequent';
const FALLBACK_CATEGORY = 'peoples';
const CATEGORY_ICONS = {
    frequent: '\u{1F557}',
    peoples: '\u{1F60A}',
    nature: '\u{1F333}',
    food: '\u{1F34E}',
    activity: '\u{26BD}',
    travel: '\u{1F697}',
    objects: '\u{1F4A1}',
    symbols: '\u{2764}\u{FE0F}',
    flags: '\u{1F3C1}',
};
const DISALLOWED_PICKER_EMOJIS = new Set([
    '\uD83C\uDFF3\uFE0F\u200D\uD83C\uDF08', // rainbow flag
    '\uD83C\uDFF3\uFE0F\u200D\u26A7\uFE0F', // transgender flag
]);
const MOBILE_EMOJI_QUERY = '(max-width: 768px)';
const MOBILE_EMOJI_MIN_HEIGHT = 292;
const MOBILE_EMOJI_MAX_HEIGHT = 360;
const MOBILE_EMOJI_HEIGHT_RATIO = 0.43;
const EMOJI_CLOSE_ANIMATION_MS = 190;
const EMOJI_KEYBOARD_HANDOFF_MS = 720;
const EMOJI_KEYBOARD_INSET_MIN = 80;

let emojiCloseSeq = 0;
let emojiKeyboardHandoffTimer = null;
let emojiKeyboardHandoffFrame = 0;

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
        timeoutId = window.setTimeout(finish, fallbackMs + 50);
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
            saveRecentEmojis(sanitized);
        }
        return sanitized;
    } catch (error) {
        console.warn('Failed to read recent emojis', error);
        return [];
    }
}

function saveRecentEmojis(list) {
    try {
        localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(list.slice(0, MAX_RECENT_EMOJIS)));
    } catch (error) {
        console.warn('Failed to save recent emojis', error);
    }
}

function rememberEmoji(emoji) {
    if (!isAllowedPickerEmoji(emoji)) return;
    const list = getRecentEmojis().filter((item) => item !== emoji);
    list.unshift(emoji);
    saveRecentEmojis(list);
}

function resolveEmojiUiLanguage() {
    const explicitLanguage = window.SUN_I18N?.getLanguage?.()
        || window.SUN_BOOTSTRAP?.user?.uiLanguage
        || document.documentElement.lang
        || '';
    return String(explicitLanguage).toLowerCase().startsWith('en') ? 'en' : 'ru';
}

function getEmojiButtonLabel(mode) {
    const isEnglish = resolveEmojiUiLanguage() === 'en';
    if (mode === 'keyboard') {
        return isEnglish ? 'Show keyboard' : '\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u043A\u043B\u0430\u0432\u0438\u0430\u0442\u0443\u0440\u0443';
    }
    return isEnglish ? 'Show emojis' : '\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u0441\u043C\u0430\u0439\u043B\u0438\u043A\u0438';
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

function resolveCategoryData(data, category) {
    if (category === DEFAULT_CATEGORY) {
        return getRecentEmojis();
    }
    const list = data?.[category];
    return Array.isArray(list) ? list.filter((emoji) => isAllowedPickerEmoji(emoji)) : [];
}

async function populateEmojiList(emojiList, messageInput, category, options = {}) {
    if (!emojiList || !messageInput) return;
    const requestId = ++lastPopulateRequestId;
    const targetCategory = category || FALLBACK_CATEGORY;

    setEmojiStatus(emojiList, '<i class="bi bi-hourglass-split"></i>');

    const data = await loadEmojiData();
    if (requestId !== lastPopulateRequestId) return;

    if (!data) {
        setEmojiStatus(emojiList, '\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u044D\u043C\u043E\u0434\u0437\u0438');
        return;
    }

    const emojis = resolveCategoryData(data, targetCategory);
    if (!emojis.length) {
        if (targetCategory === DEFAULT_CATEGORY) {
            setEmojiStatus(
                emojiList,
                '<i class="bi bi-clock-history" style="margin-right:6px;"></i>\u041F\u043E\u043A\u0430 \u043F\u0443\u0441\u0442\u043E. \u0427\u0430\u0441\u0442\u043E \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0435\u043C\u044B\u0435 \u043F\u043E\u044F\u0432\u044F\u0442\u0441\u044F \u043F\u043E\u0441\u043B\u0435 \u0432\u044B\u0431\u043E\u0440\u0430 \u044D\u043C\u043E\u0434\u0437\u0438.'
            );
            return;
        }
        setEmojiStatus(emojiList, '\u0412 \u044D\u0442\u043E\u0439 \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u0438 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442 \u044D\u043C\u043E\u0434\u0437\u0438');
        return;
    }

    emojiList.innerHTML = '';
    const fragment = document.createDocumentFragment();
    emojis.forEach((emoji) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'emoji-item';
        button.textContent = emoji;
        button.setAttribute('aria-label', `\u042D\u043C\u043E\u0434\u0437\u0438 ${emoji}`);
        button.addEventListener('pointerdown', (event) => {
            event.stopPropagation();
        });
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const selection = options.getSelection?.() || {};
            const nextSelection = insertAtCursor(messageInput, emoji, {
                selectionStart: selection.start,
                selectionEnd: selection.end,
                focusAfter: options.shouldFocusAfterInsert?.() ?? true,
            });
            options.setSelection?.(nextSelection.start, nextSelection.end);
            options.onInserted?.();
            rememberEmoji(emoji);
            if (targetCategory === DEFAULT_CATEGORY) {
                populateEmojiList(emojiList, messageInput, DEFAULT_CATEGORY, options);
            }
        });
        fragment.appendChild(button);
    });
    emojiList.appendChild(fragment);
    applyEmojiGraphics(emojiList);
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
    const btnRect = emojiBtn.getBoundingClientRect();
    const formRect = emojiBtn.closest('#messageForm')?.getBoundingClientRect() || btnRect;
    const anchorRect = formRect;
    const anchorGap = 10;

    if (isMobile) {
        const mobileViewportHeight = Math.max(
            viewportHeight,
            Math.round(window.innerHeight || 0),
            Math.round(document.documentElement.clientHeight || 0),
            readRootPixelVar('--app-vh'),
        );
        const maxSheetHeight = Math.max(220, Math.min(MOBILE_EMOJI_MAX_HEIGHT, mobileViewportHeight - 96));
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
            320,
            Math.min(
                380,
                Math.min(viewportWidth - 24, Math.round(Math.max(332, anchorRect.width - 18))),
            ),
        );
    const targetHeight = preserveSize && measuredHeight > 0
        ? measuredHeight
        : Math.max(292, Math.min(388, viewportHeight - 18));

    emojiPicker.style.setProperty('--emoji-width', `${targetWidth}px`);
    emojiPicker.style.setProperty('--emoji-height', `${targetHeight}px`);

    const pickerLayoutWidth = Math.round(emojiPicker.offsetWidth || targetWidth);
    const pickerLayoutHeight = Math.round(emojiPicker.offsetHeight || targetHeight);
    const pickerWidth = Math.min(pickerLayoutWidth, viewportWidth - margin * 2);
    const pickerHeight = Math.min(pickerLayoutHeight, viewportHeight - margin * 2);
    let left;
    let top;
    let side = 'top';

    left = anchorRect.left;
    top = anchorRect.top - pickerHeight - anchorGap;
    if (top < viewportOffsetTop + margin) {
        top = anchorRect.bottom + anchorGap;
        side = 'bottom';
    }
    if (left + pickerWidth > anchorRect.right) {
        left = anchorRect.right - pickerWidth;
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

function setActiveCategory(emojiCategories, category) {
    emojiCategories?.querySelectorAll('.emoji-category-btn').forEach((button) => {
        button.classList.toggle('active', button.dataset.cat === category);
    });
}

function syncEmojiCategoryIcons(emojiCategories) {
    if (!emojiCategories) return;
    emojiCategories.querySelectorAll('.emoji-category-btn').forEach((button) => {
        const category = String(button.dataset.cat || '').trim();
        const icon = CATEGORY_ICONS[category];
        if (icon) button.textContent = icon;
    });
}

export function initEmojiPicker(messageInput) {
    const emojiBtn = document.getElementById('emojiBtn');
    const emojiPicker = document.getElementById('emojiPicker');
    const emojiList = document.getElementById('emojiList');
    const emojiCategories = document.getElementById('emojiCategories');
    if (!emojiBtn || !emojiPicker || !emojiList || !emojiCategories || !messageInput) return;

    let activeCategory = DEFAULT_CATEGORY;
    let lastSelectionStart = messageInput.value.length;
    let lastSelectionEnd = lastSelectionStart;
    let handledKeyboardSwitchPointer = false;
    let keyboardSwitchPointerTimer = null;
    syncEmojiCategoryIcons(emojiCategories);
    applyEmojiGraphics(emojiCategories);

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

    const emojiInsertOptions = {
        getSelection: getStoredSelection,
        setSelection: setStoredSelection,
        shouldFocusAfterInsert: () => !(isMobileEmojiViewport() && emojiPicker.classList.contains('active')),
        onInserted: () => {},
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
            syncEmojiButtonMode(false);
            if (focusInput) focusComposerInput();
            return;
        }

        const closeSeq = ++emojiCloseSeq;
        emojiPicker.classList.remove('active');
        emojiPicker.classList.add('is-closing');
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
        emojiPicker.classList.remove('is-closing');
        if (isMobileEmojiViewport() && document.activeElement === messageInput) {
            messageInput.blur();
        }
        document.dispatchEvent(new Event('sun-close-header-dropdown'));
        emojiPicker.classList.add('active');
        syncEmojiButtonMode(true);
        setActiveCategory(emojiCategories, activeCategory);
        applyEmojiGraphics(emojiCategories);
        positionEmojiPicker(emojiPicker, emojiBtn);
        await populateEmojiList(emojiList, messageInput, activeCategory, emojiInsertOptions);
        positionEmojiPicker(emojiPicker, emojiBtn);
        syncEmojiButtonMode(true);
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

    emojiCategories.addEventListener('click', (event) => {
        const button = event.target.closest('.emoji-category-btn');
        if (!button) return;

        activeCategory = button.dataset.cat || FALLBACK_CATEGORY;
        setActiveCategory(emojiCategories, activeCategory);
        populateEmojiList(emojiList, messageInput, activeCategory, emojiInsertOptions);
    });

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

    document.addEventListener('sun-close-emoji-picker', () => closePicker());

    window.addEventListener('resize', reposition, { passive: true });
    window.addEventListener('scroll', reposition, { passive: true });
    window.visualViewport?.addEventListener('resize', reposition);
    window.visualViewport?.addEventListener('scroll', reposition);
    window.addEventListener('sun-ui-language-changed', () => syncEmojiButtonMode());
    syncEmojiButtonMode(false);
}


