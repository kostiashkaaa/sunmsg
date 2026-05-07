const DEFAULT_MAX_SIDE = 1600;
const DEFAULT_TARGET_MAX_CHARS = 360_000;
const MIN_SIDE = 640;
const QUALITY_STEPS = [0.86, 0.78, 0.7, 0.62, 0.54, 0.46];
const EXTRA_DOWNSCALE_STEPS = [1, 0.88, 0.76, 0.64, 0.52, 0.44];

function readImageFromFile(file) {
    return new Promise((resolve, reject) => {
        const objectUrl = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(image);
        };
        image.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('Не удалось декодировать изображение'));
        };
        image.src = objectUrl;
    });
}

function renderJpegDataUrl(image, width, height, quality) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) return '';

    ctx.fillStyle = '#0f131a';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', quality);
}

function normalizeTargetSize(image, maxSide) {
    const naturalWidth = Number(image.naturalWidth) || 0;
    const naturalHeight = Number(image.naturalHeight) || 0;
    if (!(naturalWidth > 0) || !(naturalHeight > 0)) {
        return null;
    }
    const fitScale = Math.min(1, maxSide / Math.max(naturalWidth, naturalHeight));
    return {
        width: Math.max(1, Math.round(naturalWidth * fitScale)),
        height: Math.max(1, Math.round(naturalHeight * fitScale)),
    };
}

export async function prepareWallpaperDataUrl(file, options = {}) {
    if (!file) {
        throw new Error('Не выбран файл изображения');
    }

    const maxSide = Math.max(MIN_SIDE, Number(options.maxSide) || DEFAULT_MAX_SIDE);
    const targetMaxChars = Math.max(160_000, Number(options.targetMaxChars) || DEFAULT_TARGET_MAX_CHARS);
    const image = await readImageFromFile(file);
    const baseSize = normalizeTargetSize(image, maxSide);
    if (!baseSize) {
        throw new Error('Некорректное изображение');
    }

    let best = '';
    for (const ratio of EXTRA_DOWNSCALE_STEPS) {
        const width = Math.max(1, Math.round(baseSize.width * ratio));
        const height = Math.max(1, Math.round(baseSize.height * ratio));
        for (const quality of QUALITY_STEPS) {
            const next = renderJpegDataUrl(image, width, height, quality);
            if (!next) continue;
            if (!best || next.length < best.length) {
                best = next;
            }
            if (next.length <= targetMaxChars) {
                return next;
            }
        }
        if (width <= MIN_SIDE && height <= MIN_SIDE) {
            break;
        }
    }

    if (!best) {
        throw new Error('Не удалось обработать изображение обоев');
    }

    return best;
}
