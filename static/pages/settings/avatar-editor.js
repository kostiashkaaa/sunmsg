export function initAvatarEditor({
    tr,
    avatarFileInputEl,
    setAvatarUploadStatus,
    uploadAvatarBlob,
}) {
    const avatarEditorEl = document.getElementById('avatarEditor');
    const avatarEditorViewport = document.getElementById('avatarEditorViewport');
    const avatarEditorCanvas = document.getElementById('avatarEditorCanvas');
    const avatarEditorZoom = document.getElementById('avatarEditorZoom');
    const avatarEditorDone = document.getElementById('avatarEditorDone');
    const avatarEditorClose = document.getElementById('avatarEditorClose');
    const avatarEditorReset = document.getElementById('avatarEditorReset');
    const avatarEditorRotateLeft = document.getElementById('avatarEditorRotateLeft');
    const avatarEditorRotateRight = document.getElementById('avatarEditorRotateRight');
    const avatarEditorCropFrame = avatarEditorEl?.querySelector('.avatar-editor-crop-frame') || null;

    const AVATAR_OUTPUT_SIZE = 512;
    let avatarEditorState = null;
    let avatarEditorDrag = null;

    function normalizeRotation(degrees) {
        return ((degrees % 360) + 360) % 360;
    }

    function getAvatarCropSize() {
        const frameRect = avatarEditorCropFrame?.getBoundingClientRect();
        if (frameRect && frameRect.width > 0) return frameRect.width;
        const viewportRect = avatarEditorViewport?.getBoundingClientRect();
        return Math.max(1, Math.min(viewportRect?.width || 1, viewportRect?.height || 1) * 0.78);
    }

    function getRotatedImageBounds(scale) {
        if (!avatarEditorState?.image) return { width: 1, height: 1 };
        const radians = avatarEditorState.rotation * Math.PI / 180;
        const cos = Math.abs(Math.cos(radians));
        const sin = Math.abs(Math.sin(radians));
        const width = avatarEditorState.image.naturalWidth * scale;
        const height = avatarEditorState.image.naturalHeight * scale;
        return {
            width: (width * cos) + (height * sin),
            height: (width * sin) + (height * cos),
        };
    }

    function syncAvatarScale() {
        if (!avatarEditorState?.image) return;
        const cropSize = getAvatarCropSize();
        const boundsAtScaleOne = getRotatedImageBounds(1);
        const minScale = Math.max(
            cropSize / boundsAtScaleOne.width,
            cropSize / boundsAtScaleOne.height,
        );
        avatarEditorState.minScale = minScale;
        avatarEditorState.zoom = Math.min(4, Math.max(1, Number(avatarEditorState.zoom) || 1));
        avatarEditorState.scale = avatarEditorState.minScale * avatarEditorState.zoom;
        if (avatarEditorZoom) avatarEditorZoom.value = String(avatarEditorState.zoom);
    }

    function clampAvatarOffset() {
        if (!avatarEditorState?.image) return;
        const cropSize = getAvatarCropSize();
        const bounds = getRotatedImageBounds(avatarEditorState.scale);
        const maxX = Math.max(0, (bounds.width - cropSize) / 2);
        const maxY = Math.max(0, (bounds.height - cropSize) / 2);
        avatarEditorState.offsetX = Math.max(-maxX, Math.min(maxX, avatarEditorState.offsetX));
        avatarEditorState.offsetY = Math.max(-maxY, Math.min(maxY, avatarEditorState.offsetY));
    }

    function resizeAvatarCanvas() {
        if (!avatarEditorCanvas || !avatarEditorViewport) return null;
        const rect = avatarEditorViewport.getBoundingClientRect();
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const width = Math.max(1, Math.round(rect.width));
        const height = Math.max(1, Math.round(rect.height));
        const pixelWidth = Math.round(width * dpr);
        const pixelHeight = Math.round(height * dpr);
        if (avatarEditorCanvas.width !== pixelWidth || avatarEditorCanvas.height !== pixelHeight) {
            avatarEditorCanvas.width = pixelWidth;
            avatarEditorCanvas.height = pixelHeight;
        }
        return { width, height, dpr };
    }

    function renderAvatarEditor() {
        if (!avatarEditorState?.image || !avatarEditorCanvas) return;
        const canvasSize = resizeAvatarCanvas();
        if (!canvasSize) return;
        syncAvatarScale();
        clampAvatarOffset();

        const ctx = avatarEditorCanvas.getContext('2d');
        ctx.setTransform(canvasSize.dpr, 0, 0, canvasSize.dpr, 0, 0);
        ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvasSize.width, canvasSize.height);
        ctx.save();
        ctx.translate(
            (canvasSize.width / 2) + avatarEditorState.offsetX,
            (canvasSize.height / 2) + avatarEditorState.offsetY,
        );
        ctx.rotate(avatarEditorState.rotation * Math.PI / 180);
        ctx.scale(avatarEditorState.scale, avatarEditorState.scale);
        ctx.drawImage(
            avatarEditorState.image,
            -avatarEditorState.image.naturalWidth / 2,
            -avatarEditorState.image.naturalHeight / 2,
        );
        ctx.restore();
    }

    function setAvatarZoom(nextZoom) {
        if (!avatarEditorState) return;
        avatarEditorState.zoom = Math.min(4, Math.max(1, Number(nextZoom) || 1));
        syncAvatarScale();
        clampAvatarOffset();
        renderAvatarEditor();
    }

    function resetAvatarEditorTransform() {
        if (!avatarEditorState) return;
        avatarEditorState.rotation = 0;
        avatarEditorState.zoom = 1;
        avatarEditorState.offsetX = 0;
        avatarEditorState.offsetY = 0;
        renderAvatarEditor();
    }

    function rotateAvatarEditor(delta) {
        if (!avatarEditorState) return;
        avatarEditorState.rotation = normalizeRotation(avatarEditorState.rotation + delta);
        syncAvatarScale();
        clampAvatarOffset();
        renderAvatarEditor();
    }

    function closeAvatarEditor({ clearInput = true } = {}) {
        if (!avatarEditorEl) return;
        avatarEditorEl.hidden = true;
        avatarEditorEl.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('avatar-editor-open');
        if (avatarEditorState?.objectUrl) {
            URL.revokeObjectURL(avatarEditorState.objectUrl);
        }
        avatarEditorState = null;
        avatarEditorDrag = null;
        if (clearInput && avatarFileInputEl) avatarFileInputEl.value = '';
    }

    function createAvatarImage(file) {
        return new Promise((resolve, reject) => {
            const objectUrl = URL.createObjectURL(file);
            const image = new Image();
            image.onload = () => resolve({ image, objectUrl });
            image.onerror = () => {
                URL.revokeObjectURL(objectUrl);
                reject(new Error('Не удалось прочитать это изображение'));
            };
            image.src = objectUrl;
        });
    }

    function openAvatarEditor(file) {
        if (!avatarEditorEl || !avatarEditorCanvas || !avatarEditorViewport) {
            uploadAvatarBlob(file, file.name || 'avatar.png', avatarFileInputEl);
            return;
        }
        if (!String(file.type || '').startsWith('image/')) {
            setAvatarUploadStatus('Ошибка: выберите изображение', 'var(--danger)');
            if (avatarFileInputEl) avatarFileInputEl.value = '';
            return;
        }

        createAvatarImage(file)
            .then(({ image, objectUrl }) => {
                avatarEditorState = {
                    image,
                    objectUrl,
                    inputEl: avatarFileInputEl,
                    rotation: 0,
                    zoom: 1,
                    scale: 1,
                    minScale: 1,
                    offsetX: 0,
                    offsetY: 0,
                };
                avatarEditorEl.hidden = false;
                avatarEditorEl.setAttribute('aria-hidden', 'false');
                document.body.classList.add('avatar-editor-open');
                if (avatarEditorZoom) avatarEditorZoom.value = '1';
                requestAnimationFrame(renderAvatarEditor);
            })
            .catch((error) => {
                setAvatarUploadStatus(`${tr('Ошибка:')} ${tr(error.message)}`.trim(), 'var(--danger)');
                if (avatarFileInputEl) avatarFileInputEl.value = '';
            });
    }

    function createCroppedAvatarBlob() {
        return new Promise((resolve, reject) => {
            if (!avatarEditorState?.image) {
                reject(new Error('Фото не выбрано'));
                return;
            }
            const outputCanvas = document.createElement('canvas');
            outputCanvas.width = AVATAR_OUTPUT_SIZE;
            outputCanvas.height = AVATAR_OUTPUT_SIZE;
            const outputCtx = outputCanvas.getContext('2d');
            const cropScale = AVATAR_OUTPUT_SIZE / getAvatarCropSize();
            outputCtx.fillStyle = '#000';
            outputCtx.fillRect(0, 0, AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE);
            outputCtx.save();
            outputCtx.translate(
                (AVATAR_OUTPUT_SIZE / 2) + (avatarEditorState.offsetX * cropScale),
                (AVATAR_OUTPUT_SIZE / 2) + (avatarEditorState.offsetY * cropScale),
            );
            outputCtx.rotate(avatarEditorState.rotation * Math.PI / 180);
            outputCtx.scale(avatarEditorState.scale * cropScale, avatarEditorState.scale * cropScale);
            outputCtx.drawImage(
                avatarEditorState.image,
                -avatarEditorState.image.naturalWidth / 2,
                -avatarEditorState.image.naturalHeight / 2,
            );
            outputCtx.restore();
            outputCanvas.toBlob((blob) => {
                if (!blob) {
                    reject(new Error('Не удалось подготовить фото'));
                    return;
                }
                resolve(blob);
            }, 'image/jpeg', 0.86);
        });
    }

    avatarEditorZoom?.addEventListener('input', function () {
        setAvatarZoom(this.value);
    });
    avatarEditorReset?.addEventListener('click', resetAvatarEditorTransform);
    avatarEditorRotateLeft?.addEventListener('click', () => rotateAvatarEditor(-90));
    avatarEditorRotateRight?.addEventListener('click', () => rotateAvatarEditor(90));
    avatarEditorClose?.addEventListener('click', () => closeAvatarEditor());
    avatarEditorDone?.addEventListener('click', function () {
        if (!avatarEditorState || avatarEditorDone.disabled) return;
        avatarEditorDone.disabled = true;
        createCroppedAvatarBlob()
            .then((blob) => {
                const inputEl = avatarEditorState?.inputEl || avatarFileInputEl;
                closeAvatarEditor({ clearInput: false });
                return uploadAvatarBlob(blob, 'avatar.jpg', inputEl);
            })
            .catch((error) => {
                setAvatarUploadStatus(`${tr('Ошибка:')} ${tr(error.message)}`.trim(), 'var(--danger)');
            })
            .finally(() => {
                avatarEditorDone.disabled = false;
            });
    });

    avatarEditorViewport?.addEventListener('pointerdown', (event) => {
        if (!avatarEditorState) return;
        avatarEditorDrag = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
        };
        avatarEditorViewport.setPointerCapture(event.pointerId);
    });

    avatarEditorViewport?.addEventListener('pointermove', (event) => {
        if (!avatarEditorState || !avatarEditorDrag || avatarEditorDrag.pointerId !== event.pointerId) return;
        avatarEditorState.offsetX += event.clientX - avatarEditorDrag.x;
        avatarEditorState.offsetY += event.clientY - avatarEditorDrag.y;
        avatarEditorDrag.x = event.clientX;
        avatarEditorDrag.y = event.clientY;
        clampAvatarOffset();
        renderAvatarEditor();
    });

    ['pointerup', 'pointercancel'].forEach((eventName) => {
        avatarEditorViewport?.addEventListener(eventName, (event) => {
            if (avatarEditorDrag?.pointerId === event.pointerId) avatarEditorDrag = null;
        });
    });

    avatarEditorViewport?.addEventListener('wheel', (event) => {
        if (!avatarEditorState) return;
        event.preventDefault();
        const delta = event.deltaY > 0 ? -0.08 : 0.08;
        setAvatarZoom(avatarEditorState.zoom + delta);
    }, { passive: false });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && avatarEditorState) closeAvatarEditor();
    });

    if (window.ResizeObserver && avatarEditorViewport) {
        new ResizeObserver(renderAvatarEditor).observe(avatarEditorViewport);
    } else {
        window.addEventListener('resize', renderAvatarEditor);
    }

    avatarFileInputEl?.addEventListener('change', function () {
        const file = this.files && this.files[0];
        if (!file) return;
        openAvatarEditor(file);
    });
}