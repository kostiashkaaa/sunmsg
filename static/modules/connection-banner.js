/*
 * Global connection-loss banner.
 *
 * Pinned to the top of the viewport (z-index above modals and toasts). Visible
 * whenever either:
 *   - navigator.onLine === false (browser-detected network loss), or
 *   - the SocketIO socket is disconnected for longer than GRACE_MS.
 *
 * GRACE_MS keeps the banner from flashing during normal transport upgrades
 * (websocket ↔ polling), which can briefly drop the connection.
 */

const GRACE_MS = 4000;
const BANNER_ID = 'sun-connection-banner';
const ROOT_CLASS = 'sun-has-connection-banner';

let bannerEl = null;
let socketRef = null;
let pendingTimer = 0;
let isShowing = false;
let lastSocketConnected = true;

function tr(text) {
    if (typeof window !== 'undefined' && typeof window.t === 'function') {
        try {
            return window.t(text);
        } catch (_err) {
            return text;
        }
    }
    return text;
}

function ensureBannerEl() {
    if (bannerEl && document.body.contains(bannerEl)) return bannerEl;
    bannerEl = document.createElement('div');
    bannerEl.id = BANNER_ID;
    bannerEl.className = 'sun-connection-banner';
    bannerEl.setAttribute('role', 'status');
    bannerEl.setAttribute('aria-live', 'polite');
    bannerEl.setAttribute('hidden', '');
    bannerEl.innerHTML = `
        <span class="sun-connection-banner__dot" aria-hidden="true"></span>
        <span class="sun-connection-banner__label"></span>
        <button type="button" class="sun-connection-banner__retry" aria-label="${tr('Повторить попытку подключения')}">
            ${tr('Повторить')}
        </button>
    `;
    document.body.appendChild(bannerEl);

    const retryBtn = bannerEl.querySelector('.sun-connection-banner__retry');
    retryBtn?.addEventListener('click', () => {
        try {
            socketRef?.connect?.();
        } catch (_err) {
            // socket.io reconnects on its own; this is just a courtesy ping.
        }
    });
    return bannerEl;
}

function setLabel(text) {
    const labelEl = bannerEl?.querySelector('.sun-connection-banner__label');
    if (labelEl) labelEl.textContent = text;
}

function show(reason) {
    ensureBannerEl();
    const networkOff = (typeof navigator !== 'undefined') && navigator.onLine === false;
    const label = networkOff
        ? tr('Нет интернета — мы переподключимся, как только сеть вернётся.')
        : tr('Связь с сервером прервалась — пытаемся восстановить…');
    setLabel(label);
    bannerEl.removeAttribute('hidden');
    document.documentElement.classList.add(ROOT_CLASS);
    isShowing = true;
}

function hide() {
    if (!bannerEl) return;
    bannerEl.setAttribute('hidden', '');
    document.documentElement.classList.remove(ROOT_CLASS);
    isShowing = false;
}

function scheduleShow(reason) {
    if (pendingTimer) return;
    pendingTimer = window.setTimeout(() => {
        pendingTimer = 0;
        // Re-check at fire time: socket may have reconnected during grace.
        if (!lastSocketConnected || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
            show(reason);
        }
    }, GRACE_MS);
}

function cancelPendingShow() {
    if (!pendingTimer) return;
    window.clearTimeout(pendingTimer);
    pendingTimer = 0;
}

function handleSocketState(connected) {
    lastSocketConnected = !!connected;
    if (connected) {
        cancelPendingShow();
        if (isShowing) hide();
        return;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        // Browser already knows network is down — show immediately, no grace.
        show('offline');
        return;
    }
    scheduleShow('socket');
}

function handleBrowserOnline() {
    if (lastSocketConnected) {
        cancelPendingShow();
        hide();
    } else {
        scheduleShow('reconnecting');
    }
}

function handleBrowserOffline() {
    cancelPendingShow();
    show('offline');
}

export function attachConnectionBanner(socket) {
    if (!socket || typeof socket.on !== 'function') return;
    if (socketRef === socket) return;
    socketRef = socket;
    ensureBannerEl();

    socket.on('connect', () => handleSocketState(true));
    socket.on('disconnect', () => handleSocketState(false));
    socket.on('connect_error', () => handleSocketState(false));
    socket.on('reconnect', () => handleSocketState(true));

    window.addEventListener('online', handleBrowserOnline);
    window.addEventListener('offline', handleBrowserOffline);

    // Sync initial state in case attach happens after the first connect.
    if (socket.connected === true) {
        handleSocketState(true);
    } else if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        show('offline');
    }
}
