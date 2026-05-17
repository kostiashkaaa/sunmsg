import { applyFallbackAvatarTint, buildAvatarInitials, escapeHtml } from './utils.js';

function applyRealtimeProfileEnterAnimation(element) {
    if (!element || !element.classList) return;
    element.classList.remove('sun-fade-enter');
    const run = () => {
        element.classList.add('sun-fade-enter');
        const clear = () => {
            element.classList.remove('sun-fade-enter');
            element.removeEventListener('animationend', clear);
        };
        element.addEventListener('animationend', clear);
        window.setTimeout(clear, 420);
    };
    if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(run);
        return;
    }
    run();
}

function renderAvatarContent(element, {
    avatarUrl = '',
    label = '',
    includeAlt = false,
} = {}) {
    if (!element) return;
    if (avatarUrl) {
        const cleanUrl = String(avatarUrl).trim();
        const sep = cleanUrl.includes('?') ? '&' : '?';
        const freshUrl = escapeHtml(`${cleanUrl}${sep}t=${Date.now()}`);
        const alt = includeAlt ? ` alt="${escapeHtml(label)}"` : '';
        element.removeAttribute('data-avatar-tint');
        element.innerHTML = `<img src="${freshUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"${alt}>`;
        return;
    }
    element.textContent = buildAvatarInitials(label);
    applyFallbackAvatarTint(element, label);
}

export function registerProfileRealtimeSocketHandlers({
    socket,
    escapeHtml,
    updateOnlineStatusUI,
    renderProfileHeader,
    getCurrentContactPublicKey,
    getCurrentPartnerData,
    setCurrentPartnerData,
    getPartnerProfileDrawer,
    chatTitleEl,
    resolveChatPartnerAvatar,
    rerenderCurrentChat,
    resolveContactItemByPublicKey,
    resolveSidebarAvatarCircle,
    resolveSidebarDisplayName,
    resolveSidebarUsername,
    setCurrentUserIdentity,
    isSavedContactItem = () => false,
    renderProfileBio = null,
    renderPartnerProfile = null,
    renderProfileSpotifyStatus = null,
} = {}) {
    socket.on('user_status', (data) => {
        const publicKey = String(data?.public_key || '');
        if (!publicKey) return;

        const contactItemForStatus = resolveContactItemByPublicKey(publicKey);
        const blockedStatus = contactItemForStatus
            && (
                contactItemForStatus.getAttribute('data-blocked-by-me') === '1'
                || contactItemForStatus.getAttribute('data-blocked-me') === '1'
            );
        if (blockedStatus) return;

        const isCurrentPartner = publicKey === getCurrentContactPublicKey();
        if (isCurrentPartner) {
            updateOnlineStatusUI(data.online, data.last_seen);
        }

        const dot = contactItemForStatus?.querySelector('.status-dot');
        if (dot) {
            dot.classList.toggle('online', Boolean(data.online));
        }
        if (contactItemForStatus) {
            contactItemForStatus.setAttribute('data-last-seen', String(data.last_seen || ''));
        }

        if (isCurrentPartner) {
            const currentPartnerData = getCurrentPartnerData();
            if (currentPartnerData && currentPartnerData.public_key === publicKey) {
                const nextPartnerData = {
                    ...currentPartnerData,
                    online: data.online,
                    last_seen: data.last_seen,
                };
                setCurrentPartnerData(nextPartnerData);

                const profileDrawer = getPartnerProfileDrawer();
                if (profileDrawer?.classList.contains('active')) {
                    renderProfileHeader(nextPartnerData);
                }
            }
        }
    });

    socket.on('profile_updated', (data) => {
        const publicKey = String(data?.public_key || '');
        if (!publicKey) return;

        const displayLabel = data.display_name || data.username || '?';
        const safeAvatarUrl = escapeHtml(data.avatar_url || '');
        const safeLabel = escapeHtml(displayLabel);
        const contactItem = resolveContactItemByPublicKey(publicKey);
        const savedMessagesContact = Boolean(isSavedContactItem(contactItem));
        if (contactItem && !savedMessagesContact) {
            const nameEl = contactItem.querySelector('.contact-name');
            if (nameEl) {
                nameEl.textContent = displayLabel;
                applyRealtimeProfileEnterAnimation(nameEl);
            }
            const contactAvatar = contactItem.querySelector('.contact-avatar');
            renderAvatarContent(contactAvatar, {
                avatarUrl: safeAvatarUrl,
                label: safeLabel,
            });
            applyRealtimeProfileEnterAnimation(contactAvatar);
        }

        if (publicKey !== getCurrentContactPublicKey()) return;
        if (savedMessagesContact) {
            rerenderCurrentChat();
            return;
        }

        if (chatTitleEl) {
            chatTitleEl.textContent = displayLabel;
            applyRealtimeProfileEnterAnimation(chatTitleEl);
        }
        const partnerAvatar = resolveChatPartnerAvatar();
        renderAvatarContent(partnerAvatar, {
            avatarUrl: safeAvatarUrl,
            label: safeLabel,
        });
        applyRealtimeProfileEnterAnimation(partnerAvatar);

        const currentPartnerData = getCurrentPartnerData();
        if (currentPartnerData) {
            const nextPartnerData = {
                ...currentPartnerData,
                display_name: data.display_name || currentPartnerData.display_name || '',
                username: data.username || currentPartnerData.username || '',
                avatar_url: data.avatar_url || '',
                bio: Object.prototype.hasOwnProperty.call(data || {}, 'bio')
                    ? String(data?.bio || '')
                    : String(currentPartnerData.bio || ''),
            };
            setCurrentPartnerData(nextPartnerData);
            if (typeof renderProfileBio === 'function') {
                const profileDrawer = getPartnerProfileDrawer();
                if (profileDrawer?.classList.contains('active')) {
                    renderProfileBio(nextPartnerData);
                    if (typeof document !== 'undefined') {
                        applyRealtimeProfileEnterAnimation(document.getElementById('profileBioLine'));
                    }
                }
            }
        }
        rerenderCurrentChat();
    });

    socket.on('own_profile_updated', (data) => {
        const displayLabel = data.display_name || data.username || '?';
        const safeAvatarUrl = escapeHtml(data.avatar_url || '');
        const safeLabel = escapeHtml(displayLabel);

        renderAvatarContent(resolveSidebarAvatarCircle(), {
            avatarUrl: safeAvatarUrl,
            label: safeLabel,
            includeAlt: true,
        });

        const displayNameEl = resolveSidebarDisplayName();
        if (displayNameEl) {
            displayNameEl.textContent = data.display_name || data.username;
            applyRealtimeProfileEnterAnimation(displayNameEl);
        }

        const usernameEl = resolveSidebarUsername();
        if (usernameEl) {
            usernameEl.textContent = `@${data.username || ''}`;
            applyRealtimeProfileEnterAnimation(usernameEl);
        }
        applyRealtimeProfileEnterAnimation(resolveSidebarAvatarCircle());

        setCurrentUserIdentity({
            displayName: data.display_name || '',
            username: data.username || '',
            avatarUrl: data.avatar_url || '',
        });

        rerenderCurrentChat();
    });

    socket.on('spotify_status_updated', (data) => {
        const publicKey = String(data?.public_key || '');
        const userId = String(data?.user_id || '').trim();
        if (!publicKey && !userId) return;

        const currentPartnerData = getCurrentPartnerData();
        if (!currentPartnerData) return;

        const currentPublicKey = String(currentPartnerData.public_key || getCurrentContactPublicKey() || '');
        const currentUserId = String(currentPartnerData.user_id ?? currentPartnerData.userId ?? '').trim();
        const matchesCurrentProfile = (
            (publicKey && publicKey === currentPublicKey)
            || (userId && userId === currentUserId)
        );
        if (!matchesCurrentProfile) return;

        const nextPartnerData = {
            ...currentPartnerData,
            spotify_status: data.spotify_status || null,
        };
        setCurrentPartnerData(nextPartnerData);

        const profileDrawer = getPartnerProfileDrawer();
        if (profileDrawer?.classList.contains('active') && typeof renderProfileSpotifyStatus === 'function') {
            renderProfileSpotifyStatus(nextPartnerData);
        } else if (profileDrawer?.classList.contains('active') && typeof renderPartnerProfile === 'function') {
            renderPartnerProfile(nextPartnerData);
        }
    });
}
