document.addEventListener('DOMContentLoaded', async function () {
    const bootstrapData = window.SUN_BOOTSTRAP || {};
    const bootstrapUser = bootstrapData.user || {};
    const withAppRoot = (path) => {
        const raw = String(path || '').trim();
        if (!raw) return '/';
        if (/^[a-z][a-z0-9+\-.]*:/i.test(raw) || raw.startsWith('//') || raw.startsWith('#')) {
            return raw;
        }
        const rootRaw = String(bootstrapData?.app?.root || window.SUN_APP_ROOT || '').trim();
        const root = !rootRaw || rootRaw === '/'
            ? ''
            : (rootRaw.startsWith('/') ? rootRaw : `/${rootRaw}`).replace(/\/+$/, '');
        if (!root) {
            return raw.startsWith('/') ? raw : `/${raw.replace(/^\/+/, '')}`;
        }
        if (raw.startsWith('/')) {
            if (raw === root || raw.startsWith(`${root}/`) || raw.startsWith(`${root}?`) || raw.startsWith(`${root}#`)) {
                return raw;
            }
            return `${root}${raw}`;
        }
        return `${root}/${raw.replace(/^\/+/, '')}`;
    };
    const getCsrfToken = () => document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';

    function consumeInitialSettingsSection() {
        try {
            const url = new URL(window.location.href);
            const section = String(url.searchParams.get('settings') || '').trim();
            if (!section) return '';
            url.searchParams.delete('settings');
            window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
            return section;
        } catch (_) {
            return '';
        }
    }

    const initialSettingsSection = consumeInitialSettingsSection();

    async function persistClientPreferences(clientPreferences, options = {}) {
        const keepalive = options && options.keepalive === true;
        const response = await fetch(withAppRoot('/api/save_settings'), {
            method: 'POST',
            credentials: 'include',
            keepalive,
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken(),
            },
            body: JSON.stringify({
                client_preferences: clientPreferences || {},
            }),
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        if (keepalive) {
            return;
        }
        const payload = await response.json().catch(() => ({}));
        if (!payload || payload.success === false) {
            throw new Error(String(payload?.error || 'Failed to persist client preferences'));
        }
    }

    const currentUserState = {
        displayName: String(bootstrapUser.currentDisplayName || window.currentDisplayName || '').trim(),
        username: String(bootstrapUser.currentUsername || window.currentUsername || '').trim(),
        userId: String(bootstrapUser.currentUserId || window.currentUserId || '').trim(),
        publicKey: String(bootstrapUser.currentUserPublicKey || window.currentUserPublicKey || '').trim(),
        avatarUrl: String(bootstrapUser.currentAvatarUrl || window.currentAvatarUrl || '').trim(),
    };

    function syncUserStateToLegacyGlobals() {
        bootstrapUser.currentDisplayName = currentUserState.displayName;
        bootstrapUser.currentUsername = currentUserState.username;
        bootstrapUser.currentUserId = currentUserState.userId;
        bootstrapUser.currentUserPublicKey = currentUserState.publicKey;
        bootstrapUser.currentAvatarUrl = currentUserState.avatarUrl;
        window.currentDisplayName = currentUserState.displayName;
        window.currentUsername = currentUserState.username;
        window.currentUserId = currentUserState.userId;
        window.currentUserPublicKey = currentUserState.publicKey;
        window.currentAvatarUrl = currentUserState.avatarUrl;
    }

    function markFirstRunCompleted() {
        try { localStorage.setItem('sun_first_run_completed', '1'); } catch (_) {}
    }

    const i18nApi = window.SUN_I18N || null;
    const tr = (value) => {
        if (i18nApi && typeof i18nApi.translateText === 'function') {
            return i18nApi.translateText(String(value ?? ''));
        }
        return String(value ?? '');
    };

    syncUserStateToLegacyGlobals();

    const logoutLinks = document.querySelectorAll(
        `[data-logout-trigger], a[href="${withAppRoot('/logout')}"]`,
    );
    if (logoutLinks.length) {
        logoutLinks.forEach((trigger) => {
            trigger.addEventListener('click', async (event) => {
                event.preventDefault();
                const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
                const headers = { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken };
                let logoutRequestFailed = false;
                try {
                    await fetch(withAppRoot('/api/logout'), {
                        method: 'POST',
                        credentials: 'include',
                        headers,
                        body: JSON.stringify({}),
                    });
                } catch (_err) {
                    logoutRequestFailed = true;
                }
                if (window.sunPrivateKeySession && typeof window.sunPrivateKeySession.clearPrivateKeyPem === 'function') {
                    await window.sunPrivateKeySession.clearPrivateKeyPem({
                        notify: true,
                        clearWrappedSession: false,
                        clearWrappedPersistent: false,
                        clearDeviceKey: false,
                    });
                } else {
                    sessionStorage.removeItem('e2e_private_key');
                    localStorage.removeItem('e2e_private_key');
                    if (window.deviceKey) {
                        try { await window.deviceKey.clear(); } catch (_) {}
                    }
                }
                if (typeof window.clearChatHistoryCacheOnLogout === 'function') {
                    try {
                        await window.clearChatHistoryCacheOnLogout();
                    } catch (_) {}
                } else {
                    try {
                        const chatIdb = await import(withAppRoot('/static/modules/chat-idb.js'));
                        const fallbackUserId = String(
                            bootstrapUser.currentUserId
                            || document.body?.dataset?.currentUserId
                            || localStorage.getItem('last_user_id')
                            || '',
                        ).trim();
                        await chatIdb.clearAllCache();
                        if (fallbackUserId) {
                            await chatIdb.deleteChatDb(fallbackUserId);
                        }
                        localStorage.removeItem('last_user_id');
                    } catch (_) {}
                }
                if (logoutRequestFailed) {
                    const logoutForm = trigger.closest('form');
                    if (logoutForm && typeof logoutForm.submit === 'function') {
                        logoutForm.submit();
                        return;
                    }
                }
                window.location.href = withAppRoot('/');
            });
        });
    }

    const dn = currentUserState.displayName || 'SUN Messenger';
    const un = currentUserState.username;
    const sidebarDisplayName = document.getElementById('sidebarDisplayName');
    const sidebarUsername = document.getElementById('sidebarUsername');
    const avatarCircle = document.getElementById('avatarCircle');

    if (sidebarDisplayName) sidebarDisplayName.textContent = dn;
    if (sidebarUsername) sidebarUsername.textContent = un ? `@${un}` : '';

    const initials = dn.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
    if (avatarCircle && !avatarCircle.querySelector('img')) {
        avatarCircle.textContent = initials;
    }

    function buildInitials(value) {
        return String(value || '?')
            .trim()
            .split(/\s+/)
            .slice(0, 2)
            .map((word) => word[0] || '')
            .join('')
            .toUpperCase() || '?';
    }

    function buildCacheBustedAvatarUrl(avatarUrl) {
        const clean = String(avatarUrl || '').trim();
        if (!clean) return '';
        const sep = clean.includes('?') ? '&' : '?';
        return `${clean}${sep}t=${Date.now()}`;
    }

    function applyOwnAvatarUpdate({ avatarUrl, displayName, username } = {}) {
        const nextDisplayName = String(displayName || currentUserState.displayName || '').trim();
        const nextUsername = String(username || currentUserState.username || '').trim();
        const nextAvatarUrl = String(avatarUrl || '').trim();
        const avatarSrc = buildCacheBustedAvatarUrl(nextAvatarUrl);

        currentUserState.displayName = nextDisplayName || currentUserState.displayName || '';
        currentUserState.username = nextUsername || currentUserState.username || '';
        currentUserState.avatarUrl = nextAvatarUrl || '';
        syncUserStateToLegacyGlobals();

        if (sidebarDisplayName && nextDisplayName) {
            sidebarDisplayName.textContent = nextDisplayName;
        }
        if (sidebarUsername) {
            const usernameLabel = nextUsername || currentUserState.username || '';
            sidebarUsername.textContent = usernameLabel ? `@${usernameLabel}` : '';
        }

        if (avatarCircle) {
            if (avatarSrc) {
                avatarCircle.replaceChildren();
                const avatarImg = document.createElement('img');
                avatarImg.src = avatarSrc;
                avatarImg.alt = tr('Ваш аватар');
                avatarImg.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;';
                avatarCircle.appendChild(avatarImg);
            } else {
                avatarCircle.textContent = buildInitials(nextDisplayName || nextUsername || '?');
            }
        }
    }

    function readAppliedDarkMode() {
        try {
            const storedDark = localStorage.getItem('darkMode');
            if (storedDark === 'true') return true;
            if (storedDark === 'false') return false;
        } catch (_) {
            // Fall back to the class applied by early boot.
        }
        return Boolean(
            document.documentElement?.classList?.contains('dark-mode')
            || document.body?.classList?.contains('dark-mode'),
        );
    }

    let themeSyncApi = {
        isDark: readAppliedDarkMode,
        applyDark: () => {},
        applyEmbeddedThemeUpdates: () => Promise.resolve(),
        applyEmbeddedLanguageUpdates: () => {},
    };
    let settingsOverlayApi = {
        openCommandPalette: () => {},
        openSettingsOverlay: () => {},
        notifySettingsPrivateKeyStatus: () => {},
    };
    let qrApi = {
        openMyQrModal: () => Promise.resolve(),
        openDeviceQrHub: () => {},
        hasRuntimePrivateKey: () => false,
    };
    let weatherLabelApi = {
        refresh: () => {},
        updatePreferences: () => {},
    };

    try {
        const [
            sidebarModule,
            settingsOverlayModule,
            qrModule,
            themeSyncModule,
            weatherLabelModule,
        ] = await Promise.all([
            import(withAppRoot('/static/pages/chat-shell/sidebar.js')),
            import(withAppRoot('/static/pages/chat-shell/settings-overlay.js')),
            import(withAppRoot('/static/pages/chat-shell/qr.js')),
            import(withAppRoot('/static/pages/chat-shell/theme-sync.js')),
            import(withAppRoot('/static/pages/chat-shell/sidebar-weather-label.js')),
        ]);

        themeSyncApi = themeSyncModule.initChatShellThemeSync({
            interfaceThemeApi: window.InterfaceTheme || null,
            chatAppearanceApi: window.ChatAppearance || null,
            i18nApi: window.SUN_I18N || null,
            persistClientPreferences,
        });

        settingsOverlayApi = settingsOverlayModule.initChatShellSettingsOverlay({
            withAppRoot,
            markFirstRunCompleted,
            onThemeUpdated: () => themeSyncApi.applyEmbeddedThemeUpdates(),
            onLanguageUpdated: (language, options) => themeSyncApi.applyEmbeddedLanguageUpdates(language, options),
            onAvatarUpdated: (detail) => applyOwnAvatarUpdate(detail),
            onRedecrypt: () => {
                if (typeof window._redecryptCurrentChat === 'function') {
                    window._redecryptCurrentChat();
                }
                if (typeof window.syncSidebarStatusBar === 'function') {
                    window.syncSidebarStatusBar();
                }
            },
            onWeatherLabelUpdated: (detail) => {
                weatherLabelApi.updatePreferences(detail);
            },
            isPrivateKeyUnlocked: () => qrApi.hasRuntimePrivateKey(),
        });

        qrApi = qrModule.initChatShellQr({
            withAppRoot,
            currentUserState,
            markFirstRunCompleted,
            openAnimatedDialog: settingsOverlayApi.openAnimatedDialog,
            closeAnimatedDialog: settingsOverlayApi.closeAnimatedDialog,
            attachAnimatedDialog: settingsOverlayApi.attachAnimatedDialog,
        });

        weatherLabelApi = weatherLabelModule.initSidebarWeatherLabel({
            labelEl: document.querySelector('.sidebar-brand-name'),
            baseLabel: 'sun',
            clientPreferences: bootstrapUser.clientPreferences || {},
            language: () => (
                window.SUN_I18N?.getLanguage?.()
                || String(document.documentElement.lang || 'ru').toLowerCase()
            ),
        }) || weatherLabelApi;

        sidebarModule.initChatShellSidebar();
    } catch (error) {
        console.error('Failed to initialize chat shell modules', error);
    }

    if (initialSettingsSection) {
        settingsOverlayApi.openSettingsOverlay(initialSettingsSection);
    }

    const emptyStatePrimaryBtn = document.getElementById('emptyStatePrimaryBtn');
    const emptyStateSecondaryBtn = document.getElementById('emptyStateSecondaryBtn');
    const emptyStatePrimaryLabel = document.getElementById('emptyStatePrimaryLabel');
    const emptyStateStatus = document.getElementById('emptyStateStatus');
    const emptyStateEyebrow = document.getElementById('emptyStateEyebrow');
    const emptyStateHeadline = document.getElementById('emptyStateHeadline');
    const emptyStateDesc = document.getElementById('emptyStateDesc');
    const chatPlaceholder = document.getElementById('chatPlaceholder');

    emptyStatePrimaryBtn?.addEventListener('click', function () {
        const mode = this.getAttribute('data-empty-action') || 'palette';
        if (mode === 'settings') {
            settingsOverlayApi.openSettingsOverlay('keys');
            return;
        }
        settingsOverlayApi.openCommandPalette('');
    });
    emptyStateSecondaryBtn?.addEventListener('click', function () {
        qrApi.openMyQrModal();
    });

    function syncEmptyStateUi() {
        const placeholderVisible = !chatPlaceholder || chatPlaceholder.style.display !== 'none';
        const hasContacts = Boolean(document.querySelector('#contactsList .contact-item'));
        const hasPrivateKey = qrApi.hasRuntimePrivateKey();
        const offline = navigator.onLine === false;

        if (emptyStateStatus) {
            emptyStateStatus.style.display = offline ? '' : 'none';
            emptyStateStatus.textContent = offline ? tr('\u041D\u0435\u0442 \u0441\u0435\u0442\u0438') : '';
        }
        if (!placeholderVisible) return;

        if (offline) {
            if (emptyStateEyebrow) emptyStateEyebrow.textContent = tr('\u2318 \u041D\u0435\u0442 \u0441\u0435\u0442\u0438');
            if (emptyStateHeadline) emptyStateHeadline.innerHTML = tr('\u0421\u043E\u0435\u0434\u0438\u043D\u0435\u043D\u0438\u0435 \u043F\u043E\u0442\u0435\u0440\u044F\u043D\u043E.<br><em>\u0427\u0430\u0442 \u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0438\u0442\u0441\u044F \u043F\u043E\u0441\u043B\u0435 \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u044F \u0441\u0435\u0442\u0438.</em>');
            if (emptyStateDesc) emptyStateDesc.textContent = tr('\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F \u0432\u0440\u0435\u043C\u0435\u043D\u043D\u043E \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B, \u043F\u043E\u043A\u0430 \u0441\u0435\u0442\u044C \u043D\u0435 \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u0441\u044F.');
            if (emptyStatePrimaryLabel) {
                emptyStatePrimaryLabel.textContent = hasContacts
                    ? tr('\u041D\u043E\u0432\u044B\u0439 \u0440\u0430\u0437\u0433\u043E\u0432\u043E\u0440')
                    : tr('\u041D\u0430\u0439\u0442\u0438 \u043A\u043E\u043D\u0442\u0430\u043A\u0442');
            }
            if (emptyStatePrimaryBtn) emptyStatePrimaryBtn.disabled = true;
            if (emptyStateSecondaryBtn) emptyStateSecondaryBtn.disabled = true;
            return;
        }

        if (emptyStatePrimaryBtn) emptyStatePrimaryBtn.disabled = false;
        if (emptyStateSecondaryBtn) emptyStateSecondaryBtn.disabled = false;

        if (hasContacts && !hasPrivateKey) {
            if (emptyStateEyebrow) emptyStateEyebrow.textContent = tr('\u2318 \u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0437\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D\u0430');
            if (emptyStateHeadline) emptyStateHeadline.innerHTML = tr('\u0412\u0430\u0448\u0438 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F \u0436\u0434\u0443\u0442 \u043A\u043B\u044E\u0447.<br><em>\u0410\u043A\u0442\u0438\u0432\u0438\u0440\u0443\u0439\u0442\u0435 \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u043E 24 \u0441\u043B\u043E\u0432\u0430\u043C\u0438.</em>');
            if (emptyStateDesc) emptyStateDesc.textContent = tr('\u0412\u044B \u0432\u043E\u0448\u043B\u0438 \u0447\u0435\u0440\u0435\u0437 Authenticator. \u0412\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u0435 \u043F\u0440\u0438\u0432\u0430\u0442\u043D\u044B\u0439 \u043A\u043B\u044E\u0447, \u0447\u0442\u043E\u0431\u044B \u0447\u0438\u0442\u0430\u0442\u044C \u0438\u0441\u0442\u043E\u0440\u0438\u044E \u043D\u0430 \u044D\u0442\u043E\u043C \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u0435.');
            if (emptyStatePrimaryLabel) emptyStatePrimaryLabel.textContent = tr('\u0410\u043A\u0442\u0438\u0432\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0438\u0441\u0442\u043E\u0440\u0438\u044E');
            if (emptyStatePrimaryBtn) emptyStatePrimaryBtn.setAttribute('data-empty-action', 'settings');
            if (emptyStateSecondaryBtn) emptyStateSecondaryBtn.style.display = 'none';
            return;
        }

        if (hasContacts) {
            if (emptyStateEyebrow) emptyStateEyebrow.textContent = tr('\u2318 \u0414\u043E\u0431\u0440\u043E \u043F\u043E\u0436\u0430\u043B\u043E\u0432\u0430\u0442\u044C \u043D\u0430\u0437\u0430\u0434');
            if (emptyStateHeadline) emptyStateHeadline.innerHTML = tr('\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0440\u0430\u0437\u0433\u043E\u0432\u043E\u0440,<br><em>\u0438\u043B\u0438 \u043D\u0430\u0447\u043D\u0438\u0442\u0435 \u043D\u043E\u0432\u044B\u0439.</em>');
            if (emptyStateDesc) emptyStateDesc.textContent = tr('\u0412\u0430\u0448 \u0441\u043F\u0438\u0441\u043E\u043A \u0447\u0430\u0442\u043E\u0432 \u0443\u0436\u0435 \u0437\u0434\u0435\u0441\u044C. \u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u0431\u0435\u0441\u0435\u0434\u0443 \u0441\u043B\u0435\u0432\u0430 \u0438\u043B\u0438 \u043D\u0430\u0439\u0434\u0438\u0442\u0435 \u043D\u043E\u0432\u043E\u0433\u043E \u0441\u043E\u0431\u0435\u0441\u0435\u0434\u043D\u0438\u043A\u0430 \u0447\u0435\u0440\u0435\u0437 \u043F\u0430\u043B\u0438\u0442\u0440\u0443.');
            if (emptyStatePrimaryLabel) emptyStatePrimaryLabel.textContent = tr('\u041D\u043E\u0432\u044B\u0439 \u0440\u0430\u0437\u0433\u043E\u0432\u043E\u0440');
            if (emptyStatePrimaryBtn) emptyStatePrimaryBtn.setAttribute('data-empty-action', 'palette');
            if (emptyStateSecondaryBtn) emptyStateSecondaryBtn.style.display = 'none';
            return;
        }

        if (emptyStateEyebrow) emptyStateEyebrow.textContent = tr('\u2318 \u0414\u043E\u0431\u0440\u043E \u043F\u043E\u0436\u0430\u043B\u043E\u0432\u0430\u0442\u044C \u0432 sun');
        if (emptyStateHeadline) emptyStateHeadline.innerHTML = tr('\u0422\u0438\u0445\u043E\u0435 \u043C\u0435\u0441\u0442\u043E<br><em>\u0434\u043B\u044F \u0442\u0435\u0445, \u043A\u043E\u043C\u0443 \u0434\u043E\u0432\u0435\u0440\u044F\u0435\u0448\u044C.</em>');
        if (emptyStateDesc) emptyStateDesc.textContent = tr('\u041A\u0430\u0436\u0434\u043E\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435 \u0437\u0430\u0448\u0438\u0444\u0440\u043E\u0432\u0430\u043D\u043E end-to-end. \u0422\u043E\u043B\u044C\u043A\u043E \u0432\u044B \u0438 \u0432\u0430\u0448 \u0441\u043E\u0431\u0435\u0441\u0435\u0434\u043D\u0438\u043A \u043C\u043E\u0436\u0435\u0442\u0435 \u0447\u0438\u0442\u0430\u0442\u044C \u043F\u0435\u0440\u0435\u043F\u0438\u0441\u043A\u0443.');
        if (emptyStatePrimaryLabel) emptyStatePrimaryLabel.textContent = tr('\u041D\u0430\u0439\u0442\u0438 \u043A\u043E\u043D\u0442\u0430\u043A\u0442');
        if (emptyStatePrimaryBtn) emptyStatePrimaryBtn.setAttribute('data-empty-action', 'palette');
        if (emptyStateSecondaryBtn) emptyStateSecondaryBtn.style.display = '';
    }
    if (window.MutationObserver) {
        const placeholderObserverTarget = document.getElementById('chatPlaceholder');
        if (placeholderObserverTarget) {
            new MutationObserver(syncEmptyStateUi).observe(placeholderObserverTarget, { attributes: true, attributeFilter: ['style'] });
        }
        const contactsListEl = document.getElementById('contactsList');
        if (contactsListEl) {
            new MutationObserver(syncEmptyStateUi).observe(contactsListEl, { childList: true });
        }
    }

    window.addEventListener('online', syncEmptyStateUi);
    window.addEventListener('offline', syncEmptyStateUi);
    window.addEventListener('focus', syncEmptyStateUi);
    const flushClientPreferencesOnBackground = () => {
        if (themeSyncApi && typeof themeSyncApi.flushClientPreferencesPersist === 'function') {
            void themeSyncApi.flushClientPreferencesPersist({ keepalive: true });
        }
    };
    window.addEventListener('pagehide', flushClientPreferencesOnBackground);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            flushClientPreferencesOnBackground();
        }
    });
    window.addEventListener('storage', function (event) {
        const key = String(event.key || '');
        if (key === 'darkMode' || key === 'sun.interfaceTheme.v1' || key === 'sun.chatAppearance.v2') {
            themeSyncApi.applyEmbeddedThemeUpdates().catch(() => {});
        }
    });
    window.addEventListener('sun-private-key-status-changed', () => {
        syncEmptyStateUi();
        settingsOverlayApi.notifySettingsPrivateKeyStatus();
    });
    window.addEventListener('sun-ui-language-changed', () => {
        themeSyncApi.applyDark(themeSyncApi.isDark());
        weatherLabelApi.refresh();
        syncEmptyStateUi();
    });

    syncEmptyStateUi();
});
