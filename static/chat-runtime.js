import {
    escapeHtml,
    applyEmojiGraphics,
    applyFallbackAvatarTint,
    sanitizeFileUri,
    formatTime,
    formatMediaDuration,
    formatFullTimestamp,
    parseSunFilePayload,
    extractImagePreview,
    renderMessagePreviewHtml,
    getErrorMessage,
} from './modules/utils.js';
import { refreshVisibleTimePreferenceRendering } from './modules/time-format-sync.js';
import { withAppRoot } from './modules/app-url.js';
import { initLightbox } from './modules/lightbox.js';
import { initPresence } from './modules/presence.js';
import { showToast, initDialogRequests, sendDialogRequest } from './modules/dialogs.js';
import { activateFocusTrap, deactivateFocusTrap } from './modules/focus-trap.js';
import { showDeleteChatDialog } from './modules/delete-chat.js';
import { initProfileDrawer, parseUtcDate as _parseUtcDate, formatLastSeenText as _formatLastSeenText, formatRegistrationDate as _formatRegistrationDate, renderProfileHeader as _renderProfileHeader, renderProfileStats as _renderProfileStats, renderProfileMeta as _renderProfileMeta, renderProfileBio as _renderProfileBio, renderPartnerProfile as _renderPartnerProfile, handleProfileAction as _handleProfileAction } from './modules/profile-drawer.js';
import { getOutgoingStatus as _getOutgoingStatus, buildTickHtml as _buildTickHtml, applyTickToElement as _applyTickToElement, buildMessageAvatarHtml as _buildMessageAvatarHtml, isSameMessageGroup as _isSameMessageGroup, getMessageGroup as _getMessageGroup, getMessageDayKey as _getMessageDayKey, formatDaySeparatorLabel as _formatDaySeparatorLabel, createDaySeparatorNode as _createDaySeparatorNode, buildMessageElement as _buildMessageElement } from './modules/message-rendering.js';
import { renderMessageLinkPreview } from './modules/message-link-preview.js';
import { getChatState as _getChatState, createChatState as _createChatState, getMessageKey as _getMessageKey, findMessageIndex as _findMessageIndex, findMessageById as _findMessageById, compareChatMessages as _compareChatMessages, normalizeChatMessageOrder as _normalizeChatMessageOrder, upsertChatMessage as _upsertChatMessage, prependChatMessages as _prependChatMessages, removeChatMessages as _removeChatMessages, setChatMessages as _setChatMessages, estimateMessageHeight as _estimateMessageHeight, CHAT_DEFAULT_MESSAGE_HEIGHT as _CHAT_DEFAULT_MESSAGE_HEIGHT } from './modules/chat-state.js';
import { REACTION_PICKER_EMOJIS, areMessageReactionsEqual as _areMessageReactionsEqual, getReactionMessageKey as _getReactionMessageKey, computeOptimisticReactions as _computeOptimisticReactions } from './modules/reactions.js';
import { initComposer as _initComposer } from './modules/composer.js';
import { buildContactItemHtml as _buildContactItemHtml, hydrateContactAvatarLoading as _hydrateContactAvatarLoading, updateSidebarContactTick as _updateSidebarContactTick, updateActiveContactLastMessage as _updateActiveContactLastMessage } from './modules/contacts.js';
import { applyBlockNoticeUI as _applyBlockNoticeUI, normalizeBlockState as _normalizeBlockState } from './modules/block-ui.js';
import { getStoredString, setStoredString, hideBootOverlay as _hideBootOverlay, setElementActiveState, openFloatingPanel, closeFloatingPanel, openAnimatedDialog, closeAnimatedDialog, copyTextToClipboard, addTapFeedback } from './modules/chat-shell-ui.js';
import { notifyIncomingChatMessage } from './modules/chat-incoming-notifications.js';
import { renderMessageTextWithMentions } from './modules/chat-mentions.js';
import { markCurrentChatSeenIfPossible as markCurrentChatSeenFlow } from './modules/chat-seen-flow.js';
import { isWindowActiveForUnreadHandling } from './modules/chat-window-activity.js';
import { createChatMuteRuntime } from './modules/chat-mute-runtime.js';
import { createProfileMoreMenuController } from './modules/chat-profile-menu-ui.js';
import { createChatSettingsRuntime } from './modules/chat-settings-runtime.js';
import { createProfileMediaPanelController } from './modules/chat-profile-media-panel.js';
import { createChatGroupProfileRuntime } from './modules/chat-group-profile-runtime.js';
import { loadAndShowPartnerProfileFlow } from './modules/chat-profile-loader.js';
import {
    resolveCurrentPartnerId as resolveCurrentPartnerIdFlow,
} from './modules/chat-profile-open.js';
import { applyChatBlockStateFlow } from './modules/chat-block-state-controller.js';
import {
    getChatBlockNoticeText as getChatBlockNoticeTextFlow,
    updateBlockButtons as updateBlockButtonsFlow,
} from './modules/chat-block-ui.js';
import { createVoiceRecorderControls } from './modules/chat-voice-controls.js';
import { createLastActiveChatController } from './modules/chat-last-active-chat.js';
import { createChatSidebarStatusRuntime } from './modules/chat-sidebar-status-runtime.js';
import {
    createHistoryAbortController as createHistoryAbortControllerFlow,
    releaseHistoryAbortController as releaseHistoryAbortControllerFlow,
    abortHistoryRequestsForChat as abortHistoryRequestsForChatFlow,
} from './modules/chat-history-abort.js';
import {
    getPinnedContactsCount as getPinnedContactsCountFlow,
    canPinMoreChats as canPinMoreChatsFlow,
} from './modules/chat-pin-limit.js';
import {
    updateGlobalUnreadTabCount as updateGlobalUnreadTabCountFlow,
    setContactUnreadBadge as setContactUnreadBadgeFlow,
} from './modules/chat-unread-badges.js';
import {
    updateJumpToNewMessagesButton as updateJumpToNewMessagesButtonFlow,
    resetOpenChatUnreadCounter as resetOpenChatUnreadCounterFlow,
} from './modules/chat-unread-jump.js';
import { createPostRenderUiRefreshScheduler } from './modules/chat-post-render-refresh.js';
import { createChatDomSnapshotRuntime } from './modules/chat-dom-snapshot-runtime.js';
import { createMessageFocusRuntime } from './modules/chat-message-focus-runtime.js';
import { createPendingUploadRuntime } from './modules/chat-pending-upload-runtime.js';
import { createChatSearchRuntime } from './modules/chat-search-runtime.js';
import { bindChatEscapeOverlaysRuntime } from './modules/chat-escape-overlays-runtime.js';
import { bindChatMessageSurfaceEventsRuntime } from './modules/chat-message-surface-events-runtime.js';
import { createChatMessageAppendRuntime } from './modules/chat-message-append-runtime.js';
import { createChatMessageRenderRuntime } from './modules/chat-message-render-runtime.js';
import { createChatMobileViewportRuntime } from './modules/chat-mobile-viewport-runtime.js';
import { bindChatHeaderActionsRuntime } from './modules/chat-header-actions-runtime.js';
import { bindChatProfileActionsRuntime } from './modules/chat-profile-actions-runtime.js';
import { createChatEncryptionRuntime } from './modules/chat-encryption-runtime.js';
import { createChatContactPreviewRuntime } from './modules/chat-contact-preview-runtime.js';
import { createChatReactionOperationsRuntime } from './modules/chat-reaction-operations-runtime.js';
import { createChatMessageStatusRuntime } from './modules/chat-message-status-runtime.js';
import { createChatMessageVisualRuntime } from './modules/chat-message-visual-runtime.js';
import { bindChatContactSelectionRuntime } from './modules/chat-contact-selection-runtime.js';
import { initChatEmojiRefreshRuntime } from './modules/chat-emoji-refresh-runtime.js';
import { bindChatRuntimeWindowEvents } from './modules/chat-runtime-window-events.js';
import { initSidebarBrandQuickActions } from './modules/sidebar-brand-quick-actions.js';
import { createSavedMessagesUiController } from './modules/saved-messages-ui.js';
import { initChatMessageActionsRuntime } from './modules/chat-message-actions-runtime.js';
import { applyPinnedState as _applyPinnedState } from './modules/pinned-contacts.js';
import { createChatPinRuntime } from './modules/chat-pin-runtime.js';
import { initChatCaptionModalRuntime } from './modules/chat-caption-modal-runtime.js';
import { initMessageActionsBar } from './modules/message-actions-bar.js';
import { initMessageSelection } from './modules/message-selection.js';
import { initMessageContextMenu } from './modules/message-context-menu.js';
import { initReactionPickerController } from './modules/reaction-picker.js';
import { syncReactionPickerItems } from './modules/chat-reaction-picker-items.js';
import { scheduleMessageLinkPreviewPrewarm } from './modules/link-preview-prewarm.js';
import { initChatThreadBarsRuntime } from './modules/chat-thread-bars-runtime.js';
import { createChatComposerPresenceRuntime } from './modules/chat-composer-presence-runtime.js';
import { createChatComposerSendRuntime } from './modules/chat-composer-send-runtime.js';
import { registerMessageStatusSocketHandlers } from './modules/chat-message-status-events.js';
import { registerIncomingMessageSocketHandlers } from './modules/chat-incoming-message-events.js';
import { registerRealtimeUiSocketHandlers } from './modules/chat-realtime-ui-events.js';
import { registerProfileRealtimeSocketHandlers } from './modules/chat-profile-realtime-events.js';
import { registerSystemSocketHandlers } from './modules/chat-system-events.js';
import {
    createGroupModerationApi,
    bindGroupModerationUiHandlers,
} from './modules/chat-group-moderation.js';
import { initChatContactsSidebar } from './modules/chat-contacts-sidebar.js';
import { bindPartnerBlockControls, createChatConnectionStatusPresenter, createOnlineStatusStateController, loadOnlineStatusFlow, markMessagesAsReadFlow } from './modules/chat-partner-network.js';
import {
    configureOnlineStatusController,
    applyOnlineStatus as applyOnlineStatusBridge,
    markOnlineStatusPending as markOnlineStatusPendingBridge,
    clearOnlineStatusPending as clearOnlineStatusPendingBridge,
    markMessagesAsRead as markMessagesAsReadBridge,
    loadOnlineStatus as loadOnlineStatusBridge,
} from './modules/chat-partner-network-bridge.js';
import { computeSidebarStatusSnapshot as _computeSidebarStatusSnapshot, runSidebarStatusAction as _runSidebarStatusAction, syncSidebarStatusBar as _syncSidebarStatusBar } from './modules/chat-sidebar-status.js';
import { showConfirmDialog } from './modules/confirm-dialog.js';
import { initVoiceRecorder } from './modules/voice-recorder.js';
import { getPrivateKeyPem, restoreWrappedPrivateKey } from './modules/private-key-session.js';
import { createChatSocketClient, createSocketEmitter } from './modules/chat-socket-client.js';
import { createChatUpdatesSyncController } from './modules/chat-updates-sync.js';
import { getCsrfToken } from './modules/csrf.js';
import * as ChatIdb from './modules/chat-idb.js';
import { buildEncryptedCacheMessageFromSocketPayload } from './modules/chat-idb-runtime.js';
import { createChatStorageRuntime } from './modules/chat-storage-runtime.js';
import { createChatHistoryRuntime, mapWithConcurrency } from './modules/chat-history-runtime.js';
import { bindWindowActivityEvents, createActivityReporter } from './modules/chat-activity.js';
import {
    APP_BOOT_OVERLAY_FALLBACK_DELAY_MS,
    CHAT_BOTTOM_INERTIA_MAX_MS,
    CHAT_BOTTOM_INERTIA_MIN_MS,
    CHAT_BOTTOM_INERTIA_PX_TO_MS,
    CHAT_BOTTOM_THRESHOLD_PX,
    CHAT_DAY_SEPARATOR_HEIGHT,
    CHAT_DECRYPT_CONCURRENCY,
    CHAT_DECRYPT_WORKER_TIMEOUT_MS,
    CHAT_DEFAULT_MESSAGE_HEIGHT,
    CHAT_HEIGHT_MEASURE_SAMPLE_LIMIT,
    CHAT_HISTORY_MAX_PAGE_SIZE,
    CHAT_HISTORY_PAGE_SIZE,
    CHAT_LOAD_MORE_THRESHOLD_PX,
    CHAT_VIRTUAL_BUFFER,
    CHAT_VIRTUAL_WINDOW_SIZE,
    CHAT_VIRTUALIZATION_MIN_MESSAGES,
    CONTACTS_BOOTSTRAP_SYNC_LIMIT,
    CONTACTS_FULL_SYNC_IDLE_TIMEOUT_MS,
    CONTACTS_RELOAD_DEBOUNCE_MS,
    MESSAGE_SCALE_STORAGE_KEY,
    MUTE_CHAT_STORAGE_KEY,
    MUTE_DIALOG_REQUESTS_STORAGE_KEY,
    PINNED_CHATS_LIMIT,
    TIME_FORMAT_STORAGE_KEY,
    TYPING_EMIT_INTERVAL_MS,
} from './modules/chat-runtime-constants.js';
import { initKeyboardShortcuts } from './modules/keyboard-shortcuts.js';
import { initAttachMenuPortal } from './modules/attach-menu-portal.js';
import {
    applyListPerfGuard,
    initMotionRuntime,
    initTelegramRipple,
    waitForMotionEnd,
} from './modules/motion.js';
import {
    syncCurrentUserIdentityLegacyGlobals as syncCurrentUserIdentityLegacyGlobalsBridge,
    setCurrentPartnerLegacyGlobals as setCurrentPartnerLegacyGlobalsBridge,
    exposeChatRuntimeLegacyGlobals as exposeChatRuntimeLegacyGlobalsBridge,
} from './modules/chat-legacy-globals.js';
import { initPrivateKeyUiRefresh } from './modules/private-key-ui-refresh.js';
import { createMediaHydrationController } from './modules/media-hydration.js';
import { createChatMessageMutations } from './modules/chat-message-mutations.js';
import { initChatMediaRuntime, formatAudioPlayerTime, hasProvidedWaveformPayload } from './modules/chat-media-runtime.js';
import { createChatForwardFlow } from './modules/chat-forward-flow.js';
import { createChatDraftsController } from './modules/chat-drafts.js';
import { createChatReportFlow } from './modules/chat-report-flow.js';
import { createChatMediaMetaController } from './modules/chat-media-meta.js';
import { createChatGroupCreateController } from './modules/chat-group-create.js';
import { createChatGroupEditController } from './modules/chat-group-edit.js';
import { createChatGroupPermissionsController } from './modules/chat-group-permissions.js';
import { resolveChatDomRefs } from './modules/chat-dom-refs.js';
import { createChatLazyUiRuntime } from './modules/chat-lazy-ui-runtime.js';
import { createChatTabTitleRuntime } from './modules/chat-tab-title-runtime.js';
import { createChatComposerAttachmentsRuntime } from './modules/chat-composer-attachments-runtime.js';
import { createComposerUploadState } from './modules/chat-composer-upload-state.js';
import { createChatAnimationsController } from './modules/chat-animations.js';
import { initChatClipboardAndDrop } from './modules/chat-clipboard-drop.js';
import { initWebPush } from './modules/web-push.js';
import { initChatBootstrap } from './chat/bootstrap.js';
import { createSidebarShell } from './chat/sidebar-shell.js';
import { syncE2EPillState as syncE2EPillStateFlow } from './chat/e2e-flows.js';
import { createThreadShell } from './chat/thread-shell.js';
import { createChatStateShell } from './chat/chat-state-shell.js';
import { createMessageEditController } from './chat/message-edit-controller.js';
import { initMessageTouchContext } from './chat/message-touch-context.js';
import { createProfileOrchestrator } from './chat/profile-orchestrator.js';
import {
    wireSocketLifecycleHandlers,
    registerRealtimeOrchestrator,
} from './chat/realtime-orchestrator.js';
import {
    wireWindowActivityEvents,
    wireBeforeUnloadCleanup,
} from './chat/events-wiring.js';
export const initChatPage = async () => {
    initMotionRuntime();
    const {
        bootstrapData,
        bootstrapUser,
        bootstrapSocketConfig,
    } = await initChatBootstrap({
        restoreWrappedPrivateKey,
        initTelegramRipple,
    });
    // \u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 \u043A Socket.IO (same-origin, with reconnection support).
    // Threading + Werkzeug is more reliable with polling-first transport config.
    const socket = createChatSocketClient(bootstrapSocketConfig);
    let hasSocketConnectedOnce = false;
    let hasSocketConnectionIssue = false;
    const emitSocket = createSocketEmitter(socket);
    const chatUpdatesSyncController = createChatUpdatesSyncController({
        socket,
        fetchImpl: window.fetch?.bind(window) || fetch,
        resolveAppUrl: withAppRoot,
        logger: console,
    });
    chatUpdatesSyncController.bind();
    const activityController = createActivityReporter({ emitSocket });
    const reportActivity = activityController.reportActivity;
    const onlineStatusController = createOnlineStatusStateController();
    void initWebPush({
        authFetch: window.authFetch || window.fetch?.bind(window),
        showToast,
        config: window.SUN_BOOTSTRAP?.app?.webPush || window.SUN_WEB_PUSH_CONFIG || {},
    });
    wireSocketLifecycleHandlers({
        socket,
        reportActivity,
        syncChatConnectionStatus: () => syncChatConnectionStatus?.(),
        getCurrentChatId: () => currentChatId,
        isChatBlocked: () => isChatBlocked(),
        joinChatRoom: (chatId) => joinChatRoom(chatId),
        markCurrentChatSeenIfPossible: () => markCurrentChatSeenIfPossible(),
        refreshCurrentPresence: () => {
            const activeContactId = String(currentContactId || '').trim();
            if (!activeContactId) return;
            if (window.currentPartnerData?._saved_messages_profile) return;
            if (window.currentPartnerData?._group_profile) return;
            onlineStatusController.reset({ loading: true });
            loadOnlineStatus(activeContactId);
        },
        syncSidebarStatusBar: () => syncSidebarStatusBar(),
        loadContacts: () => loadContacts(),
        loadDialogRequests: () => loadDialogRequests(),
        getHasSocketConnectedOnce: () => hasSocketConnectedOnce,
        setHasSocketConnectedOnce: (value) => { hasSocketConnectedOnce = Boolean(value); },
        setHasSocketConnectionIssue: (value) => { hasSocketConnectionIssue = Boolean(value); },
    });
    let currentChatId = null;
    let currentContactId = null;
    let currentBlockState = { is_blocked: false, blocked_by_me: false, blocked_me: false };
    const CURRENT_USER_ID = String(
        bootstrapUser.currentUserId
        || document.body?.dataset?.currentUserId
        || ''
    ).trim();
    const LAST_ACTIVE_CHAT_STORAGE_KEY = 'sun_last_active_chat_id';
    const CONTACT_USERNAME_PATTERN = /^[a-z0-9_]{1,50}$/;
    const initialUrlSearchParams = new URLSearchParams(window.location.search || '');
    const initialRequestedContactUserId = String(initialUrlSearchParams.get('user_id') || '').trim();
    const initialRequestedContactUsername = String(
        bootstrapUser.initialChatContactUsername
        || document.body?.dataset?.initialChatContactUsername
        || ''
    )
        .trim()
        .toLowerCase();
    let hasAttemptedInitialChatRestore = false;
    const currentUserPublicKey = String(bootstrapUser.currentUserPublicKey || window.currentUserPublicKey || '').trim();
    let currentDisplayName = String(bootstrapUser.currentDisplayName || window.currentDisplayName || '').trim();
    let currentUsername = String(bootstrapUser.currentUsername || window.currentUsername || '').trim();
    let currentAvatarUrl = String(bootstrapUser.currentAvatarUrl || window.currentAvatarUrl || '').trim();
    function syncCurrentUserIdentityLegacyGlobals() {
        syncCurrentUserIdentityLegacyGlobalsBridge({
            bootstrapUser,
            currentDisplayName,
            currentUsername,
            currentAvatarUrl,
        });
    }
    syncCurrentUserIdentityLegacyGlobals();
    const {
        chatIdbRuntime,
        isChatIdbReady,
        ensureChatIdbReady,
        appendEncryptedMessagesToCache,
        syncDeletedMessagesToCache,
        dropChatCache,
        pruneCachedChatsWithPolicy,
        enqueueOutboxMessage,
        disposeMediaCacheRuntime,
    } = createChatStorageRuntime({
        currentUserId: CURRENT_USER_ID,
        socket,
        emitSocket,
        onPendingMessageExpired: (clientId) => failPendingMessage(clientId),
        onPendingMessageDrained: (clientId) => schedulePendingTimeout(clientId),
        windowRef: window,
        documentRef: document,
    });
    const uiState = { messageScale: 1 };
    let isEditingMessageId = null; // ID \u0440\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u0443\u0435\u043C\u043E\u0433\u043E \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F
    // Lightbox gallery state
    let lightboxImages = [];
    let lightboxIndex  = 0;
    let lastMobileKeyboardDismissAt = 0;
    const MAX_CHAT_MEDIA_SIZE = 100 * 1024 * 1024;
    const VOICE_RECORD_MIME_CANDIDATES = [
        'audio/webm;codecs=opus',
        'audio/webm',
    ];
    const VOICE_RECORD_MAX_SECONDS = 180;
    let isSendingMessage = false;
    let messageFocusRuntime = null;
    let pendingUploadRuntime = null;
    let chatSearchRuntime = null;
    let messageAppendRuntime = null;
    let messageRenderRuntime = null;
    let mobileViewportRuntime = null;
    let chatEncryptionRuntime = null;
    let contactPreviewRuntime = null;
    let reactionOperationsRuntime = null;
    let groupProfileRuntime = null;
    let messageStatusRuntime = null;
    let messageVisualRuntime = null;
    let composerPresenceRuntime = null;
    let composerSendRuntime = null;

    // Forward (\u043F\u0435\u0440\u0435\u0441\u044B\u043B\u043A\u0430) \u2014 \u0438\u043D\u0438\u0446\u0438\u0430\u043B\u0438\u0437\u0438\u0440\u0443\u0435\u0442\u0441\u044F \u043D\u0438\u0436\u0435 \u043F\u043E\u0441\u043B\u0435 \u0432\u0441\u0435\u0445 \u0437\u0430\u0432\u0438\u0441\u0438\u043C\u043E\u0441\u0442\u0435\u0439.
    // var-\u0445\u043E\u0439\u0441\u0442: \u0434\u043E \u0438\u043D\u0438\u0446\u0438\u0430\u043B\u0438\u0437\u0430\u0446\u0438\u0438 \u043E\u0431\u0451\u0440\u0442\u043A\u0438 \u0432\u0438\u0434\u044F\u0442 undefined \u0438 \u043D\u0435 \u043F\u0430\u0434\u0430\u044E\u0442.
    var forwardController;
    function openForwardModal(...args) { return forwardController?.openForwardModal(...args); }
    function getForwardComposerDraftForChat(chatId) { return forwardController?.getForwardComposerDraftForChat(chatId) || null; }
    function hasPendingForwardDraftForCurrentChat() { return Boolean(forwardController?.hasPendingForwardDraftForCurrentChat()); }
    function syncForwardDraftBarForCurrentChat() { return forwardController?.syncForwardDraftBarForCurrentChat(); }
    function clearForwardComposerDraft(chatId) { return forwardController?.clearForwardComposerDraft(chatId); }
    function setForwardComposerDraft(chatId, sourceMessages) { return forwardController?.setForwardComposerDraft(chatId, sourceMessages); }
    function resolveForwardSourceMessages(messageIds) { return forwardController?.resolveForwardSourceMessages(messageIds) || []; }
    function resolveForwardContactRows() { return forwardController?.resolveForwardContactRows() || []; }
    function forwardMessagesToTargets(sourceMessages, targetRows) { return forwardController.forwardMessagesToTargets(sourceMessages, targetRows); }

    // Drafts controller — initialised below после всех зависимостей.
    var draftsController;
    function scheduleCurrentChatDraftSave(...args) { return draftsController?.scheduleCurrentChatDraftSave(...args); }
    function flushDraftSaveForChat(...args) { return draftsController?.flushDraftSaveForChat(...args); }
    function loadDraftForChat(...args) { return draftsController?.loadDraftForChat(...args); }
    function prefillComposerDraftFromContactItem(...args) { return draftsController?.prefillComposerDraftFromContactItem(...args); }
    function handleRealtimeChatDraftUpdated(...args) { return draftsController?.handleRealtimeChatDraftUpdated(...args); }
    function syncDraftPreviewForContact(...args) { return draftsController?.syncDraftPreviewForContact(...args); }
    function applyComposerDraftText(...args) { return draftsController?.applyComposerDraftText(...args); }
    function hasMeaningfulDraft(value) { return Boolean(draftsController?.hasMeaningfulDraft(value)); }
    function clearLocalDraftStateForChat(chatId) { return draftsController?.clearLocalDraftStateForChat(chatId); }

    // Report flow controller — initialised below.
    var reportController;
    function openReportModal(target) { return reportController?.openReportModal(target); }

    // Group create controller — initialised below.
    var groupCreateController;
    function openGroupCreateModal() { return groupCreateController?.openGroupCreateModal(); }

    // Group edit controller — initialised below.
    var groupEditController;
    function openGroupEditModal() {
        closeGroupPermissionsPanel();
        return groupEditController?.openGroupEditModal();
    }
    function closeGroupEditModal(options = {}) { return groupEditController?.closeGroupEditModal?.(options); }
    function updateGroupEditSubmitState() { return groupEditController?.updateGroupEditSubmitState(); }
    // Group permissions controller — initialised below.
    var groupPermissionsController;
    function syncGroupPermissionsPanel(profile) { return groupPermissionsController?.syncFromProfile?.(profile); }
    function closeGroupPermissionsPanel() { return groupPermissionsController?.closePermissionsPanel?.(); }

    // Attach menu controller — initialised below.
    var attachMenuPanelController;
    function closeAttachMenu() { return attachMenuPanelController?.closeAttachMenu(); }
    function isAttachMenuOpen() { return Boolean(attachMenuPanelController?.isAttachMenuOpen()); }
    function handleFileUpload(file, options) { return attachMenuPanelController?.handleFileUpload(file, options); }

    // Chat animations controller — initialised below.
    var chatAnimationsController;
    function triggerChatSurfaceEnterAnimation() {
        if (isMobileViewport()) {
            if (chatArea) {
                chatArea.classList.remove('chat-surface-enter');
            }
            return;
        }
        return chatAnimationsController?.triggerChatSurfaceEnterAnimation();
    }
    function triggerChatHistoryRevealAnimation() {
        if (isMobileViewport()) {
            if (chatArea) {
                chatArea.classList.remove('chat-history-reveal', 'is-switching');
            }
            return;
        }
        return chatAnimationsController?.triggerChatHistoryRevealAnimation();
    }
    function triggerChatAnimateEnter() { return chatAnimationsController?.triggerChatAnimateEnter(); }
    function triggerDesktopMobileRevealAnimation() { return chatAnimationsController?.triggerDesktopMobileRevealAnimation(); }

    // Visual media meta enrichment controller — initialised below.
    var mediaMetaController;
    function enrichVisualMediaMessageText(messageText) {
        return mediaMetaController
            ? mediaMetaController.enrichVisualMediaMessageText(messageText)
            : Promise.resolve(messageText);
    }
    function enrichDecodedMessagesVisualMeta(messages) {
        return mediaMetaController
            ? mediaMetaController.enrichDecodedMessagesVisualMeta(messages)
            : Promise.resolve(Array.isArray(messages) ? messages : []);
    }

    // \u042D\u043B\u0435\u043C\u0435\u043D\u0442\u044B \u0438\u043D\u0442\u0435\u0440\u0444\u0435\u0439\u0441\u0430
    const {
        sidebar,
        contactsList,
        chatTitle,
        e2eIndicator,
        e2ePillWrap,
        e2ePill,
        voicePlaybackBar,
        voicePlaybackSender,
        voicePlaybackDetails,
        voicePlaybackPlayBtn,
        voicePlaybackBackBtn,
        voicePlaybackForwardBtn,
        voicePlaybackVolume,
        voicePlaybackSpeedBtn,
        voicePlaybackRepeatBtn,
        voicePlaybackCloseBtn,
        voicePlaybackProgress,
        voicePlaybackProgressFill,
        chatMessages,
        chatOnlineStatus,
        chatPartnerAvatar,
        historyLoadingIndicator,
        chatPlaceholder,
        chatInputArea,
        chatBlockNotice,
        chatBlockNoticeText,
        chatUnblockBtn,
        messageActionsBar,
        composerRow,
        messageForm,
        messageInput,
        sendMessageBtn,
        voiceRecordBtn,
        voiceRecordTimer,
        voiceRecordComposer,
        voiceRecordCancelBtn,
        voiceRecordSendBtn,
        cancelReplyBtn,
        cancelEditBtn,
        sendMessageBtnMobile,
        deleteChatBtn,
        reportUserMenuBtn,
        chatArea,
        chatHeaderActions,
        headerDropdown,
        headerSearchWrap,
        headerSearchInput,
        headerSearchCalendarBtn,
        closeSearchBtn,
        newChatModal,
        dialogRequestsList,
        modalSearchInput,
        modalSearchResults,
        paletteLocalSection,
        paletteLocalResults,
        paletteFrequentSection,
        paletteFrequentChats,
        chatsSearchHint,
        commandPaletteActions,
        groupCreateModal,
        groupTitleInput,
        groupMemberSearchInput,
        groupCreateSelected,
        groupCreateSearchResults,
        groupCreateSubmitBtn,
        groupEditModal,
        groupEditTitleInput,
        groupEditDescriptionInput,
        groupEditMembersList,
        groupEditAvatarInput,
        groupEditAvatarPreview,
        groupEditSubmitBtn,
        groupEditOpenPermissionsBtn,
        groupEditPermissionsSummary,
        groupPermissionsPanel,
        groupPermissionsBackBtn,
        groupPermSendMessagesToggle,
        groupPermSendMediaToggle,
        groupPermAddMembersToggle,
        groupPermPinMessagesToggle,
        groupPermChangeInfoToggle,
        groupPermSlowModeList,
        messageForwardModal,
        messageForwardSearchInput,
        messageForwardSelectedInfo,
        messageForwardTargets,
        messageForwardSubmitBtn,
        forwardDraftBar,
        forwardDraftLabel,
        forwardDraftText,
        cancelForwardDraftBtn,
        reactionPicker,
        contextMenu,
        contextReplyItem,
        contextPinItem,
        contextFavoriteItem,
        contextCopyItem,
        contextForwardItem,
        contextEditItem,
        contextSelectItem,
        contextReportItem,
        contextDeleteItem,
        contextReactionDivider,
        contextReadInfo,
        contextReadInfoText,
        muteChatBtn,
        partnerProfileDrawer,
        profileSheet,
        profileLayout,
        profileBackdropCloseBtn,
        closeProfileBtn,
        blockPartnerBtn,
        profileMoreBtn,
        profileMoreMenu,
        profileToggleMuteMenuBtn,
        profileToggleMuteMenuIcon,
        profileToggleMuteMenuLabel,
        profileTogglePinMenuBtn,
        profileTogglePinMenuIcon,
        profileTogglePinMenuLabel,
        profileDeleteChatMenuBtn,
        profileOnlineDot,
        profileMetaUsername,
        profileMetaCreatedAt,
        profileMetaUserId,
        profileGroupEditBtn,
        profileGroupSection,
        profileGroupTabs,
        profileGroupMembers,
        profileMediaSection,
        profileTopbarTitle,
        profileDisplayName,
        profileLastSeen,
        profileLargeAvatar,
        profileMediaTabs,
        profileMediaContent,
        profileMediaEmpty,
        profileActionButtons,
        profileInfoRows,
        chatHeader,
        chatPartnerHeaderLink,
        chatTitleArea,
        dialogRequestsSection,
        sidebarProfileShortcut,
        sidebarAvatarCircle,
        sidebarDisplayName,
        sidebarUsername,
        sidebarStatusBar,
        sidebarStatusSettingsBtn,
        sidebarStatusTitle,
        sidebarStatusHint,
        sidebarSyncChip,
        sidebarSearchInput,
        emojiBtn,
        searchChatBtn,
        sideResizer,
        dragDropOverlay,
        backBtnMobile,
        jumpToNewMessagesBtn,
        jumpToNewMessagesCount,
        jumpToNewMessagesIcon,
        headerSelectionWrap,
        selectedCountSpan,
        cancelSelectionBtn,
        bulkDeleteBtn,
        bulkForwardBtn,
        bulkCopyBtn,
        barSelectBtn,
        barCancelBtn,
        deleteConfirmModal,
        cancelDeleteBtn,
        confirmDeleteBtn,
        deleteForBothCheck,
        deleteForBothWrap,
        deleteModalTitle,
        deleteModalText,
        appBootOverlay,
        profileLoadingMask,
        messageActionsPreview,
        messageActionsTitle,
        barEditBtn,
        barCopyBtn,
        barDeleteBtn,
        reportContentModal,
        reportContentTargetLabel,
        reportReasonSelect,
        reportCommentInput,
        reportContentStatus,
        reportSubmitBtn,
        reportCancelBtn,
    } = resolveChatDomRefs(document);

    reportController = createChatReportFlow({
        reportContentModal,
        reportContentTargetLabel,
        reportReasonSelect,
        reportCommentInput,
        reportContentStatus,
        reportSubmitBtn,
        reportCancelBtn,
        withAppRoot,
        getCsrfToken,
        openAnimatedDialog,
        closeAnimatedDialog,
        showToast,
    });

    mediaMetaController = createChatMediaMetaController({
        buildPendingMediaDimensions: (...args) => buildPendingMediaDimensions(...args),
    });

    groupCreateController = createChatGroupCreateController({
        groupCreateModal,
        groupTitleInput,
        groupMemberSearchInput,
        groupCreateSelected,
        groupCreateSearchResults,
        groupCreateSubmitBtn,
        withAppRoot,
        getCsrfToken,
        openAnimatedDialog,
        closeAnimatedDialog,
        showToast,
        normalizeSearchUser: (user) => normalizeSearchUser(user),
        buildSearchResultsLoaderHtml: () => buildSearchResultsLoaderHtml(),
        loadContacts: (options) => loadContacts(options),
        openChatByIdWhenReady: (chatId) => openChatByIdWhenReady(chatId),
    });

    groupEditController = createChatGroupEditController({
        groupEditModal,
        groupEditTitleInput,
        groupEditDescriptionInput,
        groupEditAvatarInput,
        groupEditSubmitBtn,
        chatTitle,
        profileLargeAvatar,
        profileDisplayName,
        getCurrentGroupProfile: () => getCurrentGroupProfile(),
        getCurrentChatId: () => currentChatId,
        withAppRoot,
        getCsrfToken,
        openAnimatedDialog,
        closeAnimatedDialog,
        showToast,
        renderGroupEditAvatar: (profile) => renderGroupEditAvatar(profile),
        renderGroupEditMembers: (profile) => renderGroupEditMembers(profile),
        loadContacts: (options) => loadContacts(options),
    });

    groupPermissionsController = createChatGroupPermissionsController({
        groupEditModal,
        groupEditOpenPermissionsBtn,
        groupEditPermissionsSummary,
        groupPermissionsPanel,
        groupPermissionsBackBtn,
        groupPermSendMessagesToggle,
        groupPermSendMediaToggle,
        groupPermAddMembersToggle,
        groupPermPinMessagesToggle,
        groupPermChangeInfoToggle,
        groupPermSlowModeList,
        withAppRoot,
        getCsrfToken,
        showToast,
        getCurrentGroupProfile: () => getCurrentGroupProfile(),
        onPermissionsUpdated: (nextPermissions) => setCurrentGroupPermissions(nextPermissions),
    });

    chatAnimationsController = createChatAnimationsController({
        chatArea,
        chatMessages,
        prefersReducedMotionSetting: () => prefersReducedMotionSetting(),
        isMobileViewport: () => isMobileViewport(),
    });

    // initChatClipboardAndDrop вызывается ниже, после объявления dragDropOverlay.

    initKeyboardShortcuts();
    initSidebarBrandQuickActions({
        openDialog: openAnimatedDialog,
    });
    try {
        window.localStorage?.removeItem('sun.favorite_chats.v1');
    } catch (_) {
        // Ignore storage availability issues.
    }
    let savedMessagesUi = null;
    const scheduleNonCriticalTask = (callback, timeout = 1200) => {
        if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(() => callback(), { timeout });
            return;
        }
        const fallbackDelayMs = Math.max(0, Number(timeout) || 0);
        window.setTimeout(callback, fallbackDelayMs);
    };
    const {
        applyActiveMessageSearchFilter,
        closeMessageSearchOverlay,
        closeHeaderDropdown,
        toggleHeaderDropdown,
    } = createChatLazyUiRuntime({
        messageInput,
        headerSearchWrap,
        closeSearchBtn,
        chatHeader,
        headerSearchInput,
        headerDropdown,
        sidebarSearchInput,
        emojiBtn,
        searchChatBtn,
        sideResizer,
        closeFloatingPanel,
        openFloatingPanel,
        isProfileDrawerOpen: () => isProfileDrawerOpen(),
        closePartnerProfileDrawer: () => closePartnerProfileDrawer(),
        sendDialogRequest,
        windowRef: window,
    });
    // Init profile drawer module (handles swipe-to-close)
    const _profileDrawer = initProfileDrawer({
        drawerEl: partnerProfileDrawer,
        profileSheetEl: profileSheet,
        chatAreaEl: chatArea,
        profileLayoutEl: profileLayout,
        isChatBlocked: () => isChatBlocked(),
        showToast,
    });
    initChatClipboardAndDrop({
        messageInput,
        chatArea,
        dragDropOverlay,
        handleFileUpload: (file, options) => handleFileUpload(file, options),
        isProfileDrawerOpen: () => isProfileDrawerOpen(),
        getCurrentChatId: () => currentChatId,
        showToast,
    });

    if (jumpToNewMessagesIcon) {
        jumpToNewMessagesIcon.className = 'bi bi-chevron-down';
    }
    const sidebarShell = createSidebarShell({
        contactsList,
        withAppRoot,
        contactUsernamePattern: CONTACT_USERNAME_PATTERN,
    });
    const getActiveContactItem = (...args) => sidebarShell.getActiveContactItem(...args);
    const setActiveContactItem = (...args) => sidebarShell.setActiveContactItem(...args);
    const resolveContactItemByDataAttribute = (...args) => sidebarShell.resolveContactItemByDataAttribute(...args);
    const resolveContactItemByChatId = (...args) => sidebarShell.resolveContactItemByChatId(...args);
    const resolveContactItemByUserId = (...args) => sidebarShell.resolveContactItemByUserId(...args);
    const normalizeContactUsername = (...args) => sidebarShell.normalizeContactUsername(...args);
    const resolveContactItemByUsername = (...args) => sidebarShell.resolveContactItemByUsername(...args);
    const resolveContactItemByPublicKey = (...args) => sidebarShell.resolveContactItemByPublicKey(...args);
    const buildChatListUrl = (...args) => sidebarShell.buildChatListUrl(...args);
    const buildChatUrlForContactItem = (...args) => sidebarShell.buildChatUrlForContactItem(...args);
    const replaceBrowserUrl = (...args) => sidebarShell.replaceBrowserUrl(...args);
    const syncBrowserUrlForActiveChat = (...args) => sidebarShell.syncBrowserUrlForActiveChat(...args);

    chatEncryptionRuntime = createChatEncryptionRuntime({
        windowRef: window,
        getCurrentChatId: () => currentChatId,
        isCurrentChatGroup: () => isCurrentChatGroup(),
        getCurrentContactPublicKey: () => window.currentContactPublicKey,
        getCurrentUserPublicKey: () => currentUserPublicKey,
        loadContacts: (options) => loadContacts(options),
        getPrivateKeyPem,
    });

    let isE2EPillPinnedOpen = false;
    const { tabAlertController } = createChatTabTitleRuntime({
        chatHeader,
        chatTitle,
        documentRef: document,
        windowRef: window,
    });

    const {
        getMutedChatIds,
        getDialogRequestsMutedFromStorage,
        isDialogRequestsMuted,
        initializeDialogRequestMutePreference,
        setMutedChatIds,
        isChatMuted,
        applyContactMuteState,
        syncContactMuteState,
        syncAllContactsMuteState,
        syncProfileMoreMenuChatActions,
        syncMuteButton,
        toggleChatMuted,
        toggleCurrentChatMuted,
    } = createChatMuteRuntime({
        storage: window.localStorage,
        muteChatStorageKey: MUTE_CHAT_STORAGE_KEY,
        muteDialogRequestsStorageKey: MUTE_DIALOG_REQUESTS_STORAGE_KEY,
        bootstrapMuteDialogRequests: Boolean(bootstrapUser.muteDialogRequests),
        contactsList,
        muteChatBtn,
        deleteChatBtn,
        profileToggleMuteMenuBtn,
        profileToggleMuteMenuIcon,
        profileToggleMuteMenuLabel,
        profileTogglePinMenuBtn,
        profileTogglePinMenuIcon,
        profileTogglePinMenuLabel,
        profileDeleteChatMenuBtn,
        resolveContactItemByChatId,
        getCurrentChatId: () => currentChatId,
        canPinMoreChats: (chatId) => canPinMoreChats(chatId),
        pinnedChatsLimit: PINNED_CHATS_LIMIT,
        showToast,
        documentRef: document,
    });
    const { ensureMediaElementHydrated, disconnectLazyMediaHydrationObserver, registerMediaElementsForLazyHydration } = createMediaHydrationController({ root: chatMessages });

    function syncE2EPillState() {
        syncE2EPillStateFlow({
            getPrivateKeyPem,
            getCurrentContactPublicKey: () => window.currentContactPublicKey,
            getCurrentChatId: () => currentChatId,
            getChatState,
            e2ePillWrap,
            e2eIndicator,
        });
    }
    syncReactionPickerItems(reactionPicker);

    let openChatUnreadCount = 0;
    const chatScrollPositions = new Map();
    const chatStates = new Map();
    const historyInitialAbortControllers = new Map();
    const historyOlderAbortControllers = new Map();
    let chatDomSnapshotRuntime = null;
    const reactionUpdateStampByMessage = new Map();
    let baseUpdateOnlineStatusUI = () => {};
    let hideTyping = () => {};
    let hideSidebarTyping = () => {};

    const { schedulePostRenderUiRefresh } = createPostRenderUiRefreshScheduler({
        requestAnimationFrameFn: requestAnimationFrame,
        applyActiveMessageSearchFilter,
        updateJumpToNewMessagesButton: () => updateJumpToNewMessagesButton(),
        syncE2EPillState,
    });

    function isAbortError(error) {
        return Boolean(error && (error.name === 'AbortError' || error.code === 20));
    }

    function createHistoryAbortController(controllerMap, chatId) {
        return createHistoryAbortControllerFlow(controllerMap, chatId);
    }

    function releaseHistoryAbortController(controllerMap, chatId, controller) {
        releaseHistoryAbortControllerFlow(controllerMap, chatId, controller);
    }

    function abortHistoryRequestsForChat(chatId) {
        abortHistoryRequestsForChatFlow(chatId, [historyInitialAbortControllers, historyOlderAbortControllers]);
    }

    function getPinnedContactsCount() {
        return getPinnedContactsCountFlow(contactsList);
    }

    function canPinMoreChats(chatId) {
        return canPinMoreChatsFlow({
            chatId,
            pinnedChatsLimit: PINNED_CHATS_LIMIT,
            resolveContactItemByChatId,
            getPinnedContactsCount,
        });
    }

    const chatConnectionStatusPresenter = createChatConnectionStatusPresenter({
        getStatusElement: () => chatOnlineStatus,
        getCurrentChatId: () => currentChatId,
        getCurrentContactId: () => currentContactId,
        resolveCustomStatus: ({
            statusElement,
            currentChatId: activeChatId,
            currentContactId: activeContactId,
        } = {}) => {
            if (isCurrentChatGroup()) {
                if (statusElement) {
                    const activeGroupItem = resolveContactItemByChatId(activeChatId);
                    const sidebarMembersCount = Number(activeGroupItem?.getAttribute('data-members-count') || '');
                    const knownMembersCount = Number.isFinite(sidebarMembersCount)
                        ? Math.max(0, sidebarMembersCount)
                        : Number(window.currentPartnerData?.members_count || 0);
                    if (window.currentPartnerData && Number(window.currentPartnerData.members_count) !== knownMembersCount) {
                        window.currentPartnerData.members_count = knownMembersCount;
                    }
                    statusElement.textContent = formatGroupMembersCountLabel(knownMembersCount);
                    statusElement.style.display = 'block';
                    statusElement.style.visibility = 'visible';
                    statusElement.style.opacity = '1';
                    statusElement.style.color = 'var(--sub-text)';
                    statusElement.setAttribute('data-last-seen', '');
                    statusElement.dataset.state = 'group';
                    statusElement.dataset.connectionState = 'group';
                    statusElement.classList.remove('chat-online-status--hidden');
                }
                return true;
            }
            if (!savedMessagesUi?.isSavedContactId?.(activeContactId)) return false;
            savedMessagesUi.syncCurrentChatMeta({
                chatId: activeChatId || currentChatId,
                contactId: activeContactId || currentContactId,
            });
            return true;
        },
        isChatBlocked: () => isChatBlocked(),
        renderBlockedState: () => onlineStatusController.renderBlockedState(),
        isNavigatorOnline: () => navigator.onLine,
        isSocketConnected: () => socket.connected,
        hasSocketConnectedOnce: () => hasSocketConnectedOnce,
        hasSocketConnectionIssue: () => hasSocketConnectionIssue,
        getPresenceState: () => onlineStatusController.getState(),
        baseUpdateOnlineStatusUI: (...args) => baseUpdateOnlineStatusUI(...args),
    });
    // var-hoist: realtime-orchestrator может вызвать syncChatConnectionStatus
    // на socket-connect раньше, чем initChatPage дойдёт до этой строки.
    // eslint-disable-next-line no-var
    var setChatHeaderStatus;
    // eslint-disable-next-line no-var
    var syncChatConnectionStatus;
    ({ setChatHeaderStatus, syncChatConnectionStatus } = chatConnectionStatusPresenter);

    const contactsSidebarController = initChatContactsSidebar({
        contactsList,
        escapeHtml,
        getPrivateKeyPem,
        isEncryptedPayload,
        decryptForDisplay,
        getCurrentUserId: () => CURRENT_USER_ID,
        getCurrentChatId: () => currentChatId,
        applyPinnedState: _applyPinnedState,
        sortContactsList,
        buildContactItemHtml: _buildContactItemHtml,
        applyEmojiGraphics,
        applyChatBlockState,
        updateActiveContactLastMessage: _updateActiveContactLastMessage,
        hideSidebarTyping: (...args) => hideSidebarTyping(...args),
        getPinnedContactsCount,
        showToast,
        restoreLastActiveChatSelection,
        hasAttemptedInitialChatRestore: () => hasAttemptedInitialChatRestore,
        setHasAttemptedInitialChatRestore: (value) => { hasAttemptedInitialChatRestore = Boolean(value); },
        hideAppBootOverlay,
        onRemovedChatState: (chatId) => {
            abortHistoryRequestsForChat(chatId);
            dropChatDomSnapshotLRU(chatId);
            chatStates.delete(String(chatId));
            chatScrollPositions.delete(String(chatId));
        },
        clearStoredLastActiveChatId,
        getStoredLastActiveChatId,
        closeChatUI,
        onContactRendered: (item, contact) => {
            const chatId = contact?.chatId || item?.getAttribute('data-chat-id');
            applyContactMuteState(item, isChatMuted(chatId));
            savedMessagesUi?.applyContactItem?.(item);
            _hydrateContactAvatarLoading(item);
        },
        contactsReloadDebounceMs: CONTACTS_RELOAD_DEBOUNCE_MS,
    });

    const composerUploadState = createComposerUploadState();

    const voiceRecorderController = initVoiceRecorder({
        composerRow,
        messageInput,
        sendMessageBtn,
        emojiBtn,
        voiceRecordBtn,
        voiceRecordTimer,
        voiceRecordComposer,
        voiceRecordCancelBtn,
        voiceRecordSendBtn,
        maxSeconds: VOICE_RECORD_MAX_SECONDS,
        mimeCandidates: VOICE_RECORD_MIME_CANDIDATES,
        getCurrentChatId: () => currentChatId,
        isChatBlocked: () => isChatBlocked(),
        getBlockedNoticeText: getChatBlockNoticeText,
        getCurrentBlockState: () => currentBlockState,
        isSendingMessage: () => isSendingMessage,
        isEditingMessage: () => Boolean(isEditingMessageId),
        getComposerText: () => messageInput?.value || '',
        hasPendingSendAction: () => hasPendingForwardDraftForCurrentChat(),
        showToast,
        onComposerStopTyping,
        onVoiceRecordingStateChange: onVoiceRecordingPresenceChange,
        sendFileMessage: (file, caption = '', options = {}) => sendFileMessage(file, caption, options),
        isUploadInProgress: () => composerUploadState.isActive(),
        getUploadProgress: () => composerUploadState.getProgress(),
        canCancelUpload: () => composerUploadState.canCancel(),
        cancelActiveUpload: () => cancelActiveComposerUpload(),
    });

    const voiceRecorderControls = createVoiceRecorderControls(voiceRecorderController);

    function isVoiceRecordSupported() {
        return voiceRecorderControls.isVoiceRecordSupported();
    }

    function isVoiceRecordingActive() {
        return voiceRecorderControls.isVoiceRecordingActive();
    }

    function updateVoiceRecordButtonState() {
        voiceRecorderControls.updateVoiceRecordButtonState();
    }

    function setActiveComposerUpload(payload = {}) {
        const changed = composerUploadState.setActive(payload);
        if (changed) {
            updateVoiceRecordButtonState();
        }
        return changed;
    }

    function updateActiveComposerUploadProgress(clientId, percent) {
        const changed = composerUploadState.updateProgress(clientId, percent);
        if (changed) {
            updateVoiceRecordButtonState();
        }
        return changed;
    }

    function clearActiveComposerUpload(clientId = '') {
        const changed = composerUploadState.clear(clientId);
        if (changed) {
            updateVoiceRecordButtonState();
        }
        return changed;
    }

    function cancelActiveComposerUpload() {
        const canceled = composerUploadState.cancelActiveUpload();
        if (canceled) {
            updateVoiceRecordButtonState();
        }
        return canceled;
    }

    async function stopVoiceRecording(options = {}) {
        return voiceRecorderControls.stopVoiceRecording(options);
    }

    async function startVoiceRecording() {
        return voiceRecorderControls.startVoiceRecording();
    }

    const lastActiveChatController = createLastActiveChatController({
        storageKey: LAST_ACTIVE_CHAT_STORAGE_KEY,
        storage: window.sessionStorage,
        getStoredString,
        setStoredString,
        getCurrentChatId: () => currentChatId,
        contactsList,
        initialRequestedContactUserId,
        initialRequestedContactUsername,
        resolveContactItemByUserId,
        resolveContactItemByUsername,
        syncBrowserUrlForActiveChat,
    });

    function getStoredLastActiveChatId() {
        return lastActiveChatController.getStoredLastActiveChatId();
    }

    function persistLastActiveChatId(chatId) {
        lastActiveChatController.persistLastActiveChatId(chatId);
    }

    function clearStoredLastActiveChatId(chatId = null) {
        lastActiveChatController.clearStoredLastActiveChatId(chatId);
    }

    function restoreLastActiveChatSelection() {
        return lastActiveChatController.restoreLastActiveChatSelection();
    }

    let appBootOverlayHidden = false;
    const appBootStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const threadShell = createThreadShell({
        historyLoadingIndicator,
        getCurrentChatId: () => currentChatId,
        getChatMessagesElement: () => chatMessages,
    });
    const setHistoryLoading = (...args) => threadShell.setHistoryLoading(...args);
    const setChatStageLoading = (...args) => threadShell.setChatStageLoading(...args);

    function hideAppBootOverlay() {
        appBootOverlayHidden = _hideBootOverlay({
            overlay: appBootOverlay,
            isHidden: appBootOverlayHidden,
            startedAt: appBootStartedAt,
        });
    }

    function setProfileLoading(isLoading) {
        partnerProfileDrawer?.classList.toggle('is-profile-loading', Boolean(isLoading));
        setElementActiveState(profileLoadingMask, isLoading);
    }

    async function handleAcceptedDialogRequest(response = {}) {
        void response;
        window.closeCommandPalette?.();
        window.switchSidebarTab?.('all');
        await loadContacts({ immediate: true });
    }

    initializeDialogRequestMutePreference();
    const { loadDialogRequests } = initDialogRequests({
        onAccepted: handleAcceptedDialogRequest,
        onListUpdated: () => updateDialogRequestsBadge(),
    });
    scheduleNonCriticalTask(() => {
        loadDialogRequests();
    });
    initLightbox();
    initChatEmojiRefreshRuntime({
        windowRef: window,
        documentRef: document,
        requestAnimationFrameFn: requestAnimationFrame,
        applyEmojiGraphics,
        chatMessages,
        contactsList,
        reactionPicker,
    });
    _hydrateContactAvatarLoading(contactsList);
    ({
        updateOnlineStatusUI: baseUpdateOnlineStatusUI,
        hideTyping,
        hideSidebarTyping,
    } = initPresence({
        socket,
        getChatId: () => currentChatId,
        isChatBlocked: (chatId) => chatId ? isBlockedChat(chatId) : isChatBlocked(),
    }));
    configureOnlineStatusController({
        onlineStatusController,
        syncChatConnectionStatus,
        baseUpdateOnlineStatusUI,
    });

    const updateOnlineStatusUI = (online, lastSeen) => {
        applyOnlineStatusBridge(onlineStatusController, online, lastSeen);
    };

    const markOnlineStatusPending = () => {
        markOnlineStatusPendingBridge(onlineStatusController);
    };

    const clearOnlineStatusPending = () => {
        clearOnlineStatusPendingBridge(onlineStatusController);
    };

    // var-hoisted: до инициализации обёртки выше видят undefined, не TDZ.
    // realtime-orchestrator может вызвать syncSidebarStatusBar() на connect
    // ещё до того, как initChatPage дойдёт до этой строки.
    // eslint-disable-next-line no-var
    var sidebarStatusController = createChatSidebarStatusRuntime({
        windowRef: window,
        computeSidebarStatusSnapshot: _computeSidebarStatusSnapshot,
        runSidebarStatusActionFn: _runSidebarStatusAction,
        syncSidebarStatusBarFn: _syncSidebarStatusBar,
        getHasNetwork: () => navigator.onLine !== false,
        getSocketConnected: () => socket.connected,
        getHasSocketConnectedOnce: () => hasSocketConnectedOnce,
        getHasSocketConnectionIssue: () => hasSocketConnectionIssue,
        setSocketConnectionIssue: (value) => {
            hasSocketConnectionIssue = Boolean(value);
        },
        socketConnect: () => socket.connect(),
        reportActivity,
        getVisibilityState: () => document.visibilityState,
        getHasPrivateKey: () => Boolean(getPrivateKeyPem()),
        openDeviceQrHub: (...args) => window.openDeviceQrHub?.(...args),
        openMyQrModal: (...args) => window.openMyQrModal?.(...args),
        openSettingsOverlay: (...args) => window.openSettingsOverlay?.(...args),
        showToast,
        sidebarProfileShortcut,
        sidebarStatusBar,
        sidebarStatusSettingsBtn,
        sidebarElements: {
            sidebarSyncChip,
            sidebarStatusBar,
            sidebarStatusTitle,
            sidebarStatusHint,
        },
        syncChatConnectionStatus,
    });

    function getSidebarStatusSnapshot() {
        return sidebarStatusController?.getSidebarStatusSnapshot() || {};
    }

    function runSidebarStatusAction(action, { silent = false } = {}) {
        sidebarStatusController?.runSidebarStatusAction(action, { silent });
    }

    function syncSidebarStatusBar() {
        sidebarStatusController?.syncSidebarStatusBar();
    }

    // \u041A\u043D\u043E\u043F\u043A\u0430 "\u041D\u0430\u0437\u0430\u0434" (\u043C\u043E\u0431\u0438\u043B\u044C\u043D\u0430\u044F)
    // \u0410\u043B\u0438\u0430\u0441\u044B \u043C\u043E\u0434\u0443\u043B\u044C\u043D\u044B\u0445 \u0444\u0443\u043D\u043A\u0446\u0438\u0439 (\u0431\u0435\u0437 _ prefix) - \u0442\u043E\u043B\u044C\u043A\u043E \u0442\u0435, \u0447\u0442\u043E \u043D\u0435 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u044E\u0442 \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u044B\u0439 chatStates Map
    const getMessageKey         = _getMessageKey;
    const getMessageDayKey      = _getMessageDayKey;
    const formatDaySeparatorLabel = _formatDaySeparatorLabel;
    const getOutgoingStatus     = _getOutgoingStatus;
    const buildTickHtml         = _buildTickHtml;
    const applyTickToElement    = _applyTickToElement;
    const isSameMessageGroup    = _isSameMessageGroup;
    const areMessageReactionsEqual   = _areMessageReactionsEqual;
    const getReactionMessageKey      = _getReactionMessageKey;
    const computeOptimisticReactions = (rawReactions, emoji) => _computeOptimisticReactions(rawReactions, emoji, {
        currentUserPublicKey,
        currentDisplayName: currentDisplayName || currentUsername || '\u0412\u044B',
        currentUsername: currentUsername || '',
        currentAvatarUrl: currentAvatarUrl || '',
    });

    // \u041B\u043E\u043A\u0430\u043B\u044C\u043D\u043E\u0435 \u0445\u0440\u0430\u043D\u0438\u043B\u0438\u0449\u0435 \u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u044F \u0447\u0430\u0442\u043E\u0432 (\u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0435\u0442\u0441\u044F chatStates Map \u0432\u044B\u0448\u0435)
    const chatStateShell = createChatStateShell({
        chatStates,
        chatDefaultMessageHeight: CHAT_DEFAULT_MESSAGE_HEIGHT,
        chatDaySeparatorHeight: CHAT_DAY_SEPARATOR_HEIGHT,
        chatVirtualizationMinMessages: CHAT_VIRTUALIZATION_MIN_MESSAGES,
        chatVirtualWindowSize: CHAT_VIRTUAL_WINDOW_SIZE,
        chatVirtualBuffer: CHAT_VIRTUAL_BUFFER,
        getMessageKey,
        getMessageDayKey,
        formatDaySeparatorLabel,
        parseUtcDate: (value) => parseUtcDate(value),
        getReactionMessageKey,
        clearPendingReactionOpByMessage: (chatId, msgId) => clearPendingReactionOpByMessage(chatId, msgId),
        syncDeletedMessagesToCache,
        invalidateChatDomSnapshot,
        scheduleProfileMediaPanelRefresh,
        getChatMessagesClientHeight: () => chatMessages?.clientHeight || 0,
        onRemoveMessageId: (_chatId, _msgId, reactionKey) => {
            if (reactionKey) {
                reactionUpdateStampByMessage.delete(reactionKey);
            }
        },
    });

    const {
        createChatState,
        getChatState,
        findMessageIndex,
        findMessageById,
        normalizePinnedMessages,
        isPinnedMessage,
        setChatPinnedMessages,
        upsertChatPinnedMessage,
        removeChatPinnedMessage,
        normalizeFavoriteMessages,
        isFavoriteMessage,
        setChatFavoriteMessages,
        upsertChatFavoriteMessage,
        removeChatFavoriteMessage,
        getMessageTimestamp,
        compareChatMessages,
        normalizeChatMessageOrder,
        upsertChatMessage,
        prependChatMessages,
        setChatMessages,
        estimateMessageHeight,
        removeChatMessages,
        createDaySeparatorNode,
        sumEstimatedHeights,
        getDesiredRenderRange,
        createVirtualSpacer,
    } = chatStateShell;

    messageRenderRuntime = createChatMessageRenderRuntime({
        documentRef: document,
        requestAnimationFrameFn: requestAnimationFrame,
        cancelAnimationFrameFn: cancelAnimationFrame,
        performanceNowFn: () => performance.now(),
        chatBottomInertiaMinMs: CHAT_BOTTOM_INERTIA_MIN_MS,
        chatBottomInertiaMaxMs: CHAT_BOTTOM_INERTIA_MAX_MS,
        chatBottomInertiaPxToMs: CHAT_BOTTOM_INERTIA_PX_TO_MS,
        chatBottomThresholdPx: CHAT_BOTTOM_THRESHOLD_PX,
        chatHeightMeasureSampleLimit: CHAT_HEIGHT_MEASURE_SAMPLE_LIMIT,
        chatDefaultMessageHeight: CHAT_DEFAULT_MESSAGE_HEIGHT,
        getCurrentChatId: () => currentChatId,
        getCurrentContactId: () => currentContactId,
        getChatMessages: () => chatMessages,
        getChatState,
        findMessageIndex,
        getMessageKey,
        getMessageDayKey,
        sumEstimatedHeights,
        getDesiredRenderRange,
        createVirtualSpacer,
        createDaySeparatorNode,
        messageGroup: (messages, index) => MessageGroup(messages, index),
        messageItem: (msg, layout) => MessageItem(msg, layout),
        applyMessageEnterAnimation,
        syncMessageBubbleLayoutClasses,
        isSelectionMode: () => messageSelectionController.isSelectionMode(),
        hasSelectedMessage: (messageId) => messageSelectionController.hasSelectedMessage(messageId),
        disconnectLazyMediaHydrationObserver,
        registerMediaElementsForLazyHydration,
        schedulePostRenderUiRefresh,
        saveChatScrollPosition: (chatId) => saveChatScrollPosition(chatId),
        resizeComposerInput: () => resizeComposerInput(),
        updateChatMessagesBottomInset: (options) => updateChatMessagesBottomInset(options),
        isMobileViewport: () => isMobileViewport(),
        triggerChatHistoryRevealAnimation: () => triggerChatHistoryRevealAnimation(),
        prefersReducedMotionSetting: () => prefersReducedMotionSetting(),
        scrollToBottom: (options) => scrollToBottom(options),
        syncSavedMessagesMeta: (payload) => savedMessagesUi?.syncCurrentChatMeta?.(payload),
    });

    chatDomSnapshotRuntime = createChatDomSnapshotRuntime({
        snapshotLimit: 5,
        getChatMessages: () => chatMessages,
        getChatState,
        getExistingChatState: (chatId) => chatStates.get(String(chatId)),
        getCurrentChatId: () => currentChatId,
        getChatScrollPositions: () => chatScrollPositions,
        renderChatMessages: (chatId, options) => renderChatMessages(chatId, options),
        setKeepChatPinnedToBottom: (value) => setKeepChatPinnedToBottom(value),
        setSuppressChatScrollHandling: (value) => setSuppressChatScrollHandling(value),
        disconnectLazyMediaHydrationObserver,
        registerMediaElementsForLazyHydration,
        requestAnimationFrameFn: requestAnimationFrame,
    });

    function getKeepChatPinnedToBottom() {
        return Boolean(messageRenderRuntime?.getKeepChatPinnedToBottom());
    }

    function setKeepChatPinnedToBottom(value) {
        return messageRenderRuntime?.setKeepChatPinnedToBottom(value);
    }

    function getSuppressChatScrollHandling() {
        return Boolean(messageRenderRuntime?.getSuppressChatScrollHandling());
    }

    function setSuppressChatScrollHandling(value) {
        return messageRenderRuntime?.setSuppressChatScrollHandling(value);
    }

    function resetMessageRenderScrollState() {
        return messageRenderRuntime?.resetScrollRuntimeState();
    }

    function setChatScrollTop(nextTop) {
        return messageRenderRuntime?.setChatScrollTop(nextTop);
    }

    function prefersReducedMotion() {
        return prefersReducedMotionSetting();
    }

    function prefersReducedMotionSetting() {
        if (document.documentElement.classList.contains('perf-lite')) return true;
        const motionLevel = String(document.documentElement.getAttribute('data-motion-level') || 'full').toLowerCase();
        if (motionLevel !== 'lite') return false;
        try {
            return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        } catch (_) {
            return false;
        }
    }

    function cancelBottomInertiaScroll() {
        return messageRenderRuntime?.cancelBottomInertiaScroll();
    }

    function isTailRangeRendered(chatId = currentChatId) {
        return Boolean(messageRenderRuntime?.isTailRangeRendered(chatId));
    }

    function runBottomInertiaScroll() {
        return Boolean(messageRenderRuntime?.runBottomInertiaScroll());
    }

    function isChatNearBottom(thresholdPx = CHAT_BOTTOM_THRESHOLD_PX) {
        return Boolean(messageRenderRuntime?.isChatNearBottom(thresholdPx));
    }

    function requestAutoScrollToBottom(options = {}) {
        return Boolean(messageRenderRuntime?.requestAutoScrollToBottom(options));
    }

    function measureRenderedMessageHeights(state) {
        return messageRenderRuntime?.measureRenderedMessageHeights(state);
    }

    function syncReusedMessageNodeState(node, msg, layout = {}) {
        return messageRenderRuntime?.syncReusedMessageNodeState(node, msg, layout);
    }

    function renderChatMessages(chatId = currentChatId, options = {}) {
        return messageRenderRuntime?.renderChatMessages(chatId, options);
    }

    async function renderChatMessagesStable(chatId = currentChatId, options = {}) {
        return messageRenderRuntime?.renderChatMessagesStable(chatId, options);
    }

    function scheduleForcedCurrentChatRerender(options = {}) {
        return messageRenderRuntime?.scheduleForcedCurrentChatRerender(options);
    }

    function scheduleVirtualChatRender(chatId = currentChatId, options = {}) {
        return messageRenderRuntime?.scheduleVirtualChatRender(chatId, options);
    }
    const {
        ChatContainer,
        applyMessageScale,
        SettingsPanel,
    } = createChatSettingsRuntime({
        uiState,
        chatArea,
        chatStates,
        chatMessages,
        getCurrentChatId: () => currentChatId,
        renderChatMessages,
        chatDefaultMessageHeight: CHAT_DEFAULT_MESSAGE_HEIGHT,
        messageScaleStorageKey: MESSAGE_SCALE_STORAGE_KEY,
        timeFormatStorageKey: TIME_FORMAT_STORAGE_KEY,
        refreshVisibleTimePreferenceRendering,
        muteChatBtn,
        toggleCurrentChatMuted,
        closeHeaderDropdown,
        e2eIndicator,
        documentRef: document,
        windowRef: window,
    });
    SettingsPanel();

    mobileViewportRuntime = createChatMobileViewportRuntime({
        documentRef: document,
        windowRef: window,
        requestAnimationFrameFn: requestAnimationFrame,
        cancelAnimationFrameFn: cancelAnimationFrame,
        setTimeoutFn: setTimeout,
        resizeObserverCtor: window.ResizeObserver,
        chatBottomThresholdPx: CHAT_BOTTOM_THRESHOLD_PX,
        chatArea,
        sidebar,
        chatMessages,
        chatInputArea,
        messageInput,
        messageForm,
        composerRow,
        headerSearchWrap,
        headerDropdown,
        partnerProfileDrawer,
        reactionPicker,
        backBtnMobile,
        prefersReducedMotion,
        leaveCurrentChatRoom,
        closeChatUI,
        isProfileDrawerOpen,
        getCurrentChatId: () => currentChatId,
        getLastMobileKeyboardDismissAt: () => lastMobileKeyboardDismissAt,
        getKeepChatPinnedToBottom: () => getKeepChatPinnedToBottom(),
        setChatScrollTop,
        saveChatScrollPosition: (chatId) => saveChatScrollPosition(chatId),
        updateJumpToNewMessagesButton,
    });

    function resizeComposerInput() {
        return mobileViewportRuntime?.resizeComposerInput();
    }

    function openChat() {
        return mobileViewportRuntime?.openChat();
    }

    function isMobileViewport() {
        return Boolean(mobileViewportRuntime?.isMobileViewport());
    }

    function closeMobileChatView({ leaveRoom = true, animated = true } = {}) {
        return mobileViewportRuntime?.closeMobileChatView({ leaveRoom, animated });
    }

    function isComposerFocusBlocked() {
        return Boolean(mobileViewportRuntime?.isComposerFocusBlocked());
    }

    function resetHorizontalViewportDrift() {
        return mobileViewportRuntime?.resetHorizontalViewportDrift();
    }

    function scheduleComposerFocus(options = {}) {
        return mobileViewportRuntime?.scheduleComposerFocus(options);
    }

    function isChatViewportPinnedToBottom(thresholdPx = CHAT_BOTTOM_THRESHOLD_PX) {
        return Boolean(mobileViewportRuntime?.isChatViewportPinnedToBottom(thresholdPx));
    }

    function syncChatViewportToBottomIfNeeded(shouldPin) {
        return mobileViewportRuntime?.syncChatViewportToBottomIfNeeded(shouldPin);
    }

    function applyChatMessagesBottomInset() {
        return mobileViewportRuntime?.applyChatMessagesBottomInset();
    }

    function syncVisualViewportCssVars() {
        return mobileViewportRuntime?.syncVisualViewportCssVars();
    }

    function syncViewportAndInsets(options = {}) {
        return mobileViewportRuntime?.syncViewportAndInsets(options);
    }

    function updateChatMessagesBottomInset(options = {}) {
        return mobileViewportRuntime?.updateChatMessagesBottomInset(options);
    }

    function bindMobileViewportEvents() {
        return mobileViewportRuntime?.bindViewportEvents();
    }

    function disposeMobileBackSwipe() {
        return mobileViewportRuntime?.getMobileBackSwipeController?.()?.dispose?.();
    }
    function saveChatScrollPosition(chatId = currentChatId) {
        if (!chatMessages || !chatId) return;
        const safeTop = Math.max(0, chatMessages.scrollTop || 0);
        chatScrollPositions.set(String(chatId), safeTop);
        const state = getChatState(chatId);
        state.savedScrollTop = safeTop;
        state.hasSavedScrollTop = true;
    }

    function restoreChatScrollPosition(chatId) {
        if (!chatMessages || !chatId) return false;
        const key = String(chatId);
        if (!chatScrollPositions.has(key)) return false;
        const storedTop = Number(chatScrollPositions.get(key));
        if (!Number.isFinite(storedTop)) return false;
        const state = getChatState(chatId);
        state.savedScrollTop = storedTop;
        state.hasSavedScrollTop = true;
        setChatScrollTop(storedTop);
        return true;
    }

    function invalidateChatDomSnapshot(chatIdOrState) {
        return chatDomSnapshotRuntime?.invalidateChatDomSnapshot(chatIdOrState);
    }

    function dropChatDomSnapshotLRU(chatId) {
        return chatDomSnapshotRuntime?.dropChatDomSnapshotLRU(chatId);
    }

    function captureChatDomSnapshot(chatId) {
        return chatDomSnapshotRuntime?.captureChatDomSnapshot(chatId);
    }

    function restoreChatDomSnapshot(chatId) {
        return Boolean(chatDomSnapshotRuntime?.restoreChatDomSnapshot(chatId));
    }

    function resolveSavedChatScrollTop(chatId = currentChatId) {
        return chatDomSnapshotRuntime?.resolveSavedChatScrollTop(chatId) ?? null;
    }

    function renderChatAtBottom(chatId = currentChatId) {
        return chatDomSnapshotRuntime?.renderChatAtBottom(chatId);
    }

    function markCurrentChatSeenIfPossible() {
        markCurrentChatSeenFlow({
            chatId: currentChatId,
            isChatBlocked,
            isWindowActive: isWindowActiveForUnreadHandling,
            clearTabAlertForChat: (chatId) => tabAlertController.clearAlertForChat(chatId),
            emitMessagesSeen: (chatId) => emitSocket('messages_seen', { chat_id: chatId }),
        });
    }

    function updateGlobalUnreadTabCount() {
        updateGlobalUnreadTabCountFlow({ doc: document });
    }

    function setContactUnreadBadge(chatId, count) {
        const contactItem = resolveContactItemByChatId(chatId);
        const isSavedMessagesChat = savedMessagesUi?.isSavedContactItem?.(contactItem) === true;
        setContactUnreadBadgeFlow({
            chatId,
            count: isSavedMessagesChat ? 0 : count,
            resolveContactItemByChatId,
            isChatMuted,
            updateGlobalUnreadTabCount,
        });
    }

    function updateJumpToNewMessagesButton() {
        updateJumpToNewMessagesButtonFlow({
            jumpToNewMessagesBtn,
            jumpToNewMessagesCount,
            currentChatId,
            chatMessages,
            isChatNearBottom,
            openChatUnreadCount,
            newMessagesAriaLabel: '\u041A \u043D\u043E\u0432\u044B\u043C \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F\u043C',
            scrollDownAriaLabel: '\u0412\u043D\u0438\u0437',
        });
    }

    function resetOpenChatUnreadCounter({ markSeen = false } = {}) {
        resetOpenChatUnreadCounterFlow({
            markSeen,
            setOpenChatUnreadCount: (value) => { openChatUnreadCount = value; },
            updateJumpToNewMessagesButton,
            markCurrentChatSeenIfPossible,
            setContactUnreadBadge,
            currentChatId,
        });
    }


    // \u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C/\u0441\u043A\u0440\u044B\u0442\u044C \u0447\u0430\u0442-\u043A\u043E\u043D\u0442\u0435\u043D\u0442
    function showChatContent(show) {
        const wasHidden = Boolean(
            chatMessages && (
                chatMessages.classList.contains('chat-messages--hidden')
                || chatMessages.style.display === 'none'
            )
        );
        if (chatPlaceholder)  chatPlaceholder.style.display = show ? 'none' : '';
        if (chatMessages) {
            chatMessages.classList.toggle('chat-messages--hidden', !show);
            chatMessages.style.display = '';
        }
        if (chatInputArea) {
            chatInputArea.classList.toggle('chat-input-area--hidden', !show);
            chatInputArea.style.display = '';
        }
        if (chatHeaderActions) {
            chatHeaderActions.classList.toggle('header-actions-group--hidden', !show);
            chatHeaderActions.style.display = '';
        }
        if (show) {
            resizeComposerInput();
            updateChatMessagesBottomInset({ immediate: true });
        } else {
            updateChatMessagesBottomInset({ immediate: true });
        }
        if (!show) {
            resetOpenChatUnreadCounter();
        } else {
            const state = currentChatId ? getChatState(currentChatId) : null;
            if (state?.initialized) {
                const restoredTop = resolveSavedChatScrollTop(currentChatId);
                if (Number.isFinite(restoredTop)) {
                    scheduleVirtualChatRender(currentChatId, { force: true, scrollTop: restoredTop });
                    requestAnimationFrame(() => {
                        setKeepChatPinnedToBottom(isChatNearBottom());
                    });
                } else {
                    scheduleVirtualChatRender(currentChatId, { force: true, scrollToBottom: true });
                    setKeepChatPinnedToBottom(true);
                }
            }
            updateJumpToNewMessagesButton();
        }
        if (!show) {
            isE2EPillPinnedOpen = false;
            setChatStageLoading(false);
        }
        syncMuteButton();
        syncE2EPillState();
        updateVoiceRecordButtonState();
    }

    exposeChatRuntimeLegacyGlobalsBridge({
        activateFocusTrap,
        deactivateFocusTrap,
    });

    showChatContent(false);
    window.setTimeout(hideAppBootOverlay, APP_BOOT_OVERLAY_FALLBACK_DELAY_MS);

    function normalizeBlockState(state) {
        return _normalizeBlockState(state);
    }

    function isChatBlocked() {
        return Boolean(currentBlockState?.is_blocked);
    }

    const messageActionsBarController = initMessageActionsBar({
        barEl: messageActionsBar,
        previewEl: messageActionsPreview,
        titleEl: messageActionsTitle,
        editButtonEl: barEditBtn,
        copyButtonEl: barCopyBtn,
        deleteButtonEl: barDeleteBtn,
        selectButtonEl: barSelectBtn,
        isChatBlocked,
    });
    const messageSelectionController = initMessageSelection({
        chatMessages,
        headerSelectionWrap,
        selectedCountEl: selectedCountSpan,
        bulkDeleteButtonEl: bulkDeleteBtn,
        bulkForwardButtonEl: bulkForwardBtn,
        bulkCopyButtonEl: bulkCopyBtn,
        onEnterSelectionMode: () => {
            closeMessageActionsBar();
            hideContextMenu();
        },
    });

    forwardController = createChatForwardFlow({
        contactsList,
        forwardDraftBar,
        forwardDraftLabel,
        forwardDraftText,
        cancelForwardDraftBtn,
        messageForwardModal,
        messageForwardSearchInput,
        messageForwardSubmitBtn,
        messageForwardSelectedInfo,
        messageForwardTargets,
        getCurrentChatId: () => currentChatId,
        getCurrentDisplayName: () => currentDisplayName,
        getCurrentUsername: () => currentUsername,
        getCurrentUserPublicKey: () => currentUserPublicKey,
        getCurrentUserId: () => CURRENT_USER_ID,
        getPrivateKeyPem,
        formatGroupMembersCountLabel,
        formatLastSeenText,
        parseSunFilePayload,
        findMessageById,
        waitForMotionEnd,
        applyFallbackAvatarTint,
        updateVoiceRecordButtonState,
        emitSocket,
        openAnimatedDialog,
        closeAnimatedDialog,
        getMessageSelectionController: () => messageSelectionController,
        toggleSelectionMode: (on) => toggleSelectionMode(on),
        openChatByIdWhenReady: (chatId) => openChatByIdWhenReady(chatId),
        scheduleComposerFocus,
        showToast,
        getErrorMessage,
    });
    let messageContextMenuController = null;
    let openDeleteModal = () => {};
    messageContextMenuController = initMessageContextMenu({
        menuEl: contextMenu,
        replyItemEl: contextReplyItem,
        pinItemEl: contextPinItem,
        favoriteItemEl: contextFavoriteItem,
        copyItemEl: contextCopyItem,
        forwardItemEl: contextForwardItem,
        editItemEl: contextEditItem,
        selectItemEl: contextSelectItem,
        reportItemEl: contextReportItem,
        deleteItemEl: contextDeleteItem,
        isChatBlocked,
        resolveMessageElement: (msgId) => document.querySelector(`.message[data-msg-id="${msgId}"]`),
        getPartnerDisplayName: () => window.currentPartnerData?.display_name || '\u0421\u043E\u0431\u0435\u0441\u0435\u0434\u043D\u0438\u043A',
        copyTextToClipboard,
        showToast,
        onReply: (msgId, text, sender) => startReply(msgId, text, sender),
        onEdit: (msgId, text) => startEditMessage(msgId, text),
        onPin: (msgId) => {
            if (isChatBlocked()) return;
            if (!msgId || !currentChatId) return;
            const normalizedMessageId = parseInt(String(msgId), 10);
            if (!Number.isFinite(normalizedMessageId) || normalizedMessageId <= 0) return;
            if (isPinnedMessage(currentChatId, normalizedMessageId)) {
                emitSocket('unpin_message', { chat_id: currentChatId, message_id: normalizedMessageId });
                return;
            }
            emitSocket('pin_message', { chat_id: currentChatId, message_id: normalizedMessageId });
        },
        onFavorite: (msgId) => {
            if (isChatBlocked()) return;
            if (!msgId || !currentChatId) return;
            const normalizedMessageId = parseInt(String(msgId), 10);
            if (!Number.isFinite(normalizedMessageId) || normalizedMessageId <= 0) return;
            if (isFavoriteMessage(currentChatId, normalizedMessageId)) {
                emitSocket('unfavorite_message', { chat_id: currentChatId, message_id: normalizedMessageId });
                return;
            }
            emitSocket('favorite_message', { chat_id: currentChatId, message_id: normalizedMessageId });
        },
        onDelete: (msgId) => openDeleteModal(msgId),
        onForward: (msgId) => {
            openForwardModal([msgId]);
        },
        onSelect: (msgId, element) => {
            toggleSelectionMode(true);
            toggleMessageSelection(msgId, element);
        },
        onReport: (msgId, element) => {
            const safeId = Number.parseInt(String(msgId || ''), 10);
            const previewText = String(element?.getAttribute('data-message-content') || '')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 120);
            openReportModal({
                targetType: 'message',
                targetId: Number.isFinite(safeId) && safeId > 0 ? String(safeId) : String(msgId || ''),
                messageId: Number.isFinite(safeId) && safeId > 0 ? safeId : null,
                preview: previewText,
            });
        },
    });
    const reactionPickerController = initReactionPickerController({
        pickerEl: reactionPicker,
        contextMenuEl: contextMenu,
        getCurrentContextMessageId: () => messageContextMenuController.getCurrentMessageId(),
        resolveMessageElement: (msgId) => document.querySelector(`.message[data-msg-id="${msgId}"]`),
        onSelectEmoji: (msgId, emoji) => emitReactionToggle(msgId, emoji),
    });
    const {
        replyBarController,
        linkDraftBarController,
        pinnedBarController,
        favoriteBarController,
        dateNavigatorController,
    } = initChatThreadBarsRuntime({
        documentRef: document,
        chatMessages,
        messageInput,
        chatInputArea,
        messageForm,
        renderMessagePreviewHtml,
        applyEmojiGraphics,
        resizeComposerInput,
        scheduleComposerFocus,
        getCurrentChatId: () => currentChatId,
        getChatState,
        getMessageDayKey,
        loadOlderMessages,
        focusMessageById: (messageId, options = {}) => _focusMessageById(messageId, options),
        isChatBlocked,
        emitSocket,
    });

    draftsController = createChatDraftsController({
        messageInput,
        getCurrentChatId: () => currentChatId,
        getIsEditingMessageId: () => isEditingMessageId,
        isChatBlocked,
        getCurrentUserId: () => CURRENT_USER_ID,
        withAppRoot,
        getCsrfToken,
        resizeComposerInput,
        updateVoiceRecordButtonState,
        getLinkDraftBarController: () => linkDraftBarController,
        resolveContactItemByChatId,
        updateActiveContactLastMessage: _updateActiveContactLastMessage,
        sortContactsList,
        getPrivateKeyPem,
        isEncryptedPayload,
        decryptForDisplay,
    });
    savedMessagesUi = createSavedMessagesUiController({
        currentUserId: CURRENT_USER_ID,
        getChatState,
        chatAreaEl: chatArea,
        profileDrawerEl: partnerProfileDrawer,
        chatTitleEl: chatTitle,
        chatOnlineStatusEl: chatOnlineStatus,
        chatPartnerAvatarEl: chatPartnerAvatar,
        profileTopbarTitleEl: profileTopbarTitle,
        profileDisplayNameEl: profileDisplayName,
        profileLastSeenEl: profileLastSeen,
        profileLargeAvatarEl: profileLargeAvatar,
    });
    if (contactsList) {
        contactsList.querySelectorAll('.contact-item').forEach((item) => {
            savedMessagesUi?.applyContactItem?.(item);
        });
    }


    function isBlockedChat(chatId) {
        if (!chatId) return false;
        if (String(chatId) === String(currentChatId)) return isChatBlocked();
        const item = resolveContactItemByChatId(chatId);
        if (!item) return false;
        return item.getAttribute('data-blocked-by-me') === '1' || item.getAttribute('data-blocked-me') === '1';
    }

    function getChatBlockNoticeText(state) {
        return getChatBlockNoticeTextFlow(state);
    }

    function updateBlockButtons() {
        updateBlockButtonsFlow({
            currentBlockState,
            normalizeBlockState,
            getBlockChatBtn: () => blockPartnerBtn,
            chatUnblockBtn,
        });
    }

    async function sendProfileContactRequest({ userId, displayName } = {}) {
        const normalizedUserId = Number.parseInt(String(userId || '').trim(), 10);
        if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) {
            showToast('Не удалось определить пользователя для запроса.', 'warning');
            return false;
        }
        try {
            const response = await fetch(withAppRoot('/send_request'), {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken(),
                },
                body: JSON.stringify({ contact_user_id: normalizedUserId }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload?.success) {
                showToast(`Ошибка: ${getErrorMessage(payload?.error || 'Не удалось отправить запрос.')}`, 'danger');
                return false;
            }
            const safeName = String(displayName || '').trim();
            showToast(
                safeName ? `Запрос пользователю ${safeName} отправлен.` : 'Запрос отправлен.',
                'success',
            );
            loadDialogRequests?.();
            return true;
        } catch (_) {
            showToast('Ошибка при отправке запроса.', 'danger');
            return false;
        }
    }

    function clearLocalChatDataAfterDeletion(chatId) {
        const normalizedChatId = String(chatId || '').trim();
        if (!normalizedChatId) return;
        const isCurrentChat = String(currentChatId || '') === normalizedChatId;
        if (isCurrentChat) {
            closeChatUI();
        }
        abortHistoryRequestsForChat(normalizedChatId);
        dropChatDomSnapshotLRU(normalizedChatId);
        chatStates.delete(normalizedChatId);
        chatScrollPositions.delete(normalizedChatId);
        hideSidebarTyping(normalizedChatId);
        dropChatCache(normalizedChatId);
        clearStoredLastActiveChatId(normalizedChatId);
        resolveContactItemByChatId(normalizedChatId)?.remove();
    }

    let profileMediaPanelController = null;
    const profileOrchestrator = createProfileOrchestrator({
        profileDrawer: _profileDrawer,
        partnerProfileDrawer,
        profileLayout,
        profileOnlineDot,
        profileMetaUsername,
        profileMetaCreatedAt,
        profileMetaUserId,
        resolveCurrentPartnerIdFlow,
        loadAndShowPartnerProfileFlow,
        renderProfileHeaderFn: _renderProfileHeader,
        renderProfileStatsFn: _renderProfileStats,
        renderProfileMetaFn: _renderProfileMeta,
        renderPartnerProfileFn: _renderPartnerProfile,
        handleProfileActionFn: _handleProfileAction,
        isChatBlocked,
        setProfileLoading,
        closeProfileMoreMenu,
        syncMuteButton,
        renderProfileMediaPanel,
        applyChatBlockState,
        normalizeBlockState,
        getCurrentBlockState: () => currentBlockState,
        getCurrentContactPublicKey: () => window.currentContactPublicKey,
        getCurrentPartnerData: () => window.currentPartnerData,
        setCurrentPartnerData: (value) => { window.currentPartnerData = value; },
        getCurrentPartnerId: () => window.currentPartnerId,
        setCurrentPartnerId: (value) => { window.currentPartnerId = value; },
        getCurrentContactId: () => currentContactId,
        getHeaderPartnerId: () => (
            chatPartnerHeaderLink?.getAttribute('data-partner-id')
            || chatHeader?.getAttribute('data-partner-id')
            || ''
        ),
        getActiveContactId: () => getActiveContactItem()?.getAttribute('data-contact-id') || '',
        resolveContactItemByChatId,
        getCurrentChatId: () => currentChatId,
        toggleCurrentChatMuted,
        updateChatPinnedState,
        showDeleteChatDialog,
        closeChatUI: (deletedChatId) => clearLocalChatDataAfterDeletion(deletedChatId),
        loadContacts,
        scheduleComposerFocus,
        copyTextToClipboard,
        showToast,
        sendContactRequest: sendProfileContactRequest,
        updateBlockButtons,
        bumpProfileLoadToken: () => profileMediaPanelController?.bumpLoadToken?.(),
        getProfileLoadToken: () => profileMediaPanelController?.getLoadToken?.(),
        afterRenderPartnerProfile: (profile) => {
            applyGroupProfileUi(profile);
            savedMessagesUi?.normalizeProfileAfterRender?.(profile, {
                chatId: currentChatId,
                contactId: currentContactId,
            });
        },
        fetchUserProfile: async (partnerId) => {
            const normalizedPartnerId = String(partnerId || '').trim();
            const groupChatId = String(currentChatId || '').trim();
            if (groupChatId && isCurrentChatGroup() && normalizedPartnerId === groupChatId) {
                try {
                    const groupResponse = await fetch(withAppRoot(`/api/chats/group/info?chat_id=${encodeURIComponent(groupChatId)}`));
                    const groupPayload = await groupResponse.json().catch(() => ({}));
                    if (groupResponse.ok && groupPayload?.success && groupPayload?._group_profile) {
                        return groupPayload;
                    }
                } catch (_) {}
                const contactItem = resolveContactItemByChatId(groupChatId);
                return {
                    success: true,
                    _group_profile: true,
                    chat_id: groupChatId,
                    display_name: String(contactItem?.querySelector('.contact-name')?.textContent || chatTitle?.textContent || 'Group chat').trim(),
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
            if (savedMessagesUi?.isSavedContactId?.(partnerId)) {
                return savedMessagesUi.buildSavedProfilePayload({
                    contactId: partnerId,
                    chatId: currentChatId,
                    publicKey: window.currentContactPublicKey || '',
                });
            }
            const response = await fetch(withAppRoot(`/get_user_profile?user_id=${encodeURIComponent(partnerId)}`));
            const payload = await response.json();
            if (payload && typeof payload === 'object') {
                payload._group_profile = false;
            }
            return payload;
        },
    });

    function isProfileDrawerOpen() {
        return profileOrchestrator.isProfileDrawerOpen();
    }

    function resolveCurrentPartnerId() {
        return profileOrchestrator.resolveCurrentPartnerId();
    }

    function openPartnerProfileDrawer() {
        profileOrchestrator.openPartnerProfileDrawer();
    }

    function resolveDefaultProfileTargetId() {
        if (isCurrentChatGroup()) {
            return String(currentChatId || '').trim();
        }
        return String(currentContactId || '').trim();
    }

    function setProfileTargetId(targetId) {
        const normalized = String(targetId || '').trim();
        if (!normalized) return false;
        window.currentPartnerId = normalized;
        chatPartnerHeaderLink?.setAttribute('data-partner-id', normalized);
        chatHeader?.setAttribute('data-partner-id', normalized);
        return true;
    }

    function openUserProfileById(rawUserId) {
        const parsedUserId = Number.parseInt(String(rawUserId || '').trim(), 10);
        if (!Number.isFinite(parsedUserId) || parsedUserId <= 0) return;
        if (!currentChatId) return;
        if (!setProfileTargetId(String(parsedUserId))) return;
        loadAndShowPartnerProfile();
    }

    function closePartnerProfileDrawer() {
        closeGroupPermissionsPanel();
        closeGroupEditModal({ restoreFocus: false });
        const defaultTargetId = resolveDefaultProfileTargetId();
        if (defaultTargetId) {
            setProfileTargetId(defaultTargetId);
        }
        return profileOrchestrator.closePartnerProfileDrawer();
    }

    function parseUtcDate(rawValue) {
        return _parseUtcDate(rawValue);
    }

    function formatLastSeenText(rawValue) {
        return _formatLastSeenText(rawValue);
    }

    function formatRegistrationDate(rawValue) {
        return _formatRegistrationDate(rawValue);
    }

    function renderProfileHeader(profile) {
        profileOrchestrator.renderProfileHeader(profile);
    }

    function renderProfileStats(statsPayload) {
        profileOrchestrator.renderProfileStats(statsPayload);
    }

    function renderProfileMeta(profile) {
        profileOrchestrator.renderProfileMeta(profile);
    }

    async function handleProfileAction(action) {
        if (action === 'report-user') {
            closeProfileMoreMenu();
            const partnerData = window.currentPartnerData || {};
            if (partnerData._group_profile) {
                showToast('\u0416\u0430\u043B\u043E\u0431\u0430 \u043D\u0430 \u0433\u0440\u0443\u043F\u043F\u0443 \u043F\u043E\u043A\u0430 \u043D\u0435 \u043F\u043E\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442\u0441\u044F. \u0415\u0441\u043B\u0438 \u043D\u0443\u0436\u043D\u043E, \u043E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u043F\u0440\u043E\u0444\u0438\u043B\u044C \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u0430 \u0438 \u043E\u0442\u043F\u0440\u0430\u0432\u044C\u0442\u0435 \u0436\u0430\u043B\u043E\u0431\u0443 \u043D\u0430 \u043D\u0435\u0433\u043E.', 'info');
                return;
            }
            const parsedTargetId = Number.parseInt(
                String(partnerData.userId || profileMetaUserId?.textContent || '').trim(),
                10,
            );
            if (!Number.isFinite(parsedTargetId) || parsedTargetId <= 0) {
                showToast('Невозможно пожаловаться: для этого чата недоступен идентификатор пользователя.', 'warning');
                return;
            }
            openReportModal({
                targetType: 'user',
                targetId: String(parsedTargetId),
                messageId: null,
                displayName: String(partnerData.display_name || '').trim(),
                username: String(partnerData.username || '').replace(/^@+/, '').trim(),
            });
            return;
        }
        await profileOrchestrator.handleProfileAction(action);
    }

    const profileMoreMenuController = createProfileMoreMenuController({
        profileMoreMenu,
        profileMoreBtn,
        openFloatingPanel,
        closeFloatingPanel,
        syncProfileMoreMenuChatActions,
    });

    function closeProfileMoreMenu() {
        profileMoreMenuController.closeProfileMoreMenu();
    }

    function toggleProfileMoreMenu(forceState) {
        profileMoreMenuController.toggleProfileMoreMenu(forceState);
    }

    profileMediaPanelController = createProfileMediaPanelController({
        getCurrentChatId: () => currentChatId,
        getChatState,
        profileMediaTabs,
        profileMediaContent,
        profileMediaEmpty,
        partnerProfileDrawer,
        chatMessages,
        isProfileDrawerOpen,
        closePartnerProfileDrawer,
        loadOlderMessages,
        openLightbox: (proxyEl) => window._openLightbox?.(proxyEl),
        scrollToMessage: (msgId) => _focusMessageById(msgId),
        reportVoiceListened: (msgId) => {
            const chatId = String(currentChatId || '').trim();
            const normalizedMessageId = Number(msgId);
            if (!chatId || !Number.isFinite(normalizedMessageId) || normalizedMessageId <= 0) {
                return;
            }
            emitSocket(
                'voice_message_listened',
                {
                    chat_id: chatId,
                    msg_id: normalizedMessageId,
                },
                { requireConnected: false },
            );
        },
    });

    function renderProfileMediaPanel(options) {
        profileMediaPanelController.renderProfileMediaPanel(options);
    }
    function scheduleProfileMediaPanelRefresh(chatId, options) {
        profileMediaPanelController.scheduleProfileMediaPanelRefresh(chatId, options);
    }
    async function loadProfileMediaHistory(chatId, loadToken) {
        return profileMediaPanelController.loadProfileMediaHistory(chatId, loadToken);
    }
    groupProfileRuntime = createChatGroupProfileRuntime({
        documentRef: document,
        windowRef: window,
        currentUserId: CURRENT_USER_ID,
        getCurrentChatId: () => currentChatId,
        getChatState,
        getCurrentPartnerData: () => window.currentPartnerData,
        isCurrentChatGroup: () => isCurrentChatGroup(),
        isProfileDrawerOpen: () => isProfileDrawerOpen(),
        loadAndShowPartnerProfile: () => loadAndShowPartnerProfile(),
        syncGroupPermissionsPanel: (profile) => syncGroupPermissionsPanel(profile),
        escapeHtml,
        applyFallbackAvatarTint,
        formatLastSeenText,
        profileDeleteChatMenuBtn,
        groupEditAvatarPreview,
        groupEditMembersList,
        profileGroupMembers,
        profileGroupTabs,
        profileMediaSection,
        getProfileMediaPanelController: () => profileMediaPanelController,
        partnerProfileDrawer,
        profileMoreMenu,
        profileGroupEditBtn,
        profileGroupSection,
        profileTopbarTitle,
        profileDisplayName,
        profileLargeAvatar,
        profileLastSeen,
        chatTitle,
    });

    function getCurrentGroupProfile() {
        return groupProfileRuntime?.getCurrentGroupProfile() || null;
    }

    function setCurrentGroupPermissions(nextPermissions) {
        return groupProfileRuntime?.setCurrentGroupPermissions(nextPermissions);
    }

    function buildMemberInitials(displayName, username) {
        return groupProfileRuntime?.buildMemberInitials(displayName, username) || '?';
    }

    function formatGroupMembersCountLabel(rawCount) {
        return groupProfileRuntime?.formatGroupMembersCountLabel(rawCount) || '';
    }

    function renderGroupEditAvatar(profile) {
        return groupProfileRuntime?.renderGroupEditAvatar(profile);
    }

    function renderGroupEditMembers(profile) {
        return groupProfileRuntime?.renderGroupEditMembers(profile);
    }

    function renderGroupMembers(profile) {
        return groupProfileRuntime?.renderGroupMembers(profile);
    }

    function setGroupProfileTab(tabKey) {
        return groupProfileRuntime?.setGroupProfileTab(tabKey);
    }

    function applyGroupProfileUi(profile) {
        return groupProfileRuntime?.applyGroupProfileUi(profile);
    }

    function refreshCurrentGroupProfileIfVisible() {
        return groupProfileRuntime?.refreshCurrentGroupProfileIfVisible();
    }

    const {
        updateGroupMemberRole,
        removeGroupMember,
        applyGroupMemberSanction,
        submitGroupSanctionAppeal,
    } = createGroupModerationApi({
        withAppRoot,
        getCsrfToken,
        showToast,
        loadContacts,
        getCurrentGroupProfile: () => getCurrentGroupProfile(),
        getCurrentChatId: () => currentChatId,
        refreshCurrentGroupProfileIfVisible: () => refreshCurrentGroupProfileIfVisible(),
    });

    function applyChatBlockState(state, { syncChatRoom = true } = {}) {
        applyChatBlockStateFlow({
            state,
            syncChatRoom,
            getCurrentBlockState: () => currentBlockState,
            setCurrentBlockState: (nextState) => {
                currentBlockState = nextState;
            },
            normalizeBlockState,
            applyBlockNoticeUIFn: _applyBlockNoticeUI,
            blockNoticeElements: {
                chatBlockNotice,
                chatBlockNoticeText,
                chatUnblockBtn,
                messageInput,
                sendMessageBtn,
            },
            composerRow,
            getFileAttachInput: () => document.getElementById('fileAttachInput'),
            getAttachButton: () => document.getElementById('attachBtn'),
            closeAttachMenu,
            updateVoiceRecordButtonState,
            isVoiceRecordingActive,
            stopVoiceRecording,
            hideTyping,
            hideSidebarTyping,
            getCurrentChatId: () => currentChatId,
            hideContextMenu,
            closeReactionPicker,
            closeMessageActionsBar,
            cancelReply,
            cancelEdit,
            isSelectionMode: () => messageSelectionController.isSelectionMode(),
            toggleSelectionMode,
            deleteConfirmModal,
            closeAnimatedDialog,
            emitLeaveChatRoom: (chatId) => emitSocket('leave', { chat_id: chatId }),
            joinChatRoom,
            updateBlockButtons,
            getCurrentPartnerData: () => window.currentPartnerData,
            updateOnlineStatusUI,
            renderProfileHeader,
            getCurrentContactId: () => currentContactId,
            loadOnlineStatus,
        });
    }
    updateBlockButtons();

    bindChatMessageSurfaceEventsRuntime({
        chatMessages,
        jumpToNewMessagesBtn,
        chatLoadMoreThresholdPx: CHAT_LOAD_MORE_THRESHOLD_PX,
        isProfileDrawerOpen,
        closePartnerProfileDrawer,
        requestAutoScrollToBottom,
        cancelBottomInertiaScroll,
        isSelectionMode: () => messageSelectionController.isSelectionMode(),
        openUserProfileById,
        getCurrentChatId: () => currentChatId,
        getSuppressChatScrollHandling,
        isReactionPickerOpen: () => reactionPickerController.isOpen(),
        closeReactionPicker,
        saveChatScrollPosition,
        scheduleVirtualChatRender,
        loadOlderMessages,
        isChatNearBottom,
        setKeepChatPinnedToBottom,
        isWindowActiveForUnreadHandling,
        getOpenChatUnreadCount: () => openChatUnreadCount,
        resetOpenChatUnreadCounter,
        updateJumpToNewMessagesButton,
    });

    bindMobileViewportEvents();

    // \u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 \u043A \u043A\u043E\u043C\u043D\u0430\u0442\u0435 \u0447\u0430\u0442\u0430
    function joinChatRoom(chatId) {
        if (chatId) {
            emitSocket('join', { chat_id: chatId });
            void chatUpdatesSyncController.primeChatState(chatId);
        }
    }

    // \u041E\u0442\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 \u043E\u0442 \u0442\u0435\u043A\u0443\u0449\u0435\u0439 \u043A\u043E\u043C\u043D\u0430\u0442\u044B \u0447\u0430\u0442\u0430
    function leaveCurrentChatRoom() {
        if (currentChatId) {
            emitSocket('leave', { chat_id: currentChatId });
        }
    }

    // \u041E\u0431\u0440\u0430\u0431\u043E\u0442\u0447\u0438\u043A\u0438 \u043A\u043D\u043E\u043F\u043E\u043A (newChatBtn \u0438 settingsBtn \u0443\u043F\u0440\u0430\u0432\u043B\u044F\u044E\u0442\u0441\u044F \u0438\u0437 chat.html)

    // \u041E\u0431\u0440\u0430\u0431\u043E\u0442\u0447\u0438\u043A \u0432\u044B\u0431\u043E\u0440\u0430 \u043A\u043E\u043D\u0442\u0430\u043A\u0442\u0430
    bindChatContactSelectionRuntime({
        windowRef: window,
        documentRef: document,
        consoleRef: console,
        contactsList,
        messageInput,
        chatArea,
        chatTitle,
        chatHeader,
        chatPartnerHeaderLink,
        partnerProfileDrawer,
        closeCommandPalette: () => window.closeCommandPalette?.(),
        setActiveContactItem,
        flushDraftSaveForChat,
        saveChatScrollPosition,
        abortHistoryRequestsForChat,
        prefersReducedMotionSetting,
        isMobileViewport,
        closeReactionPicker,
        isVoiceRecordingActive,
        stopVoiceRecording,
        captureChatDomSnapshot,
        getCurrentChatId: () => currentChatId,
        setCurrentChatId: (value) => { currentChatId = value; },
        setCurrentContactId: (value) => { currentContactId = value; },
        hideTyping,
        syncDraftPreviewForContact,
        tabAlertController,
        persistLastActiveChatId,
        syncBrowserUrlForActiveChat,
        setCurrentContactPublicKey: (value) => { window.currentContactPublicKey = value; },
        getCurrentContactPublicKey: () => window.currentContactPublicKey,
        escapeHtml,
        applyFallbackAvatarTint,
        updateE2EIndicator,
        applyChatBlockState,
        getChatState,
        savedMessagesUi,
        prefillComposerDraftFromContactItem,
        loadDraftForChat,
        syncForwardDraftBarForCurrentChat,
        resetOpenChatUnreadCounter,
        closeMessageActionsBar,
        isEditingMessage: () => Boolean(isEditingMessageId),
        cancelEdit,
        isSelectionMode: () => messageSelectionController.isSelectionMode(),
        toggleSelectionMode,
        showChatContent,
        scheduleComposerFocus,
        setCurrentPartnerLegacyGlobals: setCurrentPartnerLegacyGlobalsBridge,
        normalizeBlockState,
        onlineStatusController,
        getCurrentPartnerData: () => window.currentPartnerData,
        formatGroupMembersCountLabel,
        loadOnlineStatus,
        fetchChatHistory,
        showToast,
        loadAndShowPartnerProfile,
        emitSocket,
        isChatBlocked,
        joinChatRoom,
        openChat,
        restoreLastActiveChatSelection,
        getHasAttemptedInitialChatRestore: () => hasAttemptedInitialChatRestore,
        setHasAttemptedInitialChatRestore: (value) => { hasAttemptedInitialChatRestore = value; },
    });

    const {
        applyPinnedStateForChat,
        updateChatPinnedState,
        updatePinIcon,
        sortContactsList,
    } = createChatPinRuntime({
        contactsList,
        resolveContactItemByChatId,
        getPinnedContactsCount,
        syncProfileMoreMenuChatActions,
        canPinMoreChats,
        pinnedChatsLimit: PINNED_CHATS_LIMIT,
        showToast,
        withAppRoot,
        getCsrfToken,
        fetchImpl: fetch,
    });

    bindChatHeaderActionsRuntime({
        documentRef: document,
        windowRef: window,
        contactsList,
        deleteChatBtn,
        headerSearchCalendarBtn,
        reportUserMenuBtn,
        chatHeader,
        chatPartnerHeaderLink,
        headerDropdown,
        profileMoreMenu,
        pinnedChatsLimit: PINNED_CHATS_LIMIT,
        getCurrentChatId: () => currentChatId,
        getCurrentDisplayName: () => currentDisplayName,
        getCurrentUsername: () => currentUsername,
        getChatState,
        isCurrentChatGroup: () => isCurrentChatGroup(),
        closeHeaderDropdown,
        toggleHeaderDropdown,
        clearLocalChatDataAfterDeletion: (chatId) => clearLocalChatDataAfterDeletion(chatId),
        loadContacts: (options) => loadContacts(options),
        getCsrfToken,
        showToast,
        showDeleteChatDialog,
        isChatMuted,
        toggleChatMuted,
        getPinnedContactsCount,
        applyPinnedStateForChat,
        dateNavigatorOpen: (value) => dateNavigatorController.open(value),
        isSelectionMode: () => messageSelectionController.isSelectionMode(),
        toggleSelectionMode: (value) => toggleSelectionMode(value),
        handleProfileAction: (action) => handleProfileAction(action),
        loadOlderMessages: (chatId) => loadOlderMessages(chatId),
        formatTime,
        resolveCurrentPartnerId,
        setCurrentPartnerId: (value) => { window.currentPartnerId = value; },
        isProfileDrawerOpen,
        loadAndShowPartnerProfile,
        closeProfileMoreMenu,
    });
    bindChatProfileActionsRuntime({
        documentRef: document,
        profileGroupTabs,
        profileGroupEditBtn,
        profileActionButtons,
        profileDeleteChatMenuBtn,
        profileInfoRows,
        closeProfileBtn,
        profileBackdropCloseBtn,
        blockPartnerBtn,
        profileMoreBtn,
        profileMoreMenu,
        addTapFeedback,
        setGroupProfileTab,
        openGroupEditModal,
        handleProfileAction,
        showToast,
        toggleProfileMoreMenu,
        closeProfileMoreMenu,
        closePartnerProfileDrawer,
        isProfileDrawerOpen,
    });

    function loadAndShowPartnerProfile() {
        profileOrchestrator.loadAndShowPartnerProfile({
            revealProfileDrawerContent: () => _profileDrawer.revealContent(),
        });
    }

    function closeChatUI() {
        const closedChatId = currentChatId;
        if (closedChatId && messageInput && !isEditingMessageId) {
            void flushDraftSaveForChat(closedChatId, messageInput.value, { force: true });
        }
        closePartnerProfileDrawer();
        if (closedChatId) {
            leaveCurrentChatRoom();
            tabAlertController.clearAlertForChat(closedChatId);
        }
        stopComposerPresence();
        clearStoredLastActiveChatId(closedChatId);

        if (currentChatId) saveChatScrollPosition(currentChatId);
        if (closedChatId) abortHistoryRequestsForChat(closedChatId);
        if (closedChatId) captureChatDomSnapshot(closedChatId);
        disconnectLazyMediaHydrationObserver();
        resetMessageRenderScrollState();
        currentChatId = null; currentContactId = null;
        syncForwardDraftBarForCurrentChat();
        onlineStatusController.reset();
        window.currentContactPublicKey = null;
        window.currentPartnerId = null;
        chatPartnerHeaderLink?.removeAttribute('data-partner-id');
        chatHeader?.removeAttribute('data-partner-id');
        savedMessagesUi?.clearMode?.();
        currentBlockState = { is_blocked: false, blocked_by_me: false, blocked_me: false };
        if (isVoiceRecordingActive()) {
            stopVoiceRecording({ reason: 'cancel' }).catch(() => {});
        }
        if (typeof hideContextMenu === 'function') hideContextMenu();
        closeReactionPicker();
        chatTitle.textContent = '\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0447\u0430\u0442';
        const onlineEl = chatOnlineStatus;
        if (onlineEl) onlineEl.style.display = 'none';
        const partnerAvatar = chatPartnerAvatar;
        if (partnerAvatar) partnerAvatar.style.display = 'none';
        closePartnerProfileDrawer();
        closeMessageActionsBar();
        if (messageSelectionController.isSelectionMode()) {
            toggleSelectionMode(false);
        }
        cancelEdit();
        updateE2EIndicator();
        messageInput.disabled = true;
        sendMessageBtn.disabled = true;
        if (composerRow) composerRow.style.display = '';
        if (chatBlockNotice) chatBlockNotice.style.display = 'none';
        updateVoiceRecordButtonState();
        updateBlockButtons();
        chatMessages.replaceChildren();
        setActiveContactItem(null);
        syncBrowserUrlForActiveChat(null);
        resetOpenChatUnreadCounter();
        hidePinnedBar();
        showChatContent(false);
        if (deleteChatBtn) deleteChatBtn.style.display = 'none';
        if (chatHeaderActions) chatHeaderActions.style.display = 'none';
        closeHeaderDropdown();
        if (headerSearchWrap) headerSearchWrap.classList.remove('active');
        chatHeader?.classList.remove('chat-header--search-active');
        if (window.innerWidth <= 768) {
            // \u0421\u0431\u0440\u0430\u0441\u044B\u0432\u0430\u0435\u043C \u0444\u043E\u043A\u0443\u0441 \u0441 textarea, \u0438\u043D\u0430\u0447\u0435 \u043D\u0430 iOS \u043A\u043B\u0430\u0432\u0438\u0430\u0442\u0443\u0440\u0430 \u043E\u0441\u0442\u0430\u0451\u0442\u0441\u044F \u043E\u0442\u043A\u0440\u044B\u0442\u043E\u0439
            // \u043F\u043E\u0441\u043B\u0435 \u0432\u043E\u0437\u0432\u0440\u0430\u0442\u0430 \u043D\u0430 \u0441\u043F\u0438\u0441\u043E\u043A \u0447\u0430\u0442\u043E\u0432 \u0438 \u043B\u043E\u043C\u0430\u0435\u0442 layout.
            if (document.activeElement === messageInput) {
                try { messageInput.blur(); } catch (_) {}
            }
            closeMobileChatView({ leaveRoom: false, animated: false });
        }
    }

    // \u0418\u0441\u043F\u0440\u0430\u0432\u043B\u044F\u0435\u043C \u043E\u0442\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0439 \u0438 \u043F\u0430\u043D\u0435\u043B\u0438 \u043D\u0430 \u043C\u043E\u0431\u0438\u043B\u044C\u043D\u043E\u0439 \u0432\u0435\u0440\u0441\u0438\u0438
    composerPresenceRuntime = createChatComposerPresenceRuntime({
        emitSocket,
        getCurrentChatId: () => currentChatId,
        isChatBlocked: () => isChatBlocked(),
        isEditingMessage: () => Boolean(isEditingMessageId),
        typingEmitIntervalMs: TYPING_EMIT_INTERVAL_MS,
        setTimeoutFn: setTimeout,
        clearTimeoutFn: clearTimeout,
    });
    if (messageInput) {
        messageInput.addEventListener('input', () => {
            updateVoiceRecordButtonState();
            scheduleCurrentChatDraftSave();
        });
        messageInput.addEventListener('focus', () => {
            if (window.innerWidth <= 768) {
                const wasNearBottom = isChatNearBottom();
                setTimeout(() => {
                    if (wasNearBottom) {
                        requestAutoScrollToBottom({ ifNearBottom: false });
                    }
                }, 300);
            }
        });
        messageInput.addEventListener('blur', () => {
            scheduleCurrentChatDraftSave({ immediate: true });
            if (!window.matchMedia('(pointer: coarse)').matches) return;
            setTimeout(() => {
                const active = document.activeElement;
                if (!active || active === document.body) {
                    lastMobileKeyboardDismissAt = Date.now();
                }
            }, 0);
        });
    }

    function onComposerTyping() {
        return composerPresenceRuntime?.onComposerTyping();
    }

    function onComposerStopTyping() {
        return composerPresenceRuntime?.onComposerStopTyping();
    }

    function onVoiceRecordingPresenceChange(isRecording) {
        return composerPresenceRuntime?.onVoiceRecordingPresenceChange(isRecording);
    }

    function stopComposerPresence() {
        return composerPresenceRuntime?.stopAll();
    }

    _initComposer({
        messageInput,
        messageForm,
        sendMessageBtn,
        replyCancelBtn: cancelReplyBtn,
        editCancelBtn: cancelEditBtn,
        getChatId: () => currentChatId,
        isChatBlocked: () => {
            const blocked = isChatBlocked();
            if (blocked) {
                showToast(getChatBlockNoticeText(currentBlockState), 'warning');
            }
            return blocked;
        },
        isEditingMessageId: () => Boolean(isEditingMessageId),
        getReplyState,
        cancelReply,
        cancelEdit,
        emitSocket,
        encryptAndSend: handleComposerEncryptAndSend,
        showToast,
        resizeComposerInput,
        scheduleComposerFocus,
        onTyping: onComposerTyping,
        onStopTyping: onComposerStopTyping,
    });

    messageVisualRuntime = createChatMessageVisualRuntime({
        documentRef: document,
        windowRef: window,
        getCurrentChatId: () => currentChatId,
        getChatMessages: () => chatMessages,
        getChatState,
        getCurrentUserPublicKey: () => currentUserPublicKey,
        getCurrentDisplayName: () => currentDisplayName,
        getCurrentUsername: () => currentUsername,
        getCurrentAvatarUrl: () => currentAvatarUrl,
        getKeepChatPinnedToBottom: () => getKeepChatPinnedToBottom(),
        isChatViewportPinnedToBottom,
        setChatScrollTop,
        saveChatScrollPosition,
        updateJumpToNewMessagesButton,
        requestAnimationFrameFn: requestAnimationFrame,
    });

    function isCurrentUserReactionReactor(reactor) {
        return Boolean(messageVisualRuntime?.isCurrentUserReactionReactor(reactor));
    }

    function buildCurrentUserReactionReactor() {
        return messageVisualRuntime?.buildCurrentUserReactionReactor() || null;
    }

    function normalizeMessageReactions(rawReactions) {
        return messageVisualRuntime?.normalizeMessageReactions(rawReactions) || [];
    }

    function getReactionEventTimestamp(rawValue) {
        const date = parseUtcDate(typeof rawValue === 'string' ? rawValue : '');
        return date ? date.getTime() : Date.now();
    }

    function buildMessageReactionsHtml(msgId, rawReactions) {
        return messageVisualRuntime?.buildMessageReactionsHtml(msgId, rawReactions) || '';
    }

    function applyReactionOperationUiState(operation, options = {}) {
        return messageVisualRuntime?.applyReactionOperationUiState(operation, options);
    }

    function syncMessageBubbleLayoutClasses(messageEl) {
        return messageVisualRuntime?.syncMessageBubbleLayoutClasses(messageEl);
    }

    function patchPinnedMessageState(messageEl, isPinned) {
        return messageVisualRuntime?.patchPinnedMessageState(messageEl, isPinned);
    }

    function clearPinnedMessageStates() {
        return messageVisualRuntime?.clearPinnedMessageStates();
    }

    function patchFavoriteMessageState(messageEl, isFavorite) {
        return messageVisualRuntime?.patchFavoriteMessageState(messageEl, isFavorite);
    }

    function clearFavoriteMessageStates() {
        return messageVisualRuntime?.clearFavoriteMessageStates();
    }

    function refreshMessageHeightCache(messageEl, options = {}) {
        return messageVisualRuntime?.refreshMessageHeightCache(messageEl, options);
    }

    function patchMessageReactions(messageEl, reactions, options = {}) {
        return messageVisualRuntime?.patchMessageReactions(messageEl, reactions, options);
    }

    function buildMessageAvatarHtml(msg) {
        return _buildMessageAvatarHtml(msg, { currentDisplayName, currentUsername, currentAvatarUrl });
    }

    function MessageGroup(messages, index) {
        const layout = _getMessageGroup(messages, index);
        if (!isCurrentChatGroup()) {
            return { ...layout, showAvatar: false };
        }
        return layout;
    }

    function buildMessageElement(msg, layout = {}) {
        return _buildMessageElement(msg, layout, {
            isSelectionMode: messageSelectionController.isSelectionMode(),
            getMessageKey,
            isPinnedMessage: (message) => isPinnedMessage(currentChatId, message?.id),
            isFavoriteMessage: (message) => isFavoriteMessage(currentChatId, message?.id),
            buildMessageReactionsHtml,
            renderMessageTextContent,
            currentDisplayName,
            currentUsername,
            currentAvatarUrl,
            currentUserId: CURRENT_USER_ID,
            isGroupChat: isCurrentChatGroup(),
        });
    }

    function Avatar(msg) {
        return buildMessageAvatarHtml(msg);
    }

    function MessageItem(msg, layout = {}) {
        return buildMessageElement(msg, layout);
    }

    function Message(msg, layout = {}) {
        return MessageItem(msg, layout);
    }

    messageAppendRuntime = createChatMessageAppendRuntime({
        windowRef: window,
        cssEscape: globalThis.CSS?.escape,
        getCurrentChatId: () => currentChatId,
        getChatMessages: () => chatMessages,
        getChatState,
        getKeepChatPinnedToBottom: () => getKeepChatPinnedToBottom(),
        upsertChatMessage,
        getMessageKey,
        isSameMessageGroup,
        getMessageDayKey,
        createDaySeparatorNode,
        messageGroup: (messages, index) => MessageGroup(messages, index),
        messageItem: (msg, layout) => MessageItem(msg, layout),
        syncReusedMessageNodeState,
        isMobileViewport,
        isSelectionMode: () => messageSelectionController.isSelectionMode(),
        isChatNearBottom,
        requestAutoScrollToBottom,
        registerMediaElementsForLazyHydration,
        schedulePostRenderUiRefresh,
        scheduleVirtualChatRender,
        requestAnimationFrameFn: requestAnimationFrame,
        applyTickToElement,
        formatTime,
        formatFullTimestamp,
        patchMessageReactions,
        refreshMessageHeightCache,
    });

    function applyMessageEnterAnimation(node, msg) {
        return messageAppendRuntime?.applyMessageEnterAnimation(node, msg);
    }

    function appendMessage(msg, options = {}) {
        return messageAppendRuntime?.appendMessage(msg, options) || null;
    }

    function confirmPendingMessageDom(options = {}) {
        return Boolean(messageAppendRuntime?.confirmPendingMessageDom(options));
    }

    reactionOperationsRuntime = createChatReactionOperationsRuntime({
        windowRef: window,
        cryptoRef: crypto,
        reactionPickerEmojis: REACTION_PICKER_EMOJIS,
        reactionUpdateStampByMessage,
        getCurrentChatId: () => currentChatId,
        getChatMessages: () => chatMessages,
        getChatState,
        findMessageIndex,
        normalizeMessageReactions,
        areMessageReactionsEqual,
        getReactionMessageKey,
        computeOptimisticReactions,
        patchMessageReactions,
        scheduleVirtualChatRender,
        applyReactionOperationUiState,
        emitSocket,
    });

    function updateMessageReactionsState(chatId, messageId, rawReactions) {
        return reactionOperationsRuntime?.updateMessageReactionsState(chatId, messageId, rawReactions) || false;
    }

    function applyMessageReactionsLocally(chatId, messageId, rawReactions, options = {}) {
        return reactionOperationsRuntime?.applyMessageReactionsLocally(chatId, messageId, rawReactions, options) || false;
    }

    function clearPendingReactionOp(requestId, options = {}) {
        return reactionOperationsRuntime?.clearPendingReactionOp(requestId, options) || null;
    }

    function clearPendingReactionOpByMessage(chatId, messageId, options = {}) {
        return reactionOperationsRuntime?.clearPendingReactionOpByMessage(chatId, messageId, options) || null;
    }

    function registerPendingReactionOp(chatId, messageId, previousReactions, requestId, reactionContext = {}) {
        return reactionOperationsRuntime?.registerPendingReactionOp(chatId, messageId, previousReactions, requestId, reactionContext);
    }

    function emitReactionToggle(messageId, emoji) {
        return reactionOperationsRuntime?.emitReactionToggle(messageId, emoji);
    }

    function isSupersededReactionRequest(requestId) {
        return reactionOperationsRuntime?.isSupersededReactionRequest(requestId) || false;
    }

    function forgetSupersededReactionRequest(requestId) {
        return reactionOperationsRuntime?.forgetSupersededReactionRequest(requestId);
    }

    function closeReactionPicker() {
        reactionPickerController.closeReactionPicker();
    }

    function positionReactionPicker() {
        reactionPickerController.positionReactionPicker();
    }

    function openReactionPicker(messageId, anchorEl) {
        reactionPickerController.openReactionPicker(messageId, anchorEl);
    }

    function openReactionPickerForMessage(messageId, anchorEl = null) {
        reactionPickerController.openReactionPickerForMessage(messageId, anchorEl);
    }

    function renderMessageTextContent(targetEl, content, options = {}) {
        renderMessageTextWithMentions(targetEl, content, {
            ...options,
            currentUserId: CURRENT_USER_ID,
            currentUsername,
        });
    }

    function resetComposer() {
        messageInput.value = '';
        messageInput.dispatchEvent(new Event('sun-composer-sync-visual'));
        linkDraftBarController?.syncFromInput?.({ force: true });
        resizeComposerInput();
        updateVoiceRecordButtonState();
    }

    function restoreComposerFocus() {
        scheduleComposerFocus();
    }

    function openMessageActionsBar(msgId, text, isFile) {
        messageActionsBarController.openMessageActionsBar(msgId, text, isFile);
    }

    function closeMessageActionsBar() {
        messageActionsBarController.closeMessageActionsBar();
    }

    // --- Reply helpers ---------------------------------------------------
    function startReply(msgId, text, senderLabel) {
        if (isEditingMessageId) cancelEdit();
        replyBarController.startReply(msgId, text, senderLabel);
    }

    function cancelReply() {
        replyBarController.cancelReply();
    }

    function getReplyState() {
        return replyBarController.getReplyState();
    }

    // --- Pin message -----------------------------------------------------
    function setPinnedBarMessages(items, options = {}) {
        pinnedBarController.setPinnedMessages(items, options);
    }

    function showPinnedBar(msgId, preview, options = {}) {
        pinnedBarController.showPinnedBar(msgId, preview, options);
    }

    function hidePinnedBar() {
        pinnedBarController.hidePinnedBar();
    }

    function setFavoriteBarMessages(items, options = {}) {
        favoriteBarController.setPinnedMessages(items, options);
    }

    function hideFavoriteBar() {
        favoriteBarController.hidePinnedBar();
    }

    // Context menu - pin
    contextPinItem?.addEventListener('click', () => {
        if (isChatBlocked()) return;
        const msgId = messageContextMenuController.getCurrentMessageId();
        hideContextMenu();
        if (!msgId || !currentChatId) return;
        const normalizedMessageId = parseInt(msgId, 10);
        if (!Number.isFinite(normalizedMessageId) || normalizedMessageId <= 0) return;
        if (isPinnedMessage(currentChatId, normalizedMessageId)) {
            emitSocket('unpin_message', { chat_id: currentChatId, message_id: normalizedMessageId });
            return;
        }
        emitSocket('pin_message', { chat_id: currentChatId, message_id: normalizedMessageId });
    });

    registerRealtimeUiSocketHandlers({
        socket,
        getChatState,
        getCurrentChatId: () => currentChatId,
        upsertChatPinnedMessage,
        removeChatPinnedMessage,
        setChatPinnedMessages,
        upsertChatFavoriteMessage,
        removeChatFavoriteMessage,
        setChatFavoriteMessages,
        restorePinnedBar,
        restoreFavoriteBar,
        patchPinnedMessageState,
        clearPinnedMessageStates,
        patchFavoriteMessageState,
        clearFavoriteMessageStates,
        getReactionMessageKey,
        getReactionEventTimestamp,
        reactionUpdateStampByMessage,
        clearPendingReactionOp,
        clearPendingReactionOpByMessage,
        isSupersededReactionRequest,
        forgetSupersededReactionRequest,
        updateMessageReactionsState,
        getActiveReactionMessageId: () => reactionPickerController.getActiveMessageId(),
        closeReactionPicker,
        resolveCurrentChatMessageElement: (messageId) => chatMessages?.querySelector(`.message[data-msg-id="${messageId}"]`),
        patchMessageReactions,
        rerenderCurrentChat: () => {
            if (!currentChatId) return;
            scheduleForcedCurrentChatRerender();
        },
    });

    // --- Scroll to message -----------------------------------------------
    messageFocusRuntime = createMessageFocusRuntime({
        documentRef: document,
        requestAnimationFrameFn: requestAnimationFrame,
        cancelAnimationFrameFn: cancelAnimationFrame,
        setTimeoutFn: setTimeout,
        clearTimeoutFn: clearTimeout,
        getChatMessages: () => chatMessages,
        getCurrentChatId: () => currentChatId,
        getChatState,
        findMessageById,
        findMessageIndex,
        loadOlderMessages,
        estimateMessageHeight,
        chatDefaultMessageHeight: CHAT_DEFAULT_MESSAGE_HEIGHT,
        sumEstimatedHeights,
        renderChatMessages: (chatId, options) => renderChatMessages(chatId, options),
    });

    function _focusMessageById(msgId, options = {}) {
        return messageFocusRuntime?.focusMessageById(msgId, options) || Promise.resolve(false);
    }

    exposeChatRuntimeLegacyGlobalsBridge({
        scrollToMessage: _focusMessageById,
    });

    const captionModalController = initChatCaptionModalRuntime({
        documentRef: document,
        activateFocusTrap,
        deactivateFocusTrap,
        sendFileMessage: (file, caption, submitOptions = {}) => sendFileMessage(file, caption, submitOptions),
        showToast,
    });
    const showCaptionModal = captionModalController.showCaptionModal;
    const closeCaptionModal = captionModalController.closeCaptionModal;

    async function encryptForCurrentChat(plainText) {
        return chatEncryptionRuntime.encryptForCurrentChat(plainText);
    }

    pendingUploadRuntime = createPendingUploadRuntime({
        getCurrentChatId: () => currentChatId,
        getChatState,
        findMessageIndex,
        getChatMessages: () => chatMessages,
        parseSunFilePayload,
        updateMessageContent: (messageEl, nextMessageText, isRedecrypt) => updateMessageContent(messageEl, nextMessageText, isRedecrypt),
        cssEscape: globalThis.CSS?.escape,
    });

    function buildPendingMediaDimensions(width, height) {
        return pendingUploadRuntime?.buildPendingMediaDimensions(width, height) || null;
    }

    function resolvePendingMessageByClientId(clientId) {
        return pendingUploadRuntime?.resolvePendingMessageByClientId(clientId) || null;
    }

    function persistPendingMediaDimensions(messageEl, width, height) {
        return pendingUploadRuntime?.persistPendingMediaDimensions(messageEl, width, height) || null;
    }

    function syncPendingUploadIndicators(messageEl, filePayload) {
        return pendingUploadRuntime?.syncPendingUploadIndicators(messageEl, filePayload);
    }

    function updatePendingFileUploadProgress(clientId, percent) {
        return pendingUploadRuntime?.updatePendingFileUploadProgress(clientId, percent);
    }

    const messageMutationHandlers = createChatMessageMutations({
        documentRef: document,
        windowRef: window,
        sanitizeFileUri,
        hasProvidedWaveformPayload,
        formatAudioPlayerTime,
        registerMediaElementsForLazyHydration,
        syncPendingUploadIndicators,
        applyEmojiGraphics,
        renderMessageTextContent,
        renderMessageLinkPreview,
        syncMessageBubbleLayoutClasses,
        refreshMessageHeightCache,
        getCurrentChatId: () => currentChatId,
        getChatState,
        updateActiveContactLastMessage,
        findMessageIndex,
        scheduleForcedCurrentChatRerender,
        cancelPendingTimeout,
        parseSunFilePayload,
        resolvePendingMessageByClientId,
        applyTickToElement: _applyTickToElement,
    });

    function commitPendingFileUpload(clientId, nextFilePayload) {
        return pendingUploadRuntime?.commitPendingFileUpload(clientId, nextFilePayload);
    }

    function failPendingMessage(clientId) {
        messageMutationHandlers.failPendingMessage(clientId);
    }

    composerSendRuntime = createChatComposerSendRuntime({
        windowRef: window,
        getCurrentChatId: () => currentChatId,
        getCurrentBlockState: () => currentBlockState,
        getCurrentUserPublicKey: () => currentUserPublicKey,
        getCurrentContactPublicKey: () => window.currentContactPublicKey,
        isCurrentChatGroup: () => isCurrentChatGroup(),
        isChatBlocked,
        getBlockedNoticeText: getChatBlockNoticeText,
        showToast,
        maxChatMediaSize: MAX_CHAT_MEDIA_SIZE,
        getCsrfToken,
        setSendingState,
        getReplyState,
        cancelReply,
        emitSocket,
        enqueueOutboxMessage,
        appendMessage,
        setKeepChatPinnedToBottom: (value) => setKeepChatPinnedToBottom(value),
        updateContactLastMessageForChat,
        prewarmMessageLinkPreview: scheduleMessageLinkPreviewPrewarm,
        clearComposerInput: (sourceChatId) => {
            if (String(currentChatId || '') === String(sourceChatId || '')) {
                messageInput.value = '';
                messageInput.dispatchEvent(new Event('sun-composer-sync-visual'));
                linkDraftBarController?.syncFromInput?.({ force: true });
            }
            clearLocalDraftStateForChat(sourceChatId);
            void flushDraftSaveForChat(sourceChatId, '', { force: true });
            if (String(currentChatId || '') !== String(sourceChatId || '')) {
                syncDraftPreviewForContact(sourceChatId, '', new Date().toISOString(), { showWhileActive: true });
            }
        },
        resizeComposerInput,
        restoreComposerFocus,
        failPendingMessage,
        getEditingFilePayload,
        getEditingMessageId: () => isEditingMessageId,
        applyEditedMessageLocally,
        encryptForCurrentChat,
        createEncryptForChatSnapshot: (snapshot) => chatEncryptionRuntime.createEncryptForChatSnapshot(snapshot),
        cancelEdit,
        getForwardComposerDraftForChat,
        resolveForwardContactRows,
        forwardMessagesToTargets,
        clearForwardComposerDraft,
        updatePendingFileUploadProgress,
        commitPendingFileUpload,
        setActiveComposerUpload,
        updateActiveComposerUploadProgress,
        clearActiveComposerUpload,
        isRealtimeConnected: () => Boolean(socket.connected),
    });

    function schedulePendingTimeout(clientId, ms = 20000) {
        return composerSendRuntime?.schedulePendingTimeout(clientId, ms);
    }

    function cancelPendingTimeout(clientId) {
        return composerSendRuntime?.cancelPendingTimeout(clientId);
    }

    async function sendTextMessage(message) {
        return composerSendRuntime?.sendTextMessage(message);
    }

    async function sendFileMessage(file, caption = '', options = {}) {
        return composerSendRuntime?.sendFileMessage(file, caption, options);
    }

    async function handleComposerEncryptAndSend(rawContent) {
        return composerSendRuntime?.handleComposerEncryptAndSend(rawContent);
    }
    function updateMessageContent(msgDiv, plainText, isRedecrypt = false) {
        messageMutationHandlers.updateMessageContent(msgDiv, plainText, isRedecrypt);
    }

    function applyEditedMessageLocally(msgId, plainText) {
        messageMutationHandlers.applyEditedMessageLocally(msgId, plainText);
    }

    initChatMediaRuntime({
        formatMediaDuration,
        persistPendingMediaDimensions,
        emitSocket,
        chatTitle,
        chatArea,
        chatMessages,
        voicePlaybackBar,
        voicePlaybackPlayBtn,
        voicePlaybackBackBtn,
        voicePlaybackForwardBtn,
        voicePlaybackSender,
        voicePlaybackDetails,
        voicePlaybackProgress,
        voicePlaybackProgressFill,
        voicePlaybackSpeedBtn,
        voicePlaybackRepeatBtn,
        voicePlaybackVolume,
        voicePlaybackCloseBtn,
        ensureMediaElementHydrated,
        showToast,
        getChatState,
        setChatScrollTop,
        saveChatScrollPosition,
        updateJumpToNewMessagesButton,
        getCurrentChatId: () => currentChatId,
        getKeepChatPinnedToBottom: () => getKeepChatPinnedToBottom(),
    });

    contactPreviewRuntime = createChatContactPreviewRuntime({
        getCurrentChatId: () => currentChatId,
        resolveContactItemByChatId,
        hideSidebarTyping,
        updateActiveContactLastMessageFlow: _updateActiveContactLastMessage,
        sortContactsList,
        contactsSidebarController,
        setContactUnreadBadge,
    });

    function updateActiveContactLastMessage(
        message,
        isSelf = true,
        status = { is_read: false, is_delivered: false },
        timestamp = null
    ) {
        return contactPreviewRuntime?.updateActiveContactLastMessage(message, isSelf, status, timestamp);
    }

    function updateContactLastMessageForChat(
        chatId,
        message,
        isSelf = true,
        status = { is_read: false, is_delivered: false },
        timestamp = null,
    ) {
        return contactPreviewRuntime?.updateContactLastMessageForChat(chatId, message, isSelf, status, timestamp);
    }

    // \u041E\u0431\u043D\u043E\u0432\u043B\u044F\u0435\u0442 \u0441\u0430\u0439\u0434\u0431\u0430\u0440 \u0434\u043B\u044F \u0447\u0430\u0442\u0430, \u043A\u043E\u0442\u043E\u0440\u044B\u0439 \u043D\u0435 \u043E\u0442\u043A\u0440\u044B\u0442 \u0432 \u0434\u0430\u043D\u043D\u044B\u0439 \u043C\u043E\u043C\u0435\u043D\u0442 (\u0431\u0435\u0437 AJAX-\u0437\u0430\u043F\u0440\u043E\u0441\u0430)
    function updateSidebarForOtherChat(
        chatId,
        message,
        isSelf,
        timestamp,
        status = { is_read: false, is_delivered: false }
    ) {
        return contactPreviewRuntime?.updateSidebarForOtherChat(chatId, message, isSelf, timestamp, status);
    }

    attachMenuPanelController = createChatComposerAttachmentsRuntime({
        documentRef: document,
        windowRef: window,
        voiceRecordBtn,
        voiceRecordCancelBtn,
        voiceRecordSendBtn,
        isChatBlocked: () => isChatBlocked(),
        getCurrentBlockState: () => currentBlockState,
        getBlockedNoticeText: getChatBlockNoticeText,
        maxChatMediaSize: MAX_CHAT_MEDIA_SIZE,
        showToast,
        showCaptionModal,
        sendFileMessage: (file, caption = '', options = {}) => sendFileMessage(file, caption, options),
        cancelActiveComposerUpload,
        startVoiceRecording,
        stopVoiceRecording,
        updateVoiceRecordButtonState,
    });

    messageStatusRuntime = createChatMessageStatusRuntime({
        getCurrentChatId: () => currentChatId,
        getChatState,
        getChatMessages: () => chatMessages,
        findMessageIndex,
        applyTickToElement,
        scheduleForcedCurrentChatRerender,
        prefersReducedMotionSetting,
        runBottomInertiaScroll,
        setChatScrollTop,
        isTailRangeRendered,
        cancelBottomInertiaScroll,
        renderChatMessages: (chatId, options) => renderChatMessages(chatId, options),
        setKeepChatPinnedToBottom: (value) => setKeepChatPinnedToBottom(value),
        saveChatScrollPosition,
        updateJumpToNewMessagesButton,
    });

    // \u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0433\u0430\u043B\u043E\u0447\u043A\u0438 (\u043F\u0440\u043E\u0447\u0438\u0442\u0430\u043D\u043E) \u0434\u043B\u044F \u0432\u0441\u0435\u0445 \u0441\u043E\u0431\u0441\u0442\u0432\u0435\u043D\u043D\u044B\u0445 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0439 \u0432 \u0447\u0430\u0442\u0435
    function markAllTicksRead(readAtRaw = '') {
        return messageStatusRuntime?.markAllTicksRead(readAtRaw);
    }

    function markOutgoingVoiceMessageListenedByPartner(chatId, msgId) {
        return messageStatusRuntime?.markOutgoingVoiceMessageListenedByPartner(chatId, msgId);
    }

    function updateE2EIndicator() {
        syncE2EPillState();
    }

    function isCurrentChatGroup() {
        if (!currentChatId) return false;
        const activeItem = resolveContactItemByChatId(currentChatId);
        if (activeItem) {
            return String(activeItem.getAttribute('data-is-group') || '') === '1';
        }
        const partnerData = window.currentPartnerData || {};
        if (String(partnerData.chat_id || '') === String(currentChatId)) {
            return Boolean(partnerData._group_profile);
        }
        return false;
    }

    function setSendingState(isSending) {
        isSendingMessage = Boolean(isSending);
        const blocked = isChatBlocked();
        messageInput.disabled = isSending || blocked;
        if (sendMessageBtn) sendMessageBtn.disabled = isSending || blocked;
        if (sendMessageBtnMobile) sendMessageBtnMobile.disabled = isSending || blocked;
        updateVoiceRecordButtonState();
    }

    function isEncryptedPayload(value) {
        return chatEncryptionRuntime?.isEncryptedPayload(value) || false;
    }

    async function decryptForDisplay(privateKeyPem, encryptedPayload, isSelf) {
        return chatEncryptionRuntime
            ? chatEncryptionRuntime.decryptForDisplay(privateKeyPem, encryptedPayload, isSelf)
            : encryptedPayload;
    }

    // \u041F\u0440\u043E\u043A\u0440\u0443\u0442\u043A\u0430 \u0447\u0430\u0442\u0430 \u0432\u043D\u0438\u0437
    function scrollToBottom({ smooth = true } = {}) {
        return messageStatusRuntime?.scrollToBottom({ smooth });
    }

    // Message status/edit ingress handlers are registered via extracted modules.

    registerRealtimeOrchestrator({
        socket,
        registerMessageStatusSocketHandlers,
        registerIncomingMessageSocketHandlers,
        registerProfileRealtimeSocketHandlers,
        registerSystemSocketHandlers,
        markOutgoingVoiceMessageListenedByPartner,
        messageStatusOptions: {
            socket,
            isBlockedChat,
            removeChatMessages,
            getCurrentChatId: () => currentChatId,
            rerenderCurrentChat: () => {
                if (!currentChatId) return;
                renderChatMessages(currentChatId, { force: true, scrollTop: chatMessages.scrollTop });
            },
            loadContacts,
            getChatState,
            findMessageIndex,
            cancelPendingTimeout,
            getMessageKey,
            normalizeChatMessageOrder,
            currentChatMessagesEl: chatMessages,
            applyTickToElement,
            formatTime,
            formatFullTimestamp,
            patchMessageReactions,
            updateSidebarContactTick: _updateSidebarContactTick,
            getContactsRoot: () => contactsList || document,
            markAllTicksRead,
            isGroupChatById: (chatId) => {
                const normalizedChatId = String(chatId || '').trim();
                if (!normalizedChatId) return false;
                if (String(currentChatId || '') === normalizedChatId && window.currentPartnerData?._group_profile) {
                    return true;
                }
                const contactItem = resolveContactItemByChatId(normalizedChatId);
                return contactItem?.getAttribute('data-is-group') === '1';
            },
        },
        incomingOptions: {
            socket,
            isBlockedChat,
            getCurrentChatId: () => currentChatId,
            currentUserPublicKey,
            getPrivateKeyPem,
            decryptForDisplay,
            getChatState,
            findMessageIndex,
            cancelPendingTimeout,
            normalizeChatMessageOrder,
            updateActiveContactLastMessage,
            isChatNearBottom,
            isWindowActiveForUnreadHandling,
            getCurrentChatScrollTop: () => chatMessages.scrollTop,
            getCurrentChatScrollHeight: () => chatMessages.scrollHeight,
            appendMessage,
            isEncryptedPayload,
            normalizeMessageReactions,
            getCurrentPartnerDisplayName: () => window.currentPartnerData?.display_name || '\u0421\u043E\u0431\u0435\u0441\u0435\u0434\u043D\u0438\u043A',
            markCurrentChatSeenIfPossible,
            markOutgoingReadByPartnerMessage: ({ chatId, messageCreatedAt } = {}) => {
                const normalizedChatId = String(chatId || '').trim();
                if (!normalizedChatId) return;
                if (String(normalizedChatId) !== String(currentChatId || '')) return;
                if (isCurrentChatGroup()) return;
                markAllTicksRead(messageCreatedAt);
                _updateSidebarContactTick(normalizedChatId, 'read', contactsList || document);
            },
            setKeepChatPinnedToBottom: (value) => setKeepChatPinnedToBottom(value),
            incrementOpenChatUnreadCount: () => { openChatUnreadCount += 1; },
            updateJumpToNewMessagesButton,
            setContactUnreadBadge: (chatId) => setContactUnreadBadge(chatId, openChatUnreadCount),
            upsertChatMessage,
            updateSidebarForOtherChat,
            showToast,
            updateMessageContent,
            rerenderCurrentChat: () => {
                if (!currentChatId) return;
                scheduleForcedCurrentChatRerender();
            },
            resolveMessageElement: (msgId) => document.querySelector(`.message[data-msg-id="${msgId}"]`),
            getMessageKey,
            confirmPendingMessageDom,
            loadContacts,
            isChatMuted,
            enrichVisualMediaMessage: enrichVisualMediaMessageText,
            getCurrentUserId: () => CURRENT_USER_ID,
            getCurrentUsername: () => currentUsername,
            notifyIncomingMessage: ({ chatId, isCurrentChat, isMention = false }) => {
                notifyIncomingChatMessage({
                    chatId,
                    isCurrentChat,
                    isMention,
                    isChatMuted,
                    isWindowActive: isWindowActiveForUnreadHandling,
                    pushTabAlert: (targetChatId) => tabAlertController.pushAlert(targetChatId),
                    showToast,
                    newMessageToastText: '\u041D\u043E\u0432\u043E\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435',
                    mentionToastText: '\u0412\u0430\u0441 \u0443\u043F\u043E\u043C\u044F\u043D\u0443\u043B\u0438',
                });
            },
            onIncomingRawMessage: ({ chatId, rawMessage }) => {
                const encryptedRawMessage = buildEncryptedCacheMessageFromSocketPayload(rawMessage);
                if (!encryptedRawMessage) return;
                appendEncryptedMessagesToCache(chatId, [encryptedRawMessage]).catch(() => {});
                pruneCachedChatsWithPolicy(100);
            },
            prewarmMessageLinkPreview: scheduleMessageLinkPreviewPrewarm,
        },
        profileOptions: {
            socket,
            escapeHtml,
            updateOnlineStatusUI,
            renderProfileHeader,
            renderProfileBio: _renderProfileBio,
            getCurrentContactPublicKey: () => window.currentContactPublicKey,
            getCurrentPartnerData: () => window.currentPartnerData,
            setCurrentPartnerData: (value) => { window.currentPartnerData = value; },
            getPartnerProfileDrawer: () => partnerProfileDrawer,
            chatTitleEl: chatTitle,
            resolveChatPartnerAvatar: () => chatPartnerAvatar,
            rerenderCurrentChat: () => {
                if (currentChatId && chatMessages) {
                    scheduleForcedCurrentChatRerender();
                }
            },
            resolveContactItemByPublicKey,
            resolveSidebarAvatarCircle: () => sidebarAvatarCircle,
            resolveSidebarDisplayName: () => sidebarDisplayName,
            resolveSidebarUsername: () => sidebarUsername,
            setCurrentUserIdentity: ({ displayName, username, avatarUrl }) => {
                currentDisplayName = displayName;
                currentUsername = username;
                currentAvatarUrl = String(avatarUrl || '').trim();
                syncCurrentUserIdentityLegacyGlobals();
            },
            isSavedContactItem: (contactItem) => savedMessagesUi?.isSavedContactItem?.(contactItem) === true,
        },
        systemOptions: {
            socket,
            escapeHtml,
            loadContacts,
            getCurrentChatId: () => currentChatId,
            closeChatUI,
            showToast,
            resolveContactItemByChatId,
            hideSidebarTyping,
            chatStates,
            chatScrollPositions,
            dialogRequestsList,
            dialogRequestsSection,
            updateDialogRequestsBadge,
            clearPendingReactionOp,
            applyChatBlockState,
            updateContact,
            sortContactsList,
            getCurrentBlockState: () => currentBlockState,
            resolveContactItemByPublicKey,
            getCurrentContactPublicKey: () => window.currentContactPublicKey,
            getCurrentContactId: () => currentContactId,
            getChatState,
            normalizeBlockState,
            emitSocket,
            hideTyping,
            isDialogRequestsMuted,
            dropChatCache,
            onChatDraftUpdated: handleRealtimeChatDraftUpdated,
            refreshCurrentGroupProfileIfVisible,
        },
    });

    function updateDialogRequestsBadge() {
        contactsSidebarController.updateDialogRequestsBadge(dialogRequestsList, dialogRequestsSection);
    }

    function reconcileContactsList(serverContacts) {
        contactsSidebarController.reconcileContactsList(serverContacts);
    }

    function loadContactsNow(options = {}) {
        return contactsSidebarController.loadContactsNow(options);
    }

    // \u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430 \u0441\u043F\u0438\u0441\u043A\u0430 \u043A\u043E\u043D\u0442\u0430\u043A\u0442\u043E\u0432 (debounce + \u0437\u0430\u0449\u0438\u0442\u0430 \u043E\u0442 \u043F\u0430\u0440\u0430\u043B\u043B\u0435\u043B\u044C\u043D\u044B\u0445 \u0437\u0430\u043F\u0440\u043E\u0441\u043E\u0432)
    function loadContacts(options = {}) {
        return contactsSidebarController.loadContacts(options);
    }

    syncAllContactsMuteState();
    syncMuteButton();
    const hasSsrContacts = Boolean(contactsList?.querySelector('.contact-item[data-chat-id]'));
    const hasMoreInitialContacts = String(
        contactsList?.dataset?.hasMoreInitialContacts || '0',
    ) === '1';
    const hasPendingEncryptedPreview = Boolean(
        contactsList?.querySelector('.contact-last-msg-loading'),
    );
    if (hasSsrContacts) {
        sortContactsList();
        hideAppBootOverlay();
    } else {
        loadContacts({
            limit: CONTACTS_BOOTSTRAP_SYNC_LIMIT,
            attemptInitialChatRestore: false,
        });
    }
    if (!hasSsrContacts || hasMoreInitialContacts || hasPendingEncryptedPreview) {
        scheduleNonCriticalTask(() => {
            loadContacts({ immediate: true });
        }, CONTACTS_FULL_SYNC_IDLE_TIMEOUT_MS);
    }

    async function updateContact(contact) {
        return contactsSidebarController.updateContact(contact);
    }

    // \u041E\u0442\u043C\u0435\u0442\u0438\u0442\u044C \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F \u043A\u0430\u043A \u043F\u0440\u043E\u0447\u0438\u0442\u0430\u043D\u043D\u044B\u0435 (REST fallback)
    function markMessagesAsRead(chatId) {
        return markMessagesAsReadBridge({
            chatId,
            markMessagesAsReadFlow,
            isBlockedChat,
            getCsrfToken,
            onSuccess: loadContacts,
        });
    }

    // \u041E\u043D\u043B\u0430\u0439\u043D-\u0441\u0442\u0430\u0442\u0443\u0441 \u0441\u043E\u0431\u0435\u0441\u0435\u0434\u043D\u0438\u043A\u0430
    function loadOnlineStatus(userId) {
        return loadOnlineStatusBridge({
            userId,
            onlineStatusController,
            loadOnlineStatusFlow,
            isBlockedChat: () => isChatBlocked(),
            updateOnlineStatusUI,
            markOnlineStatusPending,
            clearOnlineStatusPending,
            getCurrentContactId: () => currentContactId,
            getCurrentPartnerData: () => window.currentPartnerData,
            getCurrentBlockState: () => currentBlockState,
            normalizeBlockState,
            setCurrentPartnerData: (value) => { window.currentPartnerData = value; },
        });
    }

    // \u041E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0430 \u043E\u0442\u043A\u0440\u044B\u0442\u0438\u044F \u043F\u0440\u043E\u0444\u0438\u043B\u044F \u043F\u0440\u0438 \u043A\u043B\u0438\u043A\u0435 \u043D\u0430 \u0448\u0430\u043F\u043A\u0443 \u0447\u0430\u0442\u0430
    // (\u041B\u043E\u0433\u0438\u043A\u0430 \u043F\u0435\u0440\u0435\u043D\u0435\u0441\u0435\u043D\u0430 \u0432 loadAndShowPartnerProfile \u0432\u044B\u0448\u0435)

    bindPartnerBlockControls({
        blockPartnerBtn,
        chatUnblockBtn,
        getCurrentPartnerData: () => window.currentPartnerData,
        getCurrentBlockState: () => currentBlockState,
        getCsrfToken,
        normalizeBlockState,
        applyChatBlockState,
        getCurrentChatId: () => currentChatId,
        resolveCurrentChatItem: () => currentChatId
            ? resolveContactItemByChatId(currentChatId)
            : null,
        closePartnerProfileDrawer,
        showToast,
        confirmDialog: showConfirmDialog,
    });

    var chatHistoryRuntime;
    function getChatHistoryRuntime() {
        if (chatHistoryRuntime) return chatHistoryRuntime;
        chatHistoryRuntime = createChatHistoryRuntime({
            chatHistoryPageSize: CHAT_HISTORY_PAGE_SIZE,
            chatHistoryMaxPageSize: CHAT_HISTORY_MAX_PAGE_SIZE,
            chatDecryptWorkerTimeoutMs: CHAT_DECRYPT_WORKER_TIMEOUT_MS,
            chatDecryptConcurrency: CHAT_DECRYPT_CONCURRENCY,
            chatMessagesEl: chatMessages,
            isMobileViewport: () => isMobileViewport(),
            getCurrentChatId: () => currentChatId,
            getCurrentUserPublicKey: () => currentUserPublicKey,
            getCurrentPartnerData: () => window.currentPartnerData,
            getPrivateKeyPem,
            isEncryptedPayload,
            decryptForDisplay,
            normalizeMessageReactions,
            enrichDecodedMessagesVisualMeta,
            normalizePinnedMessages,
            normalizeFavoriteMessages,
            setPinnedBarMessages,
            setFavoriteBarMessages,
            hidePinnedBar,
            hideFavoriteBar,
            getChatState,
            setChatMessages,
            upsertChatMessage,
            prependChatMessages,
            getMessageKey,
            applyChatBlockState,
            resetOpenChatUnreadCounter,
            showChatContent,
            setChatStageLoading,
            setHistoryLoading,
            restoreChatDomSnapshot,
            schedulePostRenderUiRefresh,
            resolveSavedChatScrollTop,
            renderChatMessages,
            renderChatAtBottom,
            renderChatMessagesStable,
            triggerChatHistoryRevealAnimation,
            isChatNearBottom,
            getKeepChatPinnedToBottom: () => getKeepChatPinnedToBottom(),
            setKeepChatPinnedToBottom: (value) => setKeepChatPinnedToBottom(value),
            ensureChatIdbReady,
            isChatIdbReady,
            readCachedMessages: (chatId) => ChatIdb.readCachedMessages(chatId),
            writeCachedMessages: (chatId, messages, meta) => ChatIdb.writeCachedMessages(chatId, messages, meta),
            pruneCachedChats: (limit) => pruneCachedChatsWithPolicy(limit),
            appendEncryptedMessagesToCache,
            showToast,
            normalizeBlockState,
            setChatPinnedMessages,
            setChatFavoriteMessages,
            resolveContactItemByChatId,
            fetchImpl: window.authFetch || window.fetch?.bind(window),
            resolveAppUrl: withAppRoot,
            decryptWorkerUrl: withAppRoot('/static/workers/decrypt-worker.js'),
            createHistoryAbortController,
            releaseHistoryAbortController,
            historyInitialAbortControllers,
            historyOlderAbortControllers,
            isAbortError,
        });
        return chatHistoryRuntime;
    }

    function decodeChatMessages(rawMessages) {
        return getChatHistoryRuntime().decodeChatMessages(rawMessages);
    }

    function restorePinnedBar(pins, options = {}) {
        return getChatHistoryRuntime().restorePinnedBar(pins, options);
    }

    function restoreFavoriteBar(favorites, options = {}) {
        return getChatHistoryRuntime().restoreFavoriteBar(favorites, options);
    }

    function fetchChatHistory(chatId) {
        return getChatHistoryRuntime().fetchChatHistory(chatId);
    }

    function loadOlderMessages(chatId) {
        return getChatHistoryRuntime().loadOlderMessages(chatId);
    }

    chatSearchRuntime = createChatSearchRuntime({
        documentRef: document,
        windowRef: window,
        setTimeoutFn: setTimeout,
        requestAnimationFrameFn: requestAnimationFrame,
        contactsList,
        chatsSearchHint,
        paletteFrequentSection,
        paletteFrequentChats,
        paletteLocalSection,
        paletteLocalResults,
        commandPaletteActions,
        modalSearchInput,
        modalSearchResults,
        modalEl: newChatModal,
        withAppRoot,
        fetchImpl: fetch,
        decodeChatMessages: (messages) => decodeChatMessages(messages),
        closeAnimatedDialog,
        openAnimatedDialog,
        showToast,
        sendDialogRequest,
        openGroupCreateModal: () => openGroupCreateModal(),
        loadContacts: (options) => loadContacts(options),
        resolveContactItemByChatId,
        resolveContactItemByUserId,
        escapeHtml,
        applyFallbackAvatarTint,
        formatLastSeenText,
    });

    function setChatsSearchHintVisible(visible) {
        return chatSearchRuntime?.setChatsSearchHintVisible(visible);
    }

    function renderFrequentChats() {
        return chatSearchRuntime?.renderFrequentChats();
    }

    function renderPaletteLocalMatches(query) {
        return chatSearchRuntime?.renderPaletteLocalMatches(query);
    }

    function openPaletteChat(chatId) {
        return chatSearchRuntime?.openPaletteChat(chatId);
    }

    function buildSearchResultsLoaderHtml() {
        return chatSearchRuntime?.buildSearchResultsLoaderHtml() || '';
    }

    function normalizeSearchUser(user) {
        return chatSearchRuntime?.normalizeSearchUser(user) || null;
    }

    async function openChatByIdWhenReady(chatId) {
        return chatSearchRuntime?.openChatByIdWhenReady(chatId);
    }

    function openCommandPaletteModal() {
        return chatSearchRuntime?.openCommandPaletteModal();
    }

    bindGroupModerationUiHandlers({
        groupEditMembersList,
        profileGroupMembers,
        updateGroupMemberRole: (targetUserId, role) => updateGroupMemberRole(targetUserId, role, {
            onLocalRoleUpdated: (updatedUserId, nextRole) => {
                groupProfileRuntime?.updateLocalMemberRole(updatedUserId, nextRole);
            },
        }),
        removeGroupMember,
        applyGroupMemberSanction,
        submitGroupSanctionAppeal,
        onGroupMemberClick: (targetUserId) => {
            if (messageSelectionController.isSelectionMode()) return;
            openUserProfileById(targetUserId);
        },
    });

    exposeChatRuntimeLegacyGlobalsBridge({
        syncSidebarStatusBar,
        openCommandPaletteModal,
    });

    // ===================================================


    // \u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0439
    // Controller for message edit state and edit window validation.
    // NOTE: var-hoisted, \u0447\u0442\u043E\u0431\u044B \u043E\u0431\u0451\u0440\u0442\u043A\u0438 \u043D\u0438\u0436\u0435 \u043C\u043E\u0433\u043B\u0438 \u0431\u044B\u0442\u044C \u0432\u044B\u0437\u0432\u0430\u043D\u044B \u0434\u043E \u044D\u0442\u043E\u0439 \u0441\u0442\u0440\u043E\u043A\u0438
    // \u0432\u043E \u0432\u0440\u0435\u043C\u044F \u0438\u043D\u0438\u0446\u0438\u0430\u043B\u0438\u0437\u0430\u0446\u0438\u0438 (\u0438\u043D\u0430\u0447\u0435 TDZ \u043B\u043E\u043C\u0430\u0435\u0442 \u0432\u0441\u044E \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443).
    var messageEditController = createMessageEditController({
        getCurrentChatId: () => currentChatId,
        getChatState,
        findMessageIndex,
        parseUtcDate,
        formatFullTimestamp,
        contextReadInfo,
        contextReadInfoText,
        showToast,
        getReplyState,
        cancelReply,
        getIsEditingMessageId: () => isEditingMessageId,
        setIsEditingMessageId: (value) => { isEditingMessageId = value; },
        messageInput,
        resizeComposerInput,
        resetHorizontalViewportDrift,
        updateVoiceRecordButtonState,
        waitForMotionEnd,
    });

    function getEditingFilePayload() {
        return messageEditController?.getEditingFilePayload();
    }

    function resolveMessageCreatedAt(...args) {
        return messageEditController?.resolveMessageCreatedAt(...args);
    }

    function resolveMessageReadMeta(...args) {
        return messageEditController?.resolveMessageReadMeta(...args);
    }

    function updateContextMenuReadInfo(...args) {
        return messageEditController?.updateContextMenuReadInfo(...args);
    }

    function formatContextMenuReadAt(...args) {
        return messageEditController?.formatContextMenuReadAt(...args);
    }

    function isWithinMessageEditWindow(...args) {
        return messageEditController?.isWithinMessageEditWindow(...args);
    }

    function canEditMessageById(...args) {
        return messageEditController?.canEditMessageById(...args);
    }

    function startEditMessage(...args) {
        return messageEditController?.startEditMessage(...args);
    }

    function cancelEdit(...args) {
        return messageEditController?.cancelEdit(...args);
    }
    function showContextMenu(x, y, msgId, isSelf, isFile, options = {}) {
        void isFile;
        messageContextMenuController?.showContextMenu(x, y, msgId, isSelf, options);
    }

    function hideContextMenu() {
        messageContextMenuController?.hideContextMenu();
    }

    function toggleSelectionMode(on) {
        messageSelectionController.setSelectionMode(on);
    }

    function toggleMessageSelection(msgId, element) {
        messageSelectionController.toggleMessageSelection(msgId, element);
    }

    bindChatEscapeOverlaysRuntime({
        documentRef: document,
        isReactionPickerOpen: () => reactionPickerController.isOpen(),
        closeReactionPicker,
        isAttachMenuOpen,
        closeAttachMenu,
        hasPendingCaptionFile: () => captionModalController.hasPendingFile(),
        closeCaptionModal,
        getLightbox: () => document.getElementById('lightbox'),
        closeLightbox: () => _closeLightbox(),
        closeMessageSearchOverlay,
        isSelectionMode: () => messageSelectionController.isSelectionMode(),
        toggleSelectionMode,
        isEditingMessage: () => Boolean(isEditingMessageId),
        cancelEdit,
        getReplyState,
        cancelReply,
    });
    const messageTouchContextController = initMessageTouchContext({
        chatMessages,
        reactionPicker,
        contextMenu,
        messageSelectionController,
        closeReactionPicker,
        hideContextMenu,
        closeMessageActionsBar,
        isEditingMessageId: () => isEditingMessageId,
        showContextMenu,
        canEditMessageById,
        isChatBlocked,
        updateContextMenuReadInfo,
        contextReactionDivider,
        contextReadInfo,
        contextPinItem,
        contextFavoriteItem,
        isPinnedMessage,
        isFavoriteMessage,
        getCurrentChatId: () => currentChatId,
        messageActionsBarController,
        openReactionPickerForMessage,
        positionReactionPicker,
        startReply,
        getCurrentPartnerDisplayName: () => window.currentPartnerData?.display_name || '\u0421\u043E\u0431\u0435\u0441\u0435\u0434\u043D\u0438\u043A',
        showToast,
        getChatBlockNoticeText,
        getCurrentBlockState: () => currentBlockState,
        emitReactionToggle,
        reactionPickerEmojis: REACTION_PICKER_EMOJIS,
    });

    // Selection Mode Logic

    ({ openDeleteModal } = initChatMessageActionsRuntime({
        documentRef: document,
        deleteConfirmModal,
        cancelDeleteBtn,
        confirmDeleteBtn,
        deleteForBothCheck,
        deleteForBothWrap,
        deleteModalTitle,
        barCopyBtn,
        barEditBtn,
        barDeleteBtn,
        barSelectBtn,
        cancelSelectionBtn,
        bulkDeleteBtn,
        bulkForwardBtn,
        bulkCopyBtn,
        barCancelBtn,
        chatMessages,
        isChatBlocked,
        getBlockedNoticeText: getChatBlockNoticeText,
        getCurrentBlockState: () => currentBlockState,
        getCurrentChatId: () => currentChatId,
        emitSocket,
        openDialog: openAnimatedDialog,
        closeDialog: closeAnimatedDialog,
        messageSelectionController,
        messageActionsBarController,
        copyTextToClipboard,
        showToast,
        startEditMessage,
        toggleSelectionMode,
        openForwardModal,
        toggleMessageSelection,
        closeMessageActionsBar,
    }));

    const unbindWindowActivityEvents = bindWindowActivityEvents({
        reportActivity,
        onFocus: () => {
            tabAlertController.clearAllAlerts();
            if (currentChatId && isChatNearBottom() && isWindowActiveForUnreadHandling()) {
                if (openChatUnreadCount > 0) {
                    resetOpenChatUnreadCounter({ markSeen: true });
                } else {
                    markCurrentChatSeenIfPossible();
                }
            }
        },
    });
    const unbindVisibilityEvents = wireWindowActivityEvents({
        reportActivity,
        tabAlertController,
        isChatNearBottom,
        isWindowActiveForUnreadHandling,
        getCurrentChatId: () => currentChatId,
        getOpenChatUnreadCount: () => openChatUnreadCount,
        resetOpenChatUnreadCounter,
        markCurrentChatSeenIfPossible,
    });

    const {
        refreshPrivateKeyDependentUi,
        refreshLocalizedRuntimeUi,
    } = initPrivateKeyUiRefresh({
        chatMessages,
        getPrivateKeyPem,
        getCurrentChatId: () => currentChatId,
        getChatState,
        isEncryptedPayload,
        decryptForDisplay,
        setChatMessages,
        getMessageKey,
        renderChatMessagesStable,
        restorePinnedBar,
        updateE2EIndicator,
        loadContacts,
        syncSidebarStatusBar,
        formatDaySeparatorLabel,
        dateNavigatorController,
        isProfileDrawerOpen,
        scheduleProfileMediaPanelRefresh,
    });

    // Re-decrypt active chat and sidebar previews after key is restored mid-session.
    exposeChatRuntimeLegacyGlobalsBridge({
        syncSidebarStatusBar,
        openCommandPaletteModal,
        startEditMessage,
        showContextMenu,
        toggleSelectionMode,
        refreshPrivateKeyDependentUi,
    });
    bindChatRuntimeWindowEvents({
        windowRef: window,
        consoleRef: console,
        refreshPrivateKeyDependentUi,
        refreshLocalizedRuntimeUi,
        loadContacts,
        syncChatConnectionStatus,
    });

    wireBeforeUnloadCleanup({
        tabAlertController,
        dateNavigatorController,
        reportActivity,
        activityController,
        unbindWindowActivityEvents: () => {
            unbindWindowActivityEvents();
            unbindVisibilityEvents();
            disposeMobileBackSwipe();
            messageTouchContextController.dispose();
        },
        voiceRecorderController,
        disposeChatAnimations: () => chatAnimationsController?.dispose(),
        isChatIdbReady,
        chatIdbRuntime,
        getExistingChatHistoryRuntime: () => chatHistoryRuntime,
        disposeMediaCacheRuntime,
        disconnectSocket: () => {
            try {
                socket.disconnect();
            } catch (_) {}
        },
    });

};
