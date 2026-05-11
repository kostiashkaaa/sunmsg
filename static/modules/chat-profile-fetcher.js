function buildFallbackGroupProfile({
    groupChatId,
    contactItem = null,
    chatTitleEl = null,
} = {}) {
    return {
        success: true,
        _group_profile: true,
        chat_id: groupChatId,
        display_name: String(contactItem?.querySelector('.contact-name')?.textContent || chatTitleEl?.textContent || 'Group chat').trim(),
        description: '',
        username: '',
        public_key: '',
        avatar_url: String(contactItem?.querySelector('.contact-avatar img')?.getAttribute('src') || '').trim(),
        online: false,
        last_seen: null,
        created_at: null,
        stats: { photos: 0, files: 0, links: 0 },
        members_count: 0,
        members: [],
        my_role: 'member',
        can_edit_group: false,
        can_manage_admins: false,
        group_permissions: {
            members_can_send_messages: true,
            members_can_send_media: true,
            members_can_add_members: false,
            members_can_pin_messages: false,
            members_can_change_info: false,
            slow_mode_seconds: 0,
        },
    };
}

export function createChatProfileFetcher({
    fetchImpl = fetch,
    resolveAppUrl = (path) => path,
    getCurrentChatId = () => '',
    getCurrentContactPublicKey = () => '',
    isCurrentChatGroup = () => false,
    resolveContactItemByChatId = () => null,
    chatTitleEl = null,
    savedMessagesUi = null,
} = {}) {
    return async function fetchUserProfile(partnerId) {
        const normalizedPartnerId = String(partnerId || '').trim();
        const groupChatId = String(getCurrentChatId() || '').trim();
        if (groupChatId && isCurrentChatGroup() && normalizedPartnerId === groupChatId) {
            try {
                const groupResponse = await fetchImpl(resolveAppUrl(`/api/chats/group/info?chat_id=${encodeURIComponent(groupChatId)}`));
                const groupPayload = await groupResponse.json().catch(() => ({}));
                if (groupResponse.ok && groupPayload?.success && groupPayload?._group_profile) {
                    return groupPayload;
                }
            } catch (_) {}
            return buildFallbackGroupProfile({
                groupChatId,
                contactItem: resolveContactItemByChatId(groupChatId),
                chatTitleEl,
            });
        }
        if (savedMessagesUi?.isSavedContactId?.(partnerId)) {
            return savedMessagesUi.buildSavedProfilePayload({
                contactId: partnerId,
                chatId: groupChatId,
                publicKey: getCurrentContactPublicKey() || '',
            });
        }
        const response = await fetchImpl(resolveAppUrl(`/get_user_profile?user_id=${encodeURIComponent(partnerId)}`));
        const payload = await response.json();
        if (payload && typeof payload === 'object') {
            payload._group_profile = false;
        }
        return payload;
    };
}
