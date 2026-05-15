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

    function triggerAttachPicker(mode) {
        if (!fileAttachInput) return;
        applyAttachInputMode(mode);
        closeAttachMenu();
        fileAttachInput.click();
    }

    // Wiring
    attachBtn?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (isAttachMenuOpen()) {
            closeAttachMenu();
            return;
        }
        openAttachMenu();
    });

    attachMenuItems.forEach((item) => {
        item.addEventListener('click', (event) => {
            event.preventDefault();
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

    if (fileAttachInput) {
        applyAttachInputMode(ATTACH_MODE_FILE);
        fileAttachInput.addEventListener('change', async function() {
            const files = Array.from(this.files || []);
            if (!files.length) return;

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
