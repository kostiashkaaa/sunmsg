import { getCsrfToken } from '../../modules/csrf.js';

export function initSpotifySection() {
    const cardNotConfigured = document.getElementById('spotifyNotConfigured');
    const cardDisconnected = document.getElementById('spotifyDisconnected');
    const cardConnected = document.getElementById('spotifyConnected');
    const disconnectBtn = document.getElementById('spotifyDisconnectBtn');
    const disconnectStatus = document.getElementById('spotifyDisconnectStatus');

    if (!cardNotConfigured && !cardDisconnected && !cardConnected) return;

    function showState(state) {
        cardNotConfigured?.classList.toggle('settings-hidden', state !== 'not_configured');
        cardDisconnected?.classList.toggle('settings-hidden', state !== 'disconnected');
        cardConnected?.classList.toggle('settings-hidden', state !== 'connected');
    }

    async function loadStatus() {
        try {
            const resp = await fetch('/spotify/status', { credentials: 'same-origin' });
            if (!resp.ok) { showState('disconnected'); return; }
            const data = await resp.json();
            if (!data.configured) { showState('not_configured'); return; }
            showState(data.connected ? 'connected' : 'disconnected');
        } catch (_) {
            showState('disconnected');
        }
    }

    disconnectBtn?.addEventListener('click', async () => {
        disconnectBtn.disabled = true;
        if (disconnectStatus) disconnectStatus.textContent = '';
        try {
            const resp = await fetch('/spotify/disconnect', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'X-CSRFToken': getCsrfToken() },
            });
            if (resp.ok) {
                showState('disconnected');
            } else {
                if (disconnectStatus) disconnectStatus.textContent = 'Не удалось отключить Spotify.';
                disconnectBtn.disabled = false;
            }
        } catch (_) {
            if (disconnectStatus) disconnectStatus.textContent = 'Ошибка сети. Попробуйте снова.';
            disconnectBtn.disabled = false;
        }
    });

    loadStatus();
}
