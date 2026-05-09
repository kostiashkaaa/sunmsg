export function initSecuritySummarySection({ tr }) {
    const scoreEl = document.getElementById('settingsSecuritySummaryScore');
    const detailsEl = document.getElementById('settingsSecuritySummaryDetails');

    if (!scoreEl || !detailsEl) {
        return {
            refreshSecuritySummary: () => {},
        };
    }

    function isTotpEnabled() {
        const status = document.getElementById('totpStatusText');
        const text = String(status?.textContent || '').toLowerCase();
        return text.includes('\u0432\u043a\u043b\u044e\u0447') || text.includes('enabled') || text.includes('on');
    }

    function isPublicProfileEnabled() {
        return Boolean(document.getElementById('isPublicSwitch')?.checked);
    }

    function isOnlineHidden() {
        return Boolean(document.getElementById('hideOnlineStatusSwitch')?.checked);
    }

    function refreshSecuritySummary() {
        const totpEnabled = isTotpEnabled();
        const publicProfile = isPublicProfileEnabled();
        const hideOnline = isOnlineHidden();

        let score = 0;
        if (totpEnabled) score += 1;
        if (!publicProfile) score += 1;
        if (hideOnline) score += 1;

        const tier = score >= 3
            ? tr('Защита: высокая')
            : score >= 1
                ? tr('Защита: средняя')
                : tr('Защита: базовая');

        const parts = [
            `${tr('TOTP')}: ${totpEnabled ? tr('Вкл') : tr('Выкл')}`,
            `${tr('Публичный профиль')}: ${publicProfile ? tr('Вкл') : tr('Выкл')}`,
            `${tr('Скрыть онлайн статус')}: ${hideOnline ? tr('Вкл') : tr('Выкл')}`,
        ];

        scoreEl.textContent = tier;
        detailsEl.textContent = parts.join(' · ');
    }

    const observerTargets = [
        document.getElementById('totpStatusText'),
        document.getElementById('isPublicSwitch'),
        document.getElementById('hideOnlineStatusSwitch'),
    ].filter(Boolean);

    const mo = new MutationObserver(() => {
        refreshSecuritySummary();
    });

    observerTargets.forEach((target) => {
        if (target instanceof HTMLElement) {
            if (target.tagName === 'INPUT') {
                target.addEventListener('change', refreshSecuritySummary);
                target.addEventListener('input', refreshSecuritySummary);
            } else {
                mo.observe(target, { subtree: true, childList: true, characterData: true });
            }
        }
    });

    refreshSecuritySummary();

    return {
        refreshSecuritySummary,
    };
}
