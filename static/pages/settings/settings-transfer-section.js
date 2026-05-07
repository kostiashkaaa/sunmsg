const MESSAGE_SCALE_STORAGE_KEY = 'sun_chat_message_scale_v1';

function downloadTextFile(filename, text) {
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}

function normalizeLanguage(value) {
    return String(value || '').toLowerCase() === 'en' ? 'en' : 'ru';
}

export function initSettingsTransferSection({
    tr,
    showAlert,
    api,
    privacySection,
    notifyLanguageUpdate,
}) {
    const exportBtn = document.getElementById('settingsExportBtn');
    const importInput = document.getElementById('settingsImportInput');

    if (!exportBtn || !importInput || !privacySection) {
        return {
            exportSettings: () => {},
            importSettings: async () => {},
        };
    }

    function collectLocalAppearance() {
        const interfaceThemeStore = window.InterfaceTheme?.readStore?.() || null;
        const chatAppearanceStore = window.ChatAppearance?.readStore?.() || null;
        const darkMode = localStorage.getItem('darkMode') === 'true';
        const messageScale = Number.parseFloat(localStorage.getItem(MESSAGE_SCALE_STORAGE_KEY) || '1') || 1;
        return {
            interfaceThemeStore,
            chatAppearanceStore,
            darkMode,
            messageScale,
        };
    }

    function applyLocalAppearance(payload) {
        const localAppearance = payload?.localAppearance || {};
        if (localAppearance.interfaceThemeStore && window.InterfaceTheme?.writeStore) {
            window.InterfaceTheme.writeStore(localAppearance.interfaceThemeStore);
        }
        if (localAppearance.chatAppearanceStore && window.ChatAppearance?.writeStore) {
            window.ChatAppearance.writeStore(localAppearance.chatAppearanceStore);
        }
        if (typeof localAppearance.darkMode === 'boolean') {
            localStorage.setItem('darkMode', localAppearance.darkMode ? 'true' : 'false');
            document.documentElement.classList.toggle('dark-mode', localAppearance.darkMode);
            document.body.classList.toggle('dark-mode', localAppearance.darkMode);
        }
        if (Number.isFinite(localAppearance.messageScale)) {
            const normalized = Math.min(1.3, Math.max(0.9, Number(localAppearance.messageScale)));
            localStorage.setItem(MESSAGE_SCALE_STORAGE_KEY, normalized.toFixed(2));
        }
        window.InterfaceTheme?.applyCurrentTheme?.();
        window.ChatAppearance?.applyCurrentTheme?.();
    }

    async function exportSettings() {
        try {
            const payload = {
                exportedAt: new Date().toISOString(),
                version: 1,
                serverSettings: privacySection.getCommonPayload(),
                localAppearance: collectLocalAppearance(),
            };
            const datePart = new Date().toISOString().slice(0, 10);
            downloadTextFile(`sun-settings-${datePart}.json`, JSON.stringify(payload, null, 2));
            showAlert('Настройки экспортированы.', 'success');
        } catch (err) {
            showAlert(String(err?.message || 'Не удалось экспортировать настройки.'), 'danger');
        }
    }

    async function importSettings(file) {
        if (!file) return;

        try {
            const text = await file.text();
            const parsed = JSON.parse(text);

            const server = parsed?.serverSettings;
            if (!server || typeof server !== 'object') {
                throw new Error('Некорректный файл настроек: отсутствует serverSettings.');
            }

            const serverPayload = {
                username: String(server.username || '').trim(),
                display_name: String(server.display_name || '').trim(),
                language: normalizeLanguage(server.language),
                bio: String(server.bio || '').slice(0, 280),
                is_public: !!server.is_public,
                auto_decline_requests: !!server.auto_decline_requests,
                mute_dialog_requests: !!server.mute_dialog_requests,
                hide_online_status: !!server.hide_online_status,
                avatar_visibility: ['all', 'contacts', 'nobody'].includes(String(server.avatar_visibility || '').toLowerCase())
                    ? String(server.avatar_visibility).toLowerCase()
                    : 'all',
            };

            await api.saveSettings(serverPayload);
            privacySection.applySettingsFromPayload(serverPayload);
            notifyLanguageUpdate(serverPayload.language, true);

            applyLocalAppearance(parsed);

            showAlert('Настройки импортированы. Перезагружаем интерфейс...', 'success');
            window.setTimeout(() => {
                window.location.reload();
            }, 320);
        } catch (err) {
            showAlert(String(err?.message || 'Не удалось импортировать настройки.'), 'danger');
        } finally {
            importInput.value = '';
        }
    }

    exportBtn.addEventListener('click', exportSettings);
    importInput.addEventListener('change', () => {
        importSettings(importInput.files?.[0] || null);
    });

    return {
        exportSettings,
        importSettings,
    };
}
