import { withAppRoot } from './app-url.js';

export function detectFileCategory(file) {
    const mime = String(file?.type || '').toLowerCase();
    const fileName = String(file?.name || '').toLowerCase();
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    if (/\.(webm|ogg|wav|mp3|m4a|aac|opus)$/i.test(fileName)) return 'audio';
    return 'file';
}

export function getMessageTypeByCategory(category) {
    if (category === 'image') return 'photo';
    if (category === 'video') return 'video';
    if (category === 'audio') return 'audio';
    return 'file';
}

export function createUploadAbortedError() {
    const error = new Error('Загрузка отменена.');
    error.code = 'UPLOAD_ABORTED';
    error.name = 'UploadAbortedError';
    error.isUploadAborted = true;
    return error;
}

export function isUploadAbortedError(error) {
    return Boolean(
        error
        && (error.code === 'UPLOAD_ABORTED'
            || error.name === 'UploadAbortedError'
            || error.isUploadAborted === true),
    );
}

function renameFileByMime(fileName, mimeType) {
    const rawName = String(fileName || 'media');
    const baseName = rawName.replace(/\.[^/.]+$/, '');
    if (mimeType === 'image/webp') return `${baseName}.webp`;
    if (mimeType === 'image/png') return `${baseName}.png`;
    return `${baseName}.jpg`;
}

function normalizeCanvasOutputMime(requestedMime, blobMime) {
    const requested = String(requestedMime || '').toLowerCase();
    const actual = String(blobMime || '').toLowerCase();
    if (actual === 'image/webp' || actual === 'image/png' || actual === 'image/jpeg') {
        return actual;
    }
    if (actual === 'image/jpg') {
        return 'image/jpeg';
    }
    if (requested === 'image/webp' || requested === 'image/png' || requested === 'image/jpeg') {
        return requested;
    }
    return 'image/jpeg';
}

function loadImageElementFromFile(file) {
    return new Promise((resolve, reject) => {
        const blobUrl = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => {
            URL.revokeObjectURL(blobUrl);
            resolve(image);
        };
        image.onerror = () => {
            URL.revokeObjectURL(blobUrl);
            reject(new Error('Failed to read image.'));
        };
        image.src = blobUrl;
    });
}

function canvasToBlob(canvas, mimeType, quality = 0.86) {
    return new Promise((resolve) => {
        canvas.toBlob((blob) => resolve(blob || null), mimeType, quality);
    });
}

export async function optimizeFileForAttachMode(file, {
    attachMode = 'file',
    maxImageSide = 2048,
    quality = 0.86,
} = {}) {
    if (!file || attachMode !== 'media') {
        return { file, optimized: false };
    }

    const mime = String(file.type || '').toLowerCase();
    if (!mime.startsWith('image/')) {
        return { file, optimized: false };
    }
    if (mime === 'image/gif' || mime === 'image/svg+xml') {
        return { file, optimized: false };
    }

    try {
        const image = await loadImageElementFromFile(file);
        const naturalWidth = Number(image.naturalWidth) || 0;
        const naturalHeight = Number(image.naturalHeight) || 0;
        if (!(naturalWidth > 0) || !(naturalHeight > 0)) {
            return { file, optimized: false };
        }

        const scale = Math.min(
            1,
            Number(maxImageSide) / Math.max(naturalWidth, naturalHeight),
        );
        const targetWidth = Math.max(1, Math.round(naturalWidth * scale));
        const targetHeight = Math.max(1, Math.round(naturalHeight * scale));

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
        if (!ctx) {
            return { file, optimized: false };
        }
        ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

        const outputMime = (mime === 'image/png') ? 'image/webp' : (mime === 'image/webp' ? 'image/webp' : 'image/jpeg');
        const optimizedBlob = await canvasToBlob(canvas, outputMime, quality);
        if (!optimizedBlob) {
            return { file, optimized: false };
        }

        const canSaveSpace = optimizedBlob.size < file.size;
        const resized = scale < 0.999;
        if (!canSaveSpace && !resized) {
            return { file, optimized: false };
        }

        const finalMime = normalizeCanvasOutputMime(outputMime, optimizedBlob.type);
        const optimizedFile = new File(
            [optimizedBlob],
            renameFileByMime(file.name, finalMime),
            { type: finalMime, lastModified: Date.now() },
        );

        return {
            file: optimizedFile,
            optimized: true,
            originalSize: Number(file.size) || 0,
            optimizedSize: Number(optimizedFile.size) || 0,
        };
    } catch (_) {
        return { file, optimized: false };
    }
}

function buildVisualPreviewMeta(width, height) {
    const safeWidth = Number(width);
    const safeHeight = Number(height);
    if (!Number.isFinite(safeWidth) || safeWidth <= 0 || !Number.isFinite(safeHeight) || safeHeight <= 0) {
        return null;
    }

    return {
        preview_width: Math.round(safeWidth),
        preview_height: Math.round(safeHeight),
        preview_aspect_ratio: Number((safeWidth / safeHeight).toFixed(4)),
    };
}

export async function probeVisualMediaMetadata(file, {
    category = '',
    objectUrl = '',
} = {}) {
    const kind = category || detectFileCategory(file);
    if (kind !== 'image' && kind !== 'video') return null;

    const previewUrl = objectUrl || URL.createObjectURL(file);
    const shouldRevoke = !objectUrl;

    try {
        const meta = await new Promise((resolve) => {
            if (kind === 'image') {
                const img = new Image();
                let settled = false;
                const finish = (value) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeoutId);
                    resolve(value);
                };
                const timeoutId = setTimeout(() => finish(null), 4500);
                img.onload = () => finish({
                    width: Number(img.naturalWidth) || 0,
                    height: Number(img.naturalHeight) || 0,
                });
                img.onerror = () => finish(null);
                img.src = previewUrl;
                return;
            }

            const video = document.createElement('video');
            let settled = false;
            const finish = (value) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeoutId);
                try {
                    video.pause();
                    video.removeAttribute('src');
                    video.load();
                } catch (_) {}
                resolve(value);
            };
            const timeoutId = setTimeout(() => finish(null), 6000);
            const tryResolve = () => finish(buildVisualPreviewMeta(video.videoWidth, video.videoHeight));
            video.preload = 'metadata';
            video.muted = true;
            video.playsInline = true;
            video.onloadedmetadata = tryResolve;
            video.onloadeddata = tryResolve;
            video.ondurationchange = tryResolve;
            video.onresize = tryResolve;
            video.onerror = () => finish(null);
            video.src = previewUrl;
            try {
                video.load();
            } catch (_) {}
        });

        if (meta?.preview_width && meta?.preview_height) {
            return meta;
        }

        return buildVisualPreviewMeta(meta?.width, meta?.height);
    } finally {
        if (shouldRevoke) {
            try { URL.revokeObjectURL(previewUrl); } catch (_) {}
        }
    }
}

export function uploadChatMedia(file, {
    chatId = '',
    csrfToken = '',
    mediaHint = '',
    onProgress,
    onRequestReady,
} = {}) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        let settled = false;
        const resolveOnce = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };
        const rejectOnce = (error) => {
            if (settled) return;
            settled = true;
            reject(error);
        };
        const abortUpload = () => {
            if (xhr.readyState === XMLHttpRequest.DONE || xhr.readyState === XMLHttpRequest.UNSENT) return;
            try {
                xhr.abort();
            } catch (_) {}
        };

        xhr.open('POST', withAppRoot('/upload_chat_media'), true);
        if (csrfToken) xhr.setRequestHeader('X-CSRFToken', csrfToken);
        if (typeof onRequestReady === 'function') {
            onRequestReady(abortUpload);
        }

        xhr.upload.onprogress = (event) => {
            if (!event.lengthComputable || typeof onProgress !== 'function') return;
            if (!(event.total > 0)) return;
            onProgress((event.loaded / event.total) * 100);
        };

        xhr.onload = () => {
            let data = null;
            try {
                data = JSON.parse(xhr.responseText || '{}');
            } catch (_) {
                rejectOnce(new Error('\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0444\u0430\u0439\u043B.'));
                return;
            }
            if (xhr.status >= 200 && xhr.status < 300 && data?.success) {
                resolveOnce(data);
                return;
            }
            const errMsg = typeof data?.error === 'string'
                ? data.error
                : (data?.error?.message || '\u041E\u0448\u0438\u0431\u043A\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0438 \u0444\u0430\u0439\u043B\u0430.');
            rejectOnce(new Error(errMsg));
        };
        xhr.onerror = () => rejectOnce(new Error('\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u0435\u0442\u0438 \u043F\u0440\u0438 \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0435 \u0444\u0430\u0439\u043B\u0430.'));
        xhr.onabort = () => rejectOnce(createUploadAbortedError());

        const formData = new FormData();
        formData.append('file', file);
        formData.append('chat_id', chatId || '');
        if (mediaHint) formData.append('media_hint', mediaHint);
        xhr.send(formData);
    });
}

export async function probeAudioDurationSeconds(file, fallbackSeconds = null) {
    const fallback = Number(fallbackSeconds);
    if (Number.isFinite(fallback) && fallback > 0) {
        return Math.max(1, Math.floor(fallback));
    }
    if (!file) {
        return null;
    }
    const objectUrl = URL.createObjectURL(file);
    try {
        const duration = await new Promise((resolve) => {
            const audio = new Audio();
            let settled = false;
            const finish = (value) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeoutId);
                try {
                    audio.pause();
                    audio.removeAttribute('src');
                    audio.load();
                } catch (_) {}
                resolve(value);
            };

            const timeoutId = setTimeout(() => finish(null), 4500);

            audio.preload = 'metadata';
            audio.src = objectUrl;
            audio.onloadedmetadata = () => {
                const d = Number(audio.duration);
                if (Number.isFinite(d) && d > 0) {
                    finish(Math.max(1, Math.floor(d)));
                    return;
                }
                finish(null);
            };
            audio.onerror = () => finish(null);
        });
        return Number.isFinite(duration) && duration > 0 ? duration : null;
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

export async function buildAudioWaveformPeaks(file, barsCount = 48) {
    const targetBars = Math.max(16, Math.min(96, Number(barsCount) || 48));
    if (!file || typeof file.arrayBuffer !== 'function') return null;
    if (Number(file.size) > 12 * 1024 * 1024) return null;

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;

    let ctx;
    try {
        ctx = new AudioCtx();
        const fileBuffer = await file.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(fileBuffer.slice(0));
        const channels = [];
        for (let ch = 0; ch < audioBuffer.numberOfChannels; ch += 1) {
            channels.push(audioBuffer.getChannelData(ch));
        }
        if (!channels.length || !audioBuffer.length) return null;

        const blockSize = Math.max(1, Math.floor(audioBuffer.length / targetBars));
        const rawPeaks = new Array(targetBars).fill(0);

        for (let i = 0; i < targetBars; i += 1) {
            const start = i * blockSize;
            const end = Math.min(audioBuffer.length, start + blockSize);
            const sampleStep = Math.max(1, Math.floor((end - start) / 72));
            let max = 0;

            for (let j = start; j < end; j += sampleStep) {
                for (let ch = 0; ch < channels.length; ch += 1) {
                    const value = Math.abs(channels[ch][j] || 0);
                    if (value > max) max = value;
                }
            }
            rawPeaks[i] = max;
        }

        const globalMax = rawPeaks.reduce((acc, value) => Math.max(acc, value), 0);
        if (!(globalMax > 0)) {
            // Тишина — возвращаем ровную низкую волну вместо fallback-псевдоволны
            return new Array(targetBars).fill(8);
        }

        return rawPeaks.map((value) => {
            const normalized = Math.round((value / globalMax) * 100);
            return Math.max(8, Math.min(100, normalized));
        });
    } catch (_) {
        return null;
    } finally {
        if (ctx && typeof ctx.close === 'function') {
            try { await ctx.close(); } catch (_) {}
        }
    }
}

