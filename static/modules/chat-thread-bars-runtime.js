import { initChatDateNavigator } from './chat-date-navigator.js';
import { initLinkDraftBar } from './link-draft-banner.js';
import { initPinnedBar, initReplyBar } from './message-thread-banners.js';

export function initChatThreadBarsRuntime({
    documentRef = document,
    chatMessages = null,
    messageInput = null,
    chatInputArea = null,
    messageForm = null,
    renderMessagePreviewHtml = () => '',
    applyEmojiGraphics = () => {},
    resizeComposerInput = () => {},
    scheduleComposerFocus = () => {},
    getCurrentChatId = () => '',
    getChatState = () => null,
    getMessageDayKey = () => '',
    loadOlderMessages = () => Promise.resolve(),
    focusMessageById = () => Promise.resolve(false),
    isChatBlocked = () => false,
    emitSocket = () => {},
} = {}) {
    const replyBarController = initReplyBar({
        barEl: documentRef.getElementById('replyBar'),
        textEl: documentRef.getElementById('replyBarText'),
        labelEl: documentRef.getElementById('replyBarLabel'),
        inputEl: messageInput,
        inputAreaEl: chatInputArea,
        formEl: messageForm,
        renderMessagePreviewHtml,
        applyEmojiGraphics,
    });
    const linkDraftBarController = initLinkDraftBar({
        barEl: documentRef.getElementById('linkDraftBar'),
        textEl: documentRef.getElementById('linkDraftText'),
        labelEl: documentRef.getElementById('linkDraftLabel'),
        thumbEl: documentRef.getElementById('linkDraftThumb'),
        thumbImgEl: documentRef.getElementById('linkDraftThumbImg'),
        closeBtnEl: documentRef.getElementById('cancelLinkDraftBtn'),
        inputEl: messageInput,
        formEl: messageForm,
        resizeComposerInput,
        scheduleComposerFocus,
    });
    const pinnedBarController = initPinnedBar({
        barEl: documentRef.getElementById('pinnedBar'),
        labelEl: documentRef.querySelector('#pinnedBar .pinned-bar__label'),
        textEl: documentRef.getElementById('pinnedBarText'),
        unpinButtonEl: documentRef.getElementById('unpinBtn'),
        renderMessagePreviewHtml,
        applyEmojiGraphics,
        onScrollToMessage: (msgId) => focusMessageById(msgId),
        onUnpin: (msgId) => {
            if (isChatBlocked()) return;
            const currentChatId = getCurrentChatId();
            if (!currentChatId) return;
            emitSocket('unpin_message', { chat_id: currentChatId, message_id: Number(msgId) });
        },
    });
    const favoriteBarController = initPinnedBar({
        barEl: documentRef.getElementById('favoriteBar'),
        labelEl: documentRef.querySelector('#favoriteBar .pinned-bar__label'),
        textEl: documentRef.getElementById('favoriteBarText'),
        unpinButtonEl: documentRef.getElementById('unfavoriteBtn'),
        renderMessagePreviewHtml,
        applyEmojiGraphics,
        singularLabel: '\u0418\u0437\u0431\u0440\u0430\u043D\u043D\u043E\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435',
        pluralLabelTemplate: '\u0418\u0437\u0431\u0440\u0430\u043D\u043D\u044B\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F {current}/{total}',
        onScrollToMessage: (msgId) => focusMessageById(msgId),
        onUnpin: (msgId) => {
            if (isChatBlocked()) return;
            const currentChatId = getCurrentChatId();
            if (!currentChatId) return;
            emitSocket('unfavorite_message', { chat_id: currentChatId, message_id: Number(msgId) });
        },
    });
    const dateNavigatorController = initChatDateNavigator({
        chatMessagesEl: chatMessages,
        getCurrentChatId,
        getChatState,
        getMessageDayKey,
        loadOlderMessages,
        scrollToMessage: (messageId, options = {}) => focusMessageById(messageId, options),
    });

    return {
        replyBarController,
        linkDraftBarController,
        pinnedBarController,
        favoriteBarController,
        dateNavigatorController,
    };
}
