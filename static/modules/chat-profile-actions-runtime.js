export function bindChatProfileActionsRuntime({
    documentRef = document,
    profileGroupTabs = null,
    profileGroupEditBtn = null,
    profileActionButtons = [],
    profileDeleteChatMenuBtn = null,
    profileInfoRows = [],
    closeProfileBtn = null,
    profileBackdropCloseBtn = null,
    blockPartnerBtn = null,
    profileMoreBtn = null,
    profileMoreMenu = null,
    addTapFeedback = () => {},
    setGroupProfileTab = () => {},
    openGroupEditModal = () => {},
    handleProfileAction = () => {},
    showToast = () => {},
    toggleProfileMoreMenu = () => {},
    closeProfileMoreMenu = () => {},
    closePartnerProfileDrawer = () => {},
    isProfileDrawerOpen = () => false,
} = {}) {
    profileGroupTabs?.addEventListener('click', (event) => {
        const tabBtn = event.target.closest('[data-group-tab]');
        if (!tabBtn) return;
        setGroupProfileTab(tabBtn.getAttribute('data-group-tab') || 'members');
    });

    profileGroupEditBtn?.addEventListener('click', () => {
        openGroupEditModal();
    });

    profileActionButtons.forEach((btn) => {
        addTapFeedback(btn);
        btn.addEventListener('click', () => {
            handleProfileAction(btn.getAttribute('data-profile-action') || '');
        });
        if (btn.getAttribute('tabindex') !== null) {
            btn.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                handleProfileAction(btn.getAttribute('data-profile-action') || '');
            });
        }
    });

    profileDeleteChatMenuBtn?.addEventListener('click', () => {
        void handleProfileAction('delete-chat');
    });

    profileInfoRows.forEach((row) => {
        addTapFeedback(row);
        row.addEventListener('click', () => {
            const mediaType = row.getAttribute('data-media-type') || '';
            const map = {
                photos: '\u0424\u043E\u0442\u043E',
                files: '\u0424\u0430\u0439\u043B\u044B',
                links: '\u0421\u0441\u044B\u043B\u043A\u0438',
            };
            const sectionName = map[mediaType] || '\u041A\u043E\u043D\u0442\u0435\u043D\u0442';
            showToast(
                `\u0420\u0430\u0437\u0434\u0435\u043B "${sectionName}" \u0431\u0443\u0434\u0435\u0442 \u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D \u0432 \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u043C \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0438.`,
                'info',
            );
        });
    });

    addTapFeedback(closeProfileBtn);
    addTapFeedback(blockPartnerBtn);
    addTapFeedback(profileMoreBtn);

    if (profileMoreBtn) {
        profileMoreBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleProfileMoreMenu();
        });
    }

    if (closeProfileBtn) {
        closeProfileBtn.addEventListener('click', closePartnerProfileDrawer);
    }
    if (profileBackdropCloseBtn) {
        profileBackdropCloseBtn.addEventListener('click', closePartnerProfileDrawer);
    }
    documentRef.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && profileMoreMenu?.classList.contains('active')) {
            closeProfileMoreMenu();
            return;
        }
        if (e.key === 'Escape' && isProfileDrawerOpen()) {
            closePartnerProfileDrawer();
        }
    });
}
