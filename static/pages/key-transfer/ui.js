function parseDurationMs(raw) {
    const value = String(raw || '').trim().toLowerCase();
    if (!value) return 0;
    if (value.endsWith('ms')) {
        const ms = Number.parseFloat(value.slice(0, -2));
        return Number.isFinite(ms) ? Math.max(0, ms) : 0;
    }
    if (value.endsWith('s')) {
        const seconds = Number.parseFloat(value.slice(0, -1));
        return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : 0;
    }
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function maxMotionMs(element, fallbackMs = 0) {
    if (!element) return fallbackMs;
    const style = window.getComputedStyle(element);
    const transitionDurations = String(style.transitionDuration || '').split(',').map(parseDurationMs);
    const transitionDelays = String(style.transitionDelay || '').split(',').map(parseDurationMs);
    const animationDurations = String(style.animationDuration || '').split(',').map(parseDurationMs);
    const animationDelays = String(style.animationDelay || '').split(',').map(parseDurationMs);
    const transitionMax = Math.max(0, ...transitionDurations) + Math.max(0, ...transitionDelays);
    const animationMax = Math.max(0, ...animationDurations) + Math.max(0, ...animationDelays);
    return Math.max(transitionMax, animationMax, fallbackMs);
}

function waitForMotionEnd(element, fallbackMs = 0) {
    if (!element) return Promise.resolve();
    const timeoutMs = maxMotionMs(element, fallbackMs);
    if (timeoutMs <= 0) return Promise.resolve();
    return new Promise((resolve) => {
        let settled = false;
        let timeoutId = 0;
        const finish = () => {
            if (settled) return;
            settled = true;
            if (timeoutId) window.clearTimeout(timeoutId);
            element.removeEventListener('transitionend', onEnd);
            element.removeEventListener('animationend', onEnd);
            resolve();
        };
        const onEnd = (event) => {
            if (event?.target !== element) return;
            finish();
        };
        element.addEventListener('transitionend', onEnd);
        element.addEventListener('animationend', onEnd);
        timeoutId = window.setTimeout(finish, timeoutMs + 60);
    });
}

export function showToast(message, type = 'info') {
    const text = String(message || '').trim();
    if (!text) return;
    if (window.showToast && typeof window.showToast === 'function') {
        window.showToast(text, type);
        return;
    }
    const container = document.getElementById('toastContainer');
    if (!container) {
        window.alert(text);
        return;
    }
    const normalizedType = type === 'error' ? 'danger' : (type || 'info');
    const toast = document.createElement('div');
    toast.className = `toast-msg ${normalizedType}`;

    const iconWrap = document.createElement('span');
    iconWrap.className = 'toast-msg__icon';
    const iconByType = {
        success: 'check-circle-fill',
        danger: 'x-circle-fill',
        warning: 'exclamation-triangle-fill',
        info: 'info-circle-fill',
    };
    iconWrap.innerHTML = `<i class="bi bi-${iconByType[normalizedType] || iconByType.info}" aria-hidden="true"></i>`;

    const content = document.createElement('div');
    content.className = 'toast-msg__content';

    const title = document.createElement('div');
    title.className = 'toast-msg__title';
    title.textContent = 'SUN Messenger';

    const textNode = document.createElement('div');
    textNode.className = 'toast-msg__text';
    textNode.textContent = text;
    content.append(title, textNode);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'toast-msg__close';
    closeBtn.setAttribute('aria-label', 'Close notification');
    closeBtn.innerHTML = '<i class="bi bi-x-lg" aria-hidden="true"></i>';

    const hideToast = () => {
        if (toast.classList.contains('is-hiding')) return;
        toast.classList.add('is-hiding');
        waitForMotionEnd(toast, 320).then(() => {
            toast.remove();
        });
    };
    closeBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        hideToast();
    });
    toast.addEventListener('click', hideToast);
    toast.append(iconWrap, content, closeBtn);
    container.prepend(toast);
    window.setTimeout(hideToast, 3200);
}

export function openDialog(dialog) {
    if (!dialog) return;
    if (!dialog.open && typeof dialog.showModal === 'function') {
        dialog.showModal();
    }
}

export function closeDialog(dialog) {
    if (!dialog) return;
    if (dialog.open && typeof dialog.close === 'function') {
        dialog.close();
    }
}

export function setText(el, value) {
    if (!el) return;
    el.textContent = String(value || '');
}

export function setScanSuccessState(isVisible, text = '') {
    const successEl = document.getElementById('keyTransferScanSuccess');
    const textEl = document.getElementById('keyTransferScanSuccessText');
    if (!successEl) return;
    if (textEl && text) {
        textEl.textContent = String(text);
    }
    successEl.classList.toggle('is-visible', !!isVisible);
}

export function startScanDetectionLoop(scanState, step) {
    const run = async () => {
        if (!scanState.stream) return;
        await step();
        if (!scanState.stream) return;
        scanState.detectRaf = window.requestAnimationFrame(run);
    };
    scanState.detectRaf = window.requestAnimationFrame(run);
}

export function clearReceivePolling(receiveState) {
    if (receiveState.pollTimer) {
        window.clearInterval(receiveState.pollTimer);
        receiveState.pollTimer = 0;
    }
}

export function stopScanStream(scanState) {
    if (scanState.detectTimer) {
        window.clearInterval(scanState.detectTimer);
        scanState.detectTimer = 0;
    }
    if (scanState.detectRaf) {
        window.cancelAnimationFrame(scanState.detectRaf);
        scanState.detectRaf = 0;
    }
    if (scanState.successHideTimer) {
        window.clearTimeout(scanState.successHideTimer);
        scanState.successHideTimer = 0;
    }
    if (scanState.stream) {
        for (const track of scanState.stream.getTracks()) {
            try { track.stop(); } catch (_) {}
        }
        scanState.stream = null;
    }
    const video = document.getElementById('keyTransferScanVideo');
    if (video) {
        video.srcObject = null;
    }
}

export function attachDialogBackDropClose(dialog, closeHandler) {
    if (!dialog) return;
    dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        closeHandler();
    });
    dialog.addEventListener('click', (event) => {
        const rect = dialog.getBoundingClientRect();
        const inside = event.clientX >= rect.left
            && event.clientX <= rect.right
            && event.clientY >= rect.top
            && event.clientY <= rect.bottom;
        if (!inside) {
            closeHandler();
        }
    });
}

export async function renderReceiveQrCode(text) {
    const container = document.getElementById('keyTransferReceiveQr');
    if (!container) return;
    container.innerHTML = '';
    if (typeof window.ensureQrCodeLibrary === 'function') {
        await window.ensureQrCodeLibrary();
    }
    if (typeof window.QRCode !== 'function') {
        throw new Error('QR библиотека не загружена.');
    }
    new window.QRCode(container, {
        text,
        width: 216,
        height: 216,
        colorDark: '#15140e',
        colorLight: '#ffffff',
        correctLevel: window.QRCode.CorrectLevel.M,
    });
}
