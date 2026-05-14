export function createSettingsApi({ withAppRoot, getCsrfToken }) {
    async function readJsonPayload(response) {
        try {
            return await response.json();
        } catch (_) {
            return null;
        }
    }

    async function request(path, {
        method = 'GET',
        json,
        body,
        headers = {},
        credentials = 'include',
        keepalive = false,
    } = {}) {
        const finalHeaders = { ...headers };
        let finalBody = body;

        if (json !== undefined) {
            finalHeaders['Content-Type'] = 'application/json';
            finalBody = JSON.stringify(json);
        }

        if (!('X-CSRFToken' in finalHeaders)) {
            finalHeaders['X-CSRFToken'] = getCsrfToken();
        }

        const response = await fetch(withAppRoot(path), {
            method,
            credentials,
            keepalive: !!keepalive,
            headers: finalHeaders,
            body: finalBody,
        });
        const payload = await readJsonPayload(response);
        return { response, payload };
    }

    async function requestSuccess(path, options, fallbackError) {
        const { response, payload } = await request(path, options);
        if (!response.ok || !payload || payload.success === false) {
            throw new Error(String(payload?.error || fallbackError));
        }
        return payload;
    }

    return {
        logout: () => request('/api/logout', { method: 'POST', json: {} }),
        getSettings: () => requestSuccess('/api/get_settings', {}, 'Не удалось загрузить настройки.'),
        saveSettings: (payload, requestOptions = {}) => requestSuccess('/api/save_settings', {
            method: 'POST',
            json: payload,
            keepalive: requestOptions.keepalive === true,
        }, 'Не удалось сохранить настройки.'),
        getWebPushPublicKey: () => requestSuccess('/api/web_push/public_key', {}, 'Не удалось загрузить настройки push.'),
        subscribeWebPush: (subscription) => requestSuccess('/api/web_push/subscribe', {
            method: 'POST',
            json: { subscription },
        }, 'Не удалось включить push-уведомления.'),
        unsubscribeWebPush: (endpoint) => requestSuccess('/api/web_push/unsubscribe', {
            method: 'POST',
            json: endpoint ? { endpoint } : {},
        }, 'Не удалось отключить push-уведомления.'),
        uploadAvatar: async (formData) => {
            const { response, payload } = await request('/upload_avatar', {
                method: 'POST',
                body: formData,
                headers: {},
            });
            if (!response.ok) {
                throw new Error(String(payload?.error || payload?.message || `HTTP ${response.status}`));
            }
            return payload || {};
        },
        getSessionDevices: () => requestSuccess('/api/session_devices', {}, 'Не удалось загрузить сессии.'),
        revokeSessionDevice: (familyId) => requestSuccess('/api/session_devices/revoke', {
            method: 'POST',
            json: { family_id: familyId },
        }, 'Не удалось завершить сессию.'),
        revokeOtherSessionDevices: () => requestSuccess('/api/session_devices/revoke_others', {
            method: 'POST',
            json: {},
        }, 'Не удалось завершить другие сессии.'),
        getTotpStatus: () => requestSuccess('/api/totp_status', {}, 'Не удалось загрузить состояние TOTP.'),
        manageTotp: (action) => requestSuccess('/api/totp_manage', {
            method: 'POST',
            json: { action },
        }, 'Не удалось обновить TOTP.'),
        verifyTotpSetup: (totpCode) => requestSuccess('/api/totp_setup/verify', {
            method: 'POST',
            json: { totp_code: totpCode },
        }, 'Не удалось подтвердить TOTP-код.'),
        regenerateBackupCodes: (totpCode) => requestSuccess('/api/totp_backup_codes/regenerate', {
            method: 'POST',
            json: { totp_code: totpCode },
        }, 'Не удалось обновить резервные коды.'),
        getChallenge: (username) => requestSuccess('/api/get_challenge', {
            method: 'POST',
            json: { username },
        }, 'Сейф не найден.'),
        deleteAccount: () => requestSuccess('/api/delete_account', {
            method: 'POST',
            headers: {},
        }, 'Не удалось удалить аккаунт.'),
    };
}
