export function createChatMuteUiController({
    contactsList = null,
    muteChatBtn = null,
    resolveContactItemByChatId = () => null,
    isChatMuted = () => false,
    getMutedChatIds = () => [],
    setMutedChatIds = () => {},
    getCurrentChatId = () => '',
    syncProfileMoreMenuChatActions = () => {},
    showToast = () => {},
    doc = document,
} = {}) {
    function applyContactMuteState(contactItem, muted) {
        if (!contactItem) return;
        contactItem.setAttribute('data-muted', muted ? '1' : '0');
        const nameMain = contactItem.querySelector('.contact-name-main');
        const nameEl = nameMain?.querySelector('.contact-name');
        const pinIcon = nameMain?.querySelector('.pin-icon');
        let muteIcon = contactItem.querySelector('.mute-icon');
        if (muted) {
            if (!muteIcon) {
                muteIcon = doc.createElement('i');
                muteIcon.className = 'bi bi-bell-slash-fill mute-icon';
                if (pinIcon) {
                    pinIcon.insertAdjacentElement('beforebegin', muteIcon);
                } else if (nameEl) {
                    nameEl.insertAdjacentElement('afterend', muteIcon);
                } else if (nameMain) {
                    nameMain.appendChild(muteIcon);
                }
            }
        } else {
            muteIcon?.remove();
        }

        const timeMetaEl = contactItem.querySelector('.contact-time-meta');
        const unreadBadge = contactItem.querySelector('.unread-badge');
        const hasUnread = Boolean(unreadBadge && unreadBadge.style.display !== 'none' && unreadBadge.textContent.trim() !== '');
        if (timeMetaEl) {
            if (muted) {
                timeMetaEl.style.color = 'var(--text-muted)';
            } else if (hasUnread) {
                timeMetaEl.style.color = 'var(--accent)';
            } else {
                timeMetaEl.style.removeProperty('color');
            }
        }
        if (unreadBadge) {
            unreadBadge.classList.toggle('unread-badge--muted', Boolean(muted && hasUnread));
        }
    }

    function syncContactMuteState(chatId) {
        const item = resolveContactItemByChatId(chatId);
        if (!item) return;
        applyContactMuteState(item, isChatMuted(chatId));
    }

    function syncAllContactsMuteState() {
        const items = Array.from(contactsList?.querySelectorAll('.contact-item[data-chat-id]') || []);
        items.forEach((item) => {
            applyContactMuteState(item, isChatMuted(item.getAttribute('data-chat-id')));
        });
    }

    function syncMuteButton() {
        const currentChatId = getCurrentChatId();
        const muted = isChatMuted(currentChatId);
        if (muteChatBtn) {
            const icon = muteChatBtn.querySelector('i');
            if (icon) {
                icon.className = muted ? 'bi bi-bell-slash' : 'bi bi-bell';
            }
            const label = doc.getElementById('muteChatBtnLabel');
            if (label) label.textContent = muted ? 'Включить уведомления' : 'Отключить уведомления';
            muteChatBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
            muteChatBtn.title = muted ? 'Включить уведомления' : 'Отключить уведомления';
        }
        const profileMuteRow = doc.getElementById('profileMuteRow');
        if (profileMuteRow) {
            const pIcon = doc.getElementById('profileMuteIcon');
            if (pIcon) pIcon.className = muted ? 'bi bi-bell-slash' : 'bi bi-bell';
            const pLabel = doc.getElementById('profileMuteLabel');
            if (pLabel) pLabel.textContent = 'Уведомления';
            profileMuteRow.setAttribute('aria-pressed', muted ? 'false' : 'true');
        }
        const profileMuteToggle = doc.getElementById('profileMuteToggle');
        if (profileMuteToggle) {
            profileMuteToggle.setAttribute('aria-pressed', muted ? 'false' : 'true');
        }
        syncProfileMoreMenuChatActions();
    }

    function toggleChatMuted(chatId, { showFeedback = true } = {}) {
        const normalizedChatId = String(chatId || '').trim();
        if (!normalizedChatId) return false;
        const next = getMutedChatIds();
        const index = next.indexOf(normalizedChatId);
        let muted = false;
        if (index >= 0) {
            next.splice(index, 1);
            muted = false;
            if (showFeedback) {
                showToast('Уведомления для чата включены', 'success');
            }
        } else {
            next.push(normalizedChatId);
            muted = true;
            if (showFeedback) {
                showToast('Чат приглушён', 'success');
            }
        }
        setMutedChatIds(next);
        syncContactMuteState(normalizedChatId);
        if (String(getCurrentChatId() || '') === normalizedChatId) {
            syncMuteButton();
        } else {
            syncProfileMoreMenuChatActions();
        }
        return muted;
    }

    function toggleCurrentChatMuted(options = {}) {
        const currentChatId = getCurrentChatId();
        if (!currentChatId) return false;
        return toggleChatMuted(currentChatId, options);
    }

    return {
        applyContactMuteState,
        syncContactMuteState,
        syncAllContactsMuteState,
        syncMuteButton,
        toggleChatMuted,
        toggleCurrentChatMuted,
    };
}
