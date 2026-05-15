import { escapeHtml } from './utils.js';
import {
    closeAnimatedOverlay,
    isOverlayVisible,
    openAnimatedOverlay,
} from './chat-shell-ui.js';

const ATTACH_MODE_FILE = 'file';
const ATTACH_MODE_MEDIA = 'media';

function resolveAttachMode(value) {
    return value === ATTACH_MODE_MEDIA ? ATTACH_MODE_MEDIA : ATTACH_MODE_FILE;
}

function isVisualMediaFile(file) {
    const mime = String(file?.type || '').toLowerCase();
    if (mime.startsWith('image/') || mime.startsWith('video/')) return true;
    const name = String(file?.name || '').toLowerCase();
    return /\.(png|jpe?g|webp|gif|bmp|svg|heic|heif|avif|mp4|mov|m4v|avi|mkv|webm|ogv)$/i.test(name);
}

function normalizeIncomingFiles(value, fallbackFile) {
    if (Array.isArray(value)) {
        return value.filter((item) => item instanceof File);
    }
    if (value instanceof FileList) {
        return Array.from(value).filter((item) => item instanceof File);
    }
    if (value instanceof File) {
        return [value];
    }
    if (fallbackFile instanceof File) {
        return [fallbackFile];
    }
    return [];
}

function resolveDefaultAttachMode(files, explicitMode) {
    if (explicitMode === ATTACH_MODE_MEDIA || explicitMode === ATTACH_MODE_FILE) {
        return explicitMode;
    }
    const primary = files[0];
    return isVisualMediaFile(primary) ? ATTACH_MODE_MEDIA : ATTACH_MODE_FILE;
}

function formatPlural(value, forms) {
    const count = Math.abs(Number(value) || 0);
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return forms[0];
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
    return forms[2];
}

export function initCaptionModal({
    modalEl,
    previewEl,
    metaEl,
    inputEl,
    sendButtonEl,
    closeButtonEl,
    titleEl,
    hintEl,
    activateFocusTrap,
    deactivateFocusTrap,
    onSubmit,
    onError,
} = {}) {
    let pendingPayload = null;
    let previewObjectUrl = '';

    const moreButtonEl = document.getElementById('captionModalMoreBtn');
    const optionsMenuEl = document.getElementById('captionOptionsMenu');
    const addButtonEl = document.getElementById('captionAddBtn');
    const addLabelEl = document.getElementById('captionAddLabel');
    const addInputEl = document.getElementById('captionAddInput');
    const toggleCompressionButtonEl = document.getElementById('captionToggleCompressionBtn');
    const compressionLabelEl = document.getElementById('captionCompressionLabel');

    function cleanupPreviewObjectUrl() {
        if (!previewObjectUrl) return;
        try {
            URL.revokeObjectURL(previewObjectUrl);
        } catch (_) {}
        previewObjectUrl = '';
    }

    function getPendingFiles() {
        return Array.isArray(pendingPayload?.files) ? pendingPayload.files : [];
    }

    function getPendingAttachMode() {
        const mode = pendingPayload?.options?.attachMode;
        return resolveAttachMode(mode);
    }

    function getLanguage() {
        const i18nApi = window.SUN_I18N;
        const raw = typeof i18nApi?.getLanguage === 'function'
            ? i18nApi.getLanguage()
            : (window.SUN_BOOTSTRAP?.user?.uiLanguage || document.documentElement.lang || 'ru');
        return String(raw || '').toLowerCase().startsWith('en') ? 'en' : 'ru';
    }

    function setOptionsMenuOpen(open) {
        if (!optionsMenuEl || !moreButtonEl) return;
        const isOpen = Boolean(open);
        optionsMenuEl.classList.toggle('active', isOpen);
        optionsMenuEl.classList.toggle('is-open', isOpen);
        optionsMenuEl.classList.toggle('is-opening', false);
        optionsMenuEl.classList.toggle('is-closing', false);
        optionsMenuEl.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
        moreButtonEl.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }

    function closeOptionsMenu() {
        setOptionsMenuOpen(false);
    }

    function formatFileSize(bytes) {
        const value = Number(bytes);
        if (!Number.isFinite(value) || value <= 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        const order = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
        const sized = value / (1024 ** order);
        const precision = order === 0 ? 0 : (sized >= 100 ? 0 : 1);
        return `${sized.toFixed(precision)} ${units[order]}`;
    }

    function resolveFileKindLabel(file) {
        const mime = String(file?.type || '').toLowerCase();
        if (mime.startsWith('image/')) return 'Фото';
        if (mime.startsWith('video/')) return 'Видео';
        if (mime.startsWith('audio/')) return 'Аудио';
        return 'Файл';
    }

    function resolveFileExtLabel(file) {
        const name = String(file?.name || '');
        const dotIndex = name.lastIndexOf('.');
        if (dotIndex > -1 && dotIndex < name.length - 1) {
            return name.slice(dotIndex + 1).toUpperCase();
        }
        const mime = String(file?.type || '').toLowerCase();
        if (!mime) return 'BIN';
        const [, subtype = 'BIN'] = mime.split('/');
        return subtype.toUpperCase();
    }

    function resolveFilePreviewIcon(file) {
        const ext = resolveFileExtLabel(file).toLowerCase();
        if (['pdf'].includes(ext)) return 'bi-file-earmark-pdf';
        if (['doc', 'docx'].includes(ext)) return 'bi-file-earmark-word';
        if (['xls', 'xlsx', 'csv'].includes(ext)) return 'bi-file-earmark-spreadsheet';
        if (['zip', 'rar', '7z'].includes(ext)) return 'bi-file-earmark-zip';
        if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'opus'].includes(ext)) return 'bi-file-earmark-music';
        return 'bi-file-earmark';
    }

    function resolveModalTitle(files, attachMode) {
        const count = files.length;
        if (count <= 0) return 'Отправить файл';
        if (count === 1) {
            return attachMode === ATTACH_MODE_MEDIA && isVisualMediaFile(files[0])
                ? 'Отправить фото или видео'
                : 'Отправить файл';
        }

        const allVisual = files.every((item) => isVisualMediaFile(item));
        if (attachMode === ATTACH_MODE_MEDIA && allVisual) {
            return `Отправить ${count} ${formatPlural(count, ['фото', 'фото', 'фото'])}`;
        }
        return `Отправить ${count} ${formatPlural(count, ['файл', 'файла', 'файлов'])}`;
    }

    function resolveModalHint(attachMode) {
        return attachMode === ATTACH_MODE_MEDIA
            ? 'Файл будет оптимизирован перед отправкой'
            : 'Отправка оригинала без сжатия';
    }

    function renderModalMeta(file, attachMode, totalFiles) {
        if (!metaEl) return;
        const modeText = attachMode === ATTACH_MODE_MEDIA
            ? 'Фото/видео (оптимизировано)'
            : 'Документ (без сжатия)';
        const countChip = totalFiles > 1
            ? `<span class="caption-meta-chip">${totalFiles} ${escapeHtml(formatPlural(totalFiles, ['вложение', 'вложения', 'вложений']))}</span>`
            : '';

        metaEl.innerHTML = `
            <span class="caption-meta-chip caption-meta-chip--accent">${escapeHtml(modeText)}</span>
            ${countChip}
            <span class="caption-meta-chip">${escapeHtml(resolveFileKindLabel(file))}</span>
            <span class="caption-meta-chip">${escapeHtml(resolveFileExtLabel(file))}</span>
            <span class="caption-meta-chip">${escapeHtml(formatFileSize(file?.size || 0))}</span>
        `;
    }

    // Track current preview slide index and per-file object URLs
    let previewSlideIndex = 0;
    const previewObjectUrls = [];

    function cleanupPreviewObjectUrls() {
        for (const u of previewObjectUrls) {
            try { URL.revokeObjectURL(u); } catch (_) {}
        }
        previewObjectUrls.length = 0;
    }

    function renderSingleFilePreview(file) {
        // Returns HTML string for one file preview (main area only, no strips)
        const mime = String(file?.type || '').toLowerCase();
        const isImage = mime.startsWith('image/');
        const isVideo = mime.startsWith('video/');
        if (isImage || isVideo) {
            const objectUrl = URL.createObjectURL(file);
            previewObjectUrls.push(objectUrl);
            return isImage
                ? `<img class="caption-slide-media" src="${escapeHtml(objectUrl)}" alt="${escapeHtml(file.name)}">`
                : `<video class="caption-preview-video caption-slide-media" src="${escapeHtml(objectUrl)}" preload="metadata" muted playsinline></video>`;
        }
        return `<div class="caption-file-icon"><i class="bi ${resolveFilePreviewIcon(file)}"></i></div>`;
    }

    function renderPreview(file, totalFiles = 1, allFiles = []) {
        if (!previewEl) return;
        cleanupPreviewObjectUrls();
        cleanupPreviewObjectUrl();
        previewEl.innerHTML = '';

        const allVisual = Array.isArray(allFiles) && allFiles.length > 1
            && allFiles.every((f) => isVisualMediaFile(f));

        // Multi-media: show gallery strip + main preview
        if (totalFiles > 1 && allVisual) {
            if (previewSlideIndex >= totalFiles) previewSlideIndex = 0;

            // Build strip thumbnails
            const thumbsHtml = allFiles.map((f, i) => {
                const mime = String(f?.type || '').toLowerCase();
                const isImg = mime.startsWith('image/');
                const isVid = mime.startsWith('video/');
                const objectUrl = URL.createObjectURL(f);
                previewObjectUrls.push(objectUrl);
                const mediaHtml = isImg
                    ? `<img src="${escapeHtml(objectUrl)}" alt="">`
                    : (isVid
                        ? `<video src="${escapeHtml(objectUrl)}" preload="metadata" muted playsinline></video>`
                        : `<i class="bi ${resolveFilePreviewIcon(f)}"></i>`);
                return `<div class="caption-thumb${i === previewSlideIndex ? ' is-active' : ''}" data-thumb-index="${i}">
                    ${mediaHtml}
                    <button class="caption-thumb-remove" data-remove-index="${i}" type="button" aria-label="Удалить"><i class="bi bi-x"></i></button>
                </div>`;
            }).join('');

            const currentFile = allFiles[previewSlideIndex];
            const currentMime = String(currentFile?.type || '').toLowerCase();
            const isCurrentImg = currentMime.startsWith('image/');
            const isCurrentVid = currentMime.startsWith('video/');
            // Find the already-created objectUrl for current slide (it was created in the thumbs loop above, at index previewSlideIndex)
            const currentUrl = previewObjectUrls[previewSlideIndex];

            const mainMediaHtml = isCurrentImg
                ? `<img class="caption-slide-media" src="${escapeHtml(currentUrl)}" alt="${escapeHtml(currentFile.name)}">`
                : (isCurrentVid
                    ? `<video class="caption-preview-video caption-slide-media" src="${escapeHtml(currentUrl)}" preload="metadata" muted playsinline></video>`
                    : `<div class="caption-file-icon"><i class="bi ${resolveFilePreviewIcon(currentFile)}"></i></div>`);

            previewEl.innerHTML = `
                <div class="caption-slide-main">
                    ${mainMediaHtml}
                    ${totalFiles > 1 ? `<span class="caption-file-count">${totalFiles}</span>` : ''}
                </div>
                <div class="caption-thumb-strip">${thumbsHtml}</div>`;

            // Delegated events on strip
            const strip = previewEl.querySelector('.caption-thumb-strip');
            strip?.addEventListener('click', (e) => {
                const removeBtn = e.target.closest('.caption-thumb-remove');
                if (removeBtn) {
                    e.stopPropagation();
                    const idx = parseInt(removeBtn.getAttribute('data-remove-index') || '0', 10);
                    if (!pendingPayload) return;
                    pendingPayload.files = getPendingFiles().filter((_, i) => i !== idx);
                    if (!pendingPayload.files.length) {
                        closeCaptionModal();
                        return;
                    }
                    if (previewSlideIndex >= pendingPayload.files.length) {
                        previewSlideIndex = pendingPayload.files.length - 1;
                    }
                    renderPendingState();
                    return;
                }
                const thumb = e.target.closest('.caption-thumb');
                if (thumb) {
                    previewSlideIndex = parseInt(thumb.getAttribute('data-thumb-index') || '0', 10);
                    renderPendingState();
                }
            });
            return;
        }

        // Single file or mixed (non-visual) files — original layout
        previewSlideIndex = 0;
        const mime = String(file?.type || '').toLowerCase();
        const isImage = mime.startsWith('image/');
        const isVideo = mime.startsWith('video/');

        if (isImage || isVideo) {
            previewObjectUrl = URL.createObjectURL(file);
            previewObjectUrls.push(previewObjectUrl);
            previewEl.innerHTML = isImage
                ? `<img src="${escapeHtml(previewObjectUrl)}" alt="${escapeHtml(file.name)}">`
                : `<video class="caption-preview-video" src="${escapeHtml(previewObjectUrl)}" preload="metadata" muted playsinline controls></video>`;
        } else {
            previewEl.innerHTML = `<div class="caption-file-icon"><i class="bi ${resolveFilePreviewIcon(file)}"></i></div>`;
        }

        previewEl.insertAdjacentHTML(
            'beforeend',
            `<span class="caption-file-name" title="${escapeHtml(file.name || '')}">${escapeHtml(file.name || '')}</span>`,
        );

        if (totalFiles > 1) {
            previewEl.insertAdjacentHTML(
                'beforeend',
                `<span class="caption-file-count">${totalFiles}</span>`,
            );
        }
    }

    function syncCompressionMenuLabel(attachMode) {
        if (!compressionLabelEl) return;
        const lang = getLanguage();
        compressionLabelEl.textContent = attachMode === ATTACH_MODE_MEDIA
            ? (lang === 'en' ? 'Send without compression' : '\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u0431\u0435\u0437 \u0441\u0436\u0430\u0442\u0438\u044F')
            : (lang === 'en' ? 'Send with compression' : '\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u0441\u043E \u0441\u0436\u0430\u0442\u0438\u0435\u043C');
    }

    function syncOptionStaticLabels() {
        const lang = getLanguage();
        if (moreButtonEl) {
            moreButtonEl.setAttribute('aria-label', lang === 'en' ? 'Actions' : '\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F');
        }
        if (closeButtonEl) {
            closeButtonEl.setAttribute('aria-label', lang === 'en' ? 'Close' : '\u0417\u0430\u043A\u0440\u044B\u0442\u044C');
        }
        if (addLabelEl) {
            addLabelEl.textContent = lang === 'en' ? 'Add' : '\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C';
        }
    }

    function renderPendingState() {
        const files = getPendingFiles();
        if (!files.length) {
            if (previewEl) previewEl.innerHTML = '';
            if (metaEl) metaEl.innerHTML = '';
            if (titleEl) titleEl.textContent = 'Отправить файл';
            if (hintEl) hintEl.textContent = '';
            syncCompressionMenuLabel(ATTACH_MODE_MEDIA);
            return;
        }

        const attachMode = getPendingAttachMode();
        const primaryFile = files[0];
        renderPreview(primaryFile, files.length, files);
        renderModalMeta(primaryFile, attachMode, files.length);
        if (titleEl) titleEl.textContent = resolveModalTitle(files, attachMode);
        if (hintEl) hintEl.textContent = resolveModalHint(attachMode);
        syncCompressionMenuLabel(attachMode);
    }

    function upsertPendingFiles(filesToAdd, { resetCaption = false } = {}) {
        const nextFiles = normalizeIncomingFiles(filesToAdd);
        if (!nextFiles.length) return false;

        if (!pendingPayload) {
            const attachMode = resolveDefaultAttachMode(nextFiles, null);
            pendingPayload = {
                files: nextFiles,
                options: { attachMode },
            };
        } else {
            pendingPayload.files = [...getPendingFiles(), ...nextFiles];
            pendingPayload.options = {
                ...(pendingPayload.options || {}),
                attachMode: getPendingAttachMode(),
            };
        }

        if (resetCaption && inputEl) {
            inputEl.value = '';
        }

        renderPendingState();
        return true;
    }

    function showCaptionModal(file, options = {}) {
        const files = normalizeIncomingFiles(options?.files, file);
        if (!files.length) return;

        previewSlideIndex = 0;
        pendingPayload = {
            files,
            options: {
                ...options,
                attachMode: resolveDefaultAttachMode(files, resolveAttachMode(options?.attachMode)),
            },
        };

        if (!previewEl || !inputEl) return;

        inputEl.value = '';
        if (addInputEl) addInputEl.value = '';
        closeOptionsMenu();
        renderPendingState();

        if (modalEl) {
            openAnimatedOverlay(modalEl, { focusTarget: inputEl });
            activateFocusTrap?.(modalEl);
        }
    }

    function closeCaptionModal() {
        pendingPayload = null;
        previewSlideIndex = 0;
        cleanupPreviewObjectUrl();
        cleanupPreviewObjectUrls();
        closeOptionsMenu();
        if (addInputEl) addInputEl.value = '';
        if (previewEl) previewEl.innerHTML = '';
        if (metaEl) metaEl.innerHTML = '';
        if (!modalEl) return;
        deactivateFocusTrap?.(modalEl);
        closeAnimatedOverlay(modalEl);
    }

    async function submitPendingCaption() {
        const files = getPendingFiles();
        if (!files.length) return;

        const caption = String(inputEl?.value || '').trim();
        const attachMode = getPendingAttachMode();
        const submitOptions = {
            ...(pendingPayload?.options || {}),
            attachMode,
        };
        delete submitOptions.files;

        // Generate a shared album_id when sending multiple visual media files
        const visualFiles = files.filter((f) => isVisualMediaFile(f));
        const isMultiMediaAlbum = files.length > 1 && visualFiles.length === files.length && attachMode !== 'file';
        const albumId = isMultiMediaAlbum
            ? crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
            : null;

        closeCaptionModal();
        try {
            for (let index = 0; index < files.length; index += 1) {
                await onSubmit?.(files[index], index === 0 ? caption : '', {
                    ...submitOptions,
                    albumId: albumId || undefined,
                    albumSize: albumId ? files.length : undefined,
                    albumIndex: albumId ? index : undefined,
                });
            }
        } catch (error) {
            onError?.(error);
        }
    }

    sendButtonEl?.addEventListener('click', submitPendingCaption);
    inputEl?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submitPendingCaption();
        }
    });

    closeButtonEl?.addEventListener('click', closeCaptionModal);
    modalEl?.addEventListener('click', (event) => {
        if (event.target === modalEl) {
            closeCaptionModal();
        }
    });

    moreButtonEl?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const isOpen = optionsMenuEl?.classList.contains('is-open');
        setOptionsMenuOpen(!isOpen);
    });

    document.addEventListener('pointerdown', (event) => {
        if (!optionsMenuEl?.classList.contains('is-open')) return;
        const target = event.target;
        if (!(target instanceof Element)) {
            closeOptionsMenu();
            return;
        }
        if (target.closest('#captionOptionsMenu') || target.closest('#captionModalMoreBtn')) return;
        closeOptionsMenu();
    });

    addButtonEl?.addEventListener('click', (event) => {
        event.preventDefault();
        closeOptionsMenu();
        addInputEl?.click();
    });

    addInputEl?.addEventListener('change', () => {
        const files = normalizeIncomingFiles(addInputEl.files);
        if (!files.length) return;
        const appended = upsertPendingFiles(files, { resetCaption: false });
        if (appended && modalEl && !isOverlayVisible(modalEl)) {
            openAnimatedOverlay(modalEl, { focusTarget: inputEl });
            activateFocusTrap?.(modalEl);
        }
        addInputEl.value = '';
    });

    toggleCompressionButtonEl?.addEventListener('click', (event) => {
        event.preventDefault();
        if (!pendingPayload) return;
        const currentMode = getPendingAttachMode();
        const nextMode = currentMode === ATTACH_MODE_MEDIA ? ATTACH_MODE_FILE : ATTACH_MODE_MEDIA;
        pendingPayload.options = {
            ...(pendingPayload.options || {}),
            attachMode: nextMode,
        };
        renderPendingState();
        closeOptionsMenu();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if (!isOverlayVisible(modalEl)) return;
        if (optionsMenuEl?.classList.contains('is-open')) {
            closeOptionsMenu();
            return;
        }
        closeCaptionModal();
    });

    window.addEventListener('sun-ui-language-changed', () => {
        syncOptionStaticLabels();
        renderPendingState();
    });
    syncOptionStaticLabels();
    renderPendingState();

    return {
        showCaptionModal,
        closeCaptionModal,
        hasPendingFile() {
            return getPendingFiles().length > 0;
        },
    };
}
