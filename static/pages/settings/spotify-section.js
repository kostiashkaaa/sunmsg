import { getCsrfToken } from '../../modules/csrf.js';

export function initSpotifySection() {
    const cardNotConfigured = document.getElementById('spotifyNotConfigured');
    const cardDisconnected = document.getElementById('spotifyDisconnected');
    const cardConnected = document.getElementById('spotifyConnected');
    const disconnectBtn = document.getElementById('spotifyDisconnectBtn');
    const disconnectStatus = document.getElementById('spotifyDisconnectStatus');
    const privacySaveBtn = document.getElementById('spotifyPrivacySaveBtn');
    const privacyStatus = document.getElementById('spotifyPrivacyStatus');
    const hideExplicitToggle = document.getElementById('spotifyHideExplicit');

    if (!cardNotConfigured && !cardDisconnected && !cardConnected) return;

    function showState(state) {
        cardNotConfigured?.classList.toggle('settings-hidden', state !== 'not_configured');
        cardDisconnected?.classList.toggle('settings-hidden', state !== 'disconnected');
        cardConnected?.classList.toggle('settings-hidden', state !== 'connected');
    }

    function setPrivacyUI(spotify_privacy, hide_explicit) {
        const radios = document.querySelectorAll('input[name="spotifyPrivacy"]');
        radios.forEach(r => { r.checked = r.value === (spotify_privacy || 'contacts'); });
        if (hideExplicitToggle) hideExplicitToggle.checked = !!hide_explicit;
    }

    async function loadStatus() {
        try {
            const resp = await fetch('/spotify/status', { credentials: 'same-origin' });
            if (!resp.ok) { showState('disconnected'); return; }
            const data = await resp.json();
            if (!data.configured) { showState('not_configured'); return; }
            if (data.connected) {
                showState('connected');
                setPrivacyUI(data.spotify_privacy, data.hide_explicit);
            } else {
                showState('disconnected');
            }
        } catch (_) {
            showState('disconnected');
        }
    }

    privacySaveBtn?.addEventListener('click', async () => {
        privacySaveBtn.disabled = true;
        if (privacyStatus) privacyStatus.textContent = '';

        const checkedRadio = document.querySelector('input[name="spotifyPrivacy"]:checked');
        const spotify_privacy = checkedRadio ? checkedRadio.value : 'contacts';
        const hide_explicit = hideExplicitToggle ? hideExplicitToggle.checked : false;

        try {
            const resp = await fetch('/spotify/privacy', {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken(),
                },
                body: JSON.stringify({ spotify_privacy, hide_explicit }),
            });
            if (resp.ok) {
                if (privacyStatus) {
                    privacyStatus.textContent = 'Настройки сохранены.';
                    setTimeout(() => { privacyStatus.textContent = ''; }, 3000);
                }
            } else {
                if (privacyStatus) privacyStatus.textContent = 'Не удалось сохранить настройки.';
            }
        } catch (_) {
            if (privacyStatus) privacyStatus.textContent = 'Ошибка сети. Попробуйте снова.';
        } finally {
            privacySaveBtn.disabled = false;
        }
    });

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
