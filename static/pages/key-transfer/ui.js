export function showToast(_message, _type = 'info') {
    // Toast UI is intentionally disabled; keep the public hook for existing callers.
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
