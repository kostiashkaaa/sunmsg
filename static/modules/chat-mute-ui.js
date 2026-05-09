export function createChatMuteUiController({
    contactsList = null,
    muteChatBtn = null,
    resolveContactItemByChatId = () => null,
    isContactMuteRestricted = (contactItem) => String(contactItem?.getAttribute?.('data-saved-messages') || '') === '1',
    isChatMuted = () => false,
    getMutedChatIds = () => [],
    setMutedChatIds = () => {},
    getCurrentChatId = () => '',
    syncProfileMoreMenuChatActions = () => {},
    showToast = () => {},
    doc = document,
} = {}) {
    function resolveContactItem(chatId) {
        const normalizedChatId = String(chatId || '').trim();
        if (!normalizedChatId) return null;
        return resolveContactItemByChatId(normalizedChatId);
    }

    function isMuteRestricted(chatId, contactItem = null) {
        const normalizedChatId = String(chatId || '').trim();
        const item = contactItem || resolveContactItem(normalizedChatId);
        try {
            return Boolean(isContactMuteRestricted(item, normalizedChatId));
        } catch (_) {
            return false;
        }
    }

    function applyContactMuteState(contactItem, muted, options = {}) {
        if (!contactItem) return;
        const normalizedChatId = String(
            options?.chatId
            || contactItem.getAttribute('data-chat-id')
            || '',
        ).trim();
        const mutedAllowed = !isMuteRestricted(normalizedChatId, contactItem);
        const effectiveMuted = mutedAllowed ? Boolean(muted) : false;
        contactItem.setAttribute('data-muted', effectiveMuted ? '1' : '0');
        const nameMain = contactItem.querySelector('.contact-name-main');
        const nameEl = nameMain?.querySelector('.contact-name');
        const pinIcon = nameMain?.querySelector('.pin-icon');
        let muteIcon = contactItem.querySelector('.mute-icon');
        if (effectiveMuted) {
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
            if (effectiveMuted) {
                timeMetaEl.style.color = 'var(--text-muted)';
            } else if (hasUnread) {
                timeMetaEl.style.color = 'var(--accent)';
            } else {
                timeMetaEl.style.removeProperty('color');
            }
        }
        if (unreadBadge) {
            unreadBadge.classList.toggle('unread-badge--muted', Boolean(effectiveMuted && hasUnread));
        }
    }

    function syncContactMuteState(chatId) {
        const normalizedChatId = String(chatId || '').trim();
        const item = resolveContactItem(normalizedChatId);
        if (!item) return;
        applyContactMuteState(item, isChatMuted(normalizedChatId), { chatId: normalizedChatId });
    }

    function syncAllContactsMuteState() {
        const items = Array.from(contactsList?.querySelectorAll('.contact-item[data-chat-id]') || []);
        items.forEach((item) => {
            const chatId = String(item.getAttribute('data-chat-id') || '').trim();
            applyContactMuteState(item, isChatMuted(chatId), { chatId });
        });
    }

    function syncMuteButton() {
        const currentChatId = getCurrentChatId();
        const muted = isMuteRestricted(currentChatId, resolveContactItem(currentChatId))
            ? false
            : isChatMuted(currentChatId);
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
        const contactItem = resolveContactItem(normalizedChatId);
        const next = getMutedChatIds();
        if (isMuteRestricted(normalizedChatId, contactItem)) {
            const filtered = next.filter((id) => String(id || '').trim() !== normalizedChatId);
            if (filtered.length !== next.length) {
                setMutedChatIds(filtered);
            }
            if (contactItem) {
                applyContactMuteState(contactItem, false, { chatId: normalizedChatId });
            }
            if (String(getCurrentChatId() || '') === normalizedChatId) {
                syncMuteButton();
            } else {
                syncProfileMoreMenuChatActions();
            }
            return false;
        }
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
