(() => {
    const form = document.getElementById('supportFeedbackForm');
    if (!(form instanceof HTMLFormElement)) {
        return;
    }

    const submitBtn = document.getElementById('supportSubmitBtn');
    const statusEl = document.getElementById('supportStatus');
    const sourceInput = document.getElementById('supportSource');
    const usernameInput = document.getElementById('supportUsername');
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
    const isAuthedUser = form.dataset.isAuthUser === '1';
    const authedUsername = form.dataset.authUsername || '';
    const i18nApi = window.SUN_I18N || null;
    const tr = (value) => {
        if (!i18nApi || typeof i18nApi.translateText !== 'function') {
            return String(value || '');
        }
        return i18nApi.translateText(String(value || ''));
    };

    const setStatus = (message, mode = '') => {
        if (!(statusEl instanceof HTMLElement)) {
            return;
        }
        statusEl.textContent = String(message || '');
        statusEl.className = `support-feedback-status ${mode}`.trim();
    };

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!(submitBtn instanceof HTMLButtonElement)) {
            return;
        }

        submitBtn.disabled = true;
        setStatus(tr('Отправка...'));

        const payload = Object.fromEntries(new FormData(form).entries());

        try {
            const response = await fetch('/api/support/requests', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrfToken,
                },
                credentials: 'include',
                body: JSON.stringify(payload),
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data.success) {
                setStatus(data.error || tr('Не удалось отправить запрос'), 'err');
                return;
            }

            setStatus(`${tr('Запрос отправлен')} (id #${data.request_id})`, 'ok');
            form.reset();

            if (sourceInput instanceof HTMLInputElement) {
                sourceInput.value = 'support_page';
            }

            if (isAuthedUser && usernameInput instanceof HTMLInputElement) {
                usernameInput.value = authedUsername;
            }
        } catch (_) {
            setStatus(tr('Сетевая ошибка'), 'err');
        } finally {
            submitBtn.disabled = false;
        }
    });
})();
