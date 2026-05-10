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
import { REACTION_PICKER_EMOJIS as _REACTION_PICKER_EMOJIS, normalizeReactionReactor as _normalizeReactionReactor, getReactionReactorKey as _getReactionReactorKey, normalizeReactionReactors as _normalizeReactionReactors, isCurrentUserReactionReactor as _isCurrentUserReactionReactor, buildCurrentUserReactionReactor as _buildCurrentUserReactionReactor, buildReactionReactorInitials as _buildReactionReactorInitials, buildReactionReactorsHtml as _buildReactionReactorsHtml, normalizeMessageReactions as _normalizeMessageReactions, areMessageReactionsEqual as _areMessageReactionsEqual, getReactionMessageKey as _getReactionMessageKey, computeOptimisticReactions as _computeOptimisticReactions, buildMessageReactionsHtml as _buildMessageReactionsHtml } from './modules/reactions.js';
import { initComposer as _initComposer } from './modules/composer.js';
import { buildContactItemHtml as _buildContactItemHtml, hydrateContactAvatarLoading as _hydrateContactAvatarLoading, updateSidebarContactTick as _updateSidebarContactTick, updateActiveContactLastMessage as _updateActiveContactLastMessage } from './modules/contacts.js';
import { applyBlockNoticeUI as _applyBlockNoticeUI, normalizeBlockState as _normalizeBlockState } from './modules/block-ui.js';
import { getStoredString, setStoredString, hideBootOverlay as _hideBootOverlay, setElementActiveState, openFloatingPanel, closeFloatingPanel, openAnimatedDialog, closeAnimatedDialog, copyTextToClipboard, addTapFeedback } from './modules/chat-shell-ui.js';
import { createChatMutePreferences } from './modules/chat-mute-preferences.js';
import { notifyIncomingChatMessage } from './modules/chat-incoming-notifications.js';
import { renderMessageTextWithMentions } from './modules/chat-mentions.js';
import { markCurrentChatSeenIfPossible as markCurrentChatSeenFlow } from './modules/chat-seen-flow.js';
import { isWindowActiveForUnreadHandling } from './modules/chat-window-activity.js';
import { createChatMuteUiController } from './modules/chat-mute-ui.js';
import { syncProfileMoreMenuChatActions as syncProfileMoreMenuChatActionsFlow } from './modules/chat-profile-menu-actions.js';
import { createProfileMoreMenuController } from './modules/chat-profile-menu-ui.js';
import { createProfileMediaPanelController } from './modules/chat-profile-media-panel.js';
import { getCurrentGroupMediaAvailability, resolveGroupTabByAvailability, syncGroupTabVisibility } from './modules/chat-group-profile-tabs.js';
import { loadAndShowPartnerProfileFlow } from './modules/chat-profile-loader.js';
import {
    resolveCurrentPartnerId as resolveCurrentPartnerIdFlow,
    handleProfileHeaderOpen as handleProfileHeaderOpenFlow,
} from './modules/chat-profile-open.js';
import { applyChatBlockStateFlow } from './modules/chat-block-state-controller.js';
import {
    getChatBlockNoticeText as getChatBlockNoticeTextFlow,
    updateBlockButtons as updateBlockButtonsFlow,
} from './modules/chat-block-ui.js';
import { createVoiceRecorderControls } from './modules/chat-voice-controls.js';
import { createLastActiveChatController } from './modules/chat-last-active-chat.js';
import { createSidebarStatusController } from './modules/chat-sidebar-status-controller.js';
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
import { initSidebarBrandQuickActions } from './modules/sidebar-brand-quick-actions.js';
import { initSearchOverlayGlobalContent } from './modules/search-overlay-global-content.js';
import { createSavedMessagesUiController } from './modules/saved-messages-ui.js';
import { renderContactsDirectoryList } from './modules/chat-contacts-directory.js';
import { initContactContextMenu, initDeleteMessagesModal } from './modules/chat-overlays.js';
import { updatePinIcon as _updatePinIcon, applyPinnedState as _applyPinnedState, sortContactsList as _sortContactsList, initPinnedContactsDnD } from './modules/pinned-contacts.js';
import { initCaptionModal } from './modules/caption-modal.js';
import { initMessageActionsBar } from './modules/message-actions-bar.js';
import { initMessageSelection } from './modules/message-selection.js';
import { initMessageContextMenu } from './modules/message-context-menu.js';
import { initReactionPickerController } from './modules/reaction-picker.js';
import { initReplyBar, initPinnedBar } from './modules/message-thread-banners.js';
import { initLinkDraftBar } from './modules/link-draft-banner.js';
import { scheduleMessageLinkPreviewPrewarm } from './modules/link-preview-prewarm.js';
import { initMessageActionHandlers } from './modules/message-action-handlers.js';
import { initChatDateNavigator } from './modules/chat-date-navigator.js';
import { sendFileMessageFlow } from './modules/chat-file-send.js';
import { createTypingSignalHeartbeat } from './modules/chat-typing-signal-heartbeat.js';
import { sendTextMessageFlow } from './modules/chat-text-send.js';
import { handleComposerEditFlow } from './modules/chat-edit-flow.js';
import { registerMessageStatusSocketHandlers } from './modules/chat-message-status-events.js';
import { registerIncomingMessageSocketHandlers } from './modules/chat-incoming-message-events.js';
import { registerRealtimeUiSocketHandlers } from './modules/chat-realtime-ui-events.js';
import { registerProfileRealtimeSocketHandlers } from './modules/chat-profile-realtime-events.js';
import { registerSystemSocketHandlers } from './modules/chat-system-events.js';
import {
    normalizeGroupRole,
    groupRoleLabel,
    formatGroupSanctionSummary,
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
import { createTabAlertController } from './modules/chat-tab-alerts.js';
import { showConfirmDialog } from './modules/confirm-dialog.js';
import { initVoiceRecorder } from './modules/voice-recorder.js';
import { getPrivateKeyPem, restoreWrappedPrivateKey } from './modules/private-key-session.js';
import { createChatSocketClient, createSocketEmitter } from './modules/chat-socket-client.js';
import { getCsrfToken } from './modules/csrf.js';
import * as ChatIdb from './modules/chat-idb.js';
import { buildEncryptedCacheMessageFromSocketPayload, createChatIdbRuntime } from './modules/chat-idb-runtime.js';
import { applyDataMemoryPolicy } from './modules/chat-cache-manager.js';
import { readDataMemoryStore } from './modules/chat-cache-policy.js';
import { createOutboxRuntime } from './modules/chat-outbox.js';
import { mountOutboxPill } from './modules/chat-outbox-ui.js';
import { createChatHistoryRuntime, mapWithConcurrency } from './modules/chat-history-runtime.js';
import { bindWindowActivityEvents, createActivityReporter } from './modules/chat-activity.js';
import { initKeyboardShortcuts } from './modules/keyboard-shortcuts.js';
import { initAttachMenuPortal } from './modules/attach-menu-portal.js';
import {
    applyListPerfGuard,
    initMotionRuntime,
    initTelegramRipple,
    waitForMotionEnd,
} from './modules/motion.js';
import { createVisualViewportCssSyncer } from './modules/mobile-viewport.js';
import { initPrivateKeyUiRefresh } from './modules/private-key-ui-refresh.js';
import { createMediaHydrationController } from './modules/media-hydration.js';
import { createChatMessageMutations } from './modules/chat-message-mutations.js';
import { initChatMediaRuntime, formatAudioPlayerTime, hasProvidedWaveformPayload } from './modules/chat-media-runtime.js';
import { createChatMediaCacheRuntime } from './modules/chat-media-cache-runtime.js';
import { createChatForwardFlow } from './modules/chat-forward-flow.js';
import { createChatDraftsController } from './modules/chat-drafts.js';
import { createChatReportFlow } from './modules/chat-report-flow.js';
import { createChatMediaMetaController } from './modules/chat-media-meta.js';
import { createChatGroupCreateController } from './modules/chat-group-create.js';
import { createChatGroupEditController } from './modules/chat-group-edit.js';
import { createChatGroupPermissionsController } from './modules/chat-group-permissions.js';
import { createChatAttachMenuController } from './modules/chat-attach-menu.js';
import { createComposerUploadState } from './modules/chat-composer-upload-state.js';
import { createChatAnimationsController } from './modules/chat-animations.js';
import { initChatClipboardAndDrop } from './modules/chat-clipboard-drop.js';
import { initWebPush } from './modules/web-push.js';
import { initChatBootstrap } from './chat/bootstrap.js';
import { createSidebarShell } from './chat/sidebar-shell.js';
import { syncE2EPillState as syncE2EPillStateFlow } from './chat/e2e-flows.js';
import { createThreadShell, createMobileThreadShell } from './chat/thread-shell.js';
import { createChatStateShell } from './chat/chat-state-shell.js';
import { initMobileBackSwipe } from './chat/mobile-back-swipe.js';
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
const initChatPage = async () => {
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
        bootstrapUser.currentDisplayName = currentDisplayName;
        bootstrapUser.currentUsername = currentUsername;
        bootstrapUser.currentAvatarUrl = currentAvatarUrl;
        window.currentDisplayName = currentDisplayName;
        window.currentUsername = currentUsername;
        window.currentAvatarUrl = currentAvatarUrl;
    }
    syncCurrentUserIdentityLegacyGlobals();
    const chatIdbRuntime = createChatIdbRuntime({
        chatIdb: ChatIdb,
        currentUserId: CURRENT_USER_ID,
    });
    const isChatIdbReady = () => chatIdbRuntime.isReady();
    const ensureChatIdbReady = () => chatIdbRuntime.ensureReady();
    function appendEncryptedMessagesToCache(chatId, messages) {
        return chatIdbRuntime.appendEncryptedMessages(chatId, messages);
    }
    function syncDeletedMessagesToCache(chatId, ids) {
        chatIdbRuntime.syncDeletedMessages(chatId, ids);
    }
    function dropChatCache(chatId) {
        chatIdbRuntime.dropChatCache(chatId);
    }
    window.clearChatHistoryCacheOnLogout = () => chatIdbRuntime.clearOnLogout();
    let cachePolicyTimerId = 0;
    let cachePolicyInFlight = false;
    let cachePolicyQueued = false;

    async function runDataMemoryPolicyNow() {
        if (cachePolicyInFlight) {
            cachePolicyQueued = true;
            return;
        }
        cachePolicyInFlight = true;
        try {
            await applyDataMemoryPolicy({
                userId: CURRENT_USER_ID,
                preferences: readDataMemoryStore(),
            });
        } catch (_) {
            // Ignore background policy errors.
        } finally {
            cachePolicyInFlight = false;
            if (cachePolicyQueued) {
                cachePolicyQueued = false;
                window.setTimeout(() => {
                    runDataMemoryPolicyNow().catch(() => {});
                }, 120);
            }
        }
    }

    function scheduleDataMemoryPolicy(delayMs = 900) {
        if (cachePolicyTimerId) {
            window.clearTimeout(cachePolicyTimerId);
        }
        cachePolicyTimerId = window.setTimeout(() => {
            cachePolicyTimerId = 0;
            runDataMemoryPolicyNow().catch(() => {});
        }, Math.max(0, Number(delayMs) || 0));
    }

    function pruneCachedChatsWithPolicy(limit = 100) {
        const prunePromise = ChatIdb.pruneCachedChats(limit);
        prunePromise.catch(() => {});
        scheduleDataMemoryPolicy();
        return prunePromise;
    }
    window.__sunScheduleDataMemoryPolicy = scheduleDataMemoryPolicy;

    const mediaCacheRuntime = createChatMediaCacheRuntime({
        currentUserId: CURRENT_USER_ID,
        fetchImpl: window.authFetch || window.fetch?.bind(window),
    });
    mediaCacheRuntime.init().catch(() => {});
    window.__sunMediaCacheResolveSource = (sourceUrl, options = {}) =>
        mediaCacheRuntime.resolveMediaSource(sourceUrl, options);
    window.__sunMediaCacheRememberElement = (mediaEl) =>
        mediaCacheRuntime.rememberFromElement(mediaEl);

    chatIdbRuntime.init()
        .then((ready) => {
            if (ready) scheduleDataMemoryPolicy(60);
        })
        .catch(() => {});

    const outboxRuntime = createOutboxRuntime({
        currentUserId: CURRENT_USER_ID,
        onEntryExpired: (clientId) => {
            try { failPendingMessage(clientId); } catch (_) {}
        },
        onEntryDrained: (clientId) => {
            try { schedulePendingTimeout(clientId); } catch (_) {}
        },
    });
    outboxRuntime.init();
    mountOutboxPill(outboxRuntime);
    const enqueueOutboxMessage = (entry) => outboxRuntime.enqueue(entry);
    const drainOutboxOnce = () => outboxRuntime.drainOnce(emitSocket);
    const removeOutboxByClientId = (clientId) => outboxRuntime.remove(clientId);
    socket.on('connect', () => { void drainOutboxOnce(); });
    window.addEventListener('online', () => { void drainOutboxOnce(); });
    socket.on('message_sent', (data) => {
        const clientId = String(data?.client_id || '').trim();
        if (clientId) void removeOutboxByClientId(clientId);
    });
    document.addEventListener('click', (event) => {
        const tick = event.target?.closest?.('.msg-tick.failed');
        if (!tick) return;
        const messageEl = tick.closest('.message.self');
        if (!messageEl) return;
        event.preventDefault();
        event.stopPropagation();
        void drainOutboxOnce();
    });
    const previousClearChatHistoryCacheOnLogout = window.clearChatHistoryCacheOnLogout;
    window.clearChatHistoryCacheOnLogout = async () => {
        if (cachePolicyTimerId) {
            window.clearTimeout(cachePolicyTimerId);
            cachePolicyTimerId = 0;
        }
        try {
            delete window.__sunMediaCacheResolveSource;
            delete window.__sunMediaCacheRememberElement;
            delete window.__sunScheduleDataMemoryPolicy;
            await mediaCacheRuntime.close();
        } catch (_) {}
        try { await previousClearChatHistoryCacheOnLogout?.(); } catch (_) {}
        try { await outboxRuntime.clearOnLogout(); } catch (_) {}
    };
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
    let pendingForcedChatRerenderFrame = 0;
    let pendingForcedChatRerenderChatId = '';
    let pendingForcedChatRerenderOptions = null;

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
    function resolveAttachModeForFile(file, preferredMode = null) {
        return attachMenuPanelController?.resolveAttachModeForFile(file, preferredMode) || 'file';
    }

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
    const sidebar      = document.getElementById('sidebar');
    const contactsList = document.getElementById('contactsList');
    const chatTitle    = document.getElementById('chatTitle');
    const e2eIndicator = document.getElementById('e2eIndicator');
    const e2ePillWrap = document.getElementById('e2ePillWrap');
    const e2ePill = document.getElementById('e2ePill');
    const voicePlaybackBar = document.getElementById('voicePlaybackBar');
    const voicePlaybackSender = document.getElementById('voicePlaybackSender');
    const voicePlaybackDetails = document.getElementById('voicePlaybackDetails');
    const voicePlaybackPlayBtn = document.getElementById('voicePlaybackPlayBtn');
    const voicePlaybackBackBtn = document.getElementById('voicePlaybackBackBtn');
    const voicePlaybackForwardBtn = document.getElementById('voicePlaybackForwardBtn');
    const voicePlaybackVolume = document.getElementById('voicePlaybackVolume');
    const voicePlaybackSpeedBtn = document.getElementById('voicePlaybackSpeedBtn');
    const voicePlaybackRepeatBtn = document.getElementById('voicePlaybackRepeatBtn');
    const voicePlaybackCloseBtn = document.getElementById('voicePlaybackCloseBtn');
    const voicePlaybackProgress = document.getElementById('voicePlaybackProgress');
    const voicePlaybackProgressFill = document.getElementById('voicePlaybackProgressFill');
    const chatMessages = document.getElementById('chatMessages');
    const historyLoadingIndicator = document.getElementById('historyLoading');
    const chatPlaceholder  = document.getElementById('chatPlaceholder');
    const chatInputArea    = document.getElementById('chatInputArea');
    const chatBlockNotice = document.getElementById('chatBlockNotice');
    const chatBlockNoticeText = document.getElementById('chatBlockNoticeText');
    const chatUnblockBtn = document.getElementById('chatUnblockBtn');
    const messageActionsBar = document.getElementById('messageActionsBar');
    const composerRow = document.getElementById('composerRow');
    const messageForm  = document.getElementById('messageForm');
    const messageInput = document.getElementById('messageInput');
    const sendMessageBtn = document.getElementById('sendMessageBtn');
    const voiceRecordBtn = document.getElementById('voiceRecordBtn');
    const voiceRecordTimer = document.getElementById('voiceRecordTimer');
    const voiceRecordComposer = document.getElementById('voiceRecordComposer');
    const voiceRecordCancelBtn = document.getElementById('voiceRecordCancelBtn');
    const voiceRecordSendBtn = document.getElementById('voiceRecordSendBtn');
    const cancelReplyBtn = document.getElementById('cancelReplyBtn');
    const cancelEditBtn = document.getElementById('cancelEditBtn');
    const sendMessageBtnMobile = null; // removed in new UI
    const deleteChatBtn = document.getElementById('deleteChatBtn');
    const reportUserMenuBtn = document.getElementById('reportUserMenuBtn');
    const chatArea     = document.getElementById('chatArea');
    const chatHeaderActions = document.getElementById('chatHeaderActions');
    const headerDropdown = document.getElementById('headerDropdown');
    const headerSearchWrap = document.getElementById('headerSearchWrap');
    const headerSearchInput = document.getElementById('headerSearchInput');
    const headerSearchCalendarBtn = document.getElementById('headerSearchCalendarBtn');
    const closeSearchBtn = document.getElementById('closeSearchBtn');
    const dialogRequestsList    = document.getElementById('dialogRequestsList');
    const modalSearchInput = document.getElementById('searchUserInput');
    const modalSearchResults = document.getElementById('searchUserResults');
    const paletteLocalSection = document.getElementById('paletteLocalSection');
    const paletteLocalResults = document.getElementById('paletteLocalResults');
    const paletteFrequentSection = document.getElementById('paletteFrequentSection');
    const paletteFrequentChats = document.getElementById('paletteFrequentChats');
    const chatsSearchHint = document.querySelector('.search-overlay__hint[data-search-hint=\"chats\"]');
    const commandPaletteActions = document.getElementById('commandPaletteActions');
    const groupCreateModal = document.getElementById('groupCreateModal');
    const groupTitleInput = document.getElementById('groupTitleInput');
    const groupMemberSearchInput = document.getElementById('groupMemberSearchInput');
    const groupCreateSelected = document.getElementById('groupCreateSelected');
    const groupCreateSearchResults = document.getElementById('groupCreateSearchResults');
    const groupCreateSubmitBtn = document.getElementById('groupCreateSubmitBtn');
    const groupEditModal = document.getElementById('groupEditModal');
    const groupEditTitleInput = document.getElementById('groupEditTitleInput');
    const groupEditDescriptionInput = document.getElementById('groupEditDescriptionInput');
    const groupEditMembersList = document.getElementById('groupEditMembersList');
    const groupEditAvatarInput = document.getElementById('groupEditAvatarInput');
    const groupEditAvatarPreview = document.getElementById('groupEditAvatarPreview');
    const groupEditSubmitBtn = document.getElementById('groupEditSubmitBtn');
    const groupEditOpenPermissionsBtn = document.getElementById('groupEditOpenPermissionsBtn');
    const groupEditPermissionsSummary = document.getElementById('groupEditPermissionsSummary');
    const groupPermissionsPanel = document.getElementById('groupPermissionsPanel');
    const groupPermissionsBackBtn = document.getElementById('groupPermissionsBackBtn');
    const groupPermSendMessagesToggle = document.getElementById('groupPermSendMessagesToggle');
    const groupPermSendMediaToggle = document.getElementById('groupPermSendMediaToggle');
    const groupPermAddMembersToggle = document.getElementById('groupPermAddMembersToggle');
    const groupPermPinMessagesToggle = document.getElementById('groupPermPinMessagesToggle');
    const groupPermChangeInfoToggle = document.getElementById('groupPermChangeInfoToggle');
    const groupPermSlowModeList = document.getElementById('groupPermSlowModeList');
    const messageForwardModal = document.getElementById('messageForwardModal');
    const messageForwardSearchInput = document.getElementById('messageForwardSearchInput');
    const messageForwardSelectedInfo = document.getElementById('messageForwardSelectedInfo');
    const messageForwardTargets = document.getElementById('messageForwardTargets');
    const messageForwardSubmitBtn = document.getElementById('messageForwardSubmitBtn');
    const forwardDraftBar = document.getElementById('forwardDraftBar');
    const forwardDraftLabel = document.getElementById('forwardDraftLabel');
    const forwardDraftText = document.getElementById('forwardDraftText');
    const cancelForwardDraftBtn = document.getElementById('cancelForwardDraftBtn');
    const reactionPicker = document.getElementById('reactionPicker');
    const contextMenu = document.getElementById('messageContextMenu');
    const contextReplyItem = document.getElementById('cmReply');
    const contextPinItem = document.getElementById('cmPin');
    const contextFavoriteItem = document.getElementById('cmFavorite');
    const contextCopyItem = document.getElementById('cmCopy');
    const contextForwardItem = document.getElementById('cmForward');
    const contextEditItem = document.getElementById('cmEdit');
    const contextSelectItem = document.getElementById('cmSelect');
    const contextReportItem = document.getElementById('cmReport');
    const contextDeleteItem = document.getElementById('cmDelete');
    const contextReactionDivider = document.getElementById('cmReactionDivider');
    const contextReadInfo = document.getElementById('cmReadInfo');
    const contextReadInfoText = contextReadInfo?.querySelector('.context-menu-read-info__text');
    const muteChatBtn = document.getElementById('muteChatBtn');
    // Partner Profile Drawer
    const partnerProfileDrawer = document.getElementById('partnerProfileDrawer');
    const profileSheet = partnerProfileDrawer?.querySelector('.profile-sheet') || null;
    const profileLayout = partnerProfileDrawer?.querySelector('.profile-scroll, .profile-layout') || null;
    const profileBackdropCloseBtn = partnerProfileDrawer?.querySelector('[data-profile-close]') || null;
    const closeProfileBtn = document.getElementById('closeProfileBtn');
    const blockPartnerBtn = document.getElementById('blockChatBtn');
    const profileMoreBtn = document.getElementById('profileMoreBtn');
    const profileMoreMenu = document.getElementById('profileMoreMenu');
    const profileToggleMuteMenuBtn = document.getElementById('profileToggleMuteMenuBtn');
    const profileToggleMuteMenuIcon = document.getElementById('profileToggleMuteMenuIcon');
    const profileToggleMuteMenuLabel = document.getElementById('profileToggleMuteMenuLabel');
    const profileTogglePinMenuBtn = document.getElementById('profileTogglePinMenuBtn');
    const profileTogglePinMenuIcon = document.getElementById('profileTogglePinMenuIcon');
    const profileTogglePinMenuLabel = document.getElementById('profileTogglePinMenuLabel');
    const profileDeleteChatMenuBtn = document.getElementById('profileDeleteChatMenuBtn');
    const profileOnlineDot = document.getElementById('profileOnlineDot');
    const profileMetaUsername = document.getElementById('profileMetaUsername');
    const profileMetaCreatedAt = document.getElementById('profileMetaCreatedAt');
    const profileMetaUserId = document.getElementById('profileMetaUserId');
    const profileGroupEditBtn = document.getElementById('profileGroupEditBtn');
    const profileGroupSection = document.getElementById('profileGroupSection');
    const profileGroupTabs = document.getElementById('profileGroupTabs');
    const profileGroupMembers = document.getElementById('profileGroupMembers');
    const profileMediaSection = document.querySelector('.profile-media-section');
    const profileTopbarTitle = partnerProfileDrawer?.querySelector('.profile-topbar-title') || null;
    const profileDisplayName = document.getElementById('profileDisplayName');
    const profileLastSeen = document.getElementById('profileLastSeen');
    const profileLargeAvatar = document.getElementById('profileLargeAvatar');
    const profileMediaTabs = document.getElementById('profileMediaTabs');
    const profileMediaContent = document.getElementById('profileMediaContent');
    const profileMediaEmpty = document.getElementById('profileMediaEmpty');
    const profileActionButtons = Array.from(partnerProfileDrawer?.querySelectorAll('[data-profile-action]') || []);
    const profileInfoRows = Array.from(partnerProfileDrawer?.querySelectorAll('.profile-info-row[data-media-type]') || []);
    const chatHeader = document.getElementById('chatHeader');
    const chatPartnerHeaderLink = document.getElementById('chatPartnerHeaderLink');
    const chatTitleArea = document.querySelector('.chat-partner-info');
    const dialogRequestsSection = document.getElementById('dialogRequestsSection');
    const sidebarProfileShortcut = document.getElementById('sidebarProfileShortcut');
    const sidebarStatusBar = document.getElementById('sidebarStatusBar');
    const sidebarStatusSettingsBtn = document.getElementById('sidebarStatusSettingsBtn');
    const sidebarStatusTitle = document.getElementById('sidebarStatusTitle');
    const sidebarStatusHint = document.getElementById('sidebarStatusHint');
    const sidebarSyncChip = document.getElementById('sidebarSyncChip');
    const emojiBtn = document.getElementById('emojiBtn');
    const searchChatBtn = document.getElementById('searchChatBtn');
    const sideResizer = document.getElementById('sideResizer');
    const reportContentModal = document.getElementById('reportContentModal');
    const reportContentTargetLabel = document.getElementById('reportContentTargetLabel');
    const reportReasonSelect = document.getElementById('reportReasonSelect');
    const reportCommentInput = document.getElementById('reportCommentInput');
    const reportContentStatus = document.getElementById('reportContentStatus');
    const reportSubmitBtn = document.getElementById('reportSubmitBtn');
    const reportCancelBtn = document.getElementById('reportCancelBtn');

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
        getCurrentGroupProfile: () => currentGroupProfile,
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
        getCurrentGroupProfile: () => currentGroupProfile,
        onPermissionsUpdated: (nextPermissions) => {
            if (!currentGroupProfile) return;
            currentGroupProfile.group_permissions = { ...nextPermissions };
        },
    });

    chatAnimationsController = createChatAnimationsController({
        chatArea,
        chatMessages,
        prefersReducedMotionSetting: () => prefersReducedMotionSetting(),
        isMobileViewport: () => isMobileViewport(),
    });

    // initChatClipboardAndDrop вызывается ниже, после объявления dragDropOverlay.

    const isMobileReactionInsideMode = () => { try { return Boolean(window.matchMedia?.('(max-width: 768px)')?.matches); } catch (_) { return false; } };
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
    let applyActiveMessageSearchFilterImpl = () => {};
    let emojiPickerInitPromise = null;
    let messageSearchInitPromise = null;
    let sidebarSearchInitPromise = null;
    let sidebarResizeInitPromise = null;
    function applyActiveMessageSearchFilter() {
        applyActiveMessageSearchFilterImpl();
    }
    function closeMessageSearchOverlay() {
        if (!headerSearchWrap?.classList.contains('active')) return false;
        if (closeSearchBtn) {
            closeSearchBtn.click();
            return true;
        }
        headerSearchWrap.classList.remove('active');
        chatHeader?.classList.remove('chat-header--search-active');
        if (headerSearchInput) {
            headerSearchInput.value = '';
            headerSearchInput.blur();
        }
        applyActiveMessageSearchFilter();
        return true;
    }
    function closeHeaderDropdown() {
        return closeFloatingPanel(headerDropdown, 'active', 120);
    }
    function toggleHeaderDropdown() {
        if (!headerDropdown) return;
        if (headerDropdown.classList.contains('active') || headerDropdown.classList.contains('is-opening')) {
            closeHeaderDropdown();
            return;
        }
        openFloatingPanel(headerDropdown, 'active');
    }
    function ensureEmojiPicker() {
        if (emojiPickerInitPromise) {
            return emojiPickerInitPromise;
        }
        emojiPickerInitPromise = import('./modules/emoji.js')
            .then(({ initEmojiPicker }) => {
                initEmojiPicker(messageInput);
            })
            .catch((error) => {
                emojiPickerInitPromise = null;
                throw error;
            });
        return emojiPickerInitPromise;
    }
    function ensureMessageSearch() {
        if (messageSearchInitPromise) {
            return messageSearchInitPromise;
        }
        messageSearchInitPromise = import('./modules/message-search.js')
            .then((module) => {
                applyActiveMessageSearchFilterImpl = module.applyActiveMessageSearchFilter;
                module.initMessageSearch();
            })
            .catch((error) => {
                messageSearchInitPromise = null;
                throw error;
            });
        return messageSearchInitPromise;
    }
    function ensureSidebarSearch() {
        if (sidebarSearchInitPromise) {
            return sidebarSearchInitPromise;
        }
        sidebarSearchInitPromise = import('./modules/sidebar-search.js')
            .then(({ initSidebarSearch }) => {
                initSidebarSearch({ onAddUser: (userId, displayName) => sendDialogRequest(userId, displayName) });
            })
            .catch((error) => {
                sidebarSearchInitPromise = null;
                throw error;
            });
        return sidebarSearchInitPromise;
    }
    function ensureSidebarResize() {
        if (sidebarResizeInitPromise) {
            return sidebarResizeInitPromise;
        }
        sidebarResizeInitPromise = import('./modules/sidebar-resize.js')
            .then(({ initSidebarResize }) => {
                initSidebarResize();
            })
            .catch((error) => {
                sidebarResizeInitPromise = null;
                throw error;
            });
        return sidebarResizeInitPromise;
    }
    emojiBtn?.addEventListener('click', async (event) => {
        if (isProfileDrawerOpen()) {
            await closePartnerProfileDrawer();
        }
        if (emojiPickerInitPromise) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        try {
            await ensureEmojiPicker();
            queueMicrotask(() => emojiBtn.click());
        } catch (error) {
            console.warn('Failed to initialize emoji picker', error);
        }
    }, { capture: true });
    searchChatBtn?.addEventListener('click', async (event) => {
        if (messageSearchInitPromise) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        try {
            await ensureMessageSearch();
            queueMicrotask(() => searchChatBtn.click());
        } catch (error) {
            console.warn('Failed to initialize message search', error);
        }
    }, { capture: true });
    sideResizer?.addEventListener('mousedown', async (event) => {
        if (sidebarResizeInitPromise) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        try {
            await ensureSidebarResize();
            queueMicrotask(() => {
                sideResizer.dispatchEvent(new MouseEvent('mousedown', {
                    bubbles: true,
                    cancelable: true,
                    clientX: event.clientX,
                    clientY: event.clientY,
                    button: event.button,
                }));
            });
        } catch (error) {
            console.warn('Failed to initialize sidebar resize', error);
        }
    }, { capture: true });
    // Init profile drawer module (handles swipe-to-close)
    const _profileDrawer = initProfileDrawer({
        drawerEl: partnerProfileDrawer,
        profileSheetEl: profileSheet,
        chatAreaEl: chatArea,
        profileLayoutEl: profileLayout,
        isChatBlocked: () => isChatBlocked(),
        showToast,
    });
    const dragDropOverlay = document.getElementById('dragDropOverlay');

    initChatClipboardAndDrop({
        messageInput,
        chatArea,
        dragDropOverlay,
        handleFileUpload: (file, options) => handleFileUpload(file, options),
        isProfileDrawerOpen: () => isProfileDrawerOpen(),
        getCurrentChatId: () => currentChatId,
        showToast,
    });

    const jumpToNewMessagesBtn = document.getElementById('jumpToNewMessagesBtn');
    const jumpToNewMessagesCount = document.getElementById('jumpToNewMessagesCount');
    const jumpToNewMessagesIcon = jumpToNewMessagesBtn?.querySelector('i');
    if (jumpToNewMessagesIcon) {
        jumpToNewMessagesIcon.className = 'bi bi-chevron-down';
    }
    // Selection UI
    const headerSelectionWrap = document.getElementById('headerSelectionWrap');
    const selectedCountSpan = document.getElementById('selectedCount');
    const cancelSelectionBtn = document.getElementById('cancelSelectionBtn');
    const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
    const bulkForwardBtn = document.getElementById('bulkForwardBtn');
    const bulkCopyBtn = document.getElementById('bulkCopyBtn');
    const barSelectBtn = document.getElementById('barSelectBtn');
    const barCancelBtn = document.getElementById('barCancelBtn');
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
    const CHAT_BOTTOM_THRESHOLD_PX = 86;
    const CHAT_HISTORY_PAGE_SIZE = 24;
    const CHAT_HISTORY_MAX_PAGE_SIZE = 80;
    const CHAT_LOAD_MORE_THRESHOLD_PX = 100;
    const CHAT_VIRTUAL_WINDOW_SIZE = 80;
    const CHAT_VIRTUAL_BUFFER = 12;
    const CHAT_VIRTUALIZATION_MIN_MESSAGES = 220;
    const CHAT_HEIGHT_MEASURE_SAMPLE_LIMIT = 24;
    const CHAT_DEFAULT_MESSAGE_HEIGHT = 88;
    const CHAT_DECRYPT_CONCURRENCY = 6;
    const CHAT_DECRYPT_WORKER_TIMEOUT_MS = 30000;
    const CHAT_BOTTOM_INERTIA_MIN_MS = 120;
    const CHAT_BOTTOM_INERTIA_MAX_MS = 520;
    const CHAT_BOTTOM_INERTIA_PX_TO_MS = 0.28;
    const CONTACTS_BOOTSTRAP_SYNC_LIMIT = 24;
    const CONTACTS_FULL_SYNC_IDLE_TIMEOUT_MS = 4000;
    const APP_BOOT_OVERLAY_FALLBACK_DELAY_MS = 450;
    const TYPING_EMIT_INTERVAL_MS = 1200;
    const CONTACTS_RELOAD_DEBOUNCE_MS = 180;
    const PINNED_CHATS_LIMIT = 5;
    const CHAT_DAY_SEPARATOR_HEIGHT = 34;
    const MESSAGE_SCALE_STORAGE_KEY = 'sun_chat_message_scale_v1';
    const TIME_FORMAT_STORAGE_KEY = 'sun_time_format_v1';
    const MUTE_CHAT_STORAGE_KEY = 'sun_chat_muted_v1';
    const MUTE_DIALOG_REQUESTS_STORAGE_KEY = 'sun_mute_dialog_requests_v1';
    const BASE_TAB_TITLE = String(document.title || 'sun').trim() || 'sun';
    const TITLE_SEPARATOR = ' • ';
    const normalizeTabLabel = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const buildTabBaseTitle = () => {
        const activeChatToken = String(chatHeader?.getAttribute('data-partner-id') || '').trim();
        const activeChatName = normalizeTabLabel(chatTitle?.textContent);
        if (!activeChatToken || !activeChatName) return BASE_TAB_TITLE;
        return `${activeChatName}${TITLE_SEPARATOR}${BASE_TAB_TITLE}`;
    };
    let isE2EPillPinnedOpen = false;
    const tabAlertController = createTabAlertController({
        baseTitle: BASE_TAB_TITLE,
        blinkIntervalMs: 900,
        getTitle: () => document.title || '',
        setTitle: (nextTitle) => {
            document.title = String(nextTitle || BASE_TAB_TITLE);
        },
        setIntervalFn: (handler, delay) => window.setInterval(handler, delay),
        clearIntervalFn: (timerId) => window.clearInterval(timerId),
    });
    tabAlertController.setBaseTitle(buildTabBaseTitle());
    if (window.MutationObserver) {
        const syncTabBaseTitle = () => {
            tabAlertController.setBaseTitle(buildTabBaseTitle());
        };
        if (chatTitle) {
            const chatTitleObserver = new MutationObserver(syncTabBaseTitle);
            chatTitleObserver.observe(chatTitle, {
                childList: true,
                characterData: true,
                subtree: true,
            });
        }
        if (chatHeader) {
            const chatHeaderObserver = new MutationObserver(syncTabBaseTitle);
            chatHeaderObserver.observe(chatHeader, {
                attributes: true,
                attributeFilter: ['data-partner-id'],
            });
        }
    }

    const mutePreferences = createChatMutePreferences({
        storage: window.localStorage,
        muteChatStorageKey: MUTE_CHAT_STORAGE_KEY,
        muteDialogRequestsStorageKey: MUTE_DIALOG_REQUESTS_STORAGE_KEY,
        bootstrapMuteDialogRequests: Boolean(bootstrapUser.muteDialogRequests),
    });
    const { ensureMediaElementHydrated, disconnectLazyMediaHydrationObserver, registerMediaElementsForLazyHydration } = createMediaHydrationController({ root: chatMessages });

    function getMutedChatIds() {
        return mutePreferences.getMutedChatIds();
    }
    function getDialogRequestsMutedFromStorage() {
        return mutePreferences.getDialogRequestsMutedFromStorage();
    }
    function isDialogRequestsMuted() {
        return mutePreferences.isDialogRequestsMuted();
    }

    function initializeDialogRequestMutePreference() {
        mutePreferences.initializeDialogRequestMutePreference();
    }

    function setMutedChatIds(ids) {
        mutePreferences.setMutedChatIds(ids);
    }

    function isChatMuted(chatId) {
        return mutePreferences.isChatMuted(chatId);
    }

    const chatMuteUiController = createChatMuteUiController({
        contactsList,
        muteChatBtn,
        resolveContactItemByChatId,
        isChatMuted,
        getMutedChatIds,
        setMutedChatIds,
        getCurrentChatId: () => currentChatId,
        syncProfileMoreMenuChatActions: () => syncProfileMoreMenuChatActions(),
        showToast,
        doc: document,
    });

    function applyContactMuteState(contactItem, muted) {
        chatMuteUiController.applyContactMuteState(contactItem, muted);
    }

    function syncContactMuteState(chatId) {
        chatMuteUiController.syncContactMuteState(chatId);
    }

    function syncAllContactsMuteState() {
        chatMuteUiController.syncAllContactsMuteState();
    }

    function syncProfileMoreMenuChatActions() {
        const currentItem = currentChatId ? resolveContactItemByChatId(currentChatId) : null;
        const isGroupChat = Boolean(currentItem && currentItem.getAttribute('data-is-group') === '1');
        if (deleteChatBtn) {
            deleteChatBtn.innerHTML = isGroupChat
                ? '<i class="bi bi-box-arrow-right"></i> \u041F\u043E\u043A\u0438\u043D\u0443\u0442\u044C \u0433\u0440\u0443\u043F\u043F\u0443'
                : '<i class="bi bi-trash3"></i> \u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0447\u0430\u0442';
        }
        syncProfileMoreMenuChatActionsFlow({
            currentChatId,
            resolveContactItemByChatId,
            isChatMuted,
            canPinMoreChats,
            pinnedChatsLimit: PINNED_CHATS_LIMIT,
            profileToggleMuteMenuBtn,
            profileToggleMuteMenuIcon,
            profileToggleMuteMenuLabel,
            profileTogglePinMenuBtn,
            profileTogglePinMenuIcon,
            profileTogglePinMenuLabel,
            profileDeleteChatMenuBtn,
        });
    }

    function syncMuteButton() {
        chatMuteUiController.syncMuteButton();
    }

    function toggleChatMuted(chatId, options = {}) {
        return chatMuteUiController.toggleChatMuted(chatId, options);
    }

    function toggleCurrentChatMuted(options = {}) {
        return chatMuteUiController.toggleCurrentChatMuted(options);
    }

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
    const REACTION_PICKER_EMOJIS = _REACTION_PICKER_EMOJIS;
    const QUICK_REACTION_EMOJIS_LIMIT = 9;

    function syncReactionPickerItems() {
        if (!reactionPicker) return;
        const emojis = Array.isArray(REACTION_PICKER_EMOJIS)
            ? REACTION_PICKER_EMOJIS.map((item) => String(item || '').trim()).filter(Boolean)
            : [];
        if (!emojis.length) return;

        const buildEmojiButtonHtml = (emoji) => (
            `<button type="button" class="reaction-picker__item" data-emoji="${escapeHtml(emoji)}" aria-label="\u0420\u0435\u0430\u043A\u0446\u0438\u044F ${escapeHtml(emoji)}">${escapeHtml(emoji)}</button>`
        );

        const quickEmojis = emojis.slice(0, QUICK_REACTION_EMOJIS_LIMIT);
        const expandedEmojis = emojis.slice(QUICK_REACTION_EMOJIS_LIMIT);
        const hasExpandedSection = expandedEmojis.length > 0;

        reactionPicker.innerHTML = `
            <div class="reaction-picker__row">
                <div class="reaction-picker__quick">${quickEmojis.map(buildEmojiButtonHtml).join('')}</div>
                ${hasExpandedSection
        ? `<button type="button" class="reaction-picker__expand-toggle" data-reaction-expand-toggle aria-label="\u0411\u043E\u043B\u044C\u0448\u0435 \u0440\u0435\u0430\u043A\u0446\u0438\u0439" aria-expanded="false"><i class="bi bi-chevron-down" aria-hidden="true"></i></button>`
        : ''}
            </div>
            ${hasExpandedSection
        ? `<div class="reaction-picker__expanded" hidden>${expandedEmojis.map(buildEmojiButtonHtml).join('')}</div>`
        : ''}
        `;
    }
    syncReactionPickerItems();

    let openChatUnreadCount = 0;
    const chatScrollPositions = new Map();
    const chatStates = new Map();
    const historyInitialAbortControllers = new Map();
    const historyOlderAbortControllers = new Map();
    let chatVirtualRenderFrame = 0;
    let pendingVirtualRenderChatId = '';
    let pendingVirtualRenderOptions = null;
    let pendingPostRenderUiFrame = 0;
    let pendingSearchFilterRefresh = false;
    let pendingJumpButtonRefresh = false;
    let pendingE2EPillRefresh = false;
    let suppressChatScrollHandling = false;
    let pendingBottomScrollFrame = 0;
    let pendingBottomScroll = false;
    let bottomInertiaFrame = 0;
    let bottomInertiaToken = 0;
    let keepChatPinnedToBottom = false;
    const reactionUpdateStampByMessage = new Map();
    const pendingReactionOpsById = new Map();
    const pendingReactionOpByMessage = new Map();
    const supersededReactionRequestIds = new Map();
    let baseUpdateOnlineStatusUI = () => {};
    let hideTyping = () => {};
    let hideSidebarTyping = () => {};

    function schedulePostRenderUiRefresh({ searchFilter = false, jumpButton = false, e2ePill = false } = {}) {
        pendingSearchFilterRefresh = pendingSearchFilterRefresh || Boolean(searchFilter);
        pendingJumpButtonRefresh = pendingJumpButtonRefresh || Boolean(jumpButton);
        pendingE2EPillRefresh = pendingE2EPillRefresh || Boolean(e2ePill);
        if (pendingPostRenderUiFrame) return;
        pendingPostRenderUiFrame = requestAnimationFrame(() => {
            pendingPostRenderUiFrame = 0;
            const shouldRefreshSearch = pendingSearchFilterRefresh;
            const shouldRefreshJump = pendingJumpButtonRefresh;
            const shouldRefreshE2E = pendingE2EPillRefresh;
            pendingSearchFilterRefresh = false;
            pendingJumpButtonRefresh = false;
            pendingE2EPillRefresh = false;

            if (shouldRefreshSearch) applyActiveMessageSearchFilter();
            if (shouldRefreshJump) updateJumpToNewMessagesButton();
            if (shouldRefreshE2E) syncE2EPillState();
        });
    }

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
        getStatusElement: () => document.getElementById('chatOnlineStatus'),
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

    // Delete Modal UI
    const deleteConfirmModal = document.getElementById('deleteConfirmModal');
    const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
    const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
    const deleteForBothCheck = document.getElementById('deleteForBothCheck');
    const deleteForBothWrap = document.getElementById('deleteForBothWrap');
    const deleteModalTitle = document.getElementById('deleteModalTitle');
    const deleteModalText = document.getElementById('deleteModalText');
    const appBootOverlay = document.getElementById('appBootOverlay');
    const profileLoadingMask = document.getElementById('profileLoadingMask');
    let appBootOverlayHidden = false;
    const appBootStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const threadShell = createThreadShell({
        historyLoadingIndicator,
        getCurrentChatId: () => currentChatId,
        getChatMessagesElement: () => chatMessages,
    });
    const setHistoryLoading = (...args) => threadShell.setHistoryLoading(...args);
    const setChatStageLoading = (...args) => threadShell.setChatStageLoading(...args);

    function refreshVisibleEmojiGraphics() {
        applyEmojiGraphics(chatMessages);
        applyEmojiGraphics(contactsList);
        applyEmojiGraphics(reactionPicker);
        applyEmojiGraphics(document.getElementById('replyBarText'));
        applyEmojiGraphics(document.getElementById('pinnedBarText'));
    }

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
    applyEmojiGraphics(reactionPicker);
    _hydrateContactAvatarLoading(contactsList);
    requestAnimationFrame(refreshVisibleEmojiGraphics);
    window.addEventListener('load', refreshVisibleEmojiGraphics, { once: true });
    scheduleNonCriticalTask(() => {
        ensureEmojiPicker().catch((error) => {
            console.warn('Deferred emoji picker init failed', error);
        });
    });
    scheduleNonCriticalTask(() => {
        ensureMessageSearch().catch((error) => {
            console.warn('Deferred message search init failed', error);
        });
    });
    scheduleNonCriticalTask(() => {
        ensureSidebarSearch().catch((error) => {
            console.warn('Deferred sidebar search init failed', error);
        });
    });
    scheduleNonCriticalTask(() => {
        ensureSidebarResize().catch((error) => {
            console.warn('Deferred sidebar resize init failed', error);
        });
    });
    SettingsPanel();
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
    var sidebarStatusController = createSidebarStatusController({
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
        sidebarElements: {
            sidebarSyncChip,
            sidebarStatusBar,
            sidebarStatusTitle,
            sidebarStatusHint,
        },
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

    sidebarProfileShortcut?.addEventListener('click', () => {
        window.openSettingsOverlay?.('settings');
    });

    sidebarStatusBar?.addEventListener('click', () => {
        const action = sidebarStatusBar?.dataset.action || getSidebarStatusSnapshot().action;
        runSidebarStatusAction(action);
    });
    sidebarStatusSettingsBtn?.addEventListener('click', () => {
        window.openSettingsOverlay?.('settings');
    });

    const syncConnectionUi = () => {
        syncSidebarStatusBar();
        syncChatConnectionStatus();
    };
    window.addEventListener('online', syncConnectionUi);
    window.addEventListener('offline', syncConnectionUi);
    window.addEventListener('focus', syncConnectionUi);
    window.syncSidebarStatusBar = syncSidebarStatusBar;
    syncSidebarStatusBar();

    // \u041A\u043D\u043E\u043F\u043A\u0430 "\u041D\u0430\u0437\u0430\u0434" (\u043C\u043E\u0431\u0438\u043B\u044C\u043D\u0430\u044F)
    const backBtnMobile = document.getElementById('backBtnMobile');

    // \u0410\u043B\u0438\u0430\u0441\u044B \u043C\u043E\u0434\u0443\u043B\u044C\u043D\u044B\u0445 \u0444\u0443\u043D\u043A\u0446\u0438\u0439 (\u0431\u0435\u0437 _ prefix) - \u0442\u043E\u043B\u044C\u043A\u043E \u0442\u0435, \u0447\u0442\u043E \u043D\u0435 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u044E\u0442 \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u044B\u0439 chatStates Map
    const getMessageKey         = _getMessageKey;
    const getMessageDayKey      = _getMessageDayKey;
    const formatDaySeparatorLabel = _formatDaySeparatorLabel;
    const getOutgoingStatus     = _getOutgoingStatus;
    const buildTickHtml         = _buildTickHtml;
    const applyTickToElement    = _applyTickToElement;
    const isSameMessageGroup    = _isSameMessageGroup;
    const normalizeReactionReactor   = _normalizeReactionReactor;
    const getReactionReactorKey      = _getReactionReactorKey;
    const normalizeReactionReactors  = _normalizeReactionReactors;
    const buildReactionReactorInitials = _buildReactionReactorInitials;
    const buildReactionReactorsHtml  = _buildReactionReactorsHtml;
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

    function setChatScrollTop(nextTop) {
        cancelBottomInertiaScroll();
        if (!chatMessages) return;
        const maxScrollTop = Math.max(0, chatMessages.scrollHeight - chatMessages.clientHeight);
        const safeTop = Number.isFinite(nextTop) ? Math.max(0, Math.min(nextTop, maxScrollTop)) : 0;
        suppressChatScrollHandling = true;
        chatMessages.scrollTop = safeTop;
        // \u0414\u0432\u043E\u0439\u043D\u043E\u0439 rAF: \u043F\u0435\u0440\u0432\u044B\u0439 - layout+paint, \u0432\u0442\u043E\u0440\u043E\u0439 - \u0431\u0440\u0430\u0443\u0437\u0435\u0440 \u0442\u043E\u0447\u043D\u043E \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u0430\u043B scroll-\u0441\u043E\u0431\u044B\u0442\u0438\u0435
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                suppressChatScrollHandling = false;
            });
        });
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
        if (bottomInertiaFrame) {
            cancelAnimationFrame(bottomInertiaFrame);
            bottomInertiaFrame = 0;
        }
        bottomInertiaToken += 1;
    }

    function isTailRangeRendered(chatId = currentChatId) {
        if (!chatId) return false;
        const state = getChatState(chatId);
        if (!state?.messages?.length) return true;
        const range = state.lastRenderRange;
        return Boolean(range && range.end >= state.messages.length);
    }

    function runBottomInertiaScroll() {
        if (!chatMessages) return false;
        const fromTop = chatMessages.scrollTop;
        const initialTarget = Math.max(0, chatMessages.scrollHeight - chatMessages.clientHeight);
        const distance = initialTarget - fromTop;
        if (!Number.isFinite(distance) || distance <= 1) {
            chatMessages.scrollTop = initialTarget;
            return false;
        }
        if (prefersReducedMotionSetting()) {
            chatMessages.scrollTop = initialTarget;
            return false;
        }

        cancelBottomInertiaScroll();
        const token = bottomInertiaToken;
        const startedAt = performance.now();
        const duration = Math.max(
            CHAT_BOTTOM_INERTIA_MIN_MS,
            Math.min(
                CHAT_BOTTOM_INERTIA_MAX_MS,
                Math.round(distance * CHAT_BOTTOM_INERTIA_PX_TO_MS),
            ),
        );

        const step = (now) => {
            if (!chatMessages || token !== bottomInertiaToken) {
                bottomInertiaFrame = 0;
                return;
            }
            const elapsed = now - startedAt;
            const progress = Math.max(0, Math.min(1, elapsed / duration));
            const eased = 1 - Math.pow(1 - progress, 2.55);
            const targetTop = Math.max(0, chatMessages.scrollHeight - chatMessages.clientHeight);
            const nextTop = fromTop + ((targetTop - fromTop) * eased);
            chatMessages.scrollTop = nextTop;

            if (progress < 1) {
                bottomInertiaFrame = requestAnimationFrame(step);
                return;
            }
            chatMessages.scrollTop = targetTop;
            bottomInertiaFrame = 0;
        };

        bottomInertiaFrame = requestAnimationFrame(step);
        return true;
    }

    function requestAutoScrollToBottom({ ifNearBottom = false, smooth = true } = {}) {
        if (!chatMessages || !currentChatId) return false;
        if (ifNearBottom && !isChatNearBottom()) return false;

        keepChatPinnedToBottom = true;
        pendingBottomScroll = true;
        if (bottomInertiaFrame) {
            pendingBottomScroll = false;
            return true;
        }
        if (pendingBottomScrollFrame) return true;

        pendingBottomScrollFrame = requestAnimationFrame(() => {
            pendingBottomScrollFrame = 0;
            if (!pendingBottomScroll) return;
            pendingBottomScroll = false;
            scrollToBottom({ smooth });
        });
        return true;
    }

    function measureRenderedMessageHeights(state) {
        if (!chatMessages) return;
        const rendered = chatMessages.querySelectorAll('.message[data-message-key]');
        if (!rendered.length) return;

        const totalRendered = rendered.length;
        const sampleLimit = Math.max(4, Math.min(CHAT_HEIGHT_MEASURE_SAMPLE_LIMIT, totalRendered));
        const sampleIndexes = [];
        if (totalRendered <= sampleLimit) {
            for (let index = 0; index < totalRendered; index += 1) {
                sampleIndexes.push(index);
            }
        } else {
            const seen = new Set([0, totalRendered - 1]);
            const step = (totalRendered - 1) / Math.max(1, sampleLimit - 1);
            for (let slot = 1; slot < sampleLimit - 1; slot += 1) {
                seen.add(Math.round(slot * step));
            }
            sampleIndexes.push(...Array.from(seen).sort((left, right) => left - right));
        }

        let totalHeight = 0;
        let count = 0;
        sampleIndexes.forEach((index) => {
            const node = rendered[index];
            const key = node.getAttribute('data-message-key');
            const height = Math.ceil(node.offsetHeight || node.getBoundingClientRect().height);
            if (!key || !Number.isFinite(height) || height <= 0) return;
            state.messageHeights.set(key, height);
            totalHeight += height;
            count += 1;
        });
        if (count > 0) {
            state.averageMessageHeight = Math.max(48, Math.round(totalHeight / count));
        }
    }

    function syncReusedMessageNodeState(node, msg, layout = {}) {
        if (!node || !msg) return;
        const groupClass = String(layout.groupClass || 'group-single');
        node.classList.remove('group-start', 'group-middle', 'group-end', 'group-single');
        node.classList.add(groupClass);
        node.style.removeProperty('--swipe-reply-shift');
        node.classList.remove('swipe-reply-dragging', 'swipe-reply-ready', 'swipe-reply-reset-immediate');
        node.classList.toggle('show-avatar', Boolean(layout.showAvatar));
        node.classList.toggle('selecting', messageSelectionController.isSelectionMode());
        if (msg.id && messageSelectionController.hasSelectedMessage(String(msg.id))) {
            node.classList.add('selected');
        } else {
            node.classList.remove('selected');
        }
    }

    function renderChatMessages(chatId = currentChatId, options = {}) {
        if (!chatMessages || !chatId) return;
        if (String(chatId) !== String(currentChatId)) return;

        const state = getChatState(chatId);
        const forcedScrollTop = Number.isFinite(options.scrollTop) ? options.scrollTop : null;
        const effectiveScrollTop = options.scrollToBottom
            ? sumEstimatedHeights(state, 0, state.messages.length)
            : (forcedScrollTop ?? chatMessages.scrollTop);
        let range = getDesiredRenderRange(state, effectiveScrollTop);
        const activeVoiceMessageEl = chatMessages.querySelector('.file-msg-audio-player.is-playing')?.closest('.message[data-message-key]');
        const activeVoiceMessageKey = String(activeVoiceMessageEl?.getAttribute('data-message-key') || '');
        if (activeVoiceMessageKey) {
            const activeVoiceIndex = findMessageIndex(state, (msg) => getMessageKey(msg) === activeVoiceMessageKey);
            if (activeVoiceIndex >= 0 && (activeVoiceIndex < range.start || activeVoiceIndex >= range.end)) {
                range = {
                    start: Math.min(range.start, activeVoiceIndex),
                    end: Math.max(range.end, activeVoiceIndex + 1),
                };
            }
        }
        const needsForcedRender = Boolean(options.force || options.preserveHeightDelta || forcedScrollTop !== null || options.scrollToBottom);
        if (!needsForcedRender && state.lastRenderRange && state.lastRenderRange.start === range.start && state.lastRenderRange.end === range.end) {
            schedulePostRenderUiRefresh({ jumpButton: true });
            return;
        }

        const reusableMessageNodesByKey = new Map();
        if (!options.force) {
            chatMessages.querySelectorAll('.message[data-message-key]').forEach((node) => {
                const key = String(node.getAttribute('data-message-key') || '');
                if (!key || reusableMessageNodesByKey.has(key)) return;
                reusableMessageNodesByKey.set(key, node);
            });
        } else if (activeVoiceMessageEl && activeVoiceMessageKey) {
            // При force-перерисовке всё равно переиспользуем DOM-узел играющего
            // голосового, иначе HTMLAudioElement отсоединится от дерева и браузер
            // принудительно вызовет pause() на нём — голосовое встанет на паузу
            // ровно в момент отправки обычного сообщения.
            reusableMessageNodesByKey.set(activeVoiceMessageKey, activeVoiceMessageEl);
        }

        const fragment = document.createDocumentFragment();
        const topSpacerHeight = sumEstimatedHeights(state, 0, range.start);
        const bottomSpacerHeight = sumEstimatedHeights(state, range.end, state.messages.length);
        fragment.appendChild(createVirtualSpacer(topSpacerHeight));

        let previousDayKey = range.start > 0
            ? getMessageDayKey(state.messages[range.start - 1]?.created_at)
            : '';
        const suppressEnterAnimation = chatMessages.classList.contains('is-loading-history');
        state.messages.slice(range.start, range.end).forEach((msg, localIndex) => {
            const absoluteIndex = range.start + localIndex;
            const dayKey = getMessageDayKey(msg?.created_at);
            if (dayKey && dayKey !== previousDayKey) {
                fragment.appendChild(createDaySeparatorNode(msg.created_at, dayKey));
            }
            previousDayKey = dayKey;

            const msgKey = getMessageKey(msg);
            const isNew = !state.renderedKeys.has(msgKey);
            const groupLayout = MessageGroup(state.messages, absoluteIndex);
            let messageNode = reusableMessageNodesByKey.get(msgKey) || null;
            if (messageNode) {
                syncReusedMessageNodeState(messageNode, msg, groupLayout);
            } else {
                messageNode = MessageItem(msg, groupLayout);
                if (isNew && !suppressEnterAnimation) applyMessageEnterAnimation(messageNode, msg);
                if (messageSelectionController.isSelectionMode()) messageNode.classList.add('selecting');
                if (msg.id && messageSelectionController.hasSelectedMessage(String(msg.id))) {
                    messageNode.classList.add('selected');
                }
            }
            state.renderedKeys.add(msgKey);
            fragment.appendChild(messageNode);
        });

        fragment.appendChild(createVirtualSpacer(bottomSpacerHeight));
        state.lastRenderRange = range;
        chatMessages.replaceChildren(fragment);
        disconnectLazyMediaHydrationObserver();
        registerMediaElementsForLazyHydration(chatMessages);
        measureRenderedMessageHeights(state);

        if (forcedScrollTop !== null) {
            setChatScrollTop(forcedScrollTop);
            requestAnimationFrame(() => {
                if (!chatMessages) return;
                if (!chatId || String(chatId) !== String(currentChatId)) return;
                if (Math.abs(forcedScrollTop - chatMessages.scrollTop) > 1) {
                    setChatScrollTop(forcedScrollTop);
                }
            });
            saveChatScrollPosition(chatId);
            schedulePostRenderUiRefresh({ searchFilter: true, jumpButton: true, e2ePill: true });
        } else if (options.preserveHeightDelta && Number.isFinite(options.previousScrollTop) && Number.isFinite(options.previousScrollHeight)) {
            const expectedTop = options.previousScrollTop + (chatMessages.scrollHeight - options.previousScrollHeight);
            setChatScrollTop(expectedTop);
            requestAnimationFrame(() => {
                if (!chatMessages) return;
                if (!chatId || String(chatId) !== String(currentChatId)) return;
                const stabilizedTop = options.previousScrollTop + (chatMessages.scrollHeight - options.previousScrollHeight);
                if (Math.abs(stabilizedTop - chatMessages.scrollTop) > 1) {
                    setChatScrollTop(stabilizedTop);
                }
            });
            saveChatScrollPosition(chatId);
            schedulePostRenderUiRefresh({ searchFilter: true, jumpButton: true, e2ePill: true });
        } else if (options.scrollToBottom) {
            // \u041E\u0442\u043A\u043B\u0430\u0434\u044B\u0432\u0430\u0435\u043C \u0441\u043A\u0440\u043E\u043B\u043B \u0432\u043D\u0438\u0437 \u043D\u0430 \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0438\u0439 \u043A\u0430\u0434\u0440 - \u043A \u0442\u043E\u043C\u0443 \u043C\u043E\u043C\u0435\u043D\u0442\u0443 \u0431\u0440\u0430\u0443\u0437\u0435\u0440
            // \u0443\u0436\u0435 \u043F\u043E\u0441\u0447\u0438\u0442\u0430\u043B scrollHeight \u0441 \u043D\u043E\u0432\u044B\u043C \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435\u043C
            suppressChatScrollHandling = true;
            requestAnimationFrame(() => {
                if (!chatMessages) { suppressChatScrollHandling = false; return; }
                const max = Math.max(0, chatMessages.scrollHeight - chatMessages.clientHeight);
                chatMessages.scrollTop = max;
                requestAnimationFrame(() => {
                    suppressChatScrollHandling = false;
                    saveChatScrollPosition(chatId);
                    schedulePostRenderUiRefresh({ jumpButton: true });
                });
            });
            schedulePostRenderUiRefresh({ searchFilter: true, jumpButton: true, e2ePill: true });
        } else {
            saveChatScrollPosition(chatId);
            schedulePostRenderUiRefresh({ searchFilter: true, jumpButton: true, e2ePill: true });
        }
        savedMessagesUi?.syncCurrentChatMeta?.({
            chatId: currentChatId,
            contactId: currentContactId,
        });
    }

    function waitForPaintFrames(frameCount = 1) {
        const safeFrames = Math.max(1, Number(frameCount) || 1);
        return new Promise((resolve) => {
            const step = (remaining) => {
                requestAnimationFrame(() => {
                    if (remaining <= 1) {
                        resolve();
                        return;
                    }
                    step(remaining - 1);
                });
            };
            step(safeFrames);
        });
    }

    async function renderChatMessagesStable(chatId = currentChatId, options = {}) {
        if (!chatMessages || !chatId) return;
        if (String(chatId) !== String(currentChatId)) return;

        resizeComposerInput();
        updateChatMessagesBottomInset({ immediate: true });
        chatMessages.classList.add('is-hydrating');
        chatMessages.style.visibility = 'hidden';

        try {
            const state = getChatState(chatId);
            const beforeAvg = state?.averageMessageHeight || CHAT_DEFAULT_MESSAGE_HEIGHT;

            renderChatMessages(chatId, { ...options, force: true });
            await waitForPaintFrames(1);

            if (chatMessages && String(chatId) === String(currentChatId)) {
                // \u0412\u0442\u043E\u0440\u043E\u0439 \u043F\u0440\u043E\u0445\u043E\u0434 - \u0442\u043E\u043B\u044C\u043A\u043E \u0435\u0441\u043B\u0438 \u043E\u0446\u0435\u043D\u043A\u0430 \u0441\u0440\u0435\u0434\u043D\u0435\u0439 \u0432\u044B\u0441\u043E\u0442\u044B \u0441\u0438\u043B\u044C\u043D\u043E \u0440\u0430\u0437\u043E\u0448\u043B\u0430\u0441\u044C \u0441 \u0440\u0435\u0430\u043B\u044C\u043D\u043E\u0439
                // \u043F\u043E\u0441\u043B\u0435 \u043F\u0435\u0440\u0432\u043E\u0433\u043E measure (>15% \u0434\u0440\u0435\u0439\u0444). \u042D\u0442\u043E \u0443\u0431\u0438\u0440\u0430\u0435\u0442 \u0432\u0438\u0434\u0438\u043C\u044B\u0439 "\u043F\u0440\u044B\u0436\u043E\u043A" \u043D\u0430 \u0434\u043B\u0438\u043D\u043D\u044B\u0445
                // \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F\u0445, \u043D\u0435 \u043F\u043B\u0430\u0442\u044F \u0434\u0432\u043E\u0439\u043D\u044B\u043C rebuild \u043A\u0430\u0436\u0434\u044B\u0439 \u0440\u0430\u0437.
                const afterAvg = state?.averageMessageHeight || beforeAvg;
                const drift = Math.abs(afterAvg - beforeAvg) / Math.max(beforeAvg, 1);
                // Mobile chat-open transition is sensitive to extra full-window rerenders.
                // Keep the corrective second pass for desktop only.
                if (drift > 0.15 && !isMobileViewport()) {
                    updateChatMessagesBottomInset({ immediate: true });
                    renderChatMessages(chatId, { ...options, force: true });
                    await waitForPaintFrames(options.scrollToBottom ? 2 : 1);
                }
            }
        } finally {
            if (!chatMessages) return;
            chatMessages.style.visibility = '';
            chatMessages.classList.remove('is-hydrating');
            if (options?.animateReveal) {
                triggerChatHistoryRevealAnimation();
            }
        }
    }

    function scheduleForcedCurrentChatRerender(options = {}) {
        if (!currentChatId || !chatMessages) return;
        pendingForcedChatRerenderChatId = String(currentChatId);
        pendingForcedChatRerenderOptions = {
            force: true,
            scrollTop: chatMessages.scrollTop,
            ...(pendingForcedChatRerenderOptions || {}),
            ...options,
        };
        if (pendingForcedChatRerenderFrame) return;

        pendingForcedChatRerenderFrame = requestAnimationFrame(() => {
            const chatId = pendingForcedChatRerenderChatId;
            const rerenderOptions = pendingForcedChatRerenderOptions || { force: true };
            pendingForcedChatRerenderFrame = 0;
            pendingForcedChatRerenderChatId = '';
            pendingForcedChatRerenderOptions = null;
            if (!chatId || String(chatId) !== String(currentChatId)) return;
            renderChatMessages(chatId, rerenderOptions);
        });
    }

    function ChatContainer(chatId = currentChatId, options = {}) {
        renderChatMessages(chatId, options);
    }

    function clampMessageScale(value) {
        const parsed = Number.parseFloat(value);
        if (!Number.isFinite(parsed)) return 1;
        return Math.min(1.3, Math.max(0.9, parsed));
    }

    function applyMessageScale(value, { persist = true, rerender = true } = {}) {
        const scale = clampMessageScale(value);
        uiState.messageScale = scale;

        if (chatArea) {
            chatArea.style.setProperty('--chat-message-scale', scale.toFixed(2));
        }
        chatStates.forEach((chatState) => {
            chatState.messageHeights = new Map();
            chatState.averageMessageHeight = CHAT_DEFAULT_MESSAGE_HEIGHT;
            chatState.lastRenderRange = null;
        });

        if (persist) {
            try {
                localStorage.setItem(MESSAGE_SCALE_STORAGE_KEY, scale.toFixed(2));
            } catch (_) {
                // Ignore storage write failures.
            }
        }

        if (rerender && currentChatId && chatMessages) {
            ChatContainer(currentChatId, { force: true, scrollTop: chatMessages.scrollTop });
        }
    }

    if (typeof window !== 'undefined') {
        window.applyChatMessageScale = function (value, options = {}) {
            applyMessageScale(value, Object.assign({ persist: true, rerender: true }, options || {}));
        };
    }

    function SettingsPanel() {
        const storedScale = (() => {
            try {
                return localStorage.getItem(MESSAGE_SCALE_STORAGE_KEY);
            } catch (_) {
                return null;
            }
        })();

        applyMessageScale(storedScale || 1, { persist: false, rerender: false });
        refreshVisibleTimePreferenceRendering(document);
        window.addEventListener('storage', (event) => {
            const key = String(event.key || '');
            if (key === MESSAGE_SCALE_STORAGE_KEY) {
                applyMessageScale(event.newValue || 1, { persist: false, rerender: true });
                return;
            }
            if (key === TIME_FORMAT_STORAGE_KEY) {
                refreshVisibleTimePreferenceRendering(document);
            }
        });

        muteChatBtn?.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleCurrentChatMuted();
            closeHeaderDropdown();
        });

        e2eIndicator?.addEventListener('click', (event) => {
            event.preventDefault();
        });
    }

    function mergeVirtualRenderOptions(base = null, incoming = null) {
        const merged = { ...(base || {}) };
        const next = incoming || {};

        if (next.force) merged.force = true;
        if (next.scrollToBottom) {
            merged.scrollToBottom = true;
            delete merged.scrollTop;
            delete merged.preserveHeightDelta;
            delete merged.previousScrollTop;
            delete merged.previousScrollHeight;
        }

        if (next.preserveHeightDelta) merged.preserveHeightDelta = true;
        if (Number.isFinite(next.previousScrollTop)) merged.previousScrollTop = next.previousScrollTop;
        if (Number.isFinite(next.previousScrollHeight)) merged.previousScrollHeight = next.previousScrollHeight;

        if (Number.isFinite(next.scrollTop)) {
            merged.scrollTop = next.scrollTop;
            delete merged.scrollToBottom;
        }

        return merged;
    }

    function scheduleVirtualChatRender(chatId = currentChatId, options = {}) {
        const targetChatId = String(chatId || '');
        if (!targetChatId || targetChatId !== String(currentChatId)) return;

        pendingVirtualRenderChatId = targetChatId;
        pendingVirtualRenderOptions = mergeVirtualRenderOptions(pendingVirtualRenderOptions, options);

        if (pendingVirtualRenderOptions?.force) {
            if (chatVirtualRenderFrame) {
                cancelAnimationFrame(chatVirtualRenderFrame);
                chatVirtualRenderFrame = 0;
            }
            const immediateOptions = pendingVirtualRenderOptions || { force: true };
            pendingVirtualRenderChatId = '';
            pendingVirtualRenderOptions = null;
            renderChatMessages(targetChatId, immediateOptions);
            return;
        }

        if (chatVirtualRenderFrame) return;
        chatVirtualRenderFrame = requestAnimationFrame(() => {
            chatVirtualRenderFrame = 0;
            const scheduledChatId = pendingVirtualRenderChatId;
            const scheduledOptions = pendingVirtualRenderOptions || {};
            pendingVirtualRenderChatId = '';
            pendingVirtualRenderOptions = null;

            if (!scheduledChatId || scheduledChatId !== String(currentChatId)) return;
            renderChatMessages(scheduledChatId, scheduledOptions);
        });
    }

    function resizeComposerInput() {
        if (!messageInput) return;
        messageInput.style.height = 'auto';
        const computed = window.getComputedStyle(messageInput);
        const maxHeight = Number.parseFloat(computed.maxHeight) || 136;
        const minHeight = Number.parseFloat(computed.minHeight) || 32;
        const targetHeight = Math.min(messageInput.scrollHeight, maxHeight);
        messageInput.style.height = `${Math.max(targetHeight, minHeight)}px`;
        messageInput.classList.toggle('composer-scroll', messageInput.scrollHeight > maxHeight + 1);
        updateChatMessagesBottomInset();
    }

    const mobileThreadShell = createMobileThreadShell({
        chatArea,
        sidebar,
        prefersReducedMotion,
        scheduleComposerFocus,
        leaveCurrentChatRoom,
        isMobileViewport: () => isMobileViewport(),
    });

    // mobile-revealing/mobile-hiding and prefersReducedMotion are handled by createMobileThreadShell.
    function openChat() {
        // mobile-revealing/mobile-hiding and prefersReducedMotion are
        // handled inside createMobileThreadShell.openChat.
        mobileThreadShell.openChat();
    }

    function isMobileViewport() {
        return window.innerWidth <= 768;
    }

    function closeMobileChatView({ leaveRoom = true, animated = true } = {}) {
        mobileThreadShell.closeMobileChatView({ leaveRoom, animated });
    }

    function isComposerFocusBlocked() {
        if (!messageInput || messageInput.disabled) return true;
        if (headerSearchWrap?.classList.contains('active')) return true;
        if (headerDropdown?.classList.contains('active')) return true;
        if (partnerProfileDrawer?.classList.contains('active')) return true;
        if (document.querySelector('.modal.show')) return true;
        if (document.getElementById('deleteChatModal')) return true;
        const captionModal = document.getElementById('captionModal');
        if (captionModal?.classList.contains('is-open') && !captionModal.classList.contains('is-closing')) return true;
        const keyRestoreModal = document.getElementById('keyRestoreModal');
        if (keyRestoreModal?.classList.contains('is-open') && !keyRestoreModal.classList.contains('is-closing')) return true;
        if (document.getElementById('lightbox')?.classList.contains('active')) return true;

        const contextMenu = document.getElementById('messageContextMenu');
        const isContextMenuOpen = Boolean(
            contextMenu
            && contextMenu.getAttribute('aria-hidden') !== 'true'
            && (contextMenu.classList.contains('is-open') || contextMenu.classList.contains('is-opening'))
        );
        if (isContextMenuOpen) return true;
        if (reactionPicker && reactionPicker.classList.contains('active')) return true;
        return false;
    }

    function resetHorizontalViewportDrift() {
        const targets = [
            document.scrollingElement,
            document.documentElement,
            document.body,
            chatArea,
            chatMessages,
            chatInputArea,
        ];
        for (const target of targets) {
            if (!target) continue;
            try {
                if (target.scrollLeft) target.scrollLeft = 0;
            } catch (_) {
                // Some browser internals expose read-only scroll containers.
            }
        }
    }

    function scheduleComposerFocus({ delay = 0, force = false } = {}) {
        if (!messageInput) return;
        window.setTimeout(() => {
            if (!force) {
                if (isComposerFocusBlocked()) return;
                const active = document.activeElement;
                if (active && active !== document.body && active !== messageInput && !active.closest('#messageForm, #composerRow')) {
                    return;
                }
                if (window.matchMedia('(pointer: coarse)').matches && Date.now() - lastMobileKeyboardDismissAt < 900) {
                    return;
                }
            } else if (isComposerFocusBlocked()) {
                return;
            }
            if (force && window.matchMedia('(pointer: coarse)').matches && document.activeElement !== messageInput) return;

            requestAnimationFrame(() => {
                if (messageInput.disabled || isComposerFocusBlocked()) return;
                const end = messageInput.value.length;
                resetHorizontalViewportDrift();
                messageInput.focus({ preventScroll: true });
                try {
                    messageInput.setSelectionRange(end, end);
                } catch (_) {
                    // setSelectionRange may throw in some browsers/input modes.
                }
                resetHorizontalViewportDrift();
                requestAnimationFrame(resetHorizontalViewportDrift);
                window.setTimeout(resetHorizontalViewportDrift, 80);
            });
        }, delay);
    }

    if (backBtnMobile) {
        backBtnMobile.addEventListener('click', () => {
            if (document.getElementById('emojiPicker')?.classList.contains('active')) { document.dispatchEvent(new CustomEvent('sun-close-emoji-picker')); return; }
            if (currentChatId) {
                closeChatUI();
                return;
            }
            closeMobileChatView({ leaveRoom: true, animated: true });
        });
    }

    const mobileBackSwipeController = initMobileBackSwipe({
        isMobileViewport: () => isMobileViewport(),
        chatArea,
        sidebar,
        isProfileDrawerOpen,
        getCurrentChatId: () => currentChatId,
        closeChatUI,
        closeMobileChatView,
    });

    function isChatNearBottom(thresholdPx = CHAT_BOTTOM_THRESHOLD_PX) {
        if (!chatMessages) return true;
        const distance = chatMessages.scrollHeight - (chatMessages.scrollTop + chatMessages.clientHeight);
        return distance <= thresholdPx;
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

    // DOM snapshot cache for instant chat switching.
    const CHAT_DOM_SNAPSHOT_LIMIT = 5;
    const chatDomSnapshotOrder = [];

    function touchChatDomSnapshotLRU(chatId) {
        const key = String(chatId);
        const idx = chatDomSnapshotOrder.indexOf(key);
        if (idx >= 0) chatDomSnapshotOrder.splice(idx, 1);
        chatDomSnapshotOrder.push(key);
        while (chatDomSnapshotOrder.length > CHAT_DOM_SNAPSHOT_LIMIT) {
            const oldKey = chatDomSnapshotOrder.shift();
            const oldState = chatStates.get(oldKey);
            if (oldState) oldState.domSnapshot = null;
        }
    }

    function dropChatDomSnapshotLRU(chatId) {
        const key = String(chatId);
        const idx = chatDomSnapshotOrder.indexOf(key);
        if (idx >= 0) chatDomSnapshotOrder.splice(idx, 1);
    }

    function invalidateChatDomSnapshot(chatIdOrState) {
        const state = (chatIdOrState && typeof chatIdOrState === 'object' && 'messages' in chatIdOrState)
            ? chatIdOrState
            : (chatIdOrState ? getChatState(chatIdOrState) : null);
        if (!state) return;
        if (state.domSnapshot) state.domSnapshot = null;
        if (typeof chatIdOrState === 'string' || typeof chatIdOrState === 'number') {
            dropChatDomSnapshotLRU(chatIdOrState);
        }
    }

    function captureChatDomSnapshot(chatId) {
        if (!chatMessages || !chatId) return;
        const state = getChatState(chatId);
        if (!state.initialized || !state.lastRenderRange) return;
        if (chatMessages.childNodes.length === 0) return;
        const nodes = Array.from(chatMessages.childNodes);
        const scrollTop = Math.max(0, chatMessages.scrollTop || 0);
        // Snapshot current nodes without early detach to avoid flash during chat switch.
        state.domSnapshot = {
            nodes,
            range: { ...state.lastRenderRange },
            scrollTop,
            messagesLength: state.messages.length,
        };
        touchChatDomSnapshotLRU(chatId);
    }

    function restoreChatDomSnapshot(chatId) {
        if (!chatMessages || !chatId) return false;
        const state = getChatState(chatId);
        const snap = state.domSnapshot;
        if (!snap || !snap.nodes?.length) return false;
        // \u0421\u043D\u0430\u043F\u0448\u043E\u0442 \u0432\u0430\u043B\u0438\u0434\u0435\u043D, \u0442\u043E\u043B\u044C\u043A\u043E \u0435\u0441\u043B\u0438 messages \u043D\u0435 \u043C\u0435\u043D\u044F\u043B\u0438\u0441\u044C (range \u0438 \u0434\u043B\u0438\u043D\u0430 \u0441\u043E\u0432\u043F\u0430\u0434\u0430\u044E\u0442).
        if (!state.lastRenderRange) return false;
        if (snap.range.start !== state.lastRenderRange.start || snap.range.end !== state.lastRenderRange.end) return false;
        if (snap.messagesLength !== state.messages.length) return false;
        try {
            chatMessages.replaceChildren(...snap.nodes);
        } catch (_) {
            return false;
        }
        disconnectLazyMediaHydrationObserver();
        registerMediaElementsForLazyHydration(chatMessages);
        // \u0421\u043D\u0430\u043F\u0448\u043E\u0442 \u0443\u0436\u0435 \u043F\u0440\u0438\u0432\u044F\u0437\u0430\u043D \u043E\u0431\u0440\u0430\u0442\u043D\u043E \u043A live DOM - \u043E\u0441\u0432\u043E\u0431\u043E\u0436\u0434\u0430\u0435\u043C \u0441\u0441\u044B\u043B\u043A\u0443.
        state.domSnapshot = null;
        dropChatDomSnapshotLRU(chatId);
        // \u0412\u043E\u0441\u0441\u0442\u0430\u043D\u0430\u0432\u043B\u0438\u0432\u0430\u0435\u043C scrollTop \u0432 \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u043C \u043A\u0430\u0434\u0440\u0435, \u0447\u0442\u043E\u0431\u044B layout \u0443\u0441\u043F\u0435\u043B \u043E\u0431\u0441\u0447\u0438\u0442\u0430\u0442\u044C\u0441\u044F.
        const targetTop = Number.isFinite(snap.scrollTop) ? snap.scrollTop : 0;
        suppressChatScrollHandling = true;
        requestAnimationFrame(() => {
            if (!chatMessages) { suppressChatScrollHandling = false; return; }
            if (!chatId || String(chatId) !== String(currentChatId)) { suppressChatScrollHandling = false; return; }
            chatMessages.scrollTop = targetTop;
            requestAnimationFrame(() => {
                if (chatMessages && chatId && String(chatId) === String(currentChatId) && Math.abs(chatMessages.scrollTop - targetTop) > 1) {
                    chatMessages.scrollTop = targetTop;
                }
                suppressChatScrollHandling = false;
            });
        });
        return true;
    }

    function resolveSavedChatScrollTop(chatId = currentChatId) {
        if (!chatId) return null;
        const key = String(chatId);
        if (chatScrollPositions.has(key)) {
            const storedTop = Number(chatScrollPositions.get(key));
            if (Number.isFinite(storedTop)) return storedTop;
        }
        const state = getChatState(chatId);
        if (state.hasSavedScrollTop && Number.isFinite(state.savedScrollTop)) {
            return state.savedScrollTop;
        }
        return null;
    }

    function renderChatAtBottom(chatId = currentChatId) {
        if (!chatId) return;
        renderChatMessages(chatId, { force: true, scrollToBottom: true });
        keepChatPinnedToBottom = true;
    }

    let _bottomInsetFrame = 0;
    function isChatViewportPinnedToBottom(thresholdPx = CHAT_BOTTOM_THRESHOLD_PX) {
        if (!chatMessages) return true;
        const maxScrollTop = Math.max(0, chatMessages.scrollHeight - chatMessages.clientHeight);
        const distance = maxScrollTop - chatMessages.scrollTop;
        return distance <= thresholdPx;
    }

    function syncChatViewportToBottomIfNeeded(shouldPin) {
        if (!shouldPin || !chatMessages || !currentChatId) return;
        requestAnimationFrame(() => {
            if (!chatMessages || !currentChatId) return;
            setChatScrollTop(chatMessages.scrollHeight);
            saveChatScrollPosition(currentChatId);
            updateJumpToNewMessagesButton();
        });
    }

    function applyChatMessagesBottomInset() {
        if (!chatArea) return;
        const shouldPinToBottom = keepChatPinnedToBottom;
        const areaStyles = window.getComputedStyle(chatArea);
        const floatingGap = Number.parseFloat(areaStyles.getPropertyValue('--floating-composer-gap')) || 16;
        const messageToComposerGap = 8;
        let reserve = floatingGap;
        let inputHeight = 0;
        if (chatInputArea) {
            const cs = window.getComputedStyle(chatInputArea);
            const isVisible = cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
            if (isVisible) {
                inputHeight = Math.ceil(chatInputArea.getBoundingClientRect().height);
                if (inputHeight > 0) reserve = inputHeight + floatingGap + messageToComposerGap;
            }
        }
        chatArea.style.setProperty('--input-height', `${Math.max(0, inputHeight)}px`);
        chatArea.style.setProperty('--floating-composer-reserve', `${reserve}px`);
        syncChatViewportToBottomIfNeeded(shouldPinToBottom);

    }

    const runVisualViewportCssSync = createVisualViewportCssSyncer({
        appVhVar: '--app-vh',
        appVwVar: '--app-vw',
        topOffsetVar: '--vv-top-offset',
        leftOffsetVar: '--vv-left-offset',
        keyboardInsetVar: '--vv-keyboard-inset',
        composerBottomInsetVar: '--mobile-composer-bottom-inset',
        layoutKeyboardInsetVar: '--mobile-keyboard-layout-inset',
    });

    function syncVisualViewportCssVars() {
        runVisualViewportCssSync();
    }

    function syncViewportAndInsets(options = {}) {
        syncVisualViewportCssVars();
        updateChatMessagesBottomInset(options);
    }

    function updateChatMessagesBottomInset(options = {}) {
        if (!chatArea) return;
        if (options.immediate) {
            if (_bottomInsetFrame) {
                cancelAnimationFrame(_bottomInsetFrame);
                _bottomInsetFrame = 0;
            }
            applyChatMessagesBottomInset();
            return;
        }
        if (_bottomInsetFrame) return;
        _bottomInsetFrame = requestAnimationFrame(() => {
            _bottomInsetFrame = 0;
            applyChatMessagesBottomInset();
        });
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
                        keepChatPinnedToBottom = isChatNearBottom();
                    });
                } else {
                    scheduleVirtualChatRender(currentChatId, { force: true, scrollToBottom: true });
                    keepChatPinnedToBottom = true;
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

    window._activateFocusTrap   = activateFocusTrap;
    window._deactivateFocusTrap = deactivateFocusTrap;

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
        previewEl: document.getElementById('messageActionsPreview'),
        titleEl: document.getElementById('messageActionsTitle'),
        editButtonEl: document.getElementById('barEditBtn'),
        copyButtonEl: document.getElementById('barCopyBtn'),
        deleteButtonEl: document.getElementById('barDeleteBtn'),
        selectButtonEl: document.getElementById('barSelectBtn'),
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
    const replyBarController = initReplyBar({
        barEl: document.getElementById('replyBar'),
        textEl: document.getElementById('replyBarText'),
        labelEl: document.getElementById('replyBarLabel'),
        inputEl: messageInput,
        inputAreaEl: chatInputArea,
        formEl: messageForm,
        renderMessagePreviewHtml,
        applyEmojiGraphics,
    });
    const linkDraftBarController = initLinkDraftBar({
        barEl: document.getElementById('linkDraftBar'),
        textEl: document.getElementById('linkDraftText'),
        labelEl: document.getElementById('linkDraftLabel'),
        closeBtnEl: document.getElementById('cancelLinkDraftBtn'),
        inputEl: messageInput,
        formEl: messageForm,
        resizeComposerInput,
        scheduleComposerFocus,
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
    const pinnedBarController = initPinnedBar({
        barEl: document.getElementById('pinnedBar'),
        labelEl: document.querySelector('#pinnedBar .pinned-bar__label'),
        textEl: document.getElementById('pinnedBarText'),
        unpinButtonEl: document.getElementById('unpinBtn'),
        renderMessagePreviewHtml,
        applyEmojiGraphics,
        onScrollToMessage: (msgId) => window._scrollToMsg?.(msgId),
        onUnpin: (msgId) => {
            if (isChatBlocked()) return;
            if (!currentChatId) return;
            emitSocket('unpin_message', { chat_id: currentChatId, message_id: Number(msgId) });
        },
    });
    const favoriteBarController = initPinnedBar({
        barEl: document.getElementById('favoriteBar'),
        labelEl: document.querySelector('#favoriteBar .pinned-bar__label'),
        textEl: document.getElementById('favoriteBarText'),
        unpinButtonEl: document.getElementById('unfavoriteBtn'),
        renderMessagePreviewHtml,
        applyEmojiGraphics,
        singularLabel: '\u0418\u0437\u0431\u0440\u0430\u043D\u043D\u043E\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435',
        pluralLabelTemplate: '\u0418\u0437\u0431\u0440\u0430\u043D\u043D\u044B\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F {current}/{total}',
        onScrollToMessage: (msgId) => window._scrollToMsg?.(msgId),
        onUnpin: (msgId) => {
            if (isChatBlocked()) return;
            if (!currentChatId) return;
            emitSocket('unfavorite_message', { chat_id: currentChatId, message_id: Number(msgId) });
        },
    });
    const dateNavigatorController = initChatDateNavigator({
        chatMessagesEl: chatMessages,
        getCurrentChatId: () => currentChatId,
        getChatState,
        getMessageDayKey,
        loadOlderMessages,
        scrollToMessage: (messageId, options = {}) => _focusMessageById(messageId, options),
    });
    savedMessagesUi = createSavedMessagesUiController({
        currentUserId: CURRENT_USER_ID,
        getChatState,
        chatAreaEl: chatArea,
        profileDrawerEl: partnerProfileDrawer,
        chatTitleEl: chatTitle,
        chatOnlineStatusEl: document.getElementById('chatOnlineStatus'),
        chatPartnerAvatarEl: document.getElementById('chatPartnerAvatar'),
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
            getBlockChatBtn: () => document.getElementById('blockChatBtn'),
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
        scrollToMessage: (msgId) => window._scrollToMsg?.(msgId),
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
    let profileGroupActiveTab = 'members';
    // var-hoisted: контроллер группы (инициализируется выше) читает это
    // через геттер ещё до этой строки.
    // eslint-disable-next-line no-var
    var currentGroupProfile = null;
    function buildMemberInitials(displayName, username) {
        const source = String(displayName || username || '?').trim();
        return source.split(/\s+/).slice(0, 2).map((chunk) => chunk[0] || '').join('').toUpperCase() || '?';
    }
    function resolveMemberDisplayName(member) {
        return String(member?.display_name || member?.username || `Пользователь ${member?.user_id || ''}`).trim();
    }
    function formatGroupPresence(member) {
        if (member?.online) return '\u0432 \u0441\u0435\u0442\u0438';
        const lastSeen = String(member?.last_seen || '').trim();
        if (!lastSeen) return '\u0431\u044B\u043B(\u0430) \u043D\u0435\u0434\u0430\u0432\u043D\u043E';
        return formatLastSeenText(lastSeen);
    }
    function formatGroupMembersCountLabel(rawCount) {
        const count = Math.max(0, Number(rawCount) || 0);
        const language = String(window.SUN_I18N?.getLanguage?.() || '').toLowerCase();
        if (language === 'en') {
            return `${count} ${count === 1 ? 'member' : 'members'}`;
        }
        return `${count} \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u043E\u0432`;
    }
    function syncGroupDangerActionLabel(profile) {
        const isGroup = Boolean(profile?._group_profile);
        const menuDeleteLabel = profileDeleteChatMenuBtn?.querySelector('span');
        if (menuDeleteLabel) {
            menuDeleteLabel.textContent = isGroup ? '\u041F\u043E\u043A\u0438\u043D\u0443\u0442\u044C \u0433\u0440\u0443\u043F\u043F\u0443' : '\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0447\u0430\u0442';
        }
    }
    function renderGroupEditAvatar(profile) {
        if (!groupEditAvatarPreview) return;
        const displayName = String(profile?.display_name || '').trim();
        const avatarUrl = String(profile?.avatar_url || '').trim();
        const initials = buildMemberInitials(displayName || '\u0413\u0440\u0443\u043F\u043F\u0430', '');
        if (avatarUrl) {
            groupEditAvatarPreview.innerHTML = `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName || 'Group')}">`;
            return;
        }
        groupEditAvatarPreview.textContent = initials;
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
        getCurrentGroupProfile: () => currentGroupProfile,
        getCurrentChatId: () => currentChatId,
        refreshCurrentGroupProfileIfVisible: () => refreshCurrentGroupProfileIfVisible(),
    });

    function renderGroupEditMembers(profile) {
        if (!groupEditMembersList) return;
        const members = Array.isArray(profile?.members) ? profile.members : [];
        if (!members.length) {
            groupEditMembersList.innerHTML = '<div class="profile-group-members-empty">\u0423\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u0438 \u043F\u043E\u043A\u0430 \u043D\u0435 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u044B.</div>';
            return;
        }
        const myUserId = Number(CURRENT_USER_ID || 0);
        const myRole = normalizeGroupRole(profile?.my_role);
        const permissions = profile?.permissions || {};
        const canManageRoles = Boolean(permissions?.can_manage_roles || profile?.can_manage_admins);
        const canKick = Boolean(permissions?.can_kick);
        const canBan = Boolean(permissions?.can_ban);
        groupEditMembersList.innerHTML = members.map((member) => {
            const userId = Number(member?.user_id || 0);
            const displayName = resolveMemberDisplayName(member);
            const role = normalizeGroupRole(member?.role);
            const roleLabel = groupRoleLabel(role);
            const avatarUrl = String(member?.avatar_url || '').trim();
            const avatarHtml = avatarUrl
                ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName)}">`
                : escapeHtml(buildMemberInitials(displayName, member?.username || ''));
            const canMutateMember = userId > 0 && userId !== myUserId;

            let roleActionHtml = '';
            if (canManageRoles && canMutateMember) {
                if (role === 'member') {
                    roleActionHtml = `
                        <button type="button" class="group-edit-member-role-btn" data-group-role-target="${userId}" data-group-role-next="moderator">
                            Назначить модератором
                        </button>
                    `;
                } else if (role === 'moderator') {
                    roleActionHtml = `
                        <button type="button" class="group-edit-member-role-btn" data-group-role-target="${userId}" data-group-role-next="member">
                            Сделать участником
                        </button>
                    `;
                } else if (role === 'admin' && myRole === 'owner') {
                    roleActionHtml = `
                        <button type="button" class="group-edit-member-role-btn" data-group-role-target="${userId}" data-group-role-next="moderator">
                            Снять администратора
                        </button>
                    `;
                }
                if (myRole === 'owner' && role !== 'owner') {
                    roleActionHtml += `
                        <button type="button" class="group-edit-member-role-btn" data-group-role-target="${userId}" data-group-role-next="owner">
                            Передать владельца
                        </button>
                    `;
                }
                if (myRole === 'owner' && ['member', 'moderator'].includes(role)) {
                    roleActionHtml += `
                        <button type="button" class="group-edit-member-role-btn" data-group-role-target="${userId}" data-group-role-next="admin">
                            Назначить администратором
                        </button>
                    `;
                }
            }

            const moderationActions = [];
            if (canKick && canMutateMember) {
                moderationActions.push(
                    `<button type="button" class="group-edit-member-role-btn" data-group-remove-target="${userId}">Удалить участника</button>`,
                );
            }
            if (canBan && canMutateMember) {
                moderationActions.push(
                    `<button type="button" class="group-edit-member-role-btn" data-group-sanction-target="${userId}" data-group-sanction-action="mute_temp" data-group-sanction-duration="3600">Мут на 1 ч</button>`,
                );
                moderationActions.push(
                    `<button type="button" class="group-edit-member-role-btn" data-group-sanction-target="${userId}" data-group-sanction-action="ban_temp" data-group-sanction-duration="86400">Бан на 24 ч</button>`,
                );
            }
            return `
                <div class="group-edit-member-row">
                    <div class="group-edit-member-avatar">${avatarHtml}</div>
                    <div class="group-edit-member-copy">
                        <div class="group-edit-member-name">${escapeHtml(displayName)}</div>
                        <div class="group-edit-member-meta">${escapeHtml(roleLabel)}</div>
                    </div>
                    <div class="group-edit-member-actions">
                        ${roleActionHtml}
                        ${moderationActions.join('')}
                    </div>
                </div>
            `;
        }).join('');
    }

    function renderGroupMembers(profile) {
        if (!profileGroupMembers) return;
        const members = Array.isArray(profile?.members) ? profile.members : [];
        if (!members.length) {
            profileGroupMembers.innerHTML = '<div class="profile-group-members-empty">\u0423\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u0438 \u043F\u043E\u043A\u0430 \u043D\u0435 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u044B.</div>';
            return;
        }
        const myUserId = Number(CURRENT_USER_ID || 0);
        const pendingAppealId = Number(profile?.my_pending_group_appeal?.appeal_id || 0);

        profileGroupMembers.innerHTML = members.map((member) => {
            const memberUserId = Number(member?.user_id || 0);
            const displayName = resolveMemberDisplayName(member);
            const username = String(member.username || '').trim();
            const memberRowClickable = memberUserId > 0;
            const role = normalizeGroupRole(member?.role);
            const roleLabel = groupRoleLabel(role);
            const avatarUrl = String(member.avatar_url || '').trim();
            const avatarHtml = avatarUrl
                ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName)}">`
                : escapeHtml(buildMemberInitials(displayName, username));
            const activeSanction = member?.active_sanction || null;
            const sanctionLabel = formatGroupSanctionSummary(activeSanction, { formatLastSeenText });
            const subtitle = sanctionLabel || formatGroupPresence(member);
            const canAppealOwnSanction = Boolean(
                activeSanction
                && memberUserId > 0
                && memberUserId === myUserId
                && Number(activeSanction.sanction_id || 0) > 0
                && pendingAppealId <= 0,
            );
            const appealActionHtml = canAppealOwnSanction
                ? `<button type="button" class="group-edit-member-role-btn" data-group-appeal-sanction-id="${Number(activeSanction.sanction_id)}">Обжаловать</button>`
                : '';
            const pendingAppealHtml = (
                activeSanction
                && memberUserId === myUserId
                && pendingAppealId > 0
            ) ? '<div class="profile-group-member-meta">Appeal is pending review.</div>' : '';
            return `
                <div class="profile-group-member${memberRowClickable ? ' profile-group-member--clickable' : ''}"${memberRowClickable ? ` data-group-member-user-id="${memberUserId}" data-group-member-username="${escapeHtml(username)}" role="button" tabindex="0"` : ''}>
                    <div class="profile-group-member-avatar">${avatarHtml}</div>
                    <div class="profile-group-member-copy">
                        <div class="profile-group-member-name">${escapeHtml(displayName)}</div>
                        <div class="profile-group-member-meta">${escapeHtml(subtitle)}</div>
                        ${pendingAppealHtml}
                    </div>
                    <div class="profile-group-member-role-wrap">
                        <div class="profile-group-member-role">${escapeHtml(roleLabel)}</div>
                        ${appealActionHtml}
                    </div>
                </div>
            `;
        }).join('');
    }

    function setGroupProfileTab(tabKey) {
        const normalized = String(tabKey || '').trim().toLowerCase();
        const requestedTab = ['members', 'media', 'files', 'links'].includes(normalized) ? normalized : 'members';
        const mediaAvailability = getCurrentGroupMediaAvailability({
            chatId: currentChatId,
            getChatState,
        });
        syncGroupTabVisibility(profileGroupTabs, mediaAvailability);
        const nextTab = resolveGroupTabByAvailability(requestedTab, mediaAvailability);
        profileGroupActiveTab = nextTab;

        if (profileGroupTabs) {
            profileGroupTabs.querySelectorAll('[data-group-tab]').forEach((btn) => {
                const active = String(btn.getAttribute('data-group-tab') || '') === nextTab;
                btn.classList.toggle('is-active', active);
                btn.setAttribute('aria-selected', active ? 'true' : 'false');
            });
        }

        const showMembers = nextTab === 'members';
        profileGroupMembers?.classList.toggle('profile-group-section--hidden', !showMembers);
        if (profileMediaSection) {
            profileMediaSection.style.display = showMembers ? 'none' : '';
        }

        if (!showMembers && profileMediaPanelController) {
            const mappedTab = nextTab === 'files' ? 'files' : nextTab === 'links' ? 'links' : 'media';
            profileMediaPanelController.renderProfileMediaPanel({ preferredTab: mappedTab });
        }
    }

    function applyGroupProfileUi(profile) {
        const isGroupProfile = Boolean(profile?._group_profile);
        const canEditGroup = Boolean(profile?.can_edit_group);
        const permissions = profile?.permissions || {};
        const canOpenGroupManagePanel = Boolean(
            canEditGroup
            || permissions?.can_manage_roles
            || permissions?.can_kick
            || permissions?.can_ban,
        );
        currentGroupProfile = isGroupProfile ? profile : null;
        syncGroupPermissionsPanel(currentGroupProfile);
        const profileUsernameLine = document.getElementById('profileUsernameLine');
        const profileBioLine = document.getElementById('profileBioLine');
        const profileMetaBio = document.getElementById('profileMetaBio');
        const profileBioLabel = profileBioLine?.querySelector('.profile-info-label') || null;
        const profileRequestLine = document.getElementById('profileRequestLine');
        const profilePrivateLine = document.getElementById('profilePrivateLine');
        const copyUsernameMenuItem = profileMoreMenu?.querySelector('[data-profile-action="copy-username"]');
        const reportUserMenuItem = profileMoreMenu?.querySelector('[data-profile-action="report-user"]');
        const messageMenuItem = profileMoreMenu?.querySelector('[data-profile-action="message"]');

        partnerProfileDrawer?.classList.toggle('is-group-profile', isGroupProfile);
        syncGroupDangerActionLabel(profile);
        profileGroupEditBtn?.classList.toggle('profile-group-edit-btn--hidden', !(isGroupProfile && canOpenGroupManagePanel));
        profileGroupSection?.classList.toggle('profile-group-section--hidden', !isGroupProfile);
        if (profileUsernameLine) profileUsernameLine.style.display = isGroupProfile ? 'none' : '';
        if (isGroupProfile) {
            profileRequestLine?.classList.add('profile-info-line--hidden');
            profilePrivateLine?.classList.add('profile-info-line--hidden');
            if (profileRequestLine) profileRequestLine.style.display = 'none';
            if (profilePrivateLine) profilePrivateLine.style.display = 'none';
        }
        if (profileBioLine) {
            if (!isGroupProfile) {
                profileBioLine.style.display = '';
                if (profileBioLabel) profileBioLabel.textContent = '\u041E \u0441\u0435\u0431\u0435';
            } else {
                const description = String(
                    profile?.description
                    || profile?.chat_description
                    || profile?.group_description
                    || '',
                ).trim();
                profileBioLine.classList.toggle('profile-info-line--hidden', !description);
                profileBioLine.style.display = description ? '' : 'none';
                if (profileMetaBio) profileMetaBio.textContent = description;
                if (profileBioLabel) profileBioLabel.textContent = '\u041E\u043F\u0438\u0441\u0430\u043D\u0438\u0435';
            }
        }
        if (copyUsernameMenuItem) copyUsernameMenuItem.style.display = isGroupProfile ? 'none' : '';
        if (reportUserMenuItem) reportUserMenuItem.style.display = isGroupProfile ? 'none' : '';
        if (messageMenuItem) messageMenuItem.style.display = isGroupProfile ? 'none' : '';

        if (!isGroupProfile) {
            if (profileTopbarTitle) profileTopbarTitle.textContent = '\u0418\u043D\u0444\u043E\u0440\u043C\u0430\u0446\u0438\u044F';
            if (profileMediaSection) profileMediaSection.style.display = '';
            return;
        }

        if (profileTopbarTitle) profileTopbarTitle.textContent = '\u0418\u043D\u0444\u043E\u0440\u043C\u0430\u0446\u0438\u044F \u043E \u0433\u0440\u0443\u043F\u043F\u0435';
        const membersCount = Number(profile?.members_count || 0);
        const groupDisplayName = String(
            profile?.display_name
            || profile?.chat_name
            || window.currentPartnerData?.display_name
            || chatTitle?.textContent
            || 'Group chat'
        ).trim();
        if (profileDisplayName) {
            profileDisplayName.textContent = groupDisplayName;
        }
        if (profileLargeAvatar) {
            const avatarUrl = String(profile?.avatar_url || '').trim();
            if (avatarUrl) {
                profileLargeAvatar.removeAttribute('data-avatar-tint');
                profileLargeAvatar.innerHTML = `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(groupDisplayName || 'Group')}">`;
            } else {
                profileLargeAvatar.textContent = buildMemberInitials(groupDisplayName, '');
                applyFallbackAvatarTint(profileLargeAvatar, groupDisplayName);
            }
        }
        if (profileLastSeen) {
            profileLastSeen.textContent = formatGroupMembersCountLabel(membersCount);
        }
        if (isCurrentChatGroup() && String(currentChatId || '') === String(profile?.chat_id || '')) {
            const headerStatus = document.getElementById('chatOnlineStatus');
            if (headerStatus) {
                headerStatus.textContent = formatGroupMembersCountLabel(membersCount);
                headerStatus.classList.remove('chat-online-status--hidden');
                headerStatus.style.display = 'block';
                headerStatus.setAttribute('data-last-seen', '');
                headerStatus.dataset.state = 'group';
            }
        }

        renderGroupMembers(profile);
        renderGroupEditMembers(profile);
        renderGroupEditAvatar(profile);
        setGroupProfileTab(profileGroupActiveTab);
    }

    function refreshCurrentGroupProfileIfVisible() {
        if (!currentChatId) return;
        if (!isCurrentChatGroup()) return;
        if (!isProfileDrawerOpen()) return;
        loadAndShowPartnerProfile();
    }

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

    jumpToNewMessagesBtn?.addEventListener('click', () => {
        if (isProfileDrawerOpen()) {
            closePartnerProfileDrawer();
        }
        requestAutoScrollToBottom({ ifNearBottom: false, smooth: true });
    });

    const stopBottomInertiaOnUserInput = () => {
        cancelBottomInertiaScroll();
    };
    chatMessages?.addEventListener('wheel', stopBottomInertiaOnUserInput, { passive: true });
    chatMessages?.addEventListener('touchstart', stopBottomInertiaOnUserInput, { passive: true });
    chatMessages?.addEventListener('pointerdown', stopBottomInertiaOnUserInput, { passive: true });

    const handleMessageProfileTrigger = (event) => {
        const trigger = event.target?.closest?.('[data-open-profile-trigger][data-profile-user-id]');
        if (!trigger || !chatMessages?.contains(trigger)) return;
        if (messageSelectionController.isSelectionMode()) return;
        const targetUserId = Number.parseInt(trigger.getAttribute('data-profile-user-id') || '', 10);
        if (!Number.isFinite(targetUserId) || targetUserId <= 0) return;
        event.preventDefault();
        event.stopPropagation();
        openUserProfileById(targetUserId);
    };

    chatMessages?.addEventListener('click', handleMessageProfileTrigger);
    chatMessages?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        handleMessageProfileTrigger(event);
    });

    chatMessages?.addEventListener('scroll', () => {
        if (!currentChatId) return;
        if (suppressChatScrollHandling) return;
        if (reactionPickerController.isOpen()) closeReactionPicker();

        saveChatScrollPosition(currentChatId);
        scheduleVirtualChatRender(currentChatId);

        if (chatMessages.scrollTop <= CHAT_LOAD_MORE_THRESHOLD_PX) {
            loadOlderMessages(currentChatId);
        }

        const nearBottom = isChatNearBottom();
        keepChatPinnedToBottom = nearBottom;

        if (nearBottom && isWindowActiveForUnreadHandling() && openChatUnreadCount > 0) {
            resetOpenChatUnreadCounter({ markSeen: true });
        }
        updateJumpToNewMessagesButton();
    }, { passive: true });

    if (typeof ResizeObserver !== 'undefined' && chatInputArea) {
        const chatInputResizeObserver = new ResizeObserver(() => {
            updateChatMessagesBottomInset();
        });
        chatInputResizeObserver.observe(chatInputArea);
    }
    window.addEventListener('resize', syncViewportAndInsets);
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', syncViewportAndInsets);
        window.visualViewport.addEventListener('scroll', syncViewportAndInsets);
    }
    document.addEventListener('focusin', (event) => {
        if (event.target?.closest?.('#messageForm, #composerRow')) {
            syncViewportAndInsets({ immediate: true });
        }
    });
    document.addEventListener('focusout', (event) => {
        if (event.target?.closest?.('#messageForm, #composerRow')) {
            window.setTimeout(() => syncViewportAndInsets({ immediate: true }), 0);
            window.setTimeout(() => syncViewportAndInsets({ immediate: true }), 220);
        }
    });
    syncViewportAndInsets({ immediate: true });

    // \u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 \u043A \u043A\u043E\u043C\u043D\u0430\u0442\u0435 \u0447\u0430\u0442\u0430
    function joinChatRoom(chatId) {
        if (chatId) {
            emitSocket('join', { chat_id: chatId });
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
    if (contactsList) {
        contactsList.addEventListener('click', function(e) {
            const contactItem = e.target.closest('.contact-item');
            if (contactItem) {
                window.closeCommandPalette?.();
                setActiveContactItem(contactItem);
                try {
                    contactItem.scrollIntoView({ block: 'nearest' });
                } catch (_) {
                    contactItem.scrollIntoView({ block: 'nearest' });
                }

                const previousChatId = currentChatId;
                const previousDraftValue = String(messageInput?.value || '');
                if (previousChatId && String(previousChatId) !== String(contactItem.getAttribute('data-chat-id'))) {
                    void flushDraftSaveForChat(previousChatId, previousDraftValue, { force: true });
                }
                if (previousChatId) saveChatScrollPosition(previousChatId);
                const nextChatId = contactItem.getAttribute('data-chat-id');
                if (previousChatId && String(previousChatId) !== String(nextChatId)) {
                    abortHistoryRequestsForChat(previousChatId);
                    const reduceMotion = prefersReducedMotionSetting();
                    const useDesktopSwitchMotion = !isMobileViewport() && !reduceMotion;
                    if (chatArea && useDesktopSwitchMotion) {
                        chatArea.classList.remove('is-switching');
                    }
                    if (useDesktopSwitchMotion) {
                        try {
                            contactItem.classList.remove('contact-just-activated');
                            // force reflow to restart animation
                            void contactItem.offsetWidth;
                            contactItem.classList.add('contact-just-activated');
                            window.setTimeout(() => {
                                contactItem.classList.remove('contact-just-activated');
                            }, 620);
                        } catch (_) {}
                    }
                }
                closeReactionPicker();
                if (isVoiceRecordingActive()) {
                    stopVoiceRecording({ reason: 'cancel' }).catch(() => {});
                }

                // \u0421\u043D\u0438\u043C\u0430\u0435\u043C DOM-\u0441\u043D\u0430\u043F\u0448\u043E\u0442 \u043F\u043E\u043A\u0438\u0434\u0430\u0435\u043C\u043E\u0433\u043E \u0447\u0430\u0442\u0430 \u0434\u043B\u044F \u043C\u0433\u043D\u043E\u0432\u0435\u043D\u043D\u043E\u0433\u043E \u0432\u043E\u0437\u0432\u0440\u0430\u0442\u0430.
                if (previousChatId && String(previousChatId) !== String(contactItem.getAttribute('data-chat-id'))) {
                    captureChatDomSnapshot(previousChatId);
                }

                currentChatId = contactItem.getAttribute('data-chat-id');
                currentContactId = contactItem.getAttribute('data-contact-id');
                const isGroupChat = String(contactItem.getAttribute('data-is-group') || '') === '1';
                chatArea?.classList.toggle('is-group-chat', isGroupChat);
                const isSwitchingChat = String(previousChatId || '') !== String(currentChatId || '');
                if (isSwitchingChat) {
                    hideTyping();
                }
                if (isSwitchingChat && previousChatId) {
                    syncDraftPreviewForContact(previousChatId, previousDraftValue, new Date().toISOString());
                }
                tabAlertController.clearAlertForChat(currentChatId);
                persistLastActiveChatId(currentChatId);
                syncBrowserUrlForActiveChat(contactItem);
                window.currentContactPublicKey = contactItem.getAttribute('data-public-key');
                const contactBlockState = {
                    blocked_by_me: contactItem.getAttribute('data-blocked-by-me') === '1',
                    blocked_me: contactItem.getAttribute('data-blocked-me') === '1',
                };

                const nameEl = contactItem.querySelector('.contact-name');
                const nameText = nameEl ? nameEl.textContent : '';
                chatTitle.textContent = nameText;

                // \u041E\u0431\u043D\u043E\u0432\u043B\u044F\u0435\u043C \u0430\u0432\u0430\u0442\u0430\u0440 \u043F\u0430\u0440\u0442\u043D\u0451\u0440\u0430 \u0432 \u0445\u0435\u0434\u0435\u0440\u0435 \u0447\u0430\u0442\u0430 (\u0431\u0435\u0437 \u0438\u043D\u0434\u0438\u043A\u0430\u0442\u043E\u0440\u0430 \u0441\u0442\u0430\u0442\u0443\u0441\u0430)
                const partnerAvatar = document.getElementById('chatPartnerAvatar');
                if (partnerAvatar) {
                    const avatarEl = contactItem.querySelector('.contact-avatar');
                    if (avatarEl) {
                        // \u041A\u043E\u043F\u0438\u0440\u0443\u0435\u043C \u0442\u043E\u043B\u044C\u043A\u043E \u0438\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u0435 \u0438\u043B\u0438 \u0438\u043D\u0438\u0446\u0438\u0430\u043B\u044B, \u0431\u0435\u0437 \u0442\u043E\u0447\u043A\u0438 \u0441\u0442\u0430\u0442\u0443\u0441\u0430
                        const img = avatarEl.querySelector('img');
                        if (img) {
                            partnerAvatar.removeAttribute('data-avatar-tint');
                            partnerAvatar.innerHTML = `<img class="contact-avatar__img" src="${escapeHtml(img.getAttribute('src'))}" alt="\u0410\u0432\u0430\u0442\u0430\u0440 \u0441\u043E\u0431\u0435\u0441\u0435\u0434\u043D\u0438\u043A\u0430">`;
                        } else {
                            // \u0415\u0441\u043B\u0438 \u043D\u0435\u0442 \u043A\u0430\u0440\u0442\u0438\u043D\u043A\u0438, \u0431\u0435\u0440\u0435\u043C \u0438\u043D\u0438\u0446\u0438\u0430\u043B\u044B
                            partnerAvatar.textContent = avatarEl.firstChild.textContent.trim();
                            const sourceTint = String(avatarEl.getAttribute('data-avatar-tint') || '').trim();
                            if (sourceTint) {
                                partnerAvatar.setAttribute('data-avatar-tint', sourceTint);
                            } else {
                                applyFallbackAvatarTint(partnerAvatar, nameText);
                            }
                        }
                    }
                    partnerAvatar.style.display = 'flex';
                }

                updateE2EIndicator();
                applyChatBlockState(contactBlockState, { syncChatRoom: false });
                getChatState(currentChatId);
                const isSavedMessagesChat = savedMessagesUi.applyChatMode({
                    contactItem,
                    chatId: currentChatId,
                });
                if (isSwitchingChat) {
                    prefillComposerDraftFromContactItem(contactItem);
                    void loadDraftForChat(currentChatId, { fallbackContactItem: contactItem });
                }
                syncForwardDraftBarForCurrentChat();
                resetOpenChatUnreadCounter();
                closeMessageActionsBar();
                if (isEditingMessageId) {
                    cancelEdit();
                }
                if (messageSelectionController.isSelectionMode()) {
                    toggleSelectionMode(false);
                }
                showChatContent(true);
                if (window.innerWidth > 768) {
                    scheduleComposerFocus({ force: true });
                }

                // \u0417\u0430\u0433\u0440\u0443\u0436\u0430\u0435\u043C \u043E\u043D\u043B\u0430\u0439\u043D-\u0441\u0442\u0430\u0442\u0443\u0441
                const cId = contactItem.getAttribute('data-contact-id');
                const membersCount = Math.max(0, Number(contactItem.getAttribute('data-members-count') || 0) || 0);
                window.currentPartnerId = isGroupChat ? String(currentChatId || '') : cId;
                chatPartnerHeaderLink?.setAttribute('data-partner-id', cId || (isGroupChat ? String(currentChatId || '') : ''));
                chatHeader?.setAttribute('data-partner-id', cId || (isGroupChat ? String(currentChatId || '') : ''));
                window.currentPartnerData = {
                    userId: cId ? Number(cId) : null,
                    display_name: nameText || '',
                    username: String(contactItem.getAttribute('data-contact-username') || '').trim(),
                    public_key: window.currentContactPublicKey || '',
                    block_state: normalizeBlockState(contactBlockState),
                    chat_id: String(currentChatId || ''),
                    _group_profile: isGroupChat,
                    members_count: isGroupChat ? membersCount : 0,
                };
                if (isSavedMessagesChat) {
                    onlineStatusController.reset({ loading: false });
                    savedMessagesUi.syncCurrentChatMeta({
                        chatId: currentChatId,
                        contactId: currentContactId,
                    });
                } else if (isGroupChat) {
                    onlineStatusController.reset({ loading: false });
                    const onlineStatusEl = document.getElementById('chatOnlineStatus');
                    if (onlineStatusEl) {
                        const knownMembersCount = Number(window.currentPartnerData?.members_count || 0);
                        onlineStatusEl.textContent = formatGroupMembersCountLabel(knownMembersCount);
                        onlineStatusEl.classList.remove('chat-online-status--hidden');
                        onlineStatusEl.style.display = 'block';
                        onlineStatusEl.setAttribute('data-last-seen', '');
                        onlineStatusEl.dataset.state = 'group';
                    }
                } else {
                    onlineStatusController.reset({ loading: true });
                    loadOnlineStatus(cId);
                }

                fetchChatHistory(currentChatId).catch((error) => {
                    console.error('Failed to fetch chat history:', error);
                    showToast('\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0438\u0441\u0442\u043E\u0440\u0438\u044E \u0447\u0430\u0442\u0430.', 'danger');
                });

                // \u0415\u0441\u043B\u0438 \u0431\u043E\u043A\u043E\u0432\u0430\u044F \u043F\u0430\u043D\u0435\u043B\u044C \u043F\u0440\u043E\u0444\u0438\u043B\u044F \u043E\u0442\u043A\u0440\u044B\u0442\u0430 - \u043E\u0431\u043D\u043E\u0432\u043B\u044F\u0435\u043C \u0435\u0451 \u0434\u043B\u044F \u043D\u043E\u0432\u043E\u0433\u043E \u043A\u043E\u043D\u0442\u0430\u043A\u0442\u0430
                if (partnerProfileDrawer && partnerProfileDrawer.classList.contains('active')) {
                    loadAndShowPartnerProfile();
                }

                if (previousChatId !== currentChatId) {
                    if (previousChatId) emitSocket('leave', { chat_id: previousChatId });
                    if (!isChatBlocked()) {
                        joinChatRoom(currentChatId);
                    }
                }

                // \u041E\u0442\u043C\u0435\u0447\u0430\u0435\u043C \u043A\u0430\u043A \u043F\u0440\u043E\u0447\u0438\u0442\u0430\u043D\u043D\u044B\u0435 \u0447\u0435\u0440\u0435\u0437 Socket.IO
                if (!isChatBlocked()) {
                    emitSocket('messages_seen', { chat_id: currentChatId });
                }

                if (isMobileViewport()) {
                    openChat();
                }
            }
        });

        if (!hasAttemptedInitialChatRestore) {
            hasAttemptedInitialChatRestore = restoreLastActiveChatSelection();
        }
    }

    // -- \u0423\u0434\u0430\u043B\u0435\u043D\u0438\u0435 \u0447\u0430\u0442\u0430 (\u0432\u044B\u0431\u043E\u0440 \u0440\u0435\u0436\u0438\u043C\u0430) --
    if (deleteChatBtn) {
        deleteChatBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeHeaderDropdown();
            const targetChatId = String(currentChatId || '').trim();
            if (!targetChatId) return;
            const isGroup = isCurrentChatGroup();
            showDeleteChatDialog(targetChatId, {
                onDeleted: () => clearLocalChatDataAfterDeletion(targetChatId),
                onReload: loadContacts,
                isGroup,
            });
        });
    }

    function applyPinnedStateForChat(chatId, { isPinned, pinOrder } = {}) {
        const item = resolveContactItemByChatId(chatId);
        if (item) {
            _applyPinnedState(item, {
                isPinned,
                pinOrder,
                pinnedCount: getPinnedContactsCount(),
            });
        }
        sortContactsList();
        syncProfileMoreMenuChatActions();
    }

    async function updateChatPinnedState(chatId, isPinned) {
        const normalizedChatId = String(chatId || '').trim();
        if (!normalizedChatId) return false;
        if (isPinned && !canPinMoreChats(normalizedChatId)) {
            showToast(`\u041C\u043E\u0436\u043D\u043E \u0437\u0430\u043A\u0440\u0435\u043F\u0438\u0442\u044C \u043D\u0435 \u0431\u043E\u043B\u0435\u0435 ${PINNED_CHATS_LIMIT} \u0447\u0430\u0442\u043E\u0432.`, 'warning');
            return false;
        }
        try {
            const response = await fetch(withAppRoot(isPinned ? '/pin_chat' : '/unpin_chat'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
                body: JSON.stringify({ chat_id: normalizedChatId }),
            });
            const payload = await response.json();
            if (!payload?.success) {
                showToast(payload?.error || (isPinned ? '\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u043A\u0440\u0435\u043F\u0438\u0442\u044C \u0447\u0430\u0442' : '\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u0442\u043A\u0440\u0435\u043F\u0438\u0442\u044C \u0447\u0430\u0442'), 'danger');
                return false;
            }
            applyPinnedStateForChat(normalizedChatId, {
                isPinned,
                pinOrder: payload?.pin_order,
            });
            return true;
        } catch (_) {
            showToast(isPinned ? '\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u043A\u0440\u0435\u043F\u0438\u0442\u044C \u0447\u0430\u0442' : '\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u0442\u043A\u0440\u0435\u043F\u0438\u0442\u044C \u0447\u0430\u0442', 'danger');
            return false;
        }
    }

    // -- \u041A\u043E\u043D\u0442\u0435\u043A\u0441\u0442\u043D\u043E\u0435 \u043C\u0435\u043D\u044E \u043A\u043E\u043D\u0442\u0430\u043A\u0442\u0430 (\u043F\u0440\u0430\u0432\u0430\u044F \u043A\u043D\u043E\u043F\u043A\u0430 \u043C\u044B\u0448\u0438 \u043D\u0430 \u0441\u0430\u0439\u0434\u0431\u0430\u0440\u0435) --
    initContactContextMenu({
        contactsList,
        menuEl: document.getElementById('contactContextMenu'),
        pinButtonEl: document.getElementById('ctxPinChat'),
        unpinButtonEl: document.getElementById('ctxUnpinChat'),
        toggleMuteButtonEl: document.getElementById('ctxToggleMuteChat'),
        deleteButtonEl: document.getElementById('ctxDeleteChat'),
        getCsrfToken,
        showToast,
        showDeleteChatDialog,
        onDeleteChat: (deletedChatId) => clearLocalChatDataAfterDeletion(deletedChatId),
        onReloadChats: loadContacts,
        isChatMuted,
        onToggleMute: ({ chatId }) => {
            toggleChatMuted(chatId);
        },
        maxPinnedCount: PINNED_CHATS_LIMIT,
        getPinnedCount: getPinnedContactsCount,
        onPinStateChange: ({ chatId, isPinned, pinOrder }) => {
            applyPinnedStateForChat(chatId, { isPinned, pinOrder });
        },
    });

    function updatePinIcon(chatId, isPinned) {
        _updatePinIcon(chatId, isPinned);
    }

    function sortContactsList() {
        _sortContactsList(contactsList);
    }

    // -- Drag-and-drop \u0434\u043B\u044F \u0437\u0430\u043A\u0440\u0435\u043F\u043B\u0451\u043D\u043D\u044B\u0445 \u0447\u0430\u0442\u043E\u0432 --
    initPinnedContactsDnD({
        contactsList,
        getCsrfToken,
    });

    // -- Header More Button (three-dots dropdown) --
    document.getElementById('headerMoreBtn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleHeaderDropdown();
    });

    document.getElementById('searchChatMenuBtn')?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeHeaderDropdown();
        document.getElementById('searchChatBtn')?.click();
    });

    headerSearchCalendarBtn?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!currentChatId) return;
        dateNavigatorController.open('');
    });

    document.getElementById('selectMessagesMenuBtn')?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeHeaderDropdown();
        if (!messageSelectionController.isSelectionMode()) {
            toggleSelectionMode(true);
        }
    });

    document.getElementById('exportChatBtn')?.addEventListener('click', async () => {
        closeHeaderDropdown();
        await exportChatHistory();
    });
    reportUserMenuBtn?.addEventListener('click', () => {
        closeHeaderDropdown();
        void handleProfileAction('report-user');
    });

    async function exportChatHistory() {
        if (!currentChatId) return;
        const state = getChatState(currentChatId);
        while (state.hasMoreBefore && !state.isLoadingOlder) {
            const loaded = await loadOlderMessages(currentChatId);
            if (!loaded) break;
        }
        const partnerName = document.getElementById('chatTitle')?.textContent || '\u0421\u043E\u0431\u0435\u0441\u0435\u0434\u043D\u0438\u043A';
        const myName = currentDisplayName || currentUsername || '\u0412\u044B';
        const lines = [
            `\u0427\u0430\u0442 \u0441 ${partnerName}`,
            `\u042D\u043A\u0441\u043F\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u043E: ${new Date().toLocaleString('ru')}`,
            '-'.repeat(40),
        ];
        state.messages.forEach((msg) => {
            const sender = msg.sender === 'self' ? myName : partnerName;
            const time = formatTime(msg.created_at);
            const content = typeof msg.message === 'string' ? msg.message : '[\u0444\u0430\u0439\u043B]';
            lines.push(`[${time}] ${sender}: ${content}`);
        });
        const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `chat_${partnerName}_${new Date().toISOString().slice(0, 10)}.txt`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u044D\u043A\u0441\u043F\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0430', 'success');
    }

    // -- Global Click Manager --
    document.addEventListener('sun-close-header-dropdown', closeHeaderDropdown);
    document.addEventListener('click', (e) => {
        // Header Dropdown Close
        if (headerDropdown && !e.target.closest('.header-more-actions')) {
            closeHeaderDropdown();
        }
        if (profileMoreMenu && !e.target.closest('.profile-topbar-more')) {
            closeProfileMoreMenu();
        }
    });

    const profileOpenIgnoreSelector = [
        '#backBtnMobile',
        '#pinnedBar',
        '.pinned-bar',
        '.btn-icon',
        '.header-more-actions',
        '.header-dropdown',
        '.dropdown-item',
        '.header-search-wrap',
        '.header-selection-wrap',
        'input',
        'textarea',
        'button',
        'a',
    ].join(', ');

    function handleProfileHeaderOpen(event) {
        handleProfileHeaderOpenFlow({
            event,
            resolveCurrentPartnerId,
            profileOpenIgnoreSelector,
            setCurrentPartnerId: (value) => {
                window.currentPartnerId = value;
            },
            setChatPartnerHeaderId: (value) => {
                chatPartnerHeaderLink?.setAttribute('data-partner-id', value);
            },
            setChatHeaderPartnerId: (value) => {
                chatHeader?.setAttribute('data-partner-id', value);
            },
            isProfileDrawerOpen,
            loadAndShowPartnerProfile,
        });
    }

    chatHeader?.addEventListener('click', handleProfileHeaderOpen);
    chatPartnerHeaderLink?.addEventListener('click', handleProfileHeaderOpen);
    chatPartnerHeaderLink?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        handleProfileHeaderOpen(event);
    });

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
            const map = { photos: '\u0424\u043E\u0442\u043E', files: '\u0424\u0430\u0439\u043B\u044B', links: '\u0421\u0441\u044B\u043B\u043A\u0438' };
            const sectionName = map[mediaType] || '\u041A\u043E\u043D\u0442\u0435\u043D\u0442';
            showToast(`\u0420\u0430\u0437\u0434\u0435\u043B "${sectionName}" \u0431\u0443\u0434\u0435\u0442 \u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D \u0432 \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u043C \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0438.`, 'info');
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
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && profileMoreMenu?.classList.contains('active')) {
            closeProfileMoreMenu();
            return;
        }
        if (e.key === 'Escape' && isProfileDrawerOpen()) {
            closePartnerProfileDrawer();
        }
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
        if (currentChatId) {
            emitSocket('stop_typing', { chat_id: currentChatId });
        }
        voiceTypingSignal.stopAll();
        if (typingTimeout) {
            clearTimeout(typingTimeout);
            typingTimeout = null;
        }
        lastTypingEmitAt = 0;
        clearStoredLastActiveChatId(closedChatId);

        if (currentChatId) saveChatScrollPosition(currentChatId);
        if (closedChatId) abortHistoryRequestsForChat(closedChatId);
        if (closedChatId) captureChatDomSnapshot(closedChatId);
        disconnectLazyMediaHydrationObserver();
        keepChatPinnedToBottom = false;
        pendingBottomScroll = false;
        if (pendingBottomScrollFrame) {
            cancelAnimationFrame(pendingBottomScrollFrame);
            pendingBottomScrollFrame = 0;
        }
        cancelBottomInertiaScroll();
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
        const onlineEl = document.getElementById('chatOnlineStatus');
        if (onlineEl) onlineEl.style.display = 'none';
        const partnerAvatar = document.getElementById('chatPartnerAvatar');
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
    let typingTimeout = null;
    let lastTypingEmitAt = 0;
    const voiceTypingSignal = createTypingSignalHeartbeat({
        emitSocket,
        getChatId: () => currentChatId,
        isBlocked: () => isChatBlocked(),
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
        if (!currentChatId || isEditingMessageId || isChatBlocked()) return;
        const now = Date.now();
        if ((now - lastTypingEmitAt) >= TYPING_EMIT_INTERVAL_MS) {
            emitSocket('typing', { chat_id: currentChatId });
            lastTypingEmitAt = now;
        }
        if (typingTimeout) {
            clearTimeout(typingTimeout);
        }
        typingTimeout = setTimeout(() => {
            if (currentChatId) {
                emitSocket('stop_typing', { chat_id: currentChatId });
            }
            lastTypingEmitAt = 0;
        }, 2000);
    }

    function onComposerStopTyping() {
        if (typingTimeout) {
            clearTimeout(typingTimeout);
            typingTimeout = null;
        }
        if (currentChatId) {
            emitSocket('stop_typing', { chat_id: currentChatId });
        }
        lastTypingEmitAt = 0;
    }

    function onVoiceRecordingPresenceChange(isRecording) {
        if (!currentChatId || isChatBlocked()) return;
        if (typingTimeout) {
            clearTimeout(typingTimeout);
            typingTimeout = null;
        }
        if (isRecording) {
            voiceTypingSignal.start('voice');
            lastTypingEmitAt = Date.now();
            return;
        }
        voiceTypingSignal.stop('voice');
        lastTypingEmitAt = 0;
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

    function isCurrentUserReactionReactor(reactor) {
        return _isCurrentUserReactionReactor(reactor, currentUserPublicKey);
    }

    function buildCurrentUserReactionReactor() {
        return _buildCurrentUserReactionReactor({
            currentUserPublicKey: currentUserPublicKey || '',
            currentDisplayName: currentDisplayName || currentUsername || '\u0412\u044B',
            currentUsername: currentUsername || '',
            currentAvatarUrl: currentAvatarUrl || '',
        });
    }

    function normalizeMessageReactions(rawReactions) {
        return _normalizeMessageReactions(rawReactions, { currentUserPublicKey });
    }

    function getReactionEventTimestamp(rawValue) {
        const date = parseUtcDate(typeof rawValue === 'string' ? rawValue : '');
        return date ? date.getTime() : Date.now();
    }

    function buildMessageReactionsHtml(msgId, rawReactions) {
        return _buildMessageReactionsHtml(msgId, rawReactions, { currentUserPublicKey });
    }

    function resolveMessageReactionLayoutState(messageEl, bubble = messageEl?.querySelector('.bubble')) {
        if (!messageEl || !bubble) {
            return {
                isMediaBubble: false,
                isAudioBubble: false,
                useOutsidePlacement: false,
            };
        }

        const isImageBubble = bubble.classList.contains('bubble--image');
        const isVideoBubble = bubble.classList.contains('bubble--video');
        const isAudioBubble = bubble.classList.contains('bubble--audio');
        const useOutsidePlacement = (isImageBubble || isVideoBubble) && !isMobileReactionInsideMode();

        messageEl.classList.toggle('message-reactions-outside', useOutsidePlacement);

        return {
            isMediaBubble: isImageBubble || isVideoBubble || isAudioBubble,
            isAudioBubble,
            useOutsidePlacement,
        };
    }

    function syncMessageBubbleLayoutClasses(messageEl) {
        if (!messageEl) return;
        const stack = messageEl.querySelector('.message-stack');
        if (!stack) return;
        const bubble = messageEl.querySelector('.bubble');
        if (!bubble) return;

        const { isMediaBubble, isAudioBubble, useOutsidePlacement } = resolveMessageReactionLayoutState(messageEl, bubble);
        const directChildren = Array.from(bubble.children || []);
        const existingFooter = directChildren.find((child) => child.classList?.contains('message-footer')) || null;
        const messageText = directChildren.find((child) => child.classList?.contains('message-text')) || null;
        const audioBody = directChildren.find((child) => child.classList?.contains('audio-message-body')) || null;
        const meta = directChildren.find((child) => child.classList?.contains('msg-meta') || child.classList?.contains('message-meta'))
            || audioBody?.querySelector(':scope > .msg-meta, :scope > .message-meta')
            || existingFooter?.querySelector('.msg-meta, .message-meta')
            || null;
        const reactionRow = directChildren.find((child) => child.classList?.contains('message-reactions'))
            || existingFooter?.querySelector('.message-reactions')
            || Array.from(stack.children || []).find((child) => child !== bubble && child.classList?.contains('message-reactions'))
            || null;
        const hasReactionItems = Boolean(reactionRow?.classList?.contains('has-items'));
        const hasEditedMeta = Boolean(meta?.querySelector?.('.msg-edited'));
        bubble.classList.toggle('bubble--text', Boolean(messageText) && !isMediaBubble);
        const shouldUseFooter = !useOutsidePlacement && Boolean(meta) && hasReactionItems;

        if (shouldUseFooter) {
            const footer = existingFooter || document.createElement('div');
            if (!existingFooter) {
                footer.className = 'message-footer';
                bubble.append(footer);
            }
            if (reactionRow) footer.append(reactionRow);
            footer.append(meta);
            footer.classList.toggle('has-reactions', hasReactionItems);
            bubble.classList.remove('bubble--text-has-reactions');
            bubble.classList.remove('bubble--text-meta-edited');
            bubble.classList.toggle('bubble--audio-footer-meta', Boolean(isAudioBubble));
            return;
        }

        if (existingFooter) {
            if (reactionRow?.parentElement === existingFooter) {
                if (useOutsidePlacement) {
                    stack.append(reactionRow);
                } else {
                    existingFooter.before(reactionRow);
                }
            }
            if (meta?.parentElement === existingFooter) {
                if (isAudioBubble && audioBody) {
                    audioBody.append(meta);
                } else {
                    existingFooter.before(meta);
                }
            }
            existingFooter.remove();
        }

        if (reactionRow) {
            if (useOutsidePlacement) {
                if (reactionRow.parentElement !== stack) {
                    stack.append(reactionRow);
                }
            } else if (reactionRow.parentElement === stack) {
                bubble.append(reactionRow);
            }
        }

        bubble.classList.toggle('bubble--text-has-reactions', Boolean(messageText) && !isMediaBubble && !useOutsidePlacement && hasReactionItems);
        bubble.classList.toggle('bubble--text-meta-edited', Boolean(messageText) && !isMediaBubble && hasEditedMeta);
        bubble.classList.toggle(
            'bubble--audio-footer-meta',
            Boolean(isAudioBubble && meta && meta.parentElement?.classList?.contains('message-footer')),
        );
    }

    function patchPinnedMessageState(messageEl, isPinned) {
        if (!messageEl) return;
        const meta = messageEl.querySelector('.msg-meta, .message-meta');
        if (!meta) return;

        let pinEl = meta.querySelector('.msg-pin');
        if (isPinned) {
            if (!pinEl) {
                pinEl = document.createElement('span');
                pinEl.className = 'msg-pin';
                pinEl.title = '\u0417\u0430\u043A\u0440\u0435\u043F\u043B\u0435\u043D\u043E';
                pinEl.innerHTML = '<i class="bi bi-pin-angle-fill"></i>';
                const editedEl = meta.querySelector('.msg-edited');
                const timeEl = meta.querySelector('.msg-time');
                if (editedEl) {
                    editedEl.before(pinEl);
                } else if (timeEl) {
                    timeEl.before(pinEl);
                } else {
                    meta.prepend(pinEl);
                }
            }
        } else {
            pinEl?.remove();
        }

        messageEl.classList.toggle('message-pinned', Boolean(isPinned));
        syncMessageBubbleLayoutClasses(messageEl);
        refreshMessageHeightCache(messageEl, { keepBottomPinned: false });
    }

    function clearPinnedMessageStates() {
        chatMessages?.querySelectorAll('.message.message-pinned, .message .msg-pin').forEach((node) => {
            const messageEl = node.classList?.contains('message') ? node : node.closest('.message');
            if (messageEl) {
                patchPinnedMessageState(messageEl, false);
            }
        });
    }

    function patchFavoriteMessageState(messageEl, isFavorite) {
        if (!messageEl) return;
        const meta = messageEl.querySelector('.msg-meta, .message-meta');
        if (!meta) return;

        let favoriteEl = meta.querySelector('.msg-favorite');
        if (isFavorite) {
            if (!favoriteEl) {
                favoriteEl = document.createElement('span');
                favoriteEl.className = 'msg-favorite';
                favoriteEl.title = '\u0412 \u0438\u0437\u0431\u0440\u0430\u043D\u043D\u043E\u043C';
                favoriteEl.innerHTML = '<i class="bi bi-star-fill"></i>';
                const pinEl = meta.querySelector('.msg-pin');
                const editedEl = meta.querySelector('.msg-edited');
                const timeEl = meta.querySelector('.msg-time');
                if (pinEl) {
                    pinEl.before(favoriteEl);
                } else if (editedEl) {
                    editedEl.before(favoriteEl);
                } else if (timeEl) {
                    timeEl.before(favoriteEl);
                } else {
                    meta.prepend(favoriteEl);
                }
            }
        } else {
            favoriteEl?.remove();
        }

        messageEl.classList.toggle('message-favorite', Boolean(isFavorite));
        syncMessageBubbleLayoutClasses(messageEl);
        refreshMessageHeightCache(messageEl, { keepBottomPinned: false });
    }

    function clearFavoriteMessageStates() {
        chatMessages?.querySelectorAll('.message.message-favorite, .message .msg-favorite').forEach((node) => {
            const messageEl = node.classList?.contains('message') ? node : node.closest('.message');
            if (messageEl) {
                patchFavoriteMessageState(messageEl, false);
            }
        });
    }

    function refreshMessageHeightCache(messageEl, options = {}) {
        if (!messageEl || !chatMessages || !currentChatId) return;
        const key = messageEl.getAttribute('data-message-key');
        if (!key) return;
        const shouldPinToBottom = options.keepBottomPinned ?? keepChatPinnedToBottom;

        requestAnimationFrame(() => {
            if (!chatMessages.contains(messageEl)) return;
            const state = getChatState(currentChatId);
            const height = Math.ceil(messageEl.getBoundingClientRect().height);
            if (!Number.isFinite(height) || height <= 0) return;
            state.messageHeights.set(key, height);
            if (shouldPinToBottom) {
                setChatScrollTop(chatMessages.scrollHeight);
                saveChatScrollPosition(currentChatId);
                updateJumpToNewMessagesButton();
            }
        });
    }

    function patchMessageReactions(messageEl, reactions, { animate = false, animatedEmoji = '' } = {}) {
        if (!messageEl) return;
        const msgId = Number(messageEl.getAttribute('data-msg-id'));
        if (!Number.isFinite(msgId) || msgId <= 0) return;
        const highlightedEmoji = String(animatedEmoji || '').trim();
        const shouldPinToBottom = keepChatPinnedToBottom && isChatViewportPinnedToBottom();

        const stack = messageEl.querySelector('.message-stack');
        if (!stack) return;
        const bubble = stack.querySelector('.bubble');
        if (!bubble) return;
        const { useOutsidePlacement } = resolveMessageReactionLayoutState(messageEl, bubble);
        const existingFooter = bubble.querySelector(':scope > .message-footer');
        const targetContainer = useOutsidePlacement ? stack : (existingFooter || bubble);
        let currentRow = null;
        const allRows = Array.from(stack.querySelectorAll('.message-reactions'));
        allRows.forEach((row) => {
            const isInTarget = row.parentElement === targetContainer;
            if (isInTarget && !currentRow) {
                currentRow = row;
                return;
            }
            row.remove();
        });
        const nextMarkup = buildMessageReactionsHtml(msgId, reactions);

        if (!nextMarkup) {
            currentRow?.remove();
            syncMessageBubbleLayoutClasses(messageEl);
            refreshMessageHeightCache(messageEl, { keepBottomPinned: shouldPinToBottom });
            return;
        }

        const template = document.createElement('template');
        template.innerHTML = nextMarkup.trim();
        const nextRow = Array.from(template.content.children)
            .find((child) => child?.classList?.contains('message-reactions')) || null;

        let updatedRow = currentRow;
        if (!nextRow) {
            currentRow?.remove();
            targetContainer.insertAdjacentHTML('beforeend', nextMarkup);
            updatedRow = Array.from(targetContainer.children).find((child) => child?.classList?.contains('message-reactions')) || null;
        } else if (!updatedRow) {
            targetContainer.append(nextRow);
            updatedRow = nextRow;
        } else {
            updatedRow.className = nextRow.className;
            updatedRow.setAttribute('data-msg-id', String(msgId));

            const syncPill = (targetPill, sourcePill) => {
                if (!targetPill || !sourcePill) return;
                const nextEmoji = String(sourcePill.getAttribute('data-emoji') || '').trim();
                targetPill.className = sourcePill.className;
                targetPill.setAttribute('data-msg-id', String(msgId));
                targetPill.setAttribute('data-emoji', nextEmoji);

                const sourceEmoji = sourcePill.querySelector('.reaction-pill__emoji');
                const targetEmoji = targetPill.querySelector('.reaction-pill__emoji');
                if (sourceEmoji && targetEmoji) {
                    targetEmoji.textContent = sourceEmoji.textContent || '';
                }

                const sourceReactors = sourcePill.querySelector('.reaction-pill__reactors');
                const targetReactors = targetPill.querySelector('.reaction-pill__reactors');
                if (sourceReactors) {
                    const clonedReactors = sourceReactors.cloneNode(true);
                    if (targetReactors) {
                        targetReactors.replaceWith(clonedReactors);
                    } else if (targetEmoji) {
                        targetEmoji.insertAdjacentElement('afterend', clonedReactors);
                    } else {
                        targetPill.prepend(clonedReactors);
                    }
                } else {
                    targetReactors?.remove();
                }

                const sourceCount = sourcePill.querySelector('.reaction-pill__count');
                const targetCount = targetPill.querySelector('.reaction-pill__count');
                if (sourceCount) {
                    if (targetCount) {
                        targetCount.textContent = sourceCount.textContent || '';
                    } else {
                        targetPill.append(sourceCount.cloneNode(true));
                    }
                } else {
                    targetCount?.remove();
                }
            };

            const currentPills = Array.from(updatedRow.querySelectorAll(':scope > .reaction-pill'));
            const currentPillByEmoji = new Map();
            currentPills.forEach((pill) => {
                const emoji = String(pill.getAttribute('data-emoji') || '').trim();
                if (!emoji || currentPillByEmoji.has(emoji)) return;
                currentPillByEmoji.set(emoji, pill);
            });

            const nextPills = Array.from(nextRow.querySelectorAll(':scope > .reaction-pill'));
            const nextEmojiSet = new Set();
            nextPills.forEach((sourcePill) => {
                const emoji = String(sourcePill.getAttribute('data-emoji') || '').trim();
                if (!emoji) return;
                nextEmojiSet.add(emoji);

                const existingPill = currentPillByEmoji.get(emoji);
                if (existingPill) {
                    syncPill(existingPill, sourcePill);
                    updatedRow.append(existingPill);
                    return;
                }

                updatedRow.append(sourcePill.cloneNode(true));
            });

            currentPillByEmoji.forEach((pill, emoji) => {
                if (!nextEmojiSet.has(emoji)) {
                    pill.remove();
                }
            });
        }

        if (updatedRow && animate) {
            updatedRow.classList.add('is-updated');
            window.setTimeout(() => updatedRow.classList.remove('is-updated'), 220);
            if (highlightedEmoji) {
                const targetPill = Array.from(updatedRow.querySelectorAll(':scope > .reaction-pill'))
                    .find((pill) => String(pill.getAttribute('data-emoji') || '').trim() === highlightedEmoji);
                if (targetPill) {
                    targetPill.classList.add('reaction-just-added');
                    window.setTimeout(() => targetPill.classList.remove('reaction-just-added'), 280);
                }
            }
        }
        if (updatedRow) applyEmojiGraphics(updatedRow);
        syncMessageBubbleLayoutClasses(messageEl);
        refreshMessageHeightCache(messageEl, { keepBottomPinned: shouldPinToBottom });
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
            useMobileReactionInside: isMobileReactionInsideMode(),
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

    function applyMessageEnterAnimation(node, msg) {
        if (!node) return;
        if (isMobileViewport()) return;
        const senderClass = msg?.sender === 'self' ? 'msg-animate-self' : 'msg-animate-other';
        node.classList.add('msg-animate-in', senderClass);

        let cleared = false;
        const clearClasses = () => {
            if (cleared || !node) return;
            cleared = true;
            node.classList.remove('msg-animate-in', 'msg-animate-self', 'msg-animate-other');
        };

        const handleAnimationEnd = (event) => {
            if (event?.target !== node) return;
            node.removeEventListener('animationend', handleAnimationEnd);
            clearClasses();
        };

        node.addEventListener('animationend', handleAnimationEnd);
        window.setTimeout(() => {
            node.removeEventListener('animationend', handleAnimationEnd);
            clearClasses();
        }, 520);
    }

    function appendMessage(msg, options = {}) {
        if (!currentChatId) return null;
        const inserted = upsertChatMessage(currentChatId, msg, { append: options.append !== false });
        const renderOptions = options.renderOptions || {};

        // \u0411\u044B\u0441\u0442\u0440\u044B\u0439 \u043F\u0443\u0442\u044C: \u0440\u0435\u0430\u043B\u0442\u0430\u0439\u043C-\u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0432 \u043A\u043E\u043D\u0435\u0446, \u0431\u0435\u0437 \u043F\u043E\u043B\u043D\u043E\u0433\u043E rebuild \u0432\u0438\u0434\u0438\u043C\u043E\u0433\u043E \u043E\u043A\u043D\u0430.
        // \u0423\u0441\u043B\u043E\u0432\u0438\u044F: \u043D\u0435\u0442 force/\u043F\u0440\u0438\u043D\u0443\u0434\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0433\u043E scrollTop/preserveHeightDelta, \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435 \u0440\u0435\u0430\u043B\u044C\u043D\u043E
        // \u043E\u043A\u0430\u0437\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u043C \u0438 \u0432\u0438\u0434\u0438\u043C\u044B\u0439 \u0434\u0438\u0430\u043F\u0430\u0437\u043E\u043D \u0443\u0436\u0435 \u0432\u043A\u043B\u044E\u0447\u0430\u0435\u0442 \u0445\u0432\u043E\u0441\u0442 \u043B\u0435\u043D\u0442\u044B.
        const canFastAppend = inserted
            && !renderOptions.force
            && !renderOptions.preserveHeightDelta
            && !Number.isFinite(renderOptions.scrollTop);

        if (canFastAppend && chatMessages) {
            const state = getChatState(currentChatId);
            const lastIdx = state.messages.length - 1;
            const isAtTail = state.messages[lastIdx] === inserted;
            const range = state.lastRenderRange;
            const rangeCoversTail = range && range.end >= state.messages.length - 1;
            const msgKey = getMessageKey(inserted);
            const alreadyRendered = state.renderedKeys.has(msgKey);
            const previousTailMessage = lastIdx > 0 ? state.messages[lastIdx - 1] : null;
            const tailGroupWouldChange = isSameMessageGroup(previousTailMessage, inserted);
            const findRenderedMessageNodeByKey = (rawKey) => {
                const normalizedKey = String(rawKey || '');
                if (!normalizedKey) return null;
                const escapedKey = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
                    ? CSS.escape(normalizedKey)
                    : normalizedKey.replace(/["\\]/g, '\\$&');
                return chatMessages.querySelector(`.message[data-message-key="${escapedKey}"]`);
            };

            if (isAtTail && rangeCoversTail && !alreadyRendered && !tailGroupWouldChange) {
                if (tailGroupWouldChange && previousTailMessage) {
                    const previousTailKey = getMessageKey(previousTailMessage);
                    const previousTailNode = findRenderedMessageNodeByKey(previousTailKey);
                    if (!previousTailNode) {
                        scheduleVirtualChatRender(currentChatId, renderOptions);
                        return inserted;
                    }
                    const previousTailLayout = MessageGroup(state.messages, lastIdx - 1);
                    syncReusedMessageNodeState(previousTailNode, previousTailMessage, previousTailLayout);
                }

                const wasNearBottom = isChatNearBottom();
                const bottomSpacer = chatMessages.querySelector('.chat-virtual-spacer:last-child');
                const groupLayout = MessageGroup(state.messages, lastIdx);
                const node = MessageItem(inserted, groupLayout);
                applyMessageEnterAnimation(node, inserted);
                if (messageSelectionController.isSelectionMode()) node.classList.add('selecting');

                // Day separator \u043F\u0440\u0438 \u0441\u043C\u0435\u043D\u0435 \u0434\u043D\u044F
                const prev = lastIdx > 0 ? state.messages[lastIdx - 1] : null;
                const prevDayKey = prev ? getMessageDayKey(prev.created_at) : '';
                const dayKey = getMessageDayKey(inserted.created_at);
                if (dayKey && dayKey !== prevDayKey) {
                    const sep = createDaySeparatorNode(inserted.created_at, dayKey);
                    if (bottomSpacer) chatMessages.insertBefore(sep, bottomSpacer);
                    else chatMessages.appendChild(sep);
                }
                if (bottomSpacer) chatMessages.insertBefore(node, bottomSpacer);
                else chatMessages.appendChild(node);
                registerMediaElementsForLazyHydration(node);

                state.renderedKeys.add(msgKey);
                state.lastRenderRange = { start: range.start, end: state.messages.length };

                // \u0417\u0430\u043C\u0435\u0440 \u0440\u0435\u0430\u043B\u044C\u043D\u043E\u0439 \u0432\u044B\u0441\u043E\u0442\u044B \u0442\u043E\u043B\u044C\u043A\u043E \u043D\u043E\u0432\u043E\u0433\u043E \u0443\u0437\u043B\u0430 - \u0431\u0435\u0437 forced layout \u043F\u043E \u0432\u0441\u0435\u043C.
                requestAnimationFrame(() => {
                    if (!chatMessages.contains(node)) return;
                    const h = Math.ceil(node.getBoundingClientRect().height);
                    if (Number.isFinite(h) && h > 0) state.messageHeights.set(msgKey, h);
                });

                if (renderOptions.scrollToBottom) {
                    requestAutoScrollToBottom();
                } else if (wasNearBottom) {
                    requestAutoScrollToBottom();
                }
                schedulePostRenderUiRefresh({ searchFilter: true, jumpButton: true, e2ePill: true });
                return inserted;
            }
        }

        scheduleVirtualChatRender(currentChatId, renderOptions);
        return inserted;
    }

    function confirmPendingMessageDom({ clientId, messageId, message } = {}) {
        if (!chatMessages || !clientId || !message) return false;
        const rawClientId = String(clientId || '');
        if (!rawClientId) return false;
        const escapedClientId = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
            ? CSS.escape(rawClientId)
            : rawClientId.replace(/["\\]/g, '\\$&');
        let msgEl = chatMessages.querySelector(`.message.self[data-client-id="${escapedClientId}"]`);
        const numericMessageId = Number(messageId);
        if (!msgEl && Number.isFinite(numericMessageId) && numericMessageId > 0) {
            msgEl = chatMessages.querySelector(`.message.self[data-msg-id="${numericMessageId}"]`);
        }
        if (!msgEl) return false;

        if (Number.isFinite(numericMessageId) && numericMessageId > 0) {
            msgEl.setAttribute('data-msg-id', String(numericMessageId));
        }
        const key = getMessageKey(message);
        if (key) {
            msgEl.setAttribute('data-message-key', key);
        }
        msgEl.removeAttribute('data-pending');
        msgEl.removeAttribute('data-client-id');

        const tickEl = msgEl.querySelector('.msg-tick');
        if (tickEl) {
            applyTickToElement(tickEl, message);
        }
        if (message.created_at) {
            const timeEl = msgEl.querySelector('.msg-time');
            if (timeEl) {
                timeEl.textContent = formatTime(message.created_at);
                timeEl.title = formatFullTimestamp(message.created_at);
                timeEl.setAttribute('data-created-at', message.created_at);
            }
        }
        patchMessageReactions(msgEl, message.reactions, { animate: false });
        refreshMessageHeightCache(msgEl, { keepBottomPinned: keepChatPinnedToBottom });
        return true;
    }

    function updateMessageReactionsState(chatId, messageId, rawReactions) {
        const numericMessageId = Number(messageId);
        if (!Number.isFinite(numericMessageId) || numericMessageId <= 0) return false;
        const state = getChatState(chatId);
        const index = findMessageIndex(state, (msg) => Number(msg.id) === numericMessageId);
        if (index < 0) return false;

        const nextReactions = normalizeMessageReactions(rawReactions);
        if (areMessageReactionsEqual(state.messages[index].reactions, nextReactions)) {
            return false;
        }

        state.messages[index] = {
            ...state.messages[index],
            reactions: nextReactions,
        };
        return true;
    }

    function applyMessageReactionsLocally(chatId, messageId, rawReactions, { animate = true, touchStamp = false, animatedEmoji = '' } = {}) {
        const changed = updateMessageReactionsState(chatId, messageId, rawReactions);
        if (!changed) return false;

        if (touchStamp) {
            const key = getReactionMessageKey(chatId, messageId);
            reactionUpdateStampByMessage.set(key, Date.now());
        }

        if (String(chatId) !== String(currentChatId)) {
            return true;
        }

        const messageEl = chatMessages?.querySelector(`.message[data-msg-id="${Number(messageId)}"]`);
        if (messageEl) {
            patchMessageReactions(messageEl, rawReactions, { animate, animatedEmoji });
            return true;
        }

        scheduleVirtualChatRender(chatId, { force: true, scrollTop: chatMessages.scrollTop });
        return true;
    }

    function rollbackPendingReactionOp(operation) {
        if (!operation) return;
        applyMessageReactionsLocally(
            operation.chatId,
            operation.messageId,
            operation.previousReactions,
            { animate: false }
        );
    }

    function rememberSupersededReactionRequest(requestId, ttlMs = 30000) {
        const token = String(requestId || '').trim();
        if (!token) return;
        const existingTimeoutId = supersededReactionRequestIds.get(token);
        if (existingTimeoutId) {
            clearTimeout(existingTimeoutId);
        }
        const timeoutId = window.setTimeout(() => {
            supersededReactionRequestIds.delete(token);
        }, ttlMs);
        supersededReactionRequestIds.set(token, timeoutId);
    }

    function isSupersededReactionRequest(requestId) {
        const token = String(requestId || '').trim();
        if (!token) return false;
        return supersededReactionRequestIds.has(token);
    }

    function forgetSupersededReactionRequest(requestId) {
        const token = String(requestId || '').trim();
        if (!token) return;
        const timeoutId = supersededReactionRequestIds.get(token);
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
        supersededReactionRequestIds.delete(token);
    }

    function markPendingReactionOpSuperseded(requestId) {
        const token = String(requestId || '').trim();
        if (!token) return;
        const operation = pendingReactionOpsById.get(token);
        if (!operation) return;
        operation.superseded = true;
        rememberSupersededReactionRequest(token);
    }

    function clearPendingReactionOp(requestId, { rollback = false } = {}) {
        const token = String(requestId || '').trim();
        if (!token) return null;

        const operation = pendingReactionOpsById.get(token);
        if (!operation) return null;

        pendingReactionOpsById.delete(token);
        if (operation.timeoutId) {
            clearTimeout(operation.timeoutId);
        }
        if (pendingReactionOpByMessage.get(operation.messageKey) === token) {
            pendingReactionOpByMessage.delete(operation.messageKey);
        }

        if (rollback) {
            rollbackPendingReactionOp(operation);
        }

        return operation;
    }

    function clearPendingReactionOpByMessage(chatId, messageId, { rollback = false } = {}) {
        const key = getReactionMessageKey(chatId, messageId);
        const requestId = pendingReactionOpByMessage.get(key);
        if (requestId) {
            return clearPendingReactionOp(requestId, { rollback });
        }
        return null;
    }

    function registerPendingReactionOp(chatId, messageId, previousReactions, requestId) {
        const token = String(requestId || '').trim();
        if (!token) return;

        const numericMessageId = Number(messageId);
        if (!Number.isFinite(numericMessageId) || numericMessageId <= 0) return;

        const key = getReactionMessageKey(chatId, numericMessageId);
        const existing = pendingReactionOpByMessage.get(key);
        if (existing) {
            markPendingReactionOpSuperseded(existing);
        }

        const timeoutId = window.setTimeout(() => {
            clearPendingReactionOp(token);
        }, 4500);

        pendingReactionOpsById.set(token, {
            requestId: token,
            chatId: String(chatId || ''),
            messageId: numericMessageId,
            messageKey: key,
            previousReactions: normalizeMessageReactions(previousReactions),
            superseded: false,
            timeoutId,
        });
        pendingReactionOpByMessage.set(key, token);
    }

    function emitReactionToggle(messageId, emoji) {
        const normalizedMsgId = Number(messageId);
        const normalizedEmoji = String(emoji || '').trim();
        if (!currentChatId || !Number.isFinite(normalizedMsgId) || normalizedMsgId <= 0) return;
        if (!REACTION_PICKER_EMOJIS.includes(normalizedEmoji)) return;

        const state = getChatState(currentChatId);
        const messageIndex = findMessageIndex(state, (msg) => Number(msg.id) === normalizedMsgId);
        if (messageIndex < 0) return;

        const previousReactions = normalizeMessageReactions(state.messages[messageIndex].reactions);
        const nextReactions = computeOptimisticReactions(previousReactions, normalizedEmoji);
        const changed = applyMessageReactionsLocally(currentChatId, normalizedMsgId, nextReactions, {
            animate: true,
            animatedEmoji: normalizedEmoji,
        });
        if (!changed) return;

        const requestId = crypto.randomUUID();
        registerPendingReactionOp(currentChatId, normalizedMsgId, previousReactions, requestId);
        const emitted = emitSocket('toggle_reaction', {
            chat_id: currentChatId,
            message_id: normalizedMsgId,
            emoji: normalizedEmoji,
            request_id: requestId,
        });

        if (!emitted) {
            clearPendingReactionOp(requestId, { rollback: true });
        }
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
    document.getElementById('cmPin')?.addEventListener('click', () => {
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
    const MESSAGE_FOCUS_TOP_OFFSET = 84;
    const MESSAGE_FOCUS_ALIGN = 'center';
    const MESSAGE_FOCUS_VISIBLE_MARGIN = 18;
    const MESSAGE_FOCUS_MIN_HIGHLIGHT_DELAY = 90;
    const MESSAGE_FOCUS_FLASH_DURATION = 1450;
    const MESSAGE_FOCUS_TARGET_EPSILON = 12;
    const MESSAGE_FOCUS_FLASH_FADE_MS = 220;
    const _messageFlashTimers = new WeakMap();

    function _isMessageInView(el, container, margin = MESSAGE_FOCUS_VISIBLE_MARGIN) {
        if (!el || !container) return false;
        const cRect = container.getBoundingClientRect();
        const eRect = el.getBoundingClientRect();
        const topVisible = eRect.top >= (cRect.top + margin);
        const bottomVisible = eRect.bottom <= (cRect.bottom - margin);
        return topVisible && bottomVisible;
    }

    function _computeScrollTarget(el, container, options = {}) {
        const topOffset = Number.isFinite(options.topOffset) ? options.topOffset : MESSAGE_FOCUS_TOP_OFFSET;
        const align = typeof options.align === 'string' ? options.align : MESSAGE_FOCUS_ALIGN;
        const cRect = container.getBoundingClientRect();
        const eRect = el.getBoundingClientRect();
        const relativeTop = eRect.top - cRect.top;
        const centerOffset = Math.max(0, (container.clientHeight - eRect.height) / 2);
        const rawTargetTop = align === 'center'
            ? container.scrollTop + relativeTop - centerOffset
            : container.scrollTop + relativeTop - topOffset;
        const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
        return Math.max(0, Math.min(rawTargetTop, maxScrollTop));
    }

    function _flashMessageTarget(el) {
        if (!el) return;
        const previousState = _messageFlashTimers.get(el);
        if (previousState?.showFrame) cancelAnimationFrame(previousState.showFrame);
        if (previousState?.hideTimer) clearTimeout(previousState.hideTimer);
        if (previousState?.cleanupTimer) clearTimeout(previousState.cleanupTimer);
        el.classList.remove('highlight-flash-active');
        el.classList.remove('highlight-flash');
        void el.offsetWidth;
        el.classList.add('highlight-flash');
        const showFrame = requestAnimationFrame(() => {
            el.classList.add('highlight-flash-active');
        });
        const hideTimer = setTimeout(() => {
            el.classList.remove('highlight-flash-active');
        }, MESSAGE_FOCUS_FLASH_DURATION);
        const cleanupTimer = setTimeout(() => {
            el.classList.remove('highlight-flash');
            _messageFlashTimers.delete(el);
        }, MESSAGE_FOCUS_FLASH_DURATION + MESSAGE_FOCUS_FLASH_FADE_MS);
        _messageFlashTimers.set(el, {
            showFrame,
            hideTimer,
            cleanupTimer,
        });
    }

    async function _ensureMessageLoaded(msgId) {
        if (!currentChatId) return false;
        const numericId = Number(msgId);
        if (!Number.isFinite(numericId) || numericId <= 0) return false;

        const state = getChatState(currentChatId);
        while (!findMessageById(currentChatId, numericId) && state.hasMoreBefore && !state.isLoadingOlder) {
            const oldestId = Number(state.messages[0]?.id);
            if (!Number.isFinite(oldestId) || numericId >= oldestId) break;
            await loadOlderMessages(currentChatId);
        }
        return Boolean(findMessageById(currentChatId, numericId));
    }

    function _estimateScrollTopForMessage(msgId, options = {}) {
        const state = getChatState(currentChatId);
        const index = findMessageIndex(state, (msg) => Number(msg.id) === Number(msgId));
        if (index < 0) return null;
        const topOffset = Number.isFinite(options.topOffset) ? options.topOffset : MESSAGE_FOCUS_TOP_OFFSET;
        const align = typeof options.align === 'string' ? options.align : MESSAGE_FOCUS_ALIGN;
        const targetMessage = state.messages[index];
        const estimatedHeight = Math.max(
            48,
            estimateMessageHeight(state, targetMessage) || state.averageMessageHeight || CHAT_DEFAULT_MESSAGE_HEIGHT,
        );
        const centerOffset = Math.max(0, ((chatMessages?.clientHeight || 0) - estimatedHeight) / 2);
        const anchorOffset = align === 'center' ? centerOffset : topOffset;
        return Math.max(0, sumEstimatedHeights(state, 0, index) - anchorOffset);
    }

    async function _focusMessageById(msgId, options = {}) {
        if (!chatMessages) return false;

        let el = document.querySelector(`.message[data-msg-id="${msgId}"]`);
        if (!el) {
            const loaded = await _ensureMessageLoaded(msgId);
            if (!loaded) return false;
            const estimatedTop = _estimateScrollTopForMessage(msgId, options);
            renderChatMessages(currentChatId, {
                force: true,
                scrollTop: Number.isFinite(estimatedTop) ? estimatedTop : chatMessages.scrollTop,
            });
            el = document.querySelector(`.message[data-msg-id="${msgId}"]`);
        }
        if (!el) return false;

        const smooth = options.smooth !== false;
        const targetTop = _computeScrollTarget(el, chatMessages, options);
        const distance = Math.abs(targetTop - chatMessages.scrollTop);
        const alreadyInView = _isMessageInView(el, chatMessages);

        if (alreadyInView && distance <= MESSAGE_FOCUS_TARGET_EPSILON) {
            _flashMessageTarget(el);
            return true;
        }

        requestAnimationFrame(() => {
            chatMessages.scrollTo({ top: targetTop, behavior: smooth ? 'smooth' : 'auto' });

            const delay = smooth
                ? Math.max(MESSAGE_FOCUS_MIN_HIGHLIGHT_DELAY, Math.min(520, Math.round(distance * 0.45)))
                : 0;
            setTimeout(() => _flashMessageTarget(el), delay);
        });
        return true;
    }

    window._scrollToMsg = function(msgId, options = {}) {
        return _focusMessageById(msgId, options);
    };

    // --- Caption modal ---------------------------------------------------
    const captionModalController = initCaptionModal({
        modalEl: document.getElementById('captionModal'),
        previewEl: document.getElementById('captionPreview'),
        metaEl: document.getElementById('captionMeta'),
        inputEl: document.getElementById('captionInput'),
        sendButtonEl: document.getElementById('captionSendBtn'),
        closeButtonEl: document.getElementById('captionModalClose'),
        titleEl: document.getElementById('captionModalTitle'),
        hintEl: document.getElementById('captionModalHint'),
        activateFocusTrap: window._activateFocusTrap,
        deactivateFocusTrap: window._deactivateFocusTrap,
        onSubmit: (file, caption, submitOptions = {}) => sendFileMessage(file, caption, submitOptions),
        onError: (error) => showToast(error.message, 'danger'),
    });
    const showCaptionModal = captionModalController.showCaptionModal;
    const closeCaptionModal = captionModalController.closeCaptionModal;

    async function encryptForCurrentChat(plainText) {
        if (!currentChatId) {
            throw new Error('\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0447\u0430\u0442 \u043F\u0435\u0440\u0435\u0434 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u043E\u0439 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F.');
        }
        if (isCurrentChatGroup()) {
            return plainText;
        }
        if (!window.currentContactPublicKey) {
            loadContacts();
            throw new Error('\u041D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u043A\u043B\u044E\u0447 \u0441\u043E\u0431\u0435\u0441\u0435\u0434\u043D\u0438\u043A\u0430. \u041E\u0431\u043D\u043E\u0432\u0438\u0442\u0435 \u0441\u043F\u0438\u0441\u043E\u043A \u043A\u043E\u043D\u0442\u0430\u043A\u0442\u043E\u0432.');
        }
        if (!getPrivateKeyPem()) {
            throw new Error('\u041D\u0435\u0442 \u043F\u0440\u0438\u0432\u0430\u0442\u043D\u043E\u0433\u043E \u043A\u043B\u044E\u0447\u0430. \u0412\u043E\u0439\u0434\u0438\u0442\u0435 \u0437\u0430\u043D\u043E\u0432\u043E \u0441 \u0432\u0430\u0448\u0438\u043C \u043A\u043B\u044E\u0447\u043E\u043C.');
        }
        if (!currentUserPublicKey) {
            throw new Error('\u041D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u0432\u0430\u0448 \u043F\u0443\u0431\u043B\u0438\u0447\u043D\u044B\u0439 \u043A\u043B\u044E\u0447. \u041E\u0431\u043D\u043E\u0432\u0438\u0442\u0435 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443 \u0438 \u0432\u043E\u0439\u0434\u0438\u0442\u0435 \u0437\u0430\u043D\u043E\u0432\u043E.');
        }
        return window.e2e.encryptMessageE2E(
            window.currentContactPublicKey,
            currentUserPublicKey,
            plainText
        );
    }

    function clampPendingUploadProgress(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return 0;
        return Math.max(0, Math.min(100, Math.round(numeric)));
    }

    function buildPendingMediaDimensions(width, height) {
        const safeWidth = Math.round(Number(width) || 0);
        const safeHeight = Math.round(Number(height) || 0);
        if (!(safeWidth > 0) || !(safeHeight > 0)) return null;
        return {
            preview_width: safeWidth,
            preview_height: safeHeight,
            preview_aspect_ratio: Number((safeWidth / safeHeight).toFixed(4)),
        };
    }

    function resolvePendingMessageByClientId(clientId) {
        if (!currentChatId || !clientId) return null;
        const state = getChatState(currentChatId);
        const index = findMessageIndex(state, (msg) => msg.clientId === clientId);
        if (index < 0) return null;
        return {
            state,
            index,
            message: state.messages[index],
            element: chatMessages?.querySelector(`.message.self[data-client-id="${CSS.escape(clientId)}"]`) || null,
        };
    }

    function persistPendingMediaDimensions(messageEl, width, height) {
        const clientId = messageEl?.getAttribute('data-client-id');
        if (!clientId) return null;
        const resolved = resolvePendingMessageByClientId(clientId);
        if (!resolved) return null;
        const filePayload = parseSunFilePayload(resolved.message.message);
        if (!filePayload) return null;
        const nextDimensions = buildPendingMediaDimensions(width, height);
        if (!nextDimensions) return null;

        const prevWidth = Number(filePayload.preview_width);
        const prevHeight = Number(filePayload.preview_height);
        const prevRatio = Number(filePayload.preview_aspect_ratio);
        const nextRatio = Number(nextDimensions.preview_aspect_ratio);
        const unchanged = prevWidth === nextDimensions.preview_width
            && prevHeight === nextDimensions.preview_height
            && Math.abs(prevRatio - nextRatio) < 0.0001;
        if (unchanged) {
            return { ...filePayload, ...nextDimensions };
        }

        const nextPayload = { ...filePayload, ...nextDimensions };
        const nextMessageText = JSON.stringify(nextPayload);
        resolved.state.messages[resolved.index] = {
            ...resolved.message,
            message: nextMessageText,
        };
        resolved.element?.setAttribute('data-message-content', nextMessageText);
        return nextPayload;
    }

    function syncPendingMediaOverlay(messageEl, filePayload) {
        if (!messageEl || !filePayload) return;
        const mediaWrap = messageEl.querySelector('.image-wrapper, .video-preview');
        if (!mediaWrap) return;

        const isUploading = Boolean(filePayload.uploading);
        const progress = clampPendingUploadProgress(filePayload.upload_progress);
        mediaWrap.classList.toggle('is-uploading', isUploading);
        mediaWrap.setAttribute('data-upload-progress', String(progress));

        const overlay = mediaWrap.querySelector('.media-status-overlay');
        if (!overlay) return;
        overlay.classList.toggle('is-uploading', isUploading);
        overlay.setAttribute('data-upload-progress', String(progress));
        overlay.style.setProperty('--upload-progress', String(progress));
        const value = overlay.querySelector('.media-status-value');
        if (value) {
            value.textContent = isUploading ? `${progress}%` : '';
        }
    }

    function syncPendingInlineUpload(messageEl, filePayload) {
        if (!messageEl || !filePayload) return;
        const uploadEl = messageEl.querySelector('[data-file-upload-inline="1"]');
        if (!uploadEl) return;

        const isUploading = Boolean(filePayload.uploading);
        const progress = clampPendingUploadProgress(filePayload.upload_progress);
        uploadEl.classList.toggle('is-uploading', isUploading);
        uploadEl.classList.toggle('is-hidden', !isUploading);
        uploadEl.setAttribute('data-upload-progress', String(progress));
        uploadEl.style.setProperty('--upload-progress', String(progress));

        const percentEl = uploadEl.querySelector('.file-upload-inline-percent');
        if (percentEl) {
            percentEl.textContent = `${progress}%`;
        }

        const fileLinkEl = messageEl.querySelector('.file-msg-link');
        if (fileLinkEl) {
            fileLinkEl.classList.toggle('is-uploading', isUploading);
            fileLinkEl.setAttribute('aria-disabled', isUploading ? 'true' : 'false');
        }
    }

    function syncPendingUploadIndicators(messageEl, filePayload) {
        syncPendingMediaOverlay(messageEl, filePayload);
        syncPendingInlineUpload(messageEl, filePayload);
    }

    function updatePendingFileUploadProgress(clientId, percent) {
        const resolved = resolvePendingMessageByClientId(clientId);
        if (!resolved) return;

        const filePayload = parseSunFilePayload(resolved.message.message);
        if (!filePayload) return;

        const nextPayload = {
            ...filePayload,
            uploading: true,
            upload_progress: clampPendingUploadProgress(percent),
        };
        resolved.state.messages[resolved.index] = {
            ...resolved.message,
            message: JSON.stringify(nextPayload),
        };
        syncPendingUploadIndicators(resolved.element, nextPayload);
    }

    const messageMutationHandlers = createChatMessageMutations({
        documentRef: document,
        windowRef: window,
        sanitizeFileUri,
        isMobileReactionInsideMode,
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
        const resolved = resolvePendingMessageByClientId(clientId);
        if (!resolved) return;

        const currentFilePayload = parseSunFilePayload(resolved.message.message) || {};
        const nextPayload = {
            ...currentFilePayload,
            ...nextFilePayload,
            preview_width: nextFilePayload?.preview_width ?? currentFilePayload.preview_width,
            preview_height: nextFilePayload?.preview_height ?? currentFilePayload.preview_height,
            preview_aspect_ratio: nextFilePayload?.preview_aspect_ratio ?? currentFilePayload.preview_aspect_ratio,
            uploading: false,
            upload_progress: 100,
        };
        const nextMessageText = JSON.stringify(nextPayload);
        resolved.state.messages[resolved.index] = {
            ...resolved.message,
            message: nextMessageText,
        };

        if (resolved.element) {
            updateMessageContent(resolved.element, nextMessageText, true);
        }
    }

    function failPendingMessage(clientId) {
        messageMutationHandlers.failPendingMessage(clientId);
    }

    const _pendingTimeouts = new Map();

    function schedulePendingTimeout(clientId, ms = 20000) {
        const tid = setTimeout(() => {
            _pendingTimeouts.delete(clientId);
            failPendingMessage(clientId);
        }, ms);
        _pendingTimeouts.set(clientId, tid);
    }

    function cancelPendingTimeout(clientId) {
        const tid = _pendingTimeouts.get(clientId);
        if (tid !== undefined) {
            clearTimeout(tid);
            _pendingTimeouts.delete(clientId);
        }
    }

    async function sendTextMessage(message) {
        const sourceChatId = String(currentChatId || '').trim();
        if (!sourceChatId) return;
        const sourceChatIsGroup = isCurrentChatGroup();
        const sourceContactPublicKey = String(window.currentContactPublicKey || '').trim();
        const sourceUserPublicKey = String(currentUserPublicKey || '').trim();

        const encryptForSourceChat = async (plainText) => {
            if (!sourceChatId) {
                throw new Error('\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0447\u0430\u0442 \u043F\u0435\u0440\u0435\u0434 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u043E\u0439 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F.');
            }
            if (sourceChatIsGroup) {
                return plainText;
            }
            if (!sourceContactPublicKey) {
                loadContacts();
                throw new Error('\u041D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u043A\u043B\u044E\u0447 \u0441\u043E\u0431\u0435\u0441\u0435\u0434\u043D\u0438\u043A\u0430. \u041E\u0431\u043D\u043E\u0432\u0438\u0442\u0435 \u0441\u043F\u0438\u0441\u043E\u043A \u043A\u043E\u043D\u0442\u0430\u043A\u0442\u043E\u0432.');
            }
            if (!getPrivateKeyPem()) {
                throw new Error('\u041D\u0435\u0442 \u043F\u0440\u0438\u0432\u0430\u0442\u043D\u043E\u0433\u043E \u043A\u043B\u044E\u0447\u0430. \u0412\u043E\u0439\u0434\u0438\u0442\u0435 \u0437\u0430\u043D\u043E\u0432\u043E \u0441 \u0432\u0430\u0448\u0438\u043C \u043A\u043B\u044E\u0447\u043E\u043C.');
            }
            if (!sourceUserPublicKey) {
                throw new Error('\u041D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u0432\u0430\u0448 \u043F\u0443\u0431\u043B\u0438\u0447\u043D\u044B\u0439 \u043A\u043B\u044E\u0447. \u041E\u0431\u043D\u043E\u0432\u0438\u0442\u0435 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443 \u0438 \u0432\u043E\u0439\u0434\u0438\u0442\u0435 \u0437\u0430\u043D\u043E\u0432\u043E.');
            }
            return window.e2e.encryptMessageE2E(sourceContactPublicKey, sourceUserPublicKey, plainText);
        };

        return sendTextMessageFlow({
            message,
            isGroupChat: sourceChatIsGroup,
            isChatBlocked,
            getBlockedNoticeText: getChatBlockNoticeText,
            currentBlockState,
            showToast,
            setSendingState,
            encryptForCurrentChat: encryptForSourceChat,
            getReplyState,
            cancelReply,
            emitSocket,
            enqueueOutbox: enqueueOutboxMessage,
            currentChatId: sourceChatId,
            appendMessage,
            setKeepChatPinnedToBottom: (value) => { keepChatPinnedToBottom = Boolean(value); },
            updateActiveContactLastMessage: (text, isSelf, status, timestamp) => {
                updateContactLastMessageForChat(sourceChatId, text, isSelf, status, timestamp);
            },
            schedulePendingTimeout,
            prewarmMessageLinkPreview: scheduleMessageLinkPreviewPrewarm,
            clearComposerInput: () => {
                if (String(currentChatId || '') === sourceChatId) {
                    messageInput.value = '';
                    messageInput.dispatchEvent(new Event('sun-composer-sync-visual'));
                    linkDraftBarController?.syncFromInput?.({ force: true });
                }
                // Keep local draft state in sync after send, so stale realtime draft
                // events cannot repopulate the composer with already-sent text.
                clearLocalDraftStateForChat(sourceChatId);
                void flushDraftSaveForChat(sourceChatId, '', { force: true });
                if (String(currentChatId || '') !== sourceChatId) {
                    syncDraftPreviewForContact(sourceChatId, '', new Date().toISOString(), { showWhileActive: true });
                }
            },
            resizeComposerInput,
            restoreComposerFocus,
        });
    }

    async function sendFileMessage(file, caption = '', options = {}) {
        const sourceChatId = String(currentChatId || '').trim();
        if (!sourceChatId) return;
        const sourceChatIsGroup = isCurrentChatGroup();
        const sourceContactPublicKey = String(window.currentContactPublicKey || '').trim();
        const sourceUserPublicKey = String(currentUserPublicKey || '').trim();

        const encryptForSourceChat = async (plainText) => {
            if (!sourceChatId) {
                throw new Error('\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0447\u0430\u0442 \u043F\u0435\u0440\u0435\u0434 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u043E\u0439 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F.');
            }
            if (sourceChatIsGroup) {
                return plainText;
            }
            if (!sourceContactPublicKey) {
                loadContacts();
                throw new Error('\u041D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u043A\u043B\u044E\u0447 \u0441\u043E\u0431\u0435\u0441\u0435\u0434\u043D\u0438\u043A\u0430. \u041E\u0431\u043D\u043E\u0432\u0438\u0442\u0435 \u0441\u043F\u0438\u0441\u043E\u043A \u043A\u043E\u043D\u0442\u0430\u043A\u0442\u043E\u0432.');
            }
            if (!getPrivateKeyPem()) {
                throw new Error('\u041D\u0435\u0442 \u043F\u0440\u0438\u0432\u0430\u0442\u043D\u043E\u0433\u043E \u043A\u043B\u044E\u0447\u0430. \u0412\u043E\u0439\u0434\u0438\u0442\u0435 \u0437\u0430\u043D\u043E\u0432\u043E \u0441 \u0432\u0430\u0448\u0438\u043C \u043A\u043B\u044E\u0447\u043E\u043C.');
            }
            if (!sourceUserPublicKey) {
                throw new Error('\u041D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u0432\u0430\u0448 \u043F\u0443\u0431\u043B\u0438\u0447\u043D\u044B\u0439 \u043A\u043B\u044E\u0447. \u041E\u0431\u043D\u043E\u0432\u0438\u0442\u0435 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443 \u0438 \u0432\u043E\u0439\u0434\u0438\u0442\u0435 \u0437\u0430\u043D\u043E\u0432\u043E.');
            }
            return window.e2e.encryptMessageE2E(sourceContactPublicKey, sourceUserPublicKey, plainText);
        };

        return sendFileMessageFlow({
            file,
            caption,
            options,
            isGroupChat: sourceChatIsGroup,
            isChatBlocked,
            getBlockedNoticeText: getChatBlockNoticeText,
            currentBlockState,
            showToast,
            maxChatMediaSize: MAX_CHAT_MEDIA_SIZE,
            currentChatId: sourceChatId,
            getCsrfToken,
            setSendingState,
            getReplyState,
            cancelReply,
            encryptForCurrentChat: encryptForSourceChat,
            isRealtimeConnected: () => Boolean(socket.connected),
            emitSocket,
            appendMessage,
            setKeepChatPinnedToBottom: (value) => { keepChatPinnedToBottom = Boolean(value); },
            updateActiveContactLastMessage: (text, isSelf, status, timestamp) => {
                updateContactLastMessageForChat(sourceChatId, text, isSelf, status, timestamp);
            },
            schedulePendingTimeout,
            updatePendingFileUploadProgress,
            commitPendingFileUpload,
            failPendingMessage,
            setActiveComposerUpload,
            updateActiveComposerUploadProgress,
            clearActiveComposerUpload,
            enqueueOutbox: enqueueOutboxMessage,
        });
    }

    async function handleComposerEncryptAndSend(rawContent) {
        const activeChatId = String(currentChatId || '').trim();
        const pendingForwardDraft = getForwardComposerDraftForChat(activeChatId);
        const normalizedRaw = String(rawContent || '').replace(/\r\n/g, '\n');
        if (!normalizedRaw.trim() && !getEditingFilePayload() && !pendingForwardDraft) return;
        const content = normalizedRaw.trim() ? normalizedRaw : '';

        const handledEdit = await handleComposerEditFlow({
            content,
            isEditingMessageId,
            isEditingFilePayload: getEditingFilePayload(),
            applyEditedMessageLocally,
            encryptForCurrentChat,
            emitSocket,
            currentChatId,
            cancelEdit,
        });
        if (handledEdit) {
            return;
        }

        if (pendingForwardDraft) {
            const targetRows = resolveForwardContactRows().filter((row) => row.chatId === pendingForwardDraft.targetChatId);
            if (!targetRows.length) {
                showToast('Чат для пересылки недоступен. Выберите получателя заново.', 'warning');
                clearForwardComposerDraft(activeChatId);
                return;
            }
            try {
                const sentCount = await forwardMessagesToTargets(pendingForwardDraft.messages, targetRows);
                showToast(`Переслано сообщений: ${sentCount}.`, 'success');
                clearForwardComposerDraft(activeChatId);
            } catch (error) {
                showToast(getErrorMessage(error, 'Не удалось переслать сообщения.'), 'danger');
                return;
            }
        }

        if (content) {
            await sendTextMessage(content);
        }
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
        getKeepChatPinnedToBottom: () => keepChatPinnedToBottom,
    });


    function updateActiveContactLastMessage(
        message,
        isSelf = true,
        status = { is_read: false, is_delivered: false },
        timestamp = null
    ) {
        if (!currentChatId) return;
        const contactItem = resolveContactItemByChatId(currentChatId);
        if (!contactItem) return;
        hideSidebarTyping(currentChatId);
        _updateActiveContactLastMessage(contactItem, message, isSelf, status, timestamp);
        sortContactsList();
    }

    function updateContactLastMessageForChat(
        chatId,
        message,
        isSelf = true,
        status = { is_read: false, is_delivered: false },
        timestamp = null,
    ) {
        const normalizedChatId = String(chatId || '').trim();
        if (!normalizedChatId) return;
        const contactItem = resolveContactItemByChatId(normalizedChatId);
        if (!contactItem) return;
        hideSidebarTyping(normalizedChatId);
        _updateActiveContactLastMessage(contactItem, message, isSelf, status, timestamp);
        sortContactsList();
    }

    // \u041E\u0431\u043D\u043E\u0432\u043B\u044F\u0435\u0442 \u0441\u0430\u0439\u0434\u0431\u0430\u0440 \u0434\u043B\u044F \u0447\u0430\u0442\u0430, \u043A\u043E\u0442\u043E\u0440\u044B\u0439 \u043D\u0435 \u043E\u0442\u043A\u0440\u044B\u0442 \u0432 \u0434\u0430\u043D\u043D\u044B\u0439 \u043C\u043E\u043C\u0435\u043D\u0442 (\u0431\u0435\u0437 AJAX-\u0437\u0430\u043F\u0440\u043E\u0441\u0430)
    function updateSidebarForOtherChat(
        chatId,
        message,
        isSelf,
        timestamp,
        status = { is_read: false, is_delivered: false }
    ) {
        contactsSidebarController.updateSidebarForOtherChat(
            chatId,
            message,
            isSelf,
            timestamp,
            status,
            setContactUnreadBadge,
        );
    }

    // -- \u041E\u0442\u043F\u0440\u0430\u0432\u043A\u0430 \u0444\u0430\u0439\u043B\u0430 (E2E \u0448\u0438\u0444\u0440\u043E\u0432\u0430\u043D\u0438\u0435) --
    const fileAttachInput = document.getElementById('fileAttachInput');
    const attachBtn = document.getElementById('attachBtn');
    const attachMenu = document.getElementById('attachMenu');
    const attachMenuItems = Array.from(attachMenu?.querySelectorAll('[data-attach-mode]') || []);

    attachMenuPanelController = createChatAttachMenuController({
        attachMenu,
        attachBtn,
        fileAttachInput,
        attachMenuItems,
        isChatBlocked: () => isChatBlocked(),
        handleFileUpload: (file, options) => handleFileUpload(file, options),
    });

    if (voiceRecordBtn) {
        voiceRecordBtn.addEventListener('click', () => {
            if (voiceRecordBtn.classList.contains('is-uploading-state')) {
                cancelActiveComposerUpload();
                return;
            }
            if (voiceRecordBtn.classList.contains('is-send-state')) {
                const messageForm = document.getElementById('messageForm');
                if (messageForm && typeof messageForm.requestSubmit === 'function') {
                    messageForm.requestSubmit();
                } else if (messageForm) {
                    messageForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
                }
                return;
            }
            startVoiceRecording().catch((err) => {
                showToast(err?.message || '\u041E\u0448\u0438\u0431\u043A\u0430 \u0437\u0430\u043F\u0438\u0441\u0438.', 'danger');
            });
        });
    }
    if (voiceRecordCancelBtn) {
        voiceRecordCancelBtn.addEventListener('click', () => {
            stopVoiceRecording({ reason: 'cancel' }).catch((err) => {
                showToast(err?.message || '\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0442\u043C\u0435\u043D\u044B \u0437\u0430\u043F\u0438\u0441\u0438.', 'danger');
            });
        });
    }
    if (voiceRecordSendBtn) {
        voiceRecordSendBtn.addEventListener('click', () => {
            stopVoiceRecording({ reason: 'send' }).catch((err) => {
                showToast(err?.message || '\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0438 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u043E\u0433\u043E.', 'danger');
            });
        });
    }
    updateVoiceRecordButtonState();

    async function handleFileUpload(file, { allowCaption = true, attachMode = null } = {}) {
        if (isChatBlocked()) {
            showToast(getChatBlockNoticeText(currentBlockState), 'warning');
            return;
        }
        if (!file) return;
        const normalizedAttachMode = resolveAttachModeForFile(file, attachMode);
        if (normalizedAttachMode !== 'media' && file.size > MAX_CHAT_MEDIA_SIZE) {
            showToast(`\u0424\u0430\u0439\u043B "${file.name}" \u0441\u043B\u0438\u0448\u043A\u043E\u043C \u0431\u043E\u043B\u044C\u0448\u043E\u0439. \u041C\u0430\u043A\u0441. ${Math.round(MAX_CHAT_MEDIA_SIZE / (1024 * 1024))} \u041C\u0411.`, 'danger');
            return;
        }
        if (allowCaption) {
            showCaptionModal(file, { attachMode: normalizedAttachMode });
            return;
        }
        try {
            await sendFileMessage(file, '', { attachMode: normalizedAttachMode });
        } catch (err) {
            showToast(err.message || '\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0438 \u0444\u0430\u0439\u043B\u0430.', 'danger');
        }
    }

    // \u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0433\u0430\u043B\u043E\u0447\u043A\u0438 (\u043F\u0440\u043E\u0447\u0438\u0442\u0430\u043D\u043E) \u0434\u043B\u044F \u0432\u0441\u0435\u0445 \u0441\u043E\u0431\u0441\u0442\u0432\u0435\u043D\u043D\u044B\u0445 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0439 \u0432 \u0447\u0430\u0442\u0435
    function markAllTicksRead(readAtRaw = '') {
        const readAt = String(readAtRaw || '').trim() || null;
        if (currentChatId) {
            const state = getChatState(currentChatId);
            state.messages = state.messages.map((msg) => (
                msg.sender === 'self'
                    ? (
                        msg.is_read
                            ? msg
                            : { ...msg, is_read: true, is_delivered: true, pending: false, read_at: readAt || msg.read_at || null }
                    )
                    : msg
            ));
        }
        chatMessages?.querySelectorAll('.message.self .msg-tick.sent, .message.self .msg-tick.delivered').forEach(function(el) {
            applyTickToElement(el, { is_read: true, is_delivered: true, pending: false, read_at: readAt });
        });
    }

    function markOutgoingVoiceMessageListenedByPartner(chatId, msgId) {
        if (!chatId || !Number.isFinite(msgId)) return;
        const state = getChatState(chatId);
        if (state?.initialized) {
            const msgIndex = findMessageIndex(state, (msg) => Number(msg.id) === Number(msgId));
            if (msgIndex >= 0 && state.messages[msgIndex]?.sender === 'self') {
                state.messages[msgIndex] = {
                    ...state.messages[msgIndex],
                    voice_listened_by_partner: true,
                };
            }
        }

        if (chatId !== currentChatId) return;
        const messageEl = chatMessages?.querySelector(`.message.self[data-msg-id="${Number(msgId)}"]`);
        if (messageEl) {
            messageEl.setAttribute('data-audio-listened-by-partner', '1');
        } else if (state?.initialized) {
            scheduleForcedCurrentChatRerender();
        }
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
        return typeof value === 'string'
            && value.trim().startsWith('{')
            && value.includes('encrypted_message');
    }

    async function decryptForDisplay(privateKeyPem, encryptedPayload, isSelf) {
        if (!privateKeyPem || !isEncryptedPayload(encryptedPayload)) {
            return encryptedPayload;
        }

        if (!window.e2e || !window.e2e.decryptMessageE2E) {
            return '[E2E \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E: crypto.js \u043D\u0435 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D]';
        }

        return await window.e2e.decryptMessageE2E(privateKeyPem, encryptedPayload, isSelf);
    }

    // \u041F\u0440\u043E\u043A\u0440\u0443\u0442\u043A\u0430 \u0447\u0430\u0442\u0430 \u0432\u043D\u0438\u0437
    function scrollToBottom({ smooth = true } = {}) {
        if (!chatMessages) return;

        if (smooth && !prefersReducedMotionSetting()) {
            if (!runBottomInertiaScroll()) {
                setChatScrollTop(chatMessages.scrollHeight);
            }
        } else if (!isTailRangeRendered(currentChatId)) {
            cancelBottomInertiaScroll();
            // Fallback: \u0435\u0441\u043B\u0438 \u0445\u0432\u043E\u0441\u0442 \u043D\u0435 \u0432 \u043E\u043A\u043D\u0435 \u0432\u0438\u0440\u0442\u0443\u0430\u043B\u0438\u0437\u0430\u0446\u0438\u0438, \u0441\u043D\u0430\u0447\u0430\u043B\u0430 \u0444\u043E\u0440\u0441-\u0440\u0435\u043D\u0434\u0435\u0440\u0438\u043C \u0435\u0433\u043E.
            renderChatMessages(currentChatId, { force: true, scrollToBottom: true });
        } else {
            setChatScrollTop(chatMessages.scrollHeight);
        }

        keepChatPinnedToBottom = true;
        saveChatScrollPosition(currentChatId);
        updateJumpToNewMessagesButton();
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
            setKeepChatPinnedToBottom: (value) => { keepChatPinnedToBottom = Boolean(value); },
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
            getPartnerProfileDrawer: () => document.getElementById('partnerProfileDrawer'),
            chatTitleEl: chatTitle,
            resolveChatPartnerAvatar: () => document.getElementById('chatPartnerAvatar'),
            rerenderCurrentChat: () => {
                if (currentChatId && chatMessages) {
                    scheduleForcedCurrentChatRerender();
                }
            },
            resolveContactItemByPublicKey,
            resolveSidebarAvatarCircle: () => document.getElementById('avatarCircle'),
            resolveSidebarDisplayName: () => document.getElementById('sidebarDisplayName'),
            resolveSidebarUsername: () => document.getElementById('sidebarUsername'),
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
            getKeepChatPinnedToBottom: () => keepChatPinnedToBottom,
            setKeepChatPinnedToBottom: (value) => { keepChatPinnedToBottom = Boolean(value); },
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

    function setChatsSearchHintVisible(visible) {
        if (!chatsSearchHint) return;
        chatsSearchHint.style.display = visible ? '' : 'none';
    }

    function renderFrequentChats() {
        if (!paletteFrequentSection || !paletteFrequentChats) return;

        const frequentItems = Array.from(document.querySelectorAll('#contactsList .contact-item[data-chat-id]'))
            .sort((a, b) => {
                const aPinned = String(a.getAttribute('data-pinned') || '') === '1';
                const bPinned = String(b.getAttribute('data-pinned') || '') === '1';
                if (aPinned !== bPinned) return aPinned ? -1 : 1;

                const aTs = Number(a.getAttribute('data-last-message-ts') || 0);
                const bTs = Number(b.getAttribute('data-last-message-ts') || 0);
                if (aTs !== bTs) return bTs - aTs;

                const aName = String(a.querySelector('.contact-name')?.textContent || '').toLowerCase();
                const bName = String(b.querySelector('.contact-name')?.textContent || '').toLowerCase();
                return aName.localeCompare(bName);
            })
            .slice(0, 10);

        if (!frequentItems.length) {
            paletteFrequentSection.style.display = 'none';
            paletteFrequentChats.innerHTML = '';
            return;
        }

        paletteFrequentSection.style.display = '';
        paletteFrequentChats.innerHTML = frequentItems.map((item) => {
            const sourceAvatarEl = item.querySelector('.contact-avatar');
            const avatarHtml = sourceAvatarEl?.innerHTML || '?';
            const avatarTint = String(sourceAvatarEl?.getAttribute('data-avatar-tint') || '').trim();
            const avatarTintAttr = avatarTint
                ? ` data-avatar-tint="${escapeHtml(avatarTint)}"`
                : '';
            const chatId = escapeHtml(String(item.getAttribute('data-chat-id') || ''));
            const name = escapeHtml(String(item.querySelector('.contact-name')?.textContent || 'Чат'));
            return `
                <button type="button" class="search-frequent-chat-btn" data-chat-id="${chatId}">
                    <div class="contact-avatar search-frequent-chat-btn-avatar"${avatarTintAttr}>${avatarHtml}</div>
                    <span class="search-frequent-chat-btn-name">${name}</span>
                </button>
            `;
        }).join('');

        paletteFrequentChats.querySelectorAll('.search-frequent-chat-btn .contact-avatar').forEach((avatarEl) => {
            if (avatarEl.querySelector('img')) return;
            const label = String(
                avatarEl.closest('.search-frequent-chat-btn')?.querySelector('.search-frequent-chat-btn-name')?.textContent
                || '',
            ).trim();
            applyFallbackAvatarTint(avatarEl, label);
        });
    }

    function renderPaletteLocalMatches(query) {
        if (!paletteLocalSection || !paletteLocalResults) return;

        const normalizedQuery = String(query || '').trim().toLowerCase();
        if (!normalizedQuery) {
            paletteLocalSection.style.display = 'none';
            paletteLocalResults.innerHTML = '';
            renderFrequentChats();
            setChatsSearchHintVisible(true);
            return;
        }

        if (paletteFrequentSection) {
            paletteFrequentSection.style.display = 'none';
        }

        const items = Array.from(document.querySelectorAll('#contactsList .contact-item'));
        const matches = items.filter((item) => {
            const name = String(item.querySelector('.contact-name')?.textContent || '').toLowerCase();
            const username = String(item.querySelector('.contact-last-msg')?.textContent || '').toLowerCase();
            const publicKey = String(item.getAttribute('data-public-key') || '').toLowerCase();
            return name.includes(normalizedQuery) || username.includes(normalizedQuery) || publicKey.includes(normalizedQuery);
        }).slice(0, 8);

        if (!matches.length) {
            paletteLocalSection.style.display = 'none';
            paletteLocalResults.innerHTML = '';
            setChatsSearchHintVisible(true);
            return;
        }

        setChatsSearchHintVisible(false);
        paletteLocalSection.style.display = '';
        paletteLocalResults.innerHTML = matches.map((item) => {
            const sourceAvatarEl = item.querySelector('.contact-avatar');
            const avatarHtml = sourceAvatarEl?.innerHTML || '?';
            const avatarTint = String(sourceAvatarEl?.getAttribute('data-avatar-tint') || '').trim();
            const avatarTintAttr = avatarTint
                ? ` data-avatar-tint="${escapeHtml(avatarTint)}"`
                : '';
            const name = escapeHtml(String(item.querySelector('.contact-name')?.textContent || '\u0427\u0430\u0442'));
            const sub = escapeHtml(String(item.querySelector('.contact-last-msg')?.textContent || ''));
            const chatId = escapeHtml(String(item.getAttribute('data-chat-id') || ''));
            return `
                <div class="command-palette-result">
                    <div class="command-palette-result-meta">
                        <div class="contact-avatar command-palette-result-avatar"${avatarTintAttr}>${avatarHtml}</div>
                        <div class="command-palette-result-copy">
                            <strong>${name}</strong>
                            <span>${sub}</span>
                        </div>
                    </div>
                    <button type="button" class="command-palette-result-btn open-chat-btn" data-chat-id="${chatId}">
                        \u041E\u0442\u043A\u0440\u044B\u0442\u044C
                    </button>
                </div>
            `;
        }).join('');
        paletteLocalResults.querySelectorAll('.command-palette-result .contact-avatar').forEach((avatarEl) => {
            if (avatarEl.querySelector('img')) return;
            const label = String(
                avatarEl.closest('.command-palette-result')?.querySelector('.command-palette-result-copy strong')?.textContent
                || '',
            ).trim();
            applyFallbackAvatarTint(avatarEl, label);
        });
    }

    function openPaletteChat(chatId) {
        if (!chatId || !contactsList) return;
        const item = resolveContactItemByChatId(chatId);
        if (!item) return;
        if (typeof window.closeCommandPalette === 'function') {
            window.closeCommandPalette();
        } else {
            closeAnimatedDialog(document.getElementById('newChatModal'));
        }
        item.click();
    }

    function buildSearchResultsLoaderHtml() {
        return `
            <div class="search-results-loader" role="status" aria-live="polite">
                <div class="search-results-loader__item">
                    <div class="search-results-loader__avatar sun-skeleton-block"></div>
                    <div class="search-results-loader__lines">
                        <div class="sun-skeleton-line"></div>
                        <div class="sun-skeleton-line"></div>
                    </div>
                </div>
                <div class="search-results-loader__item">
                    <div class="search-results-loader__avatar sun-skeleton-block"></div>
                    <div class="search-results-loader__lines">
                        <div class="sun-skeleton-line"></div>
                        <div class="sun-skeleton-line"></div>
                    </div>
                </div>
            </div>
        `;
    }

    function normalizeSearchUser(user) {
        if (!user || typeof user !== 'object') return null;
        const parsedId = Number.parseInt(user.userId ?? user.user_id, 10);
        if (!Number.isFinite(parsedId) || parsedId <= 0) return null;
        const displayName = String(user.display_name || user.username || `Пользователь ${parsedId}`).trim();
        const username = String(user.username || '').trim();
        const avatarUrl = String(user.avatar_url || '').trim();
        const canGroupAddDirect = user.can_group_add_direct !== false;
        return {
            user_id: parsedId,
            display_name: displayName || `Пользователь ${parsedId}`,
            username,
            avatar_url: avatarUrl,
            can_group_add_direct: canGroupAddDirect,
        };
    }


    async function openChatByIdWhenReady(chatId) {
        const normalizedChatId = String(chatId || '').trim();
        if (!normalizedChatId) return;

        const maxAttempts = 8;
        const retryDelayMs = 220;
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            const contactItem = resolveContactItemByChatId(normalizedChatId);
            if (contactItem) {
                contactItem.click();
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
            if (attempt === 2 || attempt === 5) {
                await loadContacts({ immediate: true, attemptInitialChatRestore: false });
            }
        }
    }

    const searchOverlayGlobalContentController = initSearchOverlayGlobalContent({
        overlayEl: document.getElementById('newChatModal'),
        resolveAppUrl: withAppRoot,
        fetchImpl: window.authFetch || window.fetch?.bind(window) || fetch,
        decodeMessages: (messages) => decodeChatMessages(messages),
        contactsRoot: contactsList,
        openChatById: (chatId) => openChatByIdWhenReady(chatId),
        focusMessageInCurrentChat: (msgId, options) => window._scrollToMsg?.(msgId, options),
        closeOverlay: () => {
            if (typeof window.closeCommandPalette === 'function') {
                window.closeCommandPalette();
                return;
            }
            closeAnimatedDialog(document.getElementById('newChatModal'));
        },
        showToast,
    });

    document.getElementById('newChatModal')?.addEventListener('sun-search-overlay-tab-changed', (event) => {
        const tabId = String(event?.detail?.tabId || '').trim();
        if (tabId === 'chats') {
            const visibleSearchInput = document.getElementById('searchInput');
            const query = String(visibleSearchInput?.value || '').trim();
            renderPaletteLocalMatches(query);
            searchOverlayGlobalContentController?.refreshChatLookup?.();
            return;
        }
        if (tabId === 'contacts') {
            modalSearchInput?.dispatchEvent(new Event('input', { bubbles: true }));
        }
    });





    bindGroupModerationUiHandlers({
        groupEditMembersList,
        profileGroupMembers,
        updateGroupMemberRole: (targetUserId, role) => updateGroupMemberRole(targetUserId, role, {
            onLocalRoleUpdated: (updatedUserId, nextRole) => {
                if (!currentGroupProfile?.members) return;
                currentGroupProfile.members = currentGroupProfile.members.map((member) => {
                    if (Number(member?.user_id) !== Number(updatedUserId)) return member;
                    return { ...member, role: nextRole };
                });
                renderGroupMembers(currentGroupProfile);
                renderGroupEditMembers(currentGroupProfile);
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


    commandPaletteActions?.addEventListener('click', (event) => {
        const actionBtn = event.target.closest('[data-palette-action]');
        if (!actionBtn) return;
        const action = String(actionBtn.getAttribute('data-palette-action') || '').trim();
        if (action === 'contact') {
            document.querySelector('.search-overlay__tab[data-search-tab="contacts"]')?.click();
            document.getElementById('searchInput')?.focus();
            return;
        }
        if (action === 'settings') {
            window.closeCommandPalette?.() || closeAnimatedDialog(document.getElementById('newChatModal'));
            window.openSettingsOverlay?.('settings');
            return;
        }
        if (action === 'qr') {
            window.closeCommandPalette?.() || closeAnimatedDialog(document.getElementById('newChatModal'));
            window.openMyQrModal?.();
            return;
        }

        if (action === 'group') {
            window.closeCommandPalette?.() || closeAnimatedDialog(document.getElementById('newChatModal'));
            openGroupCreateModal();
            return;
        }
        
        if (action === 'theme') {
            document.getElementById('sidebarThemeToggleBtn')?.click();
            window.closeCommandPalette?.();
            return;
        }
        
        document.getElementById('searchInput')?.focus();
    });

    paletteLocalResults?.addEventListener('click', (event) => {
        const openBtn = event.target.closest('.open-chat-btn');
        if (!openBtn) return;
        openPaletteChat(openBtn.getAttribute('data-chat-id'));
    });

    paletteFrequentChats?.addEventListener('click', (event) => {
        const openBtn = event.target.closest('.search-frequent-chat-btn');
        if (!openBtn) return;
        openPaletteChat(openBtn.getAttribute('data-chat-id'));
    });

    function isContactsSearchTabActive() {
        const activeTab = document.querySelector('.search-overlay__tab.is-active[data-search-tab]');
        return String(activeTab?.getAttribute('data-search-tab') || '') === 'contacts';
    }

    function translateSearchLabel(value) {
        const i18nApi = window.SUN_I18N;
        if (i18nApi && typeof i18nApi.translateText === 'function') {
            return i18nApi.translateText(String(value ?? ''));
        }
        return String(value ?? '');
    }

    function renderLocalContactsDirectory(query) {
        return renderContactsDirectoryList({
            contactsRoot: contactsList,
            resultsRoot: modalSearchResults,
            query,
            escapeHtml,
            applyFallbackAvatarTint,
            formatLastSeenText,
            labels: {
                open: translateSearchLabel('\u041E\u0442\u043A\u0440\u044B\u0442\u044C'),
                online: translateSearchLabel('\u0432 \u0441\u0435\u0442\u0438'),
                offline: translateSearchLabel('\u043D\u0435 \u0432 \u0441\u0435\u0442\u0438'),
                recently: translateSearchLabel('\u0431\u044B\u043B(\u0430) \u043D\u0435\u0434\u0430\u0432\u043D\u043E'),
                empty: translateSearchLabel('\u041D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E.'),
            },
        });
    }

    function runRemoteContactsSearch(query) {
        modalSearchResults.innerHTML = buildSearchResultsLoaderHtml();
        fetch(withAppRoot(`/search_users?q=${encodeURIComponent(query)}&limit=20`))
            .then(r => r.json())
            .then(response => {
                const results = response.results || response.users || [];
                if (response.success && results) {
                    displaySearchResults(results);
                } else {
                    modalSearchResults.innerHTML = '<p class="text-center">\u041D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E.</p>';
                }
            })
            .catch(() => showToast('\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u043F\u043E\u0438\u0441\u043A\u0435 \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u0435\u0439.', 'danger'));
    }

    // \u041E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0430 \u043F\u043E\u0438\u0441\u043A\u0430 \u0432 \u0440\u0435\u0430\u043B\u044C\u043D\u043E\u043C \u0432\u0440\u0435\u043C\u0435\u043D\u0438
    if (modalSearchInput) {
        modalSearchInput.addEventListener('input', function() {
            const query = modalSearchInput.value.trim();
            renderPaletteLocalMatches(query);
            const contactsTabActive = isContactsSearchTabActive();
            if (contactsTabActive) {
                const localCount = renderLocalContactsDirectory(query);
                if (query.length === 0 || localCount > 0 || query.length < 3) {
                    return;
                }
            }
            if (query.length === 0) {
                modalSearchResults.innerHTML = '';
                return;
            }
            if (query.length < 3) {
                modalSearchResults.innerHTML = '<p class="text-center">\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043C\u0438\u043D\u0438\u043C\u0443\u043C 3 \u0441\u0438\u043C\u0432\u043E\u043B\u0430.</p>';
                return;
            }

            runRemoteContactsSearch(query);
        });
    }

    function displaySearchResults(results) {
        if (results.length === 0) {
            modalSearchResults.innerHTML = '<p class="text-center">\u041D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E.</p>';
            return;
        }

        const list = document.createElement('div');

        results.forEach(function(user) {
            const listItem = document.createElement('div');
            const existingContact = resolveContactItemByUserId(user.userId || user.user_id);
            const existingChatId = existingContact?.getAttribute('data-chat-id') || '';

            const initials = (user.display_name || user.username || '?')
                .trim().split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase();
                
            const avatarHtml = user.avatar_url
                ? `<div class="contact-avatar command-palette-result-avatar"><img class="contact-avatar__img" src="${escapeHtml(user.avatar_url)}"></div>`
                : `<div class="contact-avatar command-palette-result-avatar">${escapeHtml(initials)}</div>`;

            listItem.className = 'command-palette-result';
            listItem.innerHTML = `
                <div class="command-palette-result-meta">
                    ${avatarHtml}
                    <div class="command-palette-result-copy">
                        <strong>${escapeHtml(user.display_name)}</strong>
                        <span>@${escapeHtml(user.username)}</span>
                    </div>
                </div>
                ${existingChatId
                    ? `<button type="button" class="command-palette-result-btn open-chat-btn" data-chat-id="${escapeHtml(existingChatId)}">\u041E\u0442\u043A\u0440\u044B\u0442\u044C</button>`
                    : `<button class="command-palette-result-btn send-request-btn" data-user-id="${user.userId || user.user_id}" data-display-name="${escapeHtml(user.display_name)}">\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C</button>`
                }
            `;
            list.appendChild(listItem);
        });

        modalSearchResults.innerHTML = '';
        modalSearchResults.appendChild(list);
        modalSearchResults.querySelectorAll('.command-palette-result .contact-avatar').forEach((avatarEl) => {
            if (avatarEl.querySelector('img')) return;
            const label = String(
                avatarEl.closest('.command-palette-result')?.querySelector('.command-palette-result-copy strong')?.textContent
                || '',
            ).trim();
            applyFallbackAvatarTint(avatarEl, label);
        });
    }

    // \u041E\u0431\u0440\u0430\u0431\u043E\u0442\u0447\u0438\u043A \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0438 \u0437\u0430\u043F\u0440\u043E\u0441\u0430 \u043D\u0430 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0438\u0435
    if (modalSearchResults) {
        modalSearchResults.addEventListener('click', function(e) {
            const target = e.target;
            const openBtn = target.closest('.open-chat-btn');
            if (openBtn) {
                openPaletteChat(openBtn.getAttribute('data-chat-id'));
                return;
            }
            const button = target.closest('.send-request-btn');
            if (button) {
                const userId = button.getAttribute('data-user-id');
                const displayName = button.getAttribute('data-display-name');
                sendDialogRequest(userId, displayName);
            }
        });
    }

    // Empty-state action buttons.
    // '\u041D\u0430\u0439\u0442\u0438 \u043A\u043E\u043D\u0442\u0430\u043A\u0442' button - opens command palette / user search
    const emptyStatePrimaryBtn = document.getElementById('emptyStatePrimaryBtn');
    const emptyStateSecondaryBtn = document.getElementById('emptyStateSecondaryBtn');

    function openCommandPaletteModal() {
        if (typeof window.openCommandPalette === 'function' && window.openCommandPalette !== openCommandPaletteModal) {
            window.openCommandPalette('');
            return;
        }
        const modal = document.getElementById('newChatModal');
        const input = document.getElementById('searchUserInput');
        const results = document.getElementById('searchUserResults');
        if (!modal) return;
        if (results) results.innerHTML = '';
        if (input) input.value = '';
        openAnimatedDialog(modal, { focusTarget: input });
        requestAnimationFrame(() => {
            try { input?.focus({ preventScroll: true }); } catch (_) {}
        });
    }

    // Expose fallback API only when overlay module did not register modern handlers.
    if (typeof window.openCommandPalette !== 'function') {
        window.openCommandPalette = openCommandPaletteModal;
    }

    emptyStatePrimaryBtn?.addEventListener('click', () => {
        window.openCommandPalette?.();
    });

    emptyStateSecondaryBtn?.addEventListener('click', () => {
        window.openMyQrModal?.();
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

    // Close active overlays and transient UI on Escape.
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (reactionPickerController.isOpen()) { closeReactionPicker(); return; }
            if (isAttachMenuOpen()) { closeAttachMenu(); return; }
            if (captionModalController.hasPendingFile()) { closeCaptionModal(); return; }
            const lb = document.getElementById('lightbox');
            if (lb?.classList.contains('active')) { _closeLightbox(); return; }
            if (closeMessageSearchOverlay()) return;
            if (messageSelectionController.isSelectionMode()) { toggleSelectionMode(false); return; }
            if (isEditingMessageId) cancelEdit();
            if (getReplyState().replyToId) cancelReply();
        }
    });
    const messageTouchContextController = initMessageTouchContext({
        chatMessages,
        reactionPicker,
        contextMenu,
        messageSelectionController,
        closeReactionPicker,
        hideContextMenu,
        closeMessageActionsBar,
        toggleSelectionMode,
        toggleMessageSelection,
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

    // Modal Delete Logic
    const { openDeleteModal } = initDeleteMessagesModal({
        modalEl: deleteConfirmModal,
        cancelButtonEl: cancelDeleteBtn,
        confirmButtonEl: confirmDeleteBtn,
        deleteForBothCheckEl: deleteForBothCheck,
        deleteForBothWrapEl: deleteForBothWrap,
        titleEl: deleteModalTitle,
        isChatBlocked,
        getBlockedNoticeText: getChatBlockNoticeText,
        currentBlockState: () => currentBlockState,
        resolveMessageElement: (id) => document.querySelector(`.message[data-msg-id="${id}"]`),
        openDialog: openAnimatedDialog,
        closeDialog: closeAnimatedDialog,
        onConfirm: ({ messageIds, mode }) => {
            emitSocket('delete_messages', {
                msg_ids: messageIds,
                chat_id: currentChatId,
                mode,
            });
        },
        onBlocked: (text) => showToast(text, 'warning'),
        onAfterConfirm: () => {
            if (messageSelectionController.isSelectionMode()) toggleSelectionMode(false);
            closeMessageActionsBar();
        },
    });

    initMessageActionHandlers({
        barCopyButtonEl: document.getElementById('barCopyBtn'),
        barEditButtonEl: document.getElementById('barEditBtn'),
        barDeleteButtonEl: document.getElementById('barDeleteBtn'),
        barSelectButtonEl: barSelectBtn,
        cancelSelectionButtonEl: cancelSelectionBtn,
        bulkDeleteButtonEl: bulkDeleteBtn,
        bulkForwardButtonEl: bulkForwardBtn,
        bulkCopyButtonEl: bulkCopyBtn,
        chatMessages,
        getSelectedMessageState: () => messageActionsBarController.getState(),
        messageSelectionController,
        copyTextToClipboard,
        showToast,
        isChatBlocked,
        openDeleteModal,
        startEditMessage,
        toggleSelectionMode,
        onForwardSelected: (messageIds) => {
            openForwardModal(messageIds);
        },
        toggleMessageSelection,
        closeMessageActionsBar,
        resolveMessageElement: (id) => document.querySelector(`.message[data-msg-id="${id}"]`),
    });
    barCancelBtn?.addEventListener('click', () => closeMessageActionsBar());

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

    window.startEditMessage = startEditMessage;
    window.showContextMenu = showContextMenu;
    window.toggleSelectionMode = toggleSelectionMode;

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
    window._redecryptCurrentChat = refreshPrivateKeyDependentUi;
    window.addEventListener('sun-private-key-status-changed', () => {
        refreshPrivateKeyDependentUi().catch((error) => {
            console.warn('Private key UI refresh failed:', error);
        });
    });
    window.addEventListener('sun-ui-language-changed', (event) => {
        const hydrated = event?.detail?.hydrated;
        refreshLocalizedRuntimeUi({ hydrated });
        const shouldReloadContacts = hydrated === true || typeof hydrated === 'undefined';
        if (shouldReloadContacts) {
            loadContacts({ immediate: true }).catch(() => {});
        }
        syncChatConnectionStatus();
    });

    wireBeforeUnloadCleanup({
        tabAlertController,
        dateNavigatorController,
        reportActivity,
        activityController,
        unbindWindowActivityEvents: () => {
            unbindWindowActivityEvents();
            unbindVisibilityEvents();
            mobileBackSwipeController.dispose();
            messageTouchContextController.dispose();
        },
        voiceRecorderController,
        disposeChatAnimations: () => chatAnimationsController?.dispose(),
        isChatIdbReady,
        chatIdbRuntime,
        getExistingChatHistoryRuntime: () => chatHistoryRuntime,
        disposeMediaCacheRuntime: () => {
            delete window.__sunMediaCacheResolveSource;
            delete window.__sunMediaCacheRememberElement;
            delete window.__sunScheduleDataMemoryPolicy;
            mediaCacheRuntime.close().catch(() => {});
        },
        disconnectSocket: () => {
            try {
                socket.disconnect();
            } catch (_) {}
        },
    });

};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initChatPage, { once: true });
} else {
    initChatPage();
}
