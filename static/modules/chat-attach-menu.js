// Attach menu (скрепка composer): открытие меню «Фото/Видео» vs «Файл»,
// настройка accept input, делегирование загрузки в handleFileUpload.

import { initAttachMenuPortal } from './attach-menu-portal.js';

const ATTACH_MODE_MEDIA = 'media';
const ATTACH_MODE_FILE = 'file';
const ATTACH_INPUT_MODE_AUDIO = 'audio';

const FILE_ATTACH_ACCEPT_MEDIA = 'image/*,video/*';
const FILE_ATTACH_ACCEPT_AUDIO = 'audio/*,.ogg,.wav,.mp3,.m4a,.aac,.opus';

export function createChatAttachMenuController(deps = {}) {
    const {
        attachMenu,
        attachBtn,
        fileAttachInput,
        attachMenuItems = [],
        isChatBlocked,
        handleFileUpload,
    } = deps;

    const FILE_ATTACH_ACCEPT_ALL = String(fileAttachInput?.getAttribute('accept') || '*/*');

    const attachMenuController = initAttachMenuPortal({ attachMenu, trigger: attachBtn });
    let suppressNextAttachClick = false;
    let suppressNextAttachClickTimer = 0;
    let restoreComposerFocusAfterPicker = false;

    function resolveAttachMode(value) {
        return value === ATTACH_MODE_MEDIA ? ATTACH_MODE_MEDIA : ATTACH_MODE_FILE;
    }

    function resolveAttachInputMode(value) {
        if (value === ATTACH_MODE_MEDIA) return ATTACH_MODE_MEDIA;
        if (value === ATTACH_INPUT_MODE_AUDIO) return ATTACH_INPUT_MODE_AUDIO;
        return ATTACH_MODE_FILE;
    }

    function isVisualAttachCandidate(file) {
        const mime = String(file?.type || '').toLowerCase();
        if (mime.startsWith('image/') || mime.startsWith('video/')) return true;
        const name = String(file?.name || '').toLowerCase();
        return /\.(png|jpe?g|webp|gif|bmp|svg|heic|heif|avif|mp4|mov|m4v|avi|mkv|webm|ogv)$/i.test(name);
    }

    function resolveAttachModeForFile(file, preferredMode = null) {
        const normalizedPreferredMode = preferredMode === null || preferredMode === undefined
            ? null
            : resolveAttachMode(preferredMode);
        if (normalizedPreferredMode === ATTACH_MODE_MEDIA) return ATTACH_MODE_MEDIA;
        if (normalizedPreferredMode === ATTACH_MODE_FILE) return ATTACH_MODE_FILE;
        return isVisualAttachCandidate(file) ? ATTACH_MODE_MEDIA : ATTACH_MODE_FILE;
    }

    function setAttachMenuOpen(open) {
        attachMenuController.setOpen(open);
    }

    function isAttachMenuOpen() {
        return attachMenuController.isOpen();
    }

    function closeAttachMenu() {
        attachMenuController.close();
    }

    function applyAttachInputMode(mode) {
        if (!fileAttachInput) return;
        const inputMode = resolveAttachInputMode(mode);
        fileAttachInput.dataset.attachMode = inputMode;
        let accept = FILE_ATTACH_ACCEPT_ALL;
        if (inputMode === ATTACH_MODE_MEDIA) accept = FILE_ATTACH_ACCEPT_MEDIA;
        if (inputMode === ATTACH_INPUT_MODE_AUDIO) accept = FILE_ATTACH_ACCEPT_AUDIO;
        fileAttachInput.setAttribute('accept', accept);
    }

    function openAttachMenu() {
        if (!attachMenu || !attachBtn || isChatBlocked?.()) return;
        if (attachBtn.classList.contains('disabled') || attachBtn.disabled) return;
        document.dispatchEvent(new Event('sun-close-emoji-picker'));
        setAttachMenuOpen(true);
    }

    function toggleAttachMenu() {
        if (isAttachMenuOpen()) {
            closeAttachMenu();
            return;
        }
        openAttachMenu();
    }

    function isMobileComposerPointer(event) {
        if (event?.pointerType && event.pointerType !== 'mouse') return true;
        return Boolean(window.matchMedia?.('(pointer: coarse)')?.matches);
    }

    function isMessageInputActive() {
        return document.activeElement === document.getElementById('messageInput');
    }

    function getMessageInput() {
        return document.getElementById('messageInput');
    }

    function suppressSyntheticAttachClick() {
        suppressNextAttachClick = true;
        if (suppressNextAttachClickTimer) window.clearTimeout(suppressNextAttachClickTimer);
        suppressNextAttachClickTimer = window.setTimeout(() => {
            suppressNextAttachClick = false;
            suppressNextAttachClickTimer = 0;
        }, 700);
    }

    function restoreComposerFocusIfNeeded() {
        if (!restoreComposerFocusAfterPicker) return;
        restoreComposerFocusAfterPicker = false;
        const messageInput = getMessageInput();
        if (!messageInput || messageInput.disabled) return;
        requestAnimationFrame(() => {
            if (document.activeElement && document.activeElement !== document.body && document.activeElement !== fileAttachInput) return;
            try {
                messageInput.focus({ preventScroll: true });
            } catch (_) {
                messageInput.focus();
            }
        });
    }

    function triggerAttachPicker(mode) {
        if (!fileAttachInput) return;
        restoreComposerFocusAfterPicker = isMessageInputActive();
        applyAttachInputMode(mode);
        // Open the native file dialog FIRST, while we are still inside the
        // trusted click gesture, then close the menu. Closing first is also
        // fine (it only toggles classes) but opening first is the safest order
        // for the iOS user-gesture requirement.
        fileAttachInput.click();
        closeAttachMenu();
    }

    // Wiring
    // Touch: toggle on pointerdown + preventDefault so the attach button never
    // steals focus / dismisses the keyboard, which kept the menu jumping.
    attachBtn?.addEventListener('pointerdown', (event) => {
        if (!isMobileComposerPointer(event)) return;
        event.preventDefault();
        event.stopPropagation();
        suppressSyntheticAttachClick();
        toggleAttachMenu();
    });

    attachBtn?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (suppressNextAttachClick) {
            suppressNextAttachClick = false;
            if (suppressNextAttachClickTimer) {
                window.clearTimeout(suppressNextAttachClickTimer);
                suppressNextAttachClickTimer = 0;
            }
            return;
        }
        toggleAttachMenu();
    });

    attachMenuItems.forEach((item) => {
        // IMPORTANT: the file dialog (fileAttachInput.click()) must be opened
        // from inside a trusted CLICK handler. Calling it from pointerdown —
        // especially after preventDefault — breaks the user-gesture chain on
        // iOS Safari and the dialog silently never appears ("buttons don't
        // work"). So the actual trigger lives only in the click handler.
        // pointerdown just stops propagation so the document-level
        // close-on-pointerdown listener does not close the menu first.
        item.addEventListener('pointerdown', (event) => {
            event.stopPropagation();
        });

        item.addEventListener('click', (event) => {
            event.stopPropagation();
            const mode = item.getAttribute('data-attach-mode') || ATTACH_MODE_FILE;
            triggerAttachPicker(mode);
        });
    });

    document.addEventListener('pointerdown', (event) => {
        if (!isAttachMenuOpen()) return;
        if (!(event.target instanceof Element)) {
            closeAttachMenu();
            return;
        }
        if (event.target.closest('#attachMenu') || event.target.closest('#attachBtn')) return;
        closeAttachMenu();
    });
    document.addEventListener('sun-close-attach-menu', closeAttachMenu);

    if (fileAttachInput) {
        applyAttachInputMode(ATTACH_MODE_FILE);
        fileAttachInput.addEventListener('cancel', restoreComposerFocusIfNeeded);
        fileAttachInput.addEventListener('change', async function() {
            const files = Array.from(this.files || []);
            if (!files.length) {
                restoreComposerFocusIfNeeded();
                return;
            }
            restoreComposerFocusAfterPicker = false;

            const attachMode = resolveAttachMode(this.dataset.attachMode);
            if (files.length === 1) {
                await handleFileUpload(files[0], { allowCaption: true, attachMode });
            } else {
                await handleFileUpload(files, { allowCaption: true, attachMode });
            }
            this.value = '';
            applyAttachInputMode(ATTACH_MODE_FILE);
        });
    }

    return {
        resolveAttachMode,
        resolveAttachModeForFile,
        isVisualAttachCandidate,
        setAttachMenuOpen,
        isAttachMenuOpen,
        closeAttachMenu,
        openAttachMenu,
        triggerAttachPicker,
        applyAttachInputMode,
    };
}
