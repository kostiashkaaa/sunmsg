// Attach menu (скрепка composer): открытие меню «Фото/Видео» vs «Файл»,
// настройка accept input, делегирование загрузки в handleFileUpload.

import { initAttachMenuPortal } from './attach-menu-portal.js';

const ATTACH_MODE_MEDIA = 'media';
const ATTACH_MODE_FILE = 'file';

const FILE_ATTACH_ACCEPT_MEDIA = 'image/*,video/*';

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
    let suppressNextMenuItemClick = false;
    let suppressNextMenuItemClickTimer = 0;
    let restoreComposerFocusAfterPicker = false;

    function resolveAttachMode(value) {
        return value === ATTACH_MODE_MEDIA ? ATTACH_MODE_MEDIA : ATTACH_MODE_FILE;
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
        const normalizedMode = resolveAttachMode(mode);
        fileAttachInput.dataset.attachMode = normalizedMode;
        fileAttachInput.setAttribute(
            'accept',
            normalizedMode === ATTACH_MODE_MEDIA ? FILE_ATTACH_ACCEPT_MEDIA : FILE_ATTACH_ACCEPT_ALL,
        );
    }

    function openAttachMenu() {
        if (!attachMenu || !attachBtn || isChatBlocked?.()) return;
        if (attachBtn.classList.contains('disabled') || attachBtn.disabled) return;
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

    function suppressSyntheticMenuItemClick() {
        suppressNextMenuItemClick = true;
        if (suppressNextMenuItemClickTimer) window.clearTimeout(suppressNextMenuItemClickTimer);
        suppressNextMenuItemClickTimer = window.setTimeout(() => {
            suppressNextMenuItemClick = false;
            suppressNextMenuItemClickTimer = 0;
        }, 700);
    }

    function clearMenuItemClickSuppression() {
        suppressNextMenuItemClick = false;
        if (suppressNextMenuItemClickTimer) {
            window.clearTimeout(suppressNextMenuItemClickTimer);
            suppressNextMenuItemClickTimer = 0;
        }
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
        closeAttachMenu();
        fileAttachInput.click();
    }

    // Wiring
    attachBtn?.addEventListener('pointerdown', (event) => {
        if (!isMobileComposerPointer(event) || !isMessageInputActive()) return;
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
        item.addEventListener('pointerdown', (event) => {
            if (!isMobileComposerPointer(event) || !isMessageInputActive()) return;
            event.preventDefault();
            event.stopPropagation();
            suppressSyntheticMenuItemClick();
            const mode = item.getAttribute('data-attach-mode') || ATTACH_MODE_FILE;
            triggerAttachPicker(mode);
        });

        item.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (suppressNextMenuItemClick) {
                clearMenuItemClickSuppression();
                return;
            }
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
