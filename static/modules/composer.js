// Composer event wiring and submit orchestration for chat input.
import { applyEmojiGraphics } from './utils.js';

const SEND_SHORTCUT_STORAGE_KEY = 'sun_send_shortcut_mode_v1';
const SEND_SHORTCUT_ENTER = 'enter';
const SEND_SHORTCUT_CTRL_ENTER = 'ctrl_enter';
const COMPOSER_EMOJI_VISUAL_WRAP_CLASS = 'composer-input-visual-wrap';
const COMPOSER_EMOJI_VISUAL_CLASS = 'composer-input-visual';
const COMPOSER_EMOJI_INPUT_CLASS = 'composer-input-emoji-layer';
const COMPOSER_EMOJI_VISUAL_SYNC_EVENT = 'sun-composer-sync-visual';
let composerEmojiMeasureCtx = null;

function normalizeSendShortcutMode(value) {
    const raw = String(value || '').trim().toLowerCase();
    return raw === SEND_SHORTCUT_CTRL_ENTER ? SEND_SHORTCUT_CTRL_ENTER : SEND_SHORTCUT_ENTER;
}

function readSendShortcutMode() {
    try {
        return normalizeSendShortcutMode(window.localStorage.getItem(SEND_SHORTCUT_STORAGE_KEY));
    } catch (_) {
        return SEND_SHORTCUT_ENTER;
    }
}

function normalizeComposerVisualText(value) {
    return String(value || '').replace(/\r\n/g, '\n');
}

function getComposerEmojiMeasureContext() {
    if (composerEmojiMeasureCtx) return composerEmojiMeasureCtx;
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    composerEmojiMeasureCtx = canvas.getContext('2d');
    return composerEmojiMeasureCtx;
}

function buildComposerMeasureFont(style) {
    const shorthand = String(style?.font || '').trim();
    if (shorthand) return shorthand;
    const fontStyle = style?.fontStyle || 'normal';
    const fontVariant = style?.fontVariant || 'normal';
    const fontWeight = style?.fontWeight || '400';
    const fontSize = style?.fontSize || '15px';
    const lineHeight = style?.lineHeight || 'normal';
    const fontFamily = style?.fontFamily || 'sans-serif';
    return `${fontStyle} ${fontVariant} ${fontWeight} ${fontSize}/${lineHeight} ${fontFamily}`;
}

function measureComposerEmojiAdvancePx(emoji, fontShorthand, fontSizePx) {
    const ctx = getComposerEmojiMeasureContext();
    if (!ctx || !emoji) return null;
    try {
        if (fontShorthand) ctx.font = fontShorthand;
    } catch (_) {
        // Keep previous context font if assignment is rejected by the runtime.
    }
    const width = Number(ctx.measureText(emoji).width || 0);
    if (!(width > 0)) return null;
    const minWidth = Math.max(1, fontSizePx * 0.82);
    const maxWidth = fontSizePx * 1.6;
    return Math.min(maxWidth, Math.max(minWidth, width));
}

function syncComposerEmojiAdvance(visual, messageInput) {
    if (!visual || !messageInput || typeof window === 'undefined') return;
    const emojiNodes = visual.querySelectorAll?.('img.emoji-graphic[data-emoji-raw]');
    if (!emojiNodes?.length) return;
    const inputStyle = window.getComputedStyle(messageInput);
    const fontShorthand = buildComposerMeasureFont(inputStyle);
    const fontSizePx = Number.parseFloat(inputStyle.fontSize) || 15;
    const localCache = new Map();
    emojiNodes.forEach((emojiNode) => {
        const raw = String(emojiNode.getAttribute('data-emoji-raw') || emojiNode.getAttribute('alt') || '').trim();
        if (!raw) return;
        const cacheKey = `${fontShorthand}\u0001${raw}`;
        let advanceWidth = localCache.get(cacheKey);
        if (!Number.isFinite(advanceWidth)) {
            advanceWidth = measureComposerEmojiAdvancePx(raw, fontShorthand, fontSizePx);
            localCache.set(cacheKey, advanceWidth);
        }
        if (!Number.isFinite(advanceWidth)) return;
        emojiNode.style.width = `${advanceWidth}px`;
    });
}

function bindInputValueObserver(input, onValueChange) {
    if (!input || typeof onValueChange !== 'function') return;
    if (input.dataset.composerEmojiValueObserved === '1') return;
    const proto = Object.getPrototypeOf(input);
    const valueDescriptor = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
    if (!valueDescriptor?.get || !valueDescriptor?.set) return;
    try {
        Object.defineProperty(input, 'value', {
            configurable: true,
            enumerable: valueDescriptor.enumerable ?? true,
            get() {
                return valueDescriptor.get.call(this);
            },
            set(nextValue) {
                valueDescriptor.set.call(this, nextValue);
                onValueChange();
            },
        });
        input.dataset.composerEmojiValueObserved = '1';
    } catch (_) {
        // Some hardened runtimes may deny overriding instance accessors.
    }
}

function initComposerEmojiVisualLayer(messageInput) {
    if (!messageInput) return () => {};
    if (messageInput.dataset.composerEmojiVisualBound === '1') {
        return () => {};
    }

    const originalParent = messageInput.parentElement;
    if (!originalParent) return () => {};

    let wrap = originalParent.classList.contains(COMPOSER_EMOJI_VISUAL_WRAP_CLASS)
        ? originalParent
        : null;
    let visual = wrap?.querySelector(`.${COMPOSER_EMOJI_VISUAL_CLASS}`) || null;

    if (!wrap || !visual) {
        wrap = document.createElement('div');
        wrap.className = COMPOSER_EMOJI_VISUAL_WRAP_CLASS;
        visual = document.createElement('div');
        visual.className = COMPOSER_EMOJI_VISUAL_CLASS;
        visual.setAttribute('aria-hidden', 'true');
        originalParent.insertBefore(wrap, messageInput);
        wrap.appendChild(visual);
        wrap.appendChild(messageInput);
    }

    messageInput.classList.add(COMPOSER_EMOJI_INPUT_CLASS);

    let lastText = null;
    let lastScrollTop = -1;
    let lastScrollLeft = -1;

    const syncVisual = (force = false) => {
        const nextText = normalizeComposerVisualText(messageInput.value);
        const nextScrollTop = messageInput.scrollTop;
        const nextScrollLeft = messageInput.scrollLeft;

        if (!force && nextText === lastText && nextScrollTop === lastScrollTop && nextScrollLeft === lastScrollLeft) {
            return;
        }

        if (force || nextText !== lastText) {
            if (!nextText) {
                visual.textContent = '';
            } else {
                visual.textContent = nextText;
                applyEmojiGraphics(visual);
                syncComposerEmojiAdvance(visual, messageInput);
            }
            lastText = nextText;
        }

        visual.scrollTop = nextScrollTop;
        visual.scrollLeft = nextScrollLeft;
        lastScrollTop = nextScrollTop;
        lastScrollLeft = nextScrollLeft;
    };

    bindInputValueObserver(messageInput, () => syncVisual(true));
    messageInput.addEventListener(COMPOSER_EMOJI_VISUAL_SYNC_EVENT, () => syncVisual(true));
    messageInput.addEventListener('input', () => syncVisual(true));
    messageInput.addEventListener('scroll', () => syncVisual(false), { passive: true });
    messageInput.addEventListener('focus', () => syncVisual(false), { passive: true });
    messageInput.addEventListener('blur', () => syncVisual(false), { passive: true });

    messageInput.dataset.composerEmojiVisualBound = '1';
    syncVisual(true);
    return syncVisual;
}

export function initComposer(opts = {}) {
    const {
        messageInput,
        messageForm,
        sendMessageBtn,
        replyCancelBtn,
        editCancelBtn,
        getChatId,
        isChatBlocked,
        isEditingMessageId,
        getReplyState,
        cancelReply,
        cancelEdit,
        emitSocket,
        encryptAndSend,
        showToast,
        resizeComposerInput,
        scheduleComposerFocus,
        onTyping,
        onStopTyping,
    } = opts;

    if (!messageInput || !messageForm) return;
    if (messageInput.dataset.composerBound === '1') return;
    messageInput.dataset.composerBound = '1';
    const syncComposerEmojiVisual = initComposerEmojiVisualLayer(messageInput);

    const resolveChatId = () => (typeof getChatId === 'function' ? getChatId() : null);
    const resolveEditing = () => (typeof isEditingMessageId === 'function' ? Boolean(isEditingMessageId()) : Boolean(isEditingMessageId));
    const resolveBlocked = () => (typeof isChatBlocked === 'function' ? Boolean(isChatBlocked()) : false);
    const isCoarsePointer = () => Boolean(window.matchMedia?.('(pointer: coarse)')?.matches);
    let touchSubmitInProgress = false;
    let submitInFlight = false;

    const submitComposerForm = () => {
        if (resolveBlocked() || submitInFlight) return false;
        if (typeof messageForm.requestSubmit === 'function') {
            messageForm.requestSubmit();
        } else {
            const submitEvent = new Event('submit', { cancelable: true, bubbles: true });
            messageForm.dispatchEvent(submitEvent);
        }
        return true;
    };

    const handleComposerSubmit = async (event) => {
        event.preventDefault();
        if (resolveBlocked() || submitInFlight) return;
        submitInFlight = true;

        onStopTyping?.();
        const rawContent = String(messageInput.value || '').replace(/\r\n/g, '\n');

        try {
            if (typeof encryptAndSend === 'function') {
                await encryptAndSend(rawContent, {
                    chatId: resolveChatId(),
                    isEditing: resolveEditing(),
                    replyState: typeof getReplyState === 'function' ? getReplyState() : null,
                });
            }
        } catch (err) {
            showToast?.(err?.message || '\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0438 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F.', 'danger');
        } finally {
            submitInFlight = false;
            if (isCoarsePointer()) {
                scheduleComposerFocus?.({ force: true });
                window.setTimeout(() => {
                    scheduleComposerFocus?.({ force: true });
                }, 120);
            }
        }
    };

    const earlyComposerKeydown = (event) => {
        if (event.key !== 'Enter') return;
        // On touch devices Enter should insert a new line; sending is button-only.
        if (isCoarsePointer()) return;
        const sendShortcutMode = readSendShortcutMode();
        const hasSendModifier = event.ctrlKey || event.metaKey;

        if (sendShortcutMode === SEND_SHORTCUT_CTRL_ENTER) {
            if (!hasSendModifier || event.shiftKey || event.isComposing) return;
        } else if (event.shiftKey || event.isComposing) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        if (messageInput.value.trim().length === 0 && !resolveEditing()) return;
        submitComposerForm();
    };

    messageForm.addEventListener('submit', handleComposerSubmit);
    messageInput.addEventListener('input', () => {
        resizeComposerInput?.({ defer: true });
        syncComposerEmojiVisual(true);
        if (!resolveChatId() || resolveEditing() || resolveBlocked()) return;
        onTyping?.();
    });
    messageInput.onkeydown = earlyComposerKeydown;
    messageInput.addEventListener('keydown', earlyComposerKeydown, true);

    if (sendMessageBtn && messageInput) {
        const handleTouchSubmitStart = (event) => {
            if (isCoarsePointer()) {
                event.preventDefault();
                event.stopPropagation();
                if (touchSubmitInProgress || submitInFlight || sendMessageBtn.disabled) return;
                touchSubmitInProgress = true;
                submitComposerForm();

                scheduleComposerFocus?.({ force: true });
                window.setTimeout(() => {
                    scheduleComposerFocus?.({ force: true });
                    touchSubmitInProgress = false;
                }, 140);
            }
        };
        sendMessageBtn.addEventListener('pointerdown', handleTouchSubmitStart);
        sendMessageBtn.addEventListener('touchstart', handleTouchSubmitStart, { passive: false });
        sendMessageBtn.addEventListener('mousedown', handleTouchSubmitStart);
        sendMessageBtn.addEventListener('click', (event) => {
            if (!isCoarsePointer()) return;
            event.preventDefault();
            event.stopPropagation();
        });
    }

    replyCancelBtn?.addEventListener('click', () => cancelReply?.());
    editCancelBtn?.addEventListener('click', () => cancelEdit?.());
    resizeComposerInput?.();
    syncComposerEmojiVisual(true);
}

