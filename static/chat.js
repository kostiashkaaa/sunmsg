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
import { withAppRoot } from './modules/app-url.js';
import { initLightbox } from './modules/lightbox.js';
import { initPresence } from './modules/presence.js';
import { showToast, initDialogRequests, sendDialogRequest } from './modules/dialogs.js';
import { activateFocusTrap, deactivateFocusTrap } from './modules/focus-trap.js';
import { showDeleteChatDialog } from './modules/delete-chat.js';
import { initProfileDrawer, parseUtcDate as _parseUtcDate, formatLastSeenText as _formatLastSeenText, formatRegistrationDate as _formatRegistrationDate, renderProfileHeader as _renderProfileHeader, renderProfileStats as _renderProfileStats, renderProfileMeta as _renderProfileMeta, renderProfileBio as _renderProfileBio, renderPartnerProfile as _renderPartnerProfile, handleProfileAction as _handleProfileAction } from './modules/profile-drawer.js';
import { getOutgoingStatus as _getOutgoingStatus, buildTickHtml as _buildTickHtml, applyTickToElement as _applyTickToElement, buildMessageAvatarHtml as _buildMessageAvatarHtml, isSameMessageGroup as _isSameMessageGroup, getMessageGroup as _getMessageGroup, getMessageDayKey as _getMessageDayKey, formatDaySeparatorLabel as _formatDaySeparatorLabel, createDaySeparatorNode as _createDaySeparatorNode, buildMessageElement as _buildMessageElement } from './modules/message-rendering.js?v=20260501d';
import { renderMessageLinkPreview } from './modules/message-link-preview.js';
import { getChatState as _getChatState, createChatState as _createChatState, getMessageKey as _getMessageKey, findMessageIndex as _findMessageIndex, findMessageById as _findMessageById, compareChatMessages as _compareChatMessages, normalizeChatMessageOrder as _normalizeChatMessageOrder, upsertChatMessage as _upsertChatMessage, prependChatMessages as _prependChatMessages, removeChatMessages as _removeChatMessages, setChatMessages as _setChatMessages, estimateMessageHeight as _estimateMessageHeight, CHAT_DEFAULT_MESSAGE_HEIGHT as _CHAT_DEFAULT_MESSAGE_HEIGHT } from './modules/chat-state.js';
import { REACTION_PICKER_EMOJIS as _REACTION_PICKER_EMOJIS, normalizeReactionReactor as _normalizeReactionReactor, getReactionReactorKey as _getReactionReactorKey, normalizeReactionReactors as _normalizeReactionReactors, isCurrentUserReactionReactor as _isCurrentUserReactionReactor, buildCurrentUserReactionReactor as _buildCurrentUserReactionReactor, buildReactionReactorInitials as _buildReactionReactorInitials, buildReactionReactorsHtml as _buildReactionReactorsHtml, normalizeMessageReactions as _normalizeMessageReactions, areMessageReactionsEqual as _areMessageReactionsEqual, getReactionMessageKey as _getReactionMessageKey, computeOptimisticReactions as _computeOptimisticReactions, buildMessageReactionsHtml as _buildMessageReactionsHtml } from './modules/reactions.js?v=20260501a';
import { initComposer as _initComposer } from './modules/composer.js';
import { buildContactItemHtml as _buildContactItemHtml, hydrateContactAvatarLoading as _hydrateContactAvatarLoading, updateSidebarContactTick as _updateSidebarContactTick, updateActiveContactLastMessage as _updateActiveContactLastMessage } from './modules/contacts.js?v=2.1.1';
import { applyBlockNoticeUI as _applyBlockNoticeUI, normalizeBlockState as _normalizeBlockState } from './modules/block-ui.js';
import { getStoredString, setStoredString, hideBootOverlay as _hideBootOverlay, setElementActiveState, openFloatingPanel, closeFloatingPanel, openAnimatedDialog, closeAnimatedDialog, copyTextToClipboard, addTapFeedback } from './modules/chat-shell-ui.js?v=20260501a';
import { createChatMutePreferences } from './modules/chat-mute-preferences.js';
import { notifyIncomingChatMessage } from './modules/chat-incoming-notifications.js';
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
import { initSidebarBrandQuickActions } from './modules/sidebar-brand-quick-actions.js?v=20260507a';
import { createSavedMessagesUiController } from './modules/saved-messages-ui.js';
import { initContactContextMenu, initDeleteMessagesModal } from './modules/chat-overlays.js';
import { updatePinIcon as _updatePinIcon, applyPinnedState as _applyPinnedState, sortContactsList as _sortContactsList, initPinnedContactsDnD } from './modules/pinned-contacts.js';
import { initCaptionModal } from './modules/caption-modal.js?v=20260508a';
import { initMessageActionsBar } from './modules/message-actions-bar.js';
import { initMessageSelection } from './modules/message-selection.js';
import { initMessageContextMenu } from './modules/message-context-menu.js';
import { initReactionPickerController } from './modules/reaction-picker.js';
import { initReplyBar, initPinnedBar } from './modules/message-thread-banners.js';
import { initLinkDraftBar } from './modules/link-draft-banner.js';
import { scheduleMessageLinkPreviewPrewarm } from './modules/link-preview-prewarm.js';
import { initMessageActionHandlers } from './modules/message-action-handlers.js';
import { initChatDateNavigator } from './modules/chat-date-navigator.js';
import { sendFileMessageFlow } from './modules/chat-file-send.js?v=2.1.2';
import { sendTextMessageFlow } from './modules/chat-text-send.js?v=2.0.11';
import { handleComposerEditFlow } from './modules/chat-edit-flow.js?v=2.1.1';
import { registerMessageStatusSocketHandlers } from './modules/chat-message-status-events.js?v=2.0.9';
import { registerIncomingMessageSocketHandlers } from './modules/chat-incoming-message-events.js?v=2.1.0';
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
import { bindPartnerBlockControls, createChatConnectionStatusPresenter, createOnlineStatusStateController, loadOnlineStatusFlow, markMessagesAsReadFlow } from './modules/chat-partner-network.js?v=20260501a';
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
import { createVisualViewportCssSyncer } from './modules/mobile-viewport.js?v=20260501e';
import { initPrivateKeyUiRefresh } from './modules/private-key-ui-refresh.js';
import { createMediaHydrationController } from './modules/media-hydration.js?v=20260502a';
import { createChatMessageMutations } from './modules/chat-message-mutations.js';
import { initWebPush } from './modules/web-push.js';
import { initChatBootstrap } from './chat/bootstrap.js';
import { createSidebarShell } from './chat/sidebar-shell.js';
import { syncE2EPillState as syncE2EPillStateFlow } from './chat/e2e-flows.js';
import { createThreadShell, createMobileThreadShell } from './chat/thread-shell.js';
import { createChatStateShell } from './chat/chat-state-shell.js';
import { initMobileBackSwipe } from './chat/mobile-back-swipe.js';
import { createMessageEditController } from './chat/message-edit-controller.js?v=2.1.1';
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
        syncChatConnectionStatus: () => syncChatConnectionStatus(),
        getCurrentChatId: () => currentChatId,
        isChatBlocked: () => isChatBlocked(),
        joinChatRoom: (chatId) => joinChatRoom(chatId),
        markCurrentChatSeenIfPossible: () => markCurrentChatSeenIfPossible(),
        syncSidebarStatusBar: () => syncSidebarStatusBar(),
        loadContacts: () => loadContacts(),
        loadDialogRequests: () => loadDialogRequests(),
        getHasSocketConnectedOnce: () => hasSocketConnectedOnce,
        setHasSocketConnectedOnce: (value) => { hasSocketConnectedOnce = Boolean(value); },
        setHasSocketConnectionIssue: (value) => { hasSocketConnectionIssue = Boolean(value); },
    });
    let currentChatId = null;
    let currentContactId = null;
    let chatDraftSaveTimer = 0;
    let chatDraftSaveTargetChatId = '';
    let chatDraftSaveQueuedText = '';
    let activeDraftLoadRequestId = 0;
    const lastSavedDraftByChatId = new Map();
    const lastDraftUpdatedAtByChatId = new Map();
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
    chatIdbRuntime.init();
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
    let reportSubmitInFlight = false;
    let reportModalTarget = null;
    let forwardModalActionInFlight = false;
    const forwardSourceMessageIds = new Set();
    const forwardComposerDraftByChatId = new Map();
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
        window.setTimeout(callback, 0);
    };
    function waitMs(durationMs) {
        return new Promise((resolve) => {
            window.setTimeout(resolve, Math.max(0, Number(durationMs) || 0));
        });
    }
    function createIdempotencyKey() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return window.crypto.randomUUID();
        }
        const entropy = Math.random().toString(36).slice(2);
        return `mrep-${Date.now()}-${entropy}`;
    }
    function setReportStatus(text, tone = 'info') {
        if (!reportContentStatus) return;
        reportContentStatus.textContent = String(text || '');
        reportContentStatus.dataset.tone = String(tone || 'info');
    }
    function resetReportModalForm() {
        if (reportReasonSelect) {
            reportReasonSelect.value = 'spam';
        }
        if (reportCommentInput) {
            reportCommentInput.value = '';
        }
        setReportStatus('');
        reportSubmitInFlight = false;
        if (reportSubmitBtn) {
            reportSubmitBtn.disabled = false;
        }
    }
    function describeReportTarget(target = null) {
        if (!target) return 'Report target is not selected.';
        if (target.targetType === 'message') {
            const safeMessageId = String(target.messageId || target.targetId || '').trim();
            const preview = String(target.preview || '').trim();
            if (preview) {
                return `Report target: message #${safeMessageId || target.targetId}. "${preview}"`;
            }
            return `Report target: message #${target.targetId}.`;
        }
        if (target.targetType === 'user') {
            const safeUserId = String(target.targetId || '').trim();
            const username = String(target.username || '').trim();
            if (username) {
                return `Report target: user #${safeUserId} (@${username}).`;
            }
            const display = String(target.displayName || '').trim();
            if (display) {
                return `Report target: user #${safeUserId} (${display}).`;
            }
            return `Report target: user #${target.targetId}.`;
        }
        return `Report target: ${target.targetType || 'unknown'} #${target.targetId}`;
    }
    async function pollReportStatus(reportId, { maxAttempts = 5, intervalMs = 1500 } = {}) {
        const safeReportId = Number.parseInt(reportId, 10);
        if (!Number.isFinite(safeReportId) || safeReportId <= 0) return null;
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            if (attempt > 0) {
                await waitMs(intervalMs);
            }
            try {
                const response = await fetch(withAppRoot(`/api/moderation/reports/${safeReportId}`), {
                    method: 'GET',
                    headers: { Accept: 'application/json' },
                });
                const payload = await response.json();
                if (!response.ok || !payload?.success) continue;
                const status = String(payload.status || '').toLowerCase();
                if (status === 'closed') {
                    return payload;
                }
                if (status === 'triaged') {
                    return payload;
                }
            } catch (_) {}
        }
        return null;
    }
    function openReportModal(target) {
        if (!reportContentModal) return;
        reportModalTarget = target || null;
        if (reportContentTargetLabel) {
            reportContentTargetLabel.textContent = describeReportTarget(reportModalTarget);
        }
        resetReportModalForm();
        openAnimatedDialog(reportContentModal, { focusTarget: reportReasonSelect || reportCommentInput });
    }
    async function submitReportFromModal() {
        if (reportSubmitInFlight) return;
        if (!reportModalTarget?.targetType || !reportModalTarget?.targetId) {
            setReportStatus('Cannot submit report: target is missing.', 'error');
            return;
        }
        reportSubmitInFlight = true;
        if (reportSubmitBtn) {
            reportSubmitBtn.disabled = true;
        }
        setReportStatus('Sending report...', 'info');
        const idempotencyKey = createIdempotencyKey();
        const reasonCode = String(reportReasonSelect?.value || 'abuse').trim().toLowerCase() || 'abuse';
        const comment = String(reportCommentInput?.value || '').trim();
        const payload = {
            target_type: String(reportModalTarget.targetType),
            target_id: String(reportModalTarget.targetId),
            reason_code: reasonCode,
            comment,
            client_event_id: idempotencyKey,
        };
        if (Number.isFinite(Number(reportModalTarget.messageId)) && Number(reportModalTarget.messageId) > 0) {
            payload.message_id = Number(reportModalTarget.messageId);
        }
        try {
            const response = await fetch(withAppRoot('/api/moderation/reports'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    'X-CSRFToken': getCsrfToken(),
                    'Idempotency-Key': idempotencyKey,
                },
                body: JSON.stringify(payload),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data?.success) {
                const errorCode = String(data?.error || '').trim();
                if (errorCode === 'idempotency_key_required') {
                    setReportStatus('Повтор не выполнен: требуется ключ идемпотентности.', 'error');
                } else if (errorCode === 'invalid_target') {
                    setReportStatus('Цель жалобы указана некорректно.', 'error');
                } else {
                    setReportStatus('Не удалось отправить жалобу. Попробуйте ещё раз.', 'error');
                }
                return;
            }
            setReportStatus('Жалоба принята. Проверяем статус...', 'success');
            const resolved = await pollReportStatus(data.report_id, { maxAttempts: 6, intervalMs: 1500 });
            if (resolved) {
                const status = String(resolved.status || '').toLowerCase();
                if (status === 'closed') {
                    setReportStatus('Жалоба автоматически закрыта.', 'success');
                } else if (status === 'triaged') {
                    setReportStatus('Жалоба передана на проверку модератору.', 'success');
                } else {
                    setReportStatus('Жалоба получена.', 'success');
                }
            } else {
                setReportStatus('Жалоба получена и поставлена в очередь.', 'success');
            }
            showToast('Жалоба отправлена.', 'success');
            window.setTimeout(() => {
                if (!reportContentModal?.open) return;
                closeAnimatedDialog(reportContentModal);
            }, 650);
        } catch (_) {
            setReportStatus('Сетевая ошибка при отправке жалобы.', 'error');
        } finally {
            reportSubmitInFlight = false;
            if (reportSubmitBtn) {
                reportSubmitBtn.disabled = false;
            }
        }
    }
    reportSubmitBtn?.addEventListener('click', () => {
        void submitReportFromModal();
    });
    reportCancelBtn?.addEventListener('click', () => {
        reportModalTarget = null;
        resetReportModalForm();
    });
    reportContentModal?.addEventListener('close', () => {
        reportModalTarget = null;
        resetReportModalForm();
    });
    const FORWARD_ALLOWED_MESSAGE_TYPES = new Set(['text', 'link', 'photo', 'video', 'audio', 'file']);

    function resolveForwardContactRows() {
        if (!contactsList) return [];
        const rows = [];
        const items = Array.from(contactsList.querySelectorAll('.contact-item[data-chat-id]'));
        const currentUserIdText = String(CURRENT_USER_ID || '').trim();
        items.forEach((item, orderIndex) => {
            const chatId = String(item.getAttribute('data-chat-id') || '').trim();
            if (!chatId) return;
            const displayName = String(item.querySelector('.contact-name')?.textContent || '').trim()
                || String(item.getAttribute('data-contact-username') || '').trim()
                || chatId;
            const username = String(item.getAttribute('data-contact-username') || '').trim();
            const publicKey = String(item.getAttribute('data-public-key') || '').trim();
            const contactId = String(item.getAttribute('data-contact-id') || '').trim();
            const isGroup = String(item.getAttribute('data-is-group') || '') === '1';
            const isSaved = Boolean(currentUserIdText && contactId && contactId === currentUserIdText);
            const isPinned = String(item.getAttribute('data-pinned') || '') === '1';
            const pinOrderRaw = Number.parseInt(String(item.getAttribute('data-pin-order') || ''), 10);
            const pinOrder = Number.isFinite(pinOrderRaw) ? pinOrderRaw : null;
            const membersCount = Math.max(0, Number(item.getAttribute('data-members-count') || 0) || 0);
            const isOnline = Boolean(item.querySelector('.contact-avatar .status-dot.online'));
            const lastSeenRaw = String(item.getAttribute('data-last-seen') || '').trim();
            const sourceAvatarEl = item.querySelector('.contact-avatar');
            const avatarClone = sourceAvatarEl?.cloneNode(true);
            avatarClone?.querySelector('.status-dot')?.remove();
            const avatarHtml = String(avatarClone?.innerHTML || '').trim() || '?';
            const avatarTint = String(sourceAvatarEl?.getAttribute('data-avatar-tint') || '').trim();
            const statusText = isSaved
                ? 'сохранённые сообщения'
                : (isGroup
                    ? formatGroupMembersCountLabel(membersCount)
                    : (isOnline
                        ? 'в сети'
                        : (lastSeenRaw ? formatLastSeenText(lastSeenRaw) : 'был(а) недавно')));
            rows.push({
                chatId,
                displayName,
                username,
                publicKey,
                isGroup,
                isSaved,
                isPinned,
                pinOrder,
                orderIndex,
                avatarHtml,
                avatarTint,
                statusText,
            });
        });
        return rows;
    }

    function inferForwardMessageType(messageType, plainText) {
        const normalizedType = String(messageType || '').trim().toLowerCase();
        if (FORWARD_ALLOWED_MESSAGE_TYPES.has(normalizedType)) {
            return normalizedType;
        }
        const filePayload = parseSunFilePayload(plainText);
        if (filePayload) {
            const mime = String(filePayload.mime || '').trim().toLowerCase();
            if (mime.startsWith('image/')) return 'photo';
            if (mime.startsWith('video/')) return 'video';
            if (mime.startsWith('audio/')) return 'audio';
            return 'file';
        }
        if (/((https?:\/\/|www\.)[^\s<]+)/i.test(String(plainText || ''))) {
            return 'link';
        }
        return 'text';
    }

    function resolveForwardSourceMessages(messageIds) {
        const sourceChatId = String(currentChatId || '').trim();
        if (!sourceChatId) return [];
        const resolved = [];
        messageIds.forEach((rawId) => {
            const numericId = Number.parseInt(String(rawId || ''), 10);
            if (!Number.isFinite(numericId) || numericId <= 0) return;
            const element = document.querySelector(`.message[data-msg-id="${numericId}"]`);
            const stateMessage = findMessageById(sourceChatId, numericId);
            const plainText = String(element?.getAttribute('data-message-content') || stateMessage?.message || '').trim();
            if (!plainText) return;
            const messageType = inferForwardMessageType(stateMessage?.message_type, plainText);
            const sourceForwardName = String(stateMessage?.forwardFromName || stateMessage?.forward_from_name || '').trim();
            const sourceSenderName = String(
                stateMessage?.senderDisplayName
                || stateMessage?.sender_display_name
                || (stateMessage?.sender === 'self' ? (currentDisplayName || currentUsername || 'Вы') : '')
                || '',
            ).trim();
            const forwardFromName = sourceForwardName || sourceSenderName;
            const sourceForwardUserId = Number(stateMessage?.forwardFromUserId || stateMessage?.forward_from_user_id);
            const sourceSenderUserId = Number(stateMessage?.senderUserId || stateMessage?.sender_user_id);
            const forwardFromUserId = Number.isFinite(sourceForwardUserId) && sourceForwardUserId > 0
                ? sourceForwardUserId
                : (Number.isFinite(sourceSenderUserId) && sourceSenderUserId > 0 ? sourceSenderUserId : null);
            resolved.push({
                messageId: numericId,
                plainText,
                messageType,
                forwardFromName,
                forwardFromUserId,
            });
        });
        return resolved;
    }

    function normalizeForwardDraftMessageCountLabel(count) {
        const safeCount = Math.max(0, Number(count) || 0);
        const mod10 = safeCount % 10;
        const mod100 = safeCount % 100;
        if (mod10 === 1 && mod100 !== 11) return `${safeCount} сообщение`;
        if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${safeCount} сообщения`;
        return `${safeCount} сообщений`;
    }

    function buildForwardDraftPreviewText(sourceMessages) {
        if (!Array.isArray(sourceMessages) || !sourceMessages.length) return '';
        const firstLine = String(sourceMessages[0]?.plainText || '').replace(/\s+/g, ' ').trim();
        if (!firstLine) return '';
        if (firstLine.length <= 140) return firstLine;
        return `${firstLine.slice(0, 140).trimEnd()}...`;
    }

    function showForwardDraftBar() {
        if (!forwardDraftBar) return;
        forwardDraftBar.classList.remove('link-draft-bar--hidden', 'is-closing');
        forwardDraftBar.style.display = 'flex';
        forwardDraftBar.setAttribute('aria-hidden', 'false');
        requestAnimationFrame(() => forwardDraftBar.classList.add('is-visible'));
    }

    function hideForwardDraftBar() {
        if (!forwardDraftBar) return;
        forwardDraftBar.classList.remove('is-visible');
        forwardDraftBar.classList.add('is-closing');
        forwardDraftBar.setAttribute('aria-hidden', 'true');
        waitForMotionEnd(forwardDraftBar, 220).then(() => {
            if (forwardDraftBar.classList.contains('is-visible')) return;
            forwardDraftBar.classList.add('link-draft-bar--hidden');
            forwardDraftBar.classList.remove('is-closing');
            forwardDraftBar.style.display = 'none';
        });
    }

    function getForwardComposerDraftForChat(chatId) {
        const normalizedChatId = String(chatId || '').trim();
        if (!normalizedChatId) return null;
        return forwardComposerDraftByChatId.get(normalizedChatId) || null;
    }

    function hasPendingForwardDraftForCurrentChat() {
        return Boolean(getForwardComposerDraftForChat(currentChatId));
    }

    function syncForwardDraftBarForCurrentChat() {
        const draft = getForwardComposerDraftForChat(currentChatId);
        if (!draft) {
            hideForwardDraftBar();
            updateVoiceRecordButtonState();
            return;
        }
        if (forwardDraftLabel) {
            forwardDraftLabel.textContent = `Переслать ${normalizeForwardDraftMessageCountLabel(draft.messages.length)}`;
        }
        if (forwardDraftText) {
            forwardDraftText.textContent = buildForwardDraftPreviewText(draft.messages);
            applyEmojiGraphics(forwardDraftText);
        }
        showForwardDraftBar();
        updateVoiceRecordButtonState();
    }

    function clearForwardComposerDraft(chatId) {
        const normalizedChatId = String(chatId || '').trim();
        if (!normalizedChatId) return;
        forwardComposerDraftByChatId.delete(normalizedChatId);
        syncForwardDraftBarForCurrentChat();
    }

    function setForwardComposerDraft(chatId, sourceMessages) {
        const normalizedChatId = String(chatId || '').trim();
        if (!normalizedChatId || !Array.isArray(sourceMessages) || !sourceMessages.length) return;
        const normalizedMessages = sourceMessages.map((message) => ({
            messageId: Number(message?.messageId) || 0,
            plainText: String(message?.plainText || ''),
            messageType: inferForwardMessageType(message?.messageType, message?.plainText),
            forwardFromName: String(message?.forwardFromName || '').trim(),
            forwardFromUserId: Number(message?.forwardFromUserId) || null,
        })).filter((message) => message.messageId > 0 && message.plainText.trim());
        if (!normalizedMessages.length) return;
        forwardComposerDraftByChatId.set(normalizedChatId, {
            targetChatId: normalizedChatId,
            messages: normalizedMessages,
            createdAt: Date.now(),
        });
        syncForwardDraftBarForCurrentChat();
    }

    function updateForwardModalState() {
        if (messageForwardSearchInput) {
            messageForwardSearchInput.disabled = forwardModalActionInFlight;
        }
        if (messageForwardSubmitBtn) {
            messageForwardSubmitBtn.disabled = true;
            messageForwardSubmitBtn.textContent = forwardModalActionInFlight ? 'Пересылка...' : 'Выберите чат';
        }
    }

    function renderForwardSelectedInfo() {
        if (!messageForwardSelectedInfo) return;
        messageForwardSelectedInfo.textContent = `Выбрано сообщений: ${forwardSourceMessageIds.size}.`;
    }

    function renderForwardTargets() {
        if (!messageForwardTargets) return;
        const query = String(messageForwardSearchInput?.value || '').trim().toLowerCase();
        const rows = resolveForwardContactRows().filter((row) => {
            if (!query) return true;
            return row.displayName.toLowerCase().includes(query)
                || row.username.toLowerCase().includes(query)
                || row.chatId.toLowerCase().includes(query)
                || String(row.statusText || '').toLowerCase().includes(query);
        });
        if (!rows.length) {
            messageForwardTargets.innerHTML = '<p class="forward-targets-empty">Чаты не найдены.</p>';
            return;
        }

        const isPinnedRow = (row) => row.isSaved || row.isPinned;
        const pinnedRows = rows.filter(isPinnedRow);
        const recentRows = rows.filter((row) => !isPinnedRow(row));
        const sortBySidebarOrder = (left, right) => {
            const leftPinned = isPinnedRow(left);
            const rightPinned = isPinnedRow(right);
            if (leftPinned && rightPinned) {
                if (left.isSaved !== right.isSaved) return left.isSaved ? -1 : 1;
                const leftPinOrder = Number.isFinite(left.pinOrder) ? left.pinOrder : Number.MAX_SAFE_INTEGER;
                const rightPinOrder = Number.isFinite(right.pinOrder) ? right.pinOrder : Number.MAX_SAFE_INTEGER;
                if (leftPinOrder !== rightPinOrder) return leftPinOrder - rightPinOrder;
            }
            return left.orderIndex - right.orderIndex;
        };
        pinnedRows.sort(sortBySidebarOrder);
        recentRows.sort(sortBySidebarOrder);

        const renderRow = (row) => {
            const avatarTintAttr = row.avatarTint
                ? ` data-avatar-tint="${escapeHtml(row.avatarTint)}"`
                : '';
            return `
                <button
                    type="button"
                    class="group-create-result-item forward-target-row"
                    data-forward-target-chat-id="${escapeHtml(row.chatId)}"
                >
                    <span class="forward-target-avatar"${avatarTintAttr}>${row.avatarHtml}</span>
                    <span class="forward-target-copy">
                        <span class="group-create-result-name forward-target-name">${escapeHtml(row.displayName)}</span>
                        <span class="group-create-result-username forward-target-status">${escapeHtml(row.statusText)}</span>
                    </span>
                </button>
            `;
        };
        const renderSection = (title, sectionRows) => {
            if (!sectionRows.length) return '';
            return `
                <section class="forward-target-section">
                    <h6 class="forward-target-section-title">${escapeHtml(title)}</h6>
                    <div class="forward-target-section-items">${sectionRows.map(renderRow).join('')}</div>
                </section>
            `;
        };

        if (query) {
            messageForwardTargets.innerHTML = rows.map(renderRow).join('');
        } else {
            messageForwardTargets.innerHTML = `${renderSection('Закреплённые', pinnedRows)}${renderSection('Недавние', recentRows)}`;
        }

        messageForwardTargets.querySelectorAll('.forward-target-avatar').forEach((avatarEl) => {
            if (!(avatarEl instanceof HTMLElement)) return;
            if (avatarEl.querySelector('img')) return;
            const name = String(avatarEl.closest('.forward-target-row')?.querySelector('.forward-target-name')?.textContent || '').trim();
            applyFallbackAvatarTint(avatarEl, name);
        });
    }

    function resetForwardModalState() {
        forwardModalActionInFlight = false;
        forwardSourceMessageIds.clear();
        if (messageForwardSearchInput) messageForwardSearchInput.value = '';
        renderForwardSelectedInfo();
        renderForwardTargets();
        updateForwardModalState();
    }

    function openForwardModal(messageIds) {
        if (!messageForwardModal) return;
        forwardSourceMessageIds.clear();
        (Array.isArray(messageIds) ? messageIds : [messageIds]).forEach((rawId) => {
            const numericId = Number.parseInt(String(rawId || ''), 10);
            if (!Number.isFinite(numericId) || numericId <= 0) return;
            forwardSourceMessageIds.add(String(numericId));
        });
        forwardModalActionInFlight = false;
        if (messageForwardSearchInput) messageForwardSearchInput.value = '';
        renderForwardSelectedInfo();
        renderForwardTargets();
        updateForwardModalState();
        openAnimatedDialog(messageForwardModal, { focusTarget: messageForwardSearchInput || messageForwardSubmitBtn });
    }

    async function encryptForForwardTarget(contactRow, plainText) {
        if (contactRow.isGroup) {
            return plainText;
        }
        const publicKey = String(contactRow.publicKey || '').trim();
        if (!publicKey) {
            throw new Error(`Не найден ключ шифрования для чата ${contactRow.displayName}.`);
        }
        if (!getPrivateKeyPem()) {
            throw new Error('Нет приватного ключа. Войдите заново с вашим ключом.');
        }
        if (!currentUserPublicKey) {
            throw new Error('Не найден ваш публичный ключ. Обновите страницу и войдите заново.');
        }
        return window.e2e.encryptMessageE2E(publicKey, currentUserPublicKey, plainText);
    }

    async function forwardMessagesToTargets(sourceMessages, targetRows) {
        let sentCount = 0;
        for (const targetRow of targetRows) {
            for (const sourceMessage of sourceMessages) {
                const encryptedPayload = await encryptForForwardTarget(targetRow, sourceMessage.plainText);
                const emitted = emitSocket('send_message', {
                    message: encryptedPayload,
                    chat_id: targetRow.chatId,
                    message_type: sourceMessage.messageType,
                    client_id: crypto.randomUUID(),
                    reply_to_id: null,
                    forward_from_name: String(sourceMessage.forwardFromName || '').trim() || null,
                    forward_from_user_id: Number(sourceMessage.forwardFromUserId) || null,
                }, { requireConnected: true });
                if (!emitted) {
                    throw new Error('Связь с сервером ещё не восстановилась. Повторите пересылку через пару секунд.');
                }
                sentCount += 1;
            }
        }
        return sentCount;
    }

    async function openTargetChatWithForwardDraft(chatId, sourceMessages) {
        const normalizedChatId = String(chatId || '').trim();
        if (!normalizedChatId || !sourceMessages.length) return;
        setForwardComposerDraft(normalizedChatId, sourceMessages);
        closeAnimatedDialog(messageForwardModal);
        if (messageSelectionController.isSelectionMode()) {
            toggleSelectionMode(false);
        }
        await openChatByIdWhenReady(normalizedChatId);
        syncForwardDraftBarForCurrentChat();
        scheduleComposerFocus({ force: true });
    }

    async function handleForwardTargetSelection(chatId) {
        if (forwardModalActionInFlight) return;
        const normalizedChatId = String(chatId || '').trim();
        if (!normalizedChatId) return;
        const sourceMessages = resolveForwardSourceMessages(Array.from(forwardSourceMessageIds));
        if (!sourceMessages.length) {
            showToast('Не удалось подготовить сообщения для пересылки.', 'warning');
            return;
        }
        const contactByChatId = new Map(resolveForwardContactRows().map((row) => [row.chatId, row]));
        const targetRow = contactByChatId.get(normalizedChatId);
        if (!targetRow) {
            showToast('Чат не найден. Обновите список контактов.', 'warning');
            return;
        }

        if (targetRow.isSaved) {
            forwardModalActionInFlight = true;
            updateForwardModalState();
            try {
                const sentCount = await forwardMessagesToTargets(sourceMessages, [targetRow]);
                showToast(`Переслано сообщений: ${sentCount}.`, 'success');
                closeAnimatedDialog(messageForwardModal);
                if (messageSelectionController.isSelectionMode()) {
                    toggleSelectionMode(false);
                }
            } catch (error) {
                showToast(getErrorMessage(error, 'Не удалось переслать сообщения.'), 'danger');
            } finally {
                forwardModalActionInFlight = false;
                updateForwardModalState();
            }
            return;
        }

        await openTargetChatWithForwardDraft(normalizedChatId, sourceMessages);
    }

    messageForwardTargets?.addEventListener('click', (event) => {
        const button = event.target.closest('[data-forward-target-chat-id]');
        if (!(button instanceof HTMLElement)) return;
        const chatId = String(button.getAttribute('data-forward-target-chat-id') || '').trim();
        if (!chatId) return;
        void handleForwardTargetSelection(chatId);
    });

    messageForwardSearchInput?.addEventListener('input', () => {
        renderForwardTargets();
    });

    messageForwardSearchInput?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        const firstTarget = messageForwardTargets?.querySelector('[data-forward-target-chat-id]');
        if (!(firstTarget instanceof HTMLElement)) return;
        const chatId = String(firstTarget.getAttribute('data-forward-target-chat-id') || '').trim();
        if (!chatId) return;
        void handleForwardTargetSelection(chatId);
    });

    messageForwardSubmitBtn?.addEventListener('click', () => {
        const firstTarget = messageForwardTargets?.querySelector('[data-forward-target-chat-id]');
        if (!(firstTarget instanceof HTMLElement)) return;
        const chatId = String(firstTarget.getAttribute('data-forward-target-chat-id') || '').trim();
        if (!chatId) return;
        void handleForwardTargetSelection(chatId);
    });

    messageForwardModal?.addEventListener('close', () => {
        resetForwardModalState();
    });
    cancelForwardDraftBtn?.addEventListener('click', () => {
        clearForwardComposerDraft(currentChatId);
        scheduleComposerFocus({ force: true });
    });
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
        emojiPickerInitPromise = import('./modules/emoji.js?v=20260501b')
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
    const CHAT_DEFAULT_MESSAGE_HEIGHT = 88;
    const CHAT_DECRYPT_CONCURRENCY = 6;
    const CHAT_MEDIA_META_PROBE_CONCURRENCY = 4;
    const CHAT_MEDIA_META_PROBE_TIMEOUT_MS = 1800;
    const CHAT_DECRYPT_WORKER_TIMEOUT_MS = 30000;
    const CHAT_BOTTOM_INERTIA_MIN_MS = 120;
    const CHAT_BOTTOM_INERTIA_MAX_MS = 520;
    const CHAT_BOTTOM_INERTIA_PX_TO_MS = 0.28;
    const CONTACTS_BOOTSTRAP_SYNC_LIMIT = 24;
    const CONTACTS_FULL_SYNC_IDLE_TIMEOUT_MS = 4000;
    const APP_BOOT_OVERLAY_FALLBACK_DELAY_MS = 450;
    const TYPING_EMIT_INTERVAL_MS = 1200;
    const CONTACTS_RELOAD_DEBOUNCE_MS = 180;
    const CHAT_DRAFT_SAVE_DEBOUNCE_MS = 700;
    const PINNED_CHATS_LIMIT = 5;
    const CHAT_DAY_SEPARATOR_HEIGHT = 34;
    const MESSAGE_SCALE_STORAGE_KEY = 'sun_chat_message_scale_v1';
    const MUTE_CHAT_STORAGE_KEY = 'sun_chat_muted_v1';
    const MUTE_DIALOG_REQUESTS_STORAGE_KEY = 'sun_mute_dialog_requests_v1';
    const BASE_TAB_TITLE = document.title || 'sun';
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
    const mediaMetaProbeInFlight = new Map();
    const mediaMetaBySource = new Map();
    const mutePreferences = createChatMutePreferences({
        storage: window.localStorage,
        muteChatStorageKey: MUTE_CHAT_STORAGE_KEY,
        muteDialogRequestsStorageKey: MUTE_DIALOG_REQUESTS_STORAGE_KEY,
        bootstrapMuteDialogRequests: Boolean(bootstrapUser.muteDialogRequests),
    });
    const { ensureMediaElementHydrated, disconnectLazyMediaHydrationObserver, registerMediaElementsForLazyHydration } = createMediaHydrationController({ root: chatMessages });
    function normalizeMediaMetaSourceKey(source) {
        const raw = String(source || '').trim();
        if (!raw) return '';
        if (raw.startsWith('blob:')) return '';
        if (raw.startsWith('data:')) return '';
        try {
            const parsed = new URL(raw, window.location.origin);
            if (parsed.origin === window.location.origin) {
                return `${parsed.pathname}${parsed.search}`;
            }
            return parsed.href;
        } catch (_) {
            return raw;
        }
    }
    function hasVisualPreviewMeta(filePayload) {
        const width = Number(filePayload?.preview_width);
        const height = Number(filePayload?.preview_height);
        const ratio = Number(filePayload?.preview_aspect_ratio);
        if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
            return true;
        }
        return Number.isFinite(ratio) && ratio > 0;
    }
    function resolveVisualMediaKind(filePayload) {
        const mime = String(filePayload?.mime || '').toLowerCase();
        if (mime.startsWith('image/')) return 'image';
        if (mime.startsWith('video/')) return 'video';
        return '';
    }
    function probeVisualMediaMetaBySource(source, kind) {
        const safeSource = String(source || '').trim();
        if (!safeSource || (kind !== 'image' && kind !== 'video')) {
            return Promise.resolve(null);
        }
        const baseKey = normalizeMediaMetaSourceKey(safeSource);
        const cacheKey = baseKey ? `${kind}:${baseKey}` : '';
        if (cacheKey) {
            const cached = mediaMetaBySource.get(cacheKey);
            if (cached) {
                return Promise.resolve(cached);
            }
        }
        if (cacheKey) {
            const inFlight = mediaMetaProbeInFlight.get(cacheKey);
            if (inFlight) {
                return inFlight;
            }
        }
        const probePromise = new Promise((resolve) => {
            let settled = false;
            let timeoutId = 0;
            let videoEl = null;
            let imageEl = null;
            const finish = (meta) => {
                if (settled) return;
                settled = true;
                if (timeoutId) {
                    window.clearTimeout(timeoutId);
                    timeoutId = 0;
                }
                if (videoEl) {
                    try {
                        videoEl.pause();
                        videoEl.removeAttribute('src');
                        videoEl.load();
                    } catch (_) {}
                    videoEl = null;
                }
                imageEl = null;
                if (meta) {
                    if (cacheKey) {
                        mediaMetaBySource.set(cacheKey, meta);
                    }
                }
                resolve(meta || null);
            };
            timeoutId = window.setTimeout(() => finish(null), CHAT_MEDIA_META_PROBE_TIMEOUT_MS);
            if (kind === 'image') {
                imageEl = new Image();
                imageEl.onload = () => {
                    const meta = buildPendingMediaDimensions(imageEl.naturalWidth, imageEl.naturalHeight);
                    finish(meta);
                };
                imageEl.onerror = () => finish(null);
                imageEl.src = safeSource;
                return;
            }
            videoEl = document.createElement('video');
            const tryResolve = () => {
                const meta = buildPendingMediaDimensions(videoEl.videoWidth, videoEl.videoHeight);
                if (meta) finish(meta);
            };
            videoEl.preload = 'metadata';
            videoEl.muted = true;
            videoEl.playsInline = true;
            videoEl.onloadedmetadata = tryResolve;
            videoEl.onloadeddata = tryResolve;
            videoEl.ondurationchange = tryResolve;
            videoEl.onresize = tryResolve;
            videoEl.onerror = () => finish(null);
            videoEl.src = safeSource;
            try {
                videoEl.load();
            } catch (_) {}
        }).finally(() => {
            if (cacheKey) {
                mediaMetaProbeInFlight.delete(cacheKey);
            }
        });
        if (cacheKey) {
            mediaMetaProbeInFlight.set(cacheKey, probePromise);
        }
        return probePromise;
    }
    async function enrichVisualMediaMessageText(messageText) {
        if (typeof messageText !== 'string' || !messageText) return messageText;
        const filePayload = parseSunFilePayload(messageText);
        if (!filePayload) return messageText;
        const mediaKind = resolveVisualMediaKind(filePayload);
        if (!mediaKind || hasVisualPreviewMeta(filePayload)) {
            return messageText;
        }
        const mediaSrc = sanitizeFileUri(filePayload.data, { imageOnlyData: mediaKind === 'image' });
        if (!mediaSrc || mediaSrc === '#') return messageText;
        const meta = await probeVisualMediaMetaBySource(mediaSrc, mediaKind);
        if (!meta) return messageText;
        try {
            return JSON.stringify({ ...filePayload, ...meta });
        } catch (_) {
            return messageText;
        }
    }
    async function enrichDecodedMessagesVisualMeta(messages) {
        const list = Array.isArray(messages) ? messages : [];
        if (!list.length) return [];
        return mapWithConcurrency(list, CHAT_MEDIA_META_PROBE_CONCURRENCY, async (messageState) => {
            const nextMessage = await enrichVisualMediaMessageText(messageState?.message);
            if (nextMessage === messageState?.message) return messageState;
            return {
                ...messageState,
                message: nextMessage,
            };
        });
    }
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
    const { setChatHeaderStatus, syncChatConnectionStatus } = chatConnectionStatusPresenter;

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

    const sidebarStatusController = createSidebarStatusController({
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
        return sidebarStatusController.getSidebarStatusSnapshot();
    }

    function runSidebarStatusAction(action, { silent = false } = {}) {
        sidebarStatusController.runSidebarStatusAction(action, { silent });
    }

    function syncSidebarStatusBar() {
        sidebarStatusController.syncSidebarStatusBar();
    }

    sidebarProfileShortcut?.addEventListener('click', () => {
        window.openSettingsOverlay?.('profile');
    });

    sidebarStatusBar?.addEventListener('click', () => {
        const action = sidebarStatusBar?.dataset.action || getSidebarStatusSnapshot().action;
        runSidebarStatusAction(action);
    });
    sidebarStatusSettingsBtn?.addEventListener('click', () => {
        window.openSettingsOverlay?.('profile');
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

        let totalHeight = 0;
        let count = 0;
        rendered.forEach((node) => {
            const key = node.getAttribute('data-message-key');
            const height = Math.ceil(node.getBoundingClientRect().height);
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
        const range = getDesiredRenderRange(state, effectiveScrollTop);
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
        window.addEventListener('storage', (event) => {
            if (String(event.key || '') !== MESSAGE_SCALE_STORAGE_KEY) return;
            applyMessageScale(event.newValue || 1, { persist: false, rerender: true });
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

    let chatSurfaceEnterRafId = 0;
    let chatSurfaceEnterTimerId = 0;
    let chatHistoryRevealRafId = 0;
    let chatHistoryRevealTimerId = 0;
    let chatAnimateEnterTimerId = 0;
    let desktopMobileRevealTimerId = 0;
    function triggerChatSurfaceEnterAnimation() {
        if (!chatArea) return;
        if (prefersReducedMotionSetting()) return;
        if (isMobileViewport()) {
            chatArea.classList.remove('chat-surface-enter');
            return;
        }
        if (chatSurfaceEnterRafId) {
            cancelAnimationFrame(chatSurfaceEnterRafId);
            chatSurfaceEnterRafId = 0;
        }
        if (chatSurfaceEnterTimerId) {
            window.clearTimeout(chatSurfaceEnterTimerId);
            chatSurfaceEnterTimerId = 0;
        }
        chatArea.classList.remove('chat-surface-enter');
        chatSurfaceEnterRafId = requestAnimationFrame(() => {
            chatSurfaceEnterRafId = 0;
            chatArea.classList.add('chat-surface-enter');
            chatSurfaceEnterTimerId = window.setTimeout(() => {
                chatArea.classList.remove('chat-surface-enter');
                chatSurfaceEnterTimerId = 0;
            }, 460);
        });
    }

    function triggerChatHistoryRevealAnimation() {
        if (!chatArea) return;
        if (prefersReducedMotionSetting()) return;
        if (isMobileViewport()) {
            chatArea.classList.remove('chat-history-reveal', 'is-switching');
            return;
        }
        if (chatHistoryRevealRafId) {
            cancelAnimationFrame(chatHistoryRevealRafId);
            chatHistoryRevealRafId = 0;
        }
        if (chatHistoryRevealTimerId) {
            clearTimeout(chatHistoryRevealTimerId);
            chatHistoryRevealTimerId = 0;
        }
        if (chatMessages) {
            const visibleMessages = chatMessages.querySelectorAll('.message').length;
            applyListPerfGuard(chatMessages, {
                total: visibleMessages,
                dataAttr: 'data-motion-history-guard',
            });
        }
        chatArea.classList.remove('chat-history-reveal');
        chatHistoryRevealRafId = requestAnimationFrame(() => {
            chatHistoryRevealRafId = 0;
            chatArea.classList.remove('is-switching');
            chatArea.classList.add('chat-history-reveal');
            chatHistoryRevealTimerId = window.setTimeout(() => {
                chatArea.classList.remove('chat-history-reveal');
                chatHistoryRevealTimerId = 0;
            }, 640);
        });
    }

    function triggerChatAnimateEnter() {
        if (!chatArea) return;
        if (prefersReducedMotionSetting()) {
            chatArea.classList.remove('chat-animate-enter');
            return;
        }
        if (isMobileViewport()) {
            chatArea.classList.remove('chat-animate-enter');
            return;
        }
        if (chatAnimateEnterTimerId) {
            window.clearTimeout(chatAnimateEnterTimerId);
            chatAnimateEnterTimerId = 0;
        }
        chatArea.classList.remove('chat-animate-enter');
        void chatArea.offsetWidth;
        chatArea.classList.add('chat-animate-enter');
        chatAnimateEnterTimerId = window.setTimeout(() => {
            chatArea.classList.remove('chat-animate-enter');
            chatAnimateEnterTimerId = 0;
        }, 380);
    }

    function triggerDesktopMobileRevealAnimation() {
        if (!chatArea) return;
        if (isMobileViewport()) {
            chatArea.classList.remove('desktop-mobile-revealing');
            chatArea.classList.remove('is-switching');
            chatArea.classList.remove('chat-surface-enter', 'chat-history-reveal', 'chat-animate-enter');
            return;
        }
        if (document.documentElement.classList.contains('perf-lite')) {
            document.documentElement.classList.remove('perf-lite');
            document.documentElement.setAttribute('data-performance-mode', 'full');
            try {
                localStorage.setItem('sun_performance_mode', 'full');
            } catch (_) {}
        }
        const revealRunId = desktopMobileRevealTimerId + 1;
        desktopMobileRevealTimerId = revealRunId;
        const desktopRevealShiftPx = Math.min(Math.max(0, chatArea.clientWidth || 0), 420);
        chatArea.style.setProperty('--desktop-mobile-reveal-shift', `${desktopRevealShiftPx}px`);
        chatArea.classList.remove('desktop-mobile-revealing');
        chatArea.classList.remove('is-switching');
        chatArea.classList.remove('chat-surface-enter', 'chat-history-reveal', 'chat-animate-enter');
        void chatArea.offsetWidth;
        chatArea.classList.add('desktop-mobile-revealing');
        const revealAnimationDuration = Number.parseFloat(
            (window.getComputedStyle(chatArea).animationDuration || '0').split(',')[0]
        );
        if (!Number.isFinite(revealAnimationDuration) || revealAnimationDuration <= 0) {
            chatArea.classList.remove('desktop-mobile-revealing');
            return;
        }
        const onDesktopMobileRevealEnd = (event) => {
            if (event.target !== chatArea) return;
            if (event.animationName !== 'desktopMobileChatRevealIn') return;
            chatArea.removeEventListener('animationend', onDesktopMobileRevealEnd);
            if (revealRunId !== desktopMobileRevealTimerId) return;
            chatArea.classList.remove('desktop-mobile-revealing');
        };
        chatArea.addEventListener('animationend', onDesktopMobileRevealEnd);
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

    function normalizeDraftText(value) {
        return String(value ?? '').replace(/\r\n/g, '\n');
    }

    function toDraftTimestampMs(value) {
        const raw = String(value || '').trim();
        if (!raw) return 0;
        const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
        const parsed = Date.parse(normalized);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function shouldApplyDraftUpdate(chatId, updatedAt, incomingDraftText = '') {
        const normalizedChatId = String(chatId || '').trim();
        if (!normalizedChatId) return false;
        const nextMs = toDraftTimestampMs(updatedAt);
        if (!nextMs) return true;
        const prevMs = Number(lastDraftUpdatedAtByChatId.get(normalizedChatId) || 0);
        if (nextMs > prevMs) return true;
        if (nextMs < prevMs) return false;

        // CURRENT_TIMESTAMP from backend is second-precision; if two updates share
        // the same timestamp, only treat exact text duplicates as safe/idempotent.
        const previousSavedDraftText = normalizeDraftText(lastSavedDraftByChatId.get(normalizedChatId) || '');
        const nextDraftText = normalizeDraftText(incomingDraftText || '');
        return nextDraftText === previousSavedDraftText;
    }

    function hasMeaningfulDraft(value) {
        return Boolean(normalizeDraftText(value).trim());
    }

    function applyComposerDraftText(value) {
        if (!messageInput) return;
        const normalized = normalizeDraftText(value);
        if (messageInput.value === normalized) return;
        messageInput.value = normalized;
        linkDraftBarController?.syncFromInput?.({ force: true });
        resizeComposerInput();
        updateVoiceRecordButtonState();
    }

    function syncDraftPreviewForContact(chatId, draftText, updatedAt = '', options = {}) {
        const normalizedChatId = String(chatId || '').trim();
        if (!normalizedChatId) return;

        const showWhileActive = options?.showWhileActive === true;
        if (!showWhileActive && normalizedChatId === String(currentChatId || '')) {
            return;
        }

        const contactItem = resolveContactItemByChatId(normalizedChatId);
        if (!contactItem) return;

        const normalizedDraft = normalizeDraftText(draftText);
        const hasDraft = hasMeaningfulDraft(normalizedDraft);
        if (hasDraft) {
            _updateActiveContactLastMessage(
                contactItem,
                normalizedDraft,
                false,
                { pending: false, is_read: false, is_delivered: false },
                updatedAt || new Date().toISOString(),
                {
                    isDraft: true,
                    draftText: normalizedDraft,
                },
            );
        } else if (contactItem.getAttribute('data-has-draft') === '1') {
            const rawMessage = String(contactItem.getAttribute('data-raw-last-message') || '');
            const rawTimestamp = String(
                contactItem.getAttribute('data-raw-last-message-time')
                || contactItem.getAttribute('data-last-message-time')
                || '',
            ).trim();
            const lastSenderId = String(contactItem.getAttribute('data-last-sender-id') || '').trim();
            const isSelf = Boolean(lastSenderId) && lastSenderId === String(CURRENT_USER_ID);
            const isRead = contactItem.getAttribute('data-last-message-is-read') === '1';
            const isDelivered = contactItem.getAttribute('data-last-message-is-delivered') === '1';
            _updateActiveContactLastMessage(
                contactItem,
                rawMessage,
                isSelf,
                { is_read: isRead, is_delivered: isDelivered },
                rawTimestamp || null,
                { isDraft: false },
            );
        }

        sortContactsList();
    }

    async function saveDraftForChat(chatId, draftText, { force = false } = {}) {
        const normalizedChatId = String(chatId || '').trim();
        if (!normalizedChatId) return null;

        const normalizedDraft = normalizeDraftText(draftText);
        const nextSavedText = hasMeaningfulDraft(normalizedDraft) ? normalizedDraft : '';
        if (!force && lastSavedDraftByChatId.get(normalizedChatId) === nextSavedText) {
            return null;
        }

        try {
            const response = await fetch(withAppRoot('/save_chat_draft'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken(),
                },
                body: JSON.stringify({
                    chat_id: normalizedChatId,
                    draft_text: normalizedDraft,
                }),
            });
            const payload = await response.json();
            if (!response.ok || !payload?.success) return null;

            const savedText = payload.has_draft ? normalizeDraftText(payload.draft_text || '') : '';
            const savedUpdatedAt = String(payload.updated_at || '').trim();
            lastSavedDraftByChatId.set(normalizedChatId, savedText);
            if (savedUpdatedAt) {
                lastDraftUpdatedAtByChatId.set(normalizedChatId, toDraftTimestampMs(savedUpdatedAt));
            }
            syncDraftPreviewForContact(normalizedChatId, savedText, savedUpdatedAt, { showWhileActive: true });
            return payload;
        } catch (_) {
            return null;
        }
    }

    function scheduleCurrentChatDraftSave({ immediate = false, force = false } = {}) {
        if (!currentChatId || !messageInput || isEditingMessageId || isChatBlocked()) return;

        if (immediate) {
            if (chatDraftSaveTimer) {
                clearTimeout(chatDraftSaveTimer);
                chatDraftSaveTimer = 0;
            }
            chatDraftSaveTargetChatId = '';
            chatDraftSaveQueuedText = '';
            void saveDraftForChat(currentChatId, messageInput.value, { force });
            return;
        }

        chatDraftSaveTargetChatId = String(currentChatId);
        chatDraftSaveQueuedText = String(messageInput.value || '');
        if (chatDraftSaveTimer) {
            clearTimeout(chatDraftSaveTimer);
        }
        chatDraftSaveTimer = window.setTimeout(() => {
            const targetChatId = chatDraftSaveTargetChatId;
            const queuedText = chatDraftSaveQueuedText;
            chatDraftSaveTimer = 0;
            chatDraftSaveTargetChatId = '';
            chatDraftSaveQueuedText = '';
            if (!targetChatId) return;
            void saveDraftForChat(targetChatId, queuedText, { force });
        }, CHAT_DRAFT_SAVE_DEBOUNCE_MS);
    }

    function flushDraftSaveForChat(chatId, draftText, { force = false } = {}) {
        if (chatDraftSaveTimer) {
            clearTimeout(chatDraftSaveTimer);
            chatDraftSaveTimer = 0;
        }
        chatDraftSaveTargetChatId = '';
        chatDraftSaveQueuedText = '';
        return saveDraftForChat(chatId, draftText, { force });
    }

    function prefillComposerDraftFromContactItem(contactItem) {
        if (!contactItem) return;
        const hasDraft = contactItem.getAttribute('data-has-draft') === '1';
        const draftText = String(contactItem.getAttribute('data-draft-text') || '');
        applyComposerDraftText(hasDraft ? draftText : '');
    }

    async function loadDraftForChat(chatId, { fallbackContactItem = null } = {}) {
        const normalizedChatId = String(chatId || '').trim();
        if (!normalizedChatId || String(normalizedChatId) !== String(currentChatId)) return;

        const requestId = ++activeDraftLoadRequestId;
        const beforeRequestValue = String(messageInput?.value || '');
        try {
            const response = await fetch(
                withAppRoot(`/get_chat_draft?chat_id=${encodeURIComponent(normalizedChatId)}`),
            );
            const payload = await response.json();
            if (!response.ok || !payload?.success) return;
            if (requestId !== activeDraftLoadRequestId) return;
            if (String(currentChatId) !== normalizedChatId) return;
            const currentValue = String(messageInput?.value || '');
            if (currentValue !== beforeRequestValue && document.activeElement === messageInput) {
                return;
            }

            const draftText = payload.has_draft ? normalizeDraftText(payload.draft_text || '') : '';
            const draftUpdatedAt = String(payload.updated_at || '');
            lastSavedDraftByChatId.set(normalizedChatId, draftText);
            if (draftUpdatedAt) {
                lastDraftUpdatedAtByChatId.set(normalizedChatId, toDraftTimestampMs(draftUpdatedAt));
            }
            syncDraftPreviewForContact(normalizedChatId, draftText, draftUpdatedAt);
            applyComposerDraftText(draftText);
        } catch (_) {
            if (requestId !== activeDraftLoadRequestId) return;
            if (String(currentChatId) !== normalizedChatId) return;
            prefillComposerDraftFromContactItem(fallbackContactItem || resolveContactItemByChatId(normalizedChatId));
        }
    }

    function handleRealtimeChatDraftUpdated(payload) {
        const chatId = String(payload?.chat_id || '').trim();
        if (!chatId) return;

        const updatedAt = String(payload?.updated_at || '').trim();
        if (!shouldApplyDraftUpdate(chatId, updatedAt, payload?.has_draft ? payload?.draft_text || '' : '')) return;

        const previousSavedDraftText = String(lastSavedDraftByChatId.get(chatId) || '');
        const normalizedDraftText = payload?.has_draft
            ? normalizeDraftText(payload?.draft_text || '')
            : '';
        lastSavedDraftByChatId.set(chatId, normalizedDraftText);
        if (updatedAt) {
            lastDraftUpdatedAtByChatId.set(chatId, toDraftTimestampMs(updatedAt));
        }
        syncDraftPreviewForContact(chatId, normalizedDraftText, updatedAt);

        if (String(chatId) !== String(currentChatId)) return;

        const isComposerFocused = document.activeElement === messageInput;
        const currentValue = normalizeDraftText(messageInput?.value || '');
        const hasUnsavedLocalChanges = currentValue !== previousSavedDraftText;
        if (isComposerFocused && hasUnsavedLocalChanges) return;
        applyComposerDraftText(normalizedDraftText);
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
        closeChatUI,
        loadContacts,
        scheduleComposerFocus,
        copyTextToClipboard,
        showToast,
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
            const groupChatId = String(currentChatId || '').trim();
            if (groupChatId && isCurrentChatGroup()) {
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
            return response.json();
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

    function closePartnerProfileDrawer() {
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
    let currentGroupProfile = null;
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
                } else if (myRole === 'owner' && ['member', 'moderator'].includes(role)) {
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
                <div class="profile-group-member">
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
        const profileUsernameLine = document.getElementById('profileUsernameLine');
        const profileBioLine = document.getElementById('profileBioLine');
        const profileMetaBio = document.getElementById('profileMetaBio');
        const profileBioLabel = profileBioLine?.querySelector('.profile-info-label') || null;
        const copyUsernameMenuItem = profileMoreMenu?.querySelector('[data-profile-action="copy-username"]');
        const reportUserMenuItem = profileMoreMenu?.querySelector('[data-profile-action="report-user"]');
        const messageMenuItem = profileMoreMenu?.querySelector('[data-profile-action="message"]');

        partnerProfileDrawer?.classList.toggle('is-group-profile', isGroupProfile);
        syncGroupDangerActionLabel(profile);
        profileGroupEditBtn?.classList.toggle('profile-group-edit-btn--hidden', !(isGroupProfile && canOpenGroupManagePanel));
        profileGroupSection?.classList.toggle('profile-group-section--hidden', !isGroupProfile);
        if (profileUsernameLine) profileUsernameLine.style.display = isGroupProfile ? 'none' : '';
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
                const isSwitchingChat = String(previousChatId || '') !== String(currentChatId || '');
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
                            partnerAvatar.innerHTML = `<img src="${escapeHtml(img.getAttribute('src'))}" alt="\u0410\u0432\u0430\u0442\u0430\u0440 \u0441\u043E\u0431\u0435\u0441\u0435\u0434\u043D\u0438\u043A\u0430" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
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
                const isGroupChat = String(contactItem.getAttribute('data-is-group') || '') === '1';
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
            if (!currentChatId) return;
            const isGroup = isCurrentChatGroup();
            showDeleteChatDialog(currentChatId, { onDeleted: closeChatUI, onReload: loadContacts, isGroup });
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
        onDeleteChat: closeChatUI,
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
            closeMobileChatView({ leaveRoom: false, animated: false });
        }
    }

    // \u0418\u0441\u043F\u0440\u0430\u0432\u043B\u044F\u0435\u043C \u043E\u0442\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0439 \u0438 \u043F\u0430\u043D\u0435\u043B\u0438 \u043D\u0430 \u043C\u043E\u0431\u0438\u043B\u044C\u043D\u043E\u0439 \u0432\u0435\u0440\u0441\u0438\u0438
    let typingTimeout = null;
    let lastTypingEmitAt = 0;
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
            emitSocket('typing', { chat_id: currentChatId, typing_kind: 'voice' });
            lastTypingEmitAt = Date.now();
            return;
        }
        emitSocket('stop_typing', { chat_id: currentChatId, typing_kind: 'voice' });
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

    function patchMessageReactions(messageEl, reactions, { animate = false } = {}) {
        if (!messageEl) return;
        const msgId = Number(messageEl.getAttribute('data-msg-id'));
        if (!Number.isFinite(msgId) || msgId <= 0) return;
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

        if (currentRow) {
            currentRow.outerHTML = nextMarkup;
        } else {
            targetContainer.insertAdjacentHTML('beforeend', nextMarkup);
        }

        const updatedRow = Array.from(targetContainer.children).find((child) => child?.classList?.contains('message-reactions')) || null;
        if (updatedRow && animate) {
            updatedRow.classList.add('is-updated');
            window.setTimeout(() => updatedRow.classList.remove('is-updated'), 220);
        }
        if (updatedRow) applyEmojiGraphics(updatedRow);
        syncMessageBubbleLayoutClasses(messageEl);
        refreshMessageHeightCache(messageEl, { keepBottomPinned: shouldPinToBottom });
    }

    function buildMessageAvatarHtml(msg) {
        return _buildMessageAvatarHtml(msg, { currentDisplayName, currentUsername, currentAvatarUrl });
    }

    function MessageGroup(messages, index) {
        return _getMessageGroup(messages, index);
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

            if (isAtTail && rangeCoversTail && !alreadyRendered && !tailGroupWouldChange) {
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
        const msgEl = chatMessages.querySelector(`.message.self[data-client-id="${escapedClientId}"]`);
        if (!msgEl) return false;

        const numericMessageId = Number(messageId);
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

    function applyMessageReactionsLocally(chatId, messageId, rawReactions, { animate = true, touchStamp = false } = {}) {
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
            patchMessageReactions(messageEl, rawReactions, { animate });
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

    function clearPendingReactionOp(requestId, { rollback = false } = {}) {
        const token = String(requestId || '').trim();
        if (!token) return;

        const operation = pendingReactionOpsById.get(token);
        if (!operation) return;

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
    }

    function clearPendingReactionOpByMessage(chatId, messageId, { rollback = false } = {}) {
        const key = getReactionMessageKey(chatId, messageId);
        const requestId = pendingReactionOpByMessage.get(key);
        if (requestId) {
            clearPendingReactionOp(requestId, { rollback });
        }
    }

    function registerPendingReactionOp(chatId, messageId, previousReactions, requestId) {
        const token = String(requestId || '').trim();
        if (!token) return;

        const numericMessageId = Number(messageId);
        if (!Number.isFinite(numericMessageId) || numericMessageId <= 0) return;

        const key = getReactionMessageKey(chatId, numericMessageId);
        const existing = pendingReactionOpByMessage.get(key);
        if (existing) {
            clearPendingReactionOp(existing);
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
        const changed = applyMessageReactionsLocally(currentChatId, normalizedMsgId, nextReactions, { animate: true });
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

    function renderMessageTextContent(targetEl, content) {
        if (!targetEl) return;
        const rawText = String(content ?? '');
        const urlRegex = /((https?:\/\/|www\.)[^\s<]+)/gi;
        const fragment = document.createDocumentFragment();
        let cursor = 0;
        let match;

        while ((match = urlRegex.exec(rawText)) !== null) {
            const index = match.index;
            const rawUrl = match[0];
            if (index > cursor) {
                fragment.appendChild(document.createTextNode(rawText.slice(cursor, index)));
            }
            const href = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
            if (/^https?:\/\//i.test(href)) {
                const anchor = document.createElement('a');
                anchor.href = href;
                anchor.target = '_blank';
                anchor.rel = 'noopener noreferrer';
                anchor.textContent = rawUrl;
                fragment.appendChild(anchor);
            } else {
                fragment.appendChild(document.createTextNode(rawUrl));
            }
            cursor = index + rawUrl.length;
        }

        if (cursor < rawText.length) {
            fragment.appendChild(document.createTextNode(rawText.slice(cursor)));
        }

        targetEl.replaceChildren(fragment);
    }

    function resetComposer() {
        messageInput.value = '';
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
            isChatBlocked,
            getBlockedNoticeText: getChatBlockNoticeText,
            currentBlockState,
            showToast,
            setSendingState,
            encryptForCurrentChat: encryptForSourceChat,
            getReplyState,
            cancelReply,
            emitSocket,
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
                    linkDraftBarController?.syncFromInput?.({ force: true });
                }
                // Keep local draft state in sync after send, so stale realtime draft
                // events cannot repopulate the composer with already-sent text.
                lastSavedDraftByChatId.set(sourceChatId, '');
                lastDraftUpdatedAtByChatId.set(sourceChatId, Date.now());
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

    window._onPreviewThumbError = function(imgEl) {
        const thumb = imgEl?.closest('.msg-preview-thumb');
        if (!thumb || thumb.classList.contains('is-fallback')) return;
        thumb.classList.add('is-fallback');
        thumb.innerHTML = '<i class="bi bi-image msg-preview-fallback-icon"></i>' + (thumb.querySelector('.msg-preview-thumb-count')?.outerHTML || '');
    };

    document.addEventListener('error', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLImageElement)) return;
        if (!target.closest('.msg-preview-thumb')) return;
        window._onPreviewThumbError?.(target);
    }, true);

    window._onVideoPreviewLoaded = function(videoEl) {
        if (!videoEl) return;
        const preview = videoEl.closest('.video-preview');
        const durationEl = preview?.querySelector('.video-preview-duration');
        if (durationEl) {
            durationEl.textContent = formatMediaDuration(videoEl.duration);
        }
        const videoWidth = Number(videoEl.videoWidth);
        const videoHeight = Number(videoEl.videoHeight);
        if (preview && Number.isFinite(videoWidth) && videoWidth > 0 && Number.isFinite(videoHeight) && videoHeight > 0) {
            const ratio = String(Math.max(0.56, Math.min(1.91, videoWidth / videoHeight)));
            preview.style.setProperty('--media-aspect-ratio', ratio);
            preview.closest('.bubble')?.style.setProperty('--media-aspect-ratio', ratio);
            persistPendingMediaDimensions(videoEl.closest('.message'), videoWidth, videoHeight);
        }
        videoEl.currentTime = 0;
        videoEl.pause();
    };

    function formatAudioPlayerTime(totalSeconds) {
        const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : 0;
        const mins = Math.floor(safe / 60);
        const secs = Math.floor(safe % 60);
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    function resolveAudioMessageElement(sourceEl) {
        if (!sourceEl) return null;
        return sourceEl.closest('.message');
    }

    function resolveAudioMessageId(sourceEl) {
        const messageEl = resolveAudioMessageElement(sourceEl);
        if (!messageEl) return null;
        const raw = Number(messageEl.getAttribute('data-msg-id'));
        return Number.isFinite(raw) && raw > 0 ? raw : null;
    }

    function initAudioMessageListenState(sourceEl) {
        const messageEl = resolveAudioMessageElement(sourceEl);
        if (!messageEl) return;
        if (!messageEl.classList.contains('self')) return;
        const current = messageEl.getAttribute('data-audio-listened-by-partner');
        if (current !== '0' && current !== '1') {
            messageEl.setAttribute('data-audio-listened-by-partner', '0');
        }
    }

    function shouldReportVoiceListened(sourceEl) {
        const messageEl = resolveAudioMessageElement(sourceEl);
        if (!messageEl) return false;
        if (messageEl.classList.contains('self')) return false;
        if (messageEl.getAttribute('data-audio-listen-sent') === '1') return false;
        return true;
    }

    function reportVoiceListened(sourceEl) {
        if (!shouldReportVoiceListened(sourceEl)) return;
        const messageEl = resolveAudioMessageElement(sourceEl);
        if (!messageEl) return;
        const chatId = currentChatId || messageEl.getAttribute('data-chat-id') || '';
        const msgId = resolveAudioMessageId(sourceEl);
        if (!chatId || !Number.isFinite(msgId)) return;
        const sent = emitSocket(
            'voice_message_listened',
            {
                chat_id: chatId,
                msg_id: Number(msgId),
            },
            { requireConnected: true },
        );
        if (sent) {
            messageEl.setAttribute('data-audio-listen-sent', '1');
        }
    }

    const audioUiFrameByElement = new WeakMap();
    const audioUiPlaybackLoopByElement = new WeakMap();
    const audioWaveformCacheBySource = new Map();
    const audioWaveformJobByPlayer = new WeakMap();
    const AUDIO_PLAYBACK_RATES = Object.freeze([1, 1.5, 2]);
    const AUDIO_PLAYBACK_RATE_STORAGE_KEY = 'sun_audio_playback_rate';
    const AUDIO_VOLUME_STORAGE_KEY = 'sun_audio_volume';
    const AUDIO_WAVEFORM_BARS_COUNT = 48;
    let activeVoicePlaybackAudioEl = null;

    function normalizeAudioPlaybackRate(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric <= 0) return AUDIO_PLAYBACK_RATES[0];
        let nearest = AUDIO_PLAYBACK_RATES[0];
        let bestDistance = Math.abs(AUDIO_PLAYBACK_RATES[0] - numeric);
        for (let i = 1; i < AUDIO_PLAYBACK_RATES.length; i += 1) {
            const distance = Math.abs(AUDIO_PLAYBACK_RATES[i] - numeric);
            if (distance < bestDistance) {
                nearest = AUDIO_PLAYBACK_RATES[i];
                bestDistance = distance;
            }
        }
        return nearest;
    }

    function formatAudioPlaybackRateLabel(value) {
        const normalized = normalizeAudioPlaybackRate(value);
        return Number.isInteger(normalized) ? `${normalized}x` : `${normalized.toFixed(1)}x`;
    }

    function getPreferredAudioPlaybackRate() {
        try {
            return normalizeAudioPlaybackRate(window.localStorage?.getItem(AUDIO_PLAYBACK_RATE_STORAGE_KEY));
        } catch (_) {
            return AUDIO_PLAYBACK_RATES[0];
        }
    }

    function setPreferredAudioPlaybackRate(value) {
        const normalized = normalizeAudioPlaybackRate(value);
        try {
            window.localStorage?.setItem(AUDIO_PLAYBACK_RATE_STORAGE_KEY, String(normalized));
        } catch (_) {}
        return normalized;
    }

    function normalizeAudioVolume(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return 1;
        return Math.max(0, Math.min(1, numeric));
    }

    function getPreferredAudioVolume() {
        try {
            return normalizeAudioVolume(window.localStorage?.getItem(AUDIO_VOLUME_STORAGE_KEY));
        } catch (_) {
            return 1;
        }
    }

    function setPreferredAudioVolume(value) {
        const normalized = normalizeAudioVolume(value);
        try {
            window.localStorage?.setItem(AUDIO_VOLUME_STORAGE_KEY, String(normalized));
        } catch (_) {}
        return normalized;
    }

    function resolveVoicePlaybackTimeLabel(audioEl) {
        const messageEl = resolveAudioMessageElement(audioEl);
        const timeEl = messageEl?.querySelector('.msg-time');
        const title = String(timeEl?.getAttribute('title') || '').trim();
        const raw = String(timeEl?.textContent || '').trim();
        return title || raw || '—';
    }

    function resolveVoicePlaybackSenderLabel(audioEl) {
        const messageEl = resolveAudioMessageElement(audioEl);
        if (!messageEl) return '—';
        const senderLabel = String(messageEl.querySelector('.message-sender-label')?.textContent || '').trim();
        if (senderLabel) return senderLabel;
        if (messageEl.classList.contains('self')) return 'Вы';
        const partner = String(chatTitle?.textContent || '').trim();
        return partner || 'Собеседник';
    }

    function resolveActiveVoicePlaybackAudio() {
        if (!activeVoicePlaybackAudioEl) return null;
        if (!activeVoicePlaybackAudioEl.isConnected) {
            activeVoicePlaybackAudioEl = null;
            return null;
        }
        return activeVoicePlaybackAudioEl;
    }

    function setVoicePlaybackBarVisible(isVisible) {
        if (!voicePlaybackBar) return;
        const currentlyVisible = !voicePlaybackBar.classList.contains('voice-playback-bar--hidden');
        if (currentlyVisible === isVisible) return;
        if (chatArea) {
            const nextOffset = isVisible ? Math.ceil(voicePlaybackBar.offsetHeight || 0) : 0;
            chatArea.style.setProperty('--voice-playback-offset', `${nextOffset}px`);
            chatArea.classList.toggle('chat-area--voice-playback-active', isVisible && nextOffset > 0);
        }
        voicePlaybackBar.classList.toggle('voice-playback-bar--hidden', !isVisible);
        voicePlaybackBar.setAttribute('aria-hidden', isVisible ? 'false' : 'true');
    }

    function clearActiveVoicePlaybackAudio(options = {}) {
        const { pause = false } = options;
        const audio = resolveActiveVoicePlaybackAudio();
        if (audio && pause && !audio.paused) {
            audio.dataset.playRequested = '0';
            try { audio.pause(); } catch (_) {}
            stopAudioPlayerUiLoop(audio);
            scheduleAudioPlayerUiSync(audio);
        }
        activeVoicePlaybackAudioEl = null;
        setVoicePlaybackBarVisible(false);
    }

    function applyPreferredVolumeToAudio(audioEl) {
        if (!audioEl) return;
        const preferredVolume = getPreferredAudioVolume();
        if (Math.abs((audioEl.volume ?? 1) - preferredVolume) > 0.001) {
            audioEl.volume = preferredVolume;
        }
    }

    function setActiveVoicePlaybackAudio(audioEl) {
        if (!audioEl || !audioEl.isConnected) return;
        activeVoicePlaybackAudioEl = audioEl;
        applyPreferredVolumeToAudio(audioEl);
        setVoicePlaybackBarVisible(true);
    }

    function syncVoicePlaybackBar(audioEl = null) {
        if (!voicePlaybackBar || !voicePlaybackProgress || !voicePlaybackPlayBtn || !voicePlaybackDetails || !voicePlaybackSender || !voicePlaybackSpeedBtn || !voicePlaybackVolume) return;
        const activeAudio = audioEl || resolveActiveVoicePlaybackAudio();
        if (!activeAudio) {
            clearActiveVoicePlaybackAudio();
            return;
        }
        if (!activeAudio.isConnected) {
            clearActiveVoicePlaybackAudio();
            return;
        }
        if (activeAudio.ended) {
            clearActiveVoicePlaybackAudio();
            return;
        }
        setVoicePlaybackBarVisible(true);
        const { durationLabel } = resolveAudioPlayerElements(activeAudio);
        const knownDuration = resolveKnownAudioDuration(activeAudio, durationLabel);
        const current = Number.isFinite(activeAudio.currentTime) ? Math.max(0, activeAudio.currentTime) : 0;
        const percent = knownDuration > 0
            ? clampAudioSeekPercent((current / knownDuration) * 100)
            : 0;
        const roundedPercent = Math.round(percent * 10) / 10;
        if (voicePlaybackProgress.dataset.seeking !== '1') {
            voicePlaybackProgress.value = String(roundedPercent);
        }
        voicePlaybackProgress.setAttribute('aria-valuenow', String(Math.round(roundedPercent)));
        voicePlaybackProgressFill?.style.setProperty('--voice-playback-progress', String(roundedPercent));
        const currentLabel = formatAudioPlayerTime(Math.floor(current));
        const durationLabelText = formatAudioPlayerTime(Math.floor(knownDuration));
        const timeLabel = resolveVoicePlaybackTimeLabel(activeAudio);
        voicePlaybackDetails.textContent = `${currentLabel} / ${durationLabelText} • ${timeLabel}`;
        voicePlaybackSender.textContent = resolveVoicePlaybackSenderLabel(activeAudio);
        const isPlaying = !activeAudio.paused && !activeAudio.ended;
        const playIconUse = voicePlaybackPlayBtn.querySelector('use');
        if (playIconUse) {
            playIconUse.setAttribute('href', isPlaying ? '#sun-i-pause' : '#sun-i-play');
        }
        voicePlaybackPlayBtn.setAttribute('aria-label', isPlaying ? 'Пауза' : 'Воспроизвести');
        voicePlaybackPlayBtn.setAttribute('title', isPlaying ? 'Пауза' : 'Воспроизвести');
        const preferredRate = getPreferredAudioPlaybackRate();
        voicePlaybackSpeedBtn.textContent = formatAudioPlaybackRateLabel(preferredRate);
        voicePlaybackSpeedBtn.setAttribute('aria-label', `Скорость ${formatAudioPlaybackRateLabel(preferredRate)}. Изменить`);
        if (voicePlaybackVolume.dataset.seeking !== '1') {
            voicePlaybackVolume.value = String(Math.round((activeAudio.volume ?? 1) * 100));
        }
    }

    function buildAudioWaveBarsHtml(values) {
        return values
            .map((height, index) => `<span class="audio-wave-bar" style="--wave-h:${height}" data-wave-index="${index}"></span>`)
            .join('');
    }

    function computeAudioWaveformHeights(buffer, barsCount = AUDIO_WAVEFORM_BARS_COUNT) {
        if (!buffer || typeof buffer.getChannelData !== 'function') return null;
        const channelData = buffer.getChannelData(0);
        if (!channelData || channelData.length <= 0) return null;
        const safeBarsCount = Math.max(16, Math.floor(barsCount || AUDIO_WAVEFORM_BARS_COUNT));
        const samplesPerBar = channelData.length / safeBarsCount;
        const raw = new Array(safeBarsCount).fill(0);
        let globalPeak = 0;

        for (let barIndex = 0; barIndex < safeBarsCount; barIndex += 1) {
            const start = Math.floor(barIndex * samplesPerBar);
            const end = Math.min(channelData.length, Math.floor((barIndex + 1) * samplesPerBar));
            const span = Math.max(0, end - start);
            const stride = Math.max(1, Math.floor(span / 240));
            let peak = 0;
            for (let i = start; i < end; i += stride) {
                const abs = Math.abs(channelData[i] || 0);
                if (abs > peak) peak = abs;
            }
            raw[barIndex] = peak;
            if (peak > globalPeak) globalPeak = peak;
        }

        if (!(globalPeak > 0.000001)) return null;
        return raw.map((value) => Math.max(8, Math.min(100, Math.round((value / globalPeak) * 100))));
    }

    function isWaveformPayloadInformative(values) {
        const normalized = Array.isArray(values)
            ? values.map((value) => Number(value)).filter((value) => Number.isFinite(value))
            : [];
        if (normalized.length < 8) return false;
        let min = normalized[0];
        let max = normalized[0];
        const unique = new Set();
        for (let i = 0; i < normalized.length; i += 1) {
            const value = Math.round(normalized[i]);
            unique.add(value);
            if (value < min) min = value;
            if (value > max) max = value;
        }
        return unique.size >= 10 && (max - min) >= 18;
    }

    function hasProvidedWaveformPayload(rawWaveform) {
        if (Array.isArray(rawWaveform)) {
            return isWaveformPayloadInformative(rawWaveform);
        }
        if (typeof rawWaveform === 'string') {
            if (!rawWaveform.includes(',')) return false;
            const parsed = rawWaveform.split(',').map((part) => Number(part.trim()));
            return isWaveformPayloadInformative(parsed);
        }
        return false;
    }

    async function decodeAudioWaveformBySource(sourceUrl, barsCount = AUDIO_WAVEFORM_BARS_COUNT) {
        const src = String(sourceUrl || '').trim();
        if (!src) return null;
        const cacheKey = `${src}::${Math.max(16, Math.floor(barsCount || AUDIO_WAVEFORM_BARS_COUNT))}`;
        if (audioWaveformCacheBySource.has(cacheKey)) {
            return audioWaveformCacheBySource.get(cacheKey);
        }
        const waveformPromise = (async () => {
            const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextCtor) return null;
            let audioCtx = null;
            try {
                const fetchOptions = src.startsWith('data:')
                    ? undefined
                    : { credentials: 'include' };
                const response = await fetch(src, fetchOptions);
                if (!response.ok) return null;
                const buffer = await response.arrayBuffer();
                audioCtx = new AudioContextCtor();
                const decoded = await audioCtx.decodeAudioData(buffer.slice(0));
                return computeAudioWaveformHeights(decoded, barsCount);
            } catch (_) {
                return null;
            } finally {
                if (audioCtx && typeof audioCtx.close === 'function') {
                    try { await audioCtx.close(); } catch (_) {}
                }
            }
        })();
        audioWaveformCacheBySource.set(cacheKey, waveformPromise);
        return waveformPromise;
    }

    function applyWaveformBarsToPlayerWave(waveEl, heights) {
        if (!waveEl || !Array.isArray(heights) || heights.length < 8) return;
        const baseLayer = waveEl.querySelector('.audio-wave-layer--base');
        const playedLayer = waveEl.querySelector('.audio-wave-layer--played');
        if (!baseLayer || !playedLayer) return;
        const html = buildAudioWaveBarsHtml(heights);
        baseLayer.innerHTML = html;
        playedLayer.innerHTML = html;
    }

    function resolveAudioPlayerElements(sourceEl) {
        if (!sourceEl) return {};
        const player = sourceEl.closest('.file-msg-audio-player');
        const bubble = player?.closest('.bubble');
        const audio = sourceEl.classList?.contains('file-msg-audio-el')
            ? sourceEl
            : player?.querySelector('.file-msg-audio-el');
        const toggle = player?.querySelector('.audio-player-toggle');
        const icon = toggle?.querySelector('i');
        const speedButton = player?.querySelector('.audio-player-speed');
        const progress = player?.querySelector('.audio-player-progress');
        const wave = player?.querySelector('.audio-player-wave');
        const durationLabel = bubble?.querySelector('.audio-message-duration');
        return { player, audio, toggle, icon, speedButton, progress, wave, durationLabel };
    }

    async function ensureGeneratedAudioWaveform(audioEl) {
        const { player, audio, wave } = resolveAudioPlayerElements(audioEl);
        if (!player || !audio || !wave) return;
        const waveformSource = String(player.dataset.waveformSource || '').trim();
        if (waveformSource !== 'fallback') return;

        const sourceUrl = String(audio.getAttribute('src') || '').trim();
        if (!sourceUrl) return;
        if (player.dataset.waveformGeneratedSrc === sourceUrl) return;

        const existingBars = wave.querySelectorAll('.audio-wave-layer--base .audio-wave-bar').length;
        const barsCount = Math.max(16, existingBars || AUDIO_WAVEFORM_BARS_COUNT);
        const activeJob = audioWaveformJobByPlayer.get(player);
        if (activeJob && activeJob.src === sourceUrl) return;

        const jobPromise = (async () => {
            const heights = await decodeAudioWaveformBySource(sourceUrl, barsCount);
            if (!heights || !player.isConnected) return;
            const currentAudioSrc = String(audio.getAttribute('src') || audio.dataset.src || '').trim();
            if (currentAudioSrc !== sourceUrl) return;
            applyWaveformBarsToPlayerWave(wave, heights);
            player.dataset.waveformSource = 'generated';
            player.dataset.waveformGeneratedSrc = sourceUrl;
        })();

        audioWaveformJobByPlayer.set(player, { src: sourceUrl, promise: jobPromise });
        try {
            await jobPromise;
        } finally {
            const stillActive = audioWaveformJobByPlayer.get(player);
            if (stillActive?.promise === jobPromise) {
                audioWaveformJobByPlayer.delete(player);
            }
        }
    }

    function resolveKnownAudioDuration(audio, durationLabel) {
        const duration = Number.isFinite(audio?.duration) && audio.duration > 0 ? audio.duration : 0;
        if (duration > 0) return duration;
        const fallbackDuration = Number(audio?.dataset?.durationSeconds || durationLabel?.dataset?.audioDuration || 0);
        return Number.isFinite(fallbackDuration) && fallbackDuration > 0 ? fallbackDuration : 0;
    }

    function clampAudioSeekPercent(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return 0;
        return Math.max(0, Math.min(100, numeric));
    }

    function seekAudioPlayerToPercent(rangeEl, nextPercent) {
        const { audio, progress, wave } = resolveAudioPlayerElements(rangeEl);
        if (!audio || !progress) return;
        ensureMediaElementHydrated(audio, { force: true });
        audio.preload = 'metadata';
        const percent = clampAudioSeekPercent(nextPercent);
        progress.value = String(percent);
        progress.dataset.seekingPercent = String(percent);
        const knownDuration = resolveKnownAudioDuration(audio);
        if (knownDuration > 0) {
            try {
                audio.currentTime = (percent / 100) * knownDuration;
            } catch (_) {}
        } else {
            try { audio.load(); } catch (_) {}
        }
        if (wave) {
            wave.style.setProperty('--audio-played-percent', String(percent));
            wave.dataset.playedPercent = String(percent);
        }
        syncAudioPlayerUi(audio);
    }

    function syncAudioPlayerUi(audioEl) {
        const { player, audio, toggle, icon, speedButton, progress, wave, durationLabel } = resolveAudioPlayerElements(audioEl);
        if (!audio) return;
        initAudioMessageListenState(audio);
        const preferredRate = getPreferredAudioPlaybackRate();
        if (Math.abs((audio.playbackRate || 1) - preferredRate) > 0.001) {
            audio.playbackRate = preferredRate;
        }
        const isPlaying = !audio.paused && !audio.ended;
        const playRequested = audio.dataset.playRequested === '1';
        if (isPlaying && playRequested) {
            audio.dataset.playRequested = '0';
        }
        const isStarting = !isPlaying && playRequested && !audio.ended;
        const isPlaybackActive = isPlaying || (audio.dataset.playRequested === '1' && !audio.ended);
        const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
        const knownDuration = resolveKnownAudioDuration(audio, durationLabel);
        const playedPercent = knownDuration > 0 ? (current / knownDuration) * 100 : 0;
        const safePercent = Math.max(0, Math.min(100, playedPercent));
        const roundedPercent = Math.round(safePercent * 10) / 10;
        const isSeeking = progress?.dataset?.seeking === '1';
        const seekingPercentRaw = Number(progress?.dataset?.seekingPercent);
        const seekingPercent = Number.isFinite(seekingPercentRaw)
            ? Math.max(0, Math.min(100, seekingPercentRaw))
            : roundedPercent;
        const effectivePercent = isSeeking ? seekingPercent : roundedPercent;
        const effectiveCurrentSeconds = knownDuration > 0 ? (effectivePercent / 100) * knownDuration : current;
        const visualPercent = (isPlaybackActive && effectivePercent <= 0)
            ? 1.2
            : effectivePercent;
        if (progress && !isSeeking) {
            const nextProgress = String(roundedPercent);
            if (progress.value !== nextProgress) {
                progress.value = nextProgress;
            }
            progress.setAttribute('aria-valuenow', String(roundedPercent));
            if (knownDuration > 0) {
                const currentLabel = formatAudioPlayerTime(Math.max(0, Math.floor(effectiveCurrentSeconds)));
                const durationLabelText = formatAudioPlayerTime(Math.max(0, Math.floor(knownDuration)));
                progress.setAttribute('aria-valuetext', `${currentLabel} / ${durationLabelText}`);
            } else {
                progress.removeAttribute('aria-valuetext');
            }
        }
        if (wave) {
            const previousPercent = Number(wave.dataset.playedPercent || -1);
            if (!Number.isFinite(previousPercent) || Math.abs(previousPercent - visualPercent) >= 0.1) {
                wave.style.setProperty('--audio-played-percent', String(visualPercent));
                wave.dataset.playedPercent = String(visualPercent);
            }
        }
        if (durationLabel) {
            if (knownDuration > 0) {
                durationLabel.dataset.audioDuration = String(Math.floor(knownDuration));
            }
            const mode = (isSeeking || isPlaybackActive || (current > 0.2 && current < knownDuration))
                ? 'current'
                : 'duration';
            const displaySeconds = mode === 'duration' ? knownDuration : effectiveCurrentSeconds;
            const roundedSeconds = Math.max(0, Math.floor(displaySeconds));
            const prevSeconds = durationLabel.dataset.displaySeconds || '';
            const prevMode = durationLabel.dataset.displayMode || '';
            if (prevSeconds !== String(roundedSeconds) || prevMode !== mode) {
                durationLabel.textContent = formatAudioPlayerTime(roundedSeconds);
                durationLabel.dataset.displaySeconds = String(roundedSeconds);
                durationLabel.dataset.displayMode = mode;
            }
        }
        if (toggle) {
            toggle.setAttribute('aria-label', isStarting ? '\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430' : (isPlaybackActive ? '\u041F\u0430\u0443\u0437\u0430' : '\u0412\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u0435\u0441\u0442\u0438'));
        }
        if (icon) {
            icon.className = isStarting
                ? 'bi bi-arrow-repeat'
                : (isPlaybackActive ? 'bi bi-pause-fill' : 'bi bi-play-fill');
        }
        if (speedButton) {
            speedButton.textContent = formatAudioPlaybackRateLabel(preferredRate);
            speedButton.setAttribute('aria-label', `\u0421\u043A\u043E\u0440\u043E\u0441\u0442\u044C ${formatAudioPlaybackRateLabel(preferredRate)}. \u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C`);
            speedButton.classList.toggle('is-active', preferredRate > 1);
        }
        if (player) {
            player.classList.toggle('is-playing', isPlaying);
            player.classList.toggle('is-starting', isStarting);
            player.classList.toggle('is-seeking', isSeeking);
        }
        const activeTopAudio = resolveActiveVoicePlaybackAudio();
        if (activeTopAudio === audio) {
            syncVoicePlaybackBar(audio);
        }
    }

    function stopAudioPlayerUiLoop(audioEl) {
        if (!audioEl) return;
        const pendingFrame = audioUiPlaybackLoopByElement.get(audioEl);
        if (pendingFrame != null) {
            cancelAnimationFrame(pendingFrame);
            audioUiPlaybackLoopByElement.delete(audioEl);
        }
    }

    function startAudioPlayerUiLoop(audioEl) {
        if (!audioEl || !audioEl.isConnected || audioEl.paused || audioEl.ended) return;
        stopAudioPlayerUiLoop(audioEl);
        const tick = () => {
            if (!audioEl || !audioEl.isConnected || audioEl.paused || audioEl.ended) {
                audioUiPlaybackLoopByElement.delete(audioEl);
                syncAudioPlayerUi(audioEl);
                return;
            }
            syncAudioPlayerUi(audioEl);
            const frameId = requestAnimationFrame(tick);
            audioUiPlaybackLoopByElement.set(audioEl, frameId);
        };
        const firstFrameId = requestAnimationFrame(tick);
        audioUiPlaybackLoopByElement.set(audioEl, firstFrameId);
    }

    function scheduleAudioPlayerUiSync(audioEl) {
        if (!audioEl) return;
        if (audioUiPlaybackLoopByElement.has(audioEl)) return;
        const pending = audioUiFrameByElement.get(audioEl);
        if (pending != null) return;
        const frameId = requestAnimationFrame(() => {
            audioUiFrameByElement.delete(audioEl);
            syncAudioPlayerUi(audioEl);
        });
        audioUiFrameByElement.set(audioEl, frameId);
    }

    window._onAudioPlayerMeta = function(audioEl) {
        const { audio, progress } = resolveAudioPlayerElements(audioEl);
        if (audio && progress && progress.dataset.seekingPercent) {
            const pendingPercent = Math.max(0, Math.min(100, Number(progress.dataset.seekingPercent) || 0));
            const knownDuration = resolveKnownAudioDuration(audio);
            if (knownDuration > 0) {
                try {
                    audio.currentTime = (pendingPercent / 100) * knownDuration;
                } catch (_) {}
            }
        }
        void ensureGeneratedAudioWaveform(audioEl);
        syncAudioPlayerUi(audioEl);
    };

    window._initAudioPlayerState = function(audioEl) {
        initAudioMessageListenState(audioEl);
        audioEl.playbackRate = getPreferredAudioPlaybackRate();
        applyPreferredVolumeToAudio(audioEl);
        void ensureGeneratedAudioWaveform(audioEl);
        syncAudioPlayerUi(audioEl);
    };

    window._onAudioPlayerTime = function(audioEl) {
        if (!audioEl) return;
        if (!audioEl.paused && !audioEl.ended) return;
        scheduleAudioPlayerUiSync(audioEl);
    };

    window._onAudioPlayerState = function(audioEl) {
        if (!audioEl) return;
        if (audioEl.ended && resolveActiveVoicePlaybackAudio() === audioEl) {
            clearActiveVoicePlaybackAudio();
        }
        if (!audioEl.paused && !audioEl.ended) {
            startAudioPlayerUiLoop(audioEl);
        } else {
            stopAudioPlayerUiLoop(audioEl);
        }
        scheduleAudioPlayerUiSync(audioEl);
    };

    window._setAudioSeekState = function(rangeEl, isSeeking) {
        const { audio, progress, wave } = resolveAudioPlayerElements(rangeEl);
        if (!audio || !progress) return;
        if (isSeeking) {
            progress.dataset.seeking = '1';
            const normalized = Math.max(0, Math.min(100, Number(progress.value) || 0));
            progress.dataset.seekingPercent = String(normalized);
            ensureMediaElementHydrated(audio, { force: true });
            audio.preload = 'metadata';
            if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
                try { audio.load(); } catch (_) {}
            }
        } else {
            progress.dataset.seeking = '0';
            delete progress.dataset.seekingPercent;
        }
        if (wave) {
            wave.classList.toggle('is-seeking', Boolean(isSeeking));
        }
        syncAudioPlayerUi(audio);
    };

    window._seekAudioPlayer = function(rangeEl) {
        seekAudioPlayerToPercent(rangeEl, Number(rangeEl?.value) || 0);
    };

    window._seekAudioPlayerByClientX = function(rangeEl, clientX) {
        const { progress } = resolveAudioPlayerElements(rangeEl);
        if (!progress) return;
        const rect = progress.getBoundingClientRect();
        if (!Number.isFinite(rect.width) || rect.width <= 0) return;
        const localX = Number(clientX) - rect.left;
        const percent = clampAudioSeekPercent((localX / rect.width) * 100);
        seekAudioPlayerToPercent(rangeEl, percent);
    };

    window._seekAudioPlayerByDeltaSeconds = function(rangeEl, deltaSeconds) {
        const { audio, durationLabel } = resolveAudioPlayerElements(rangeEl);
        if (!audio) return;
        const knownDuration = resolveKnownAudioDuration(audio, durationLabel);
        if (!Number.isFinite(knownDuration) || knownDuration <= 0) return;
        const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
        const nextSeconds = Math.max(0, Math.min(knownDuration, current + Number(deltaSeconds || 0)));
        const percent = knownDuration > 0 ? (nextSeconds / knownDuration) * 100 : 0;
        seekAudioPlayerToPercent(rangeEl, percent);
    };

    window._handleAudioSeekKeydown = function(rangeEl, event) {
        if (!rangeEl || !event) return;
        const key = String(event.key || '');
        if (key === ' ' || key === 'Spacebar' || key === 'Enter') {
            event.preventDefault();
            const { toggle } = resolveAudioPlayerElements(rangeEl);
            if (toggle) {
                window._toggleAudioPlayer(toggle);
            }
            return;
        }
        if (key === 'ArrowLeft' || key === 'ArrowRight') {
            event.preventDefault();
            const delta = (event.shiftKey ? 15 : 5) * (key === 'ArrowLeft' ? -1 : 1);
            window._seekAudioPlayerByDeltaSeconds(rangeEl, delta);
            return;
        }
        if (key === 'Home') {
            event.preventDefault();
            seekAudioPlayerToPercent(rangeEl, 0);
            return;
        }
        if (key === 'End') {
            event.preventDefault();
            seekAudioPlayerToPercent(rangeEl, 100);
        }
    };

    window._cycleAudioPlaybackRate = function(speedBtn) {
        const { audio } = resolveAudioPlayerElements(speedBtn);
        const current = getPreferredAudioPlaybackRate();
        const currentIndex = AUDIO_PLAYBACK_RATES.findIndex((value) => Math.abs(value - current) < 0.001);
        const nextIndex = currentIndex >= 0
            ? (currentIndex + 1) % AUDIO_PLAYBACK_RATES.length
            : 0;
        const nextRate = setPreferredAudioPlaybackRate(AUDIO_PLAYBACK_RATES[nextIndex]);
        document.querySelectorAll('.file-msg-audio-el').forEach((candidate) => {
            candidate.playbackRate = nextRate;
            scheduleAudioPlayerUiSync(candidate);
        });
        if (audio) {
            syncAudioPlayerUi(audio);
        }
        syncVoicePlaybackBar();
    };

    window._toggleAudioPlayer = async function(toggleBtn) {
        const { audio } = resolveAudioPlayerElements(toggleBtn);
        if (!audio) return;
        if (audio.paused) {
            ensureMediaElementHydrated(audio, { force: true });
            void ensureGeneratedAudioWaveform(audio);
            if (!audio.getAttribute('src')) {
                showToast('\u0410\u0443\u0434\u0438\u043E \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E \u0434\u043B\u044F \u0432\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u0435\u0434\u0435\u043D\u0438\u044F.', 'warning');
                return;
            }
            const all = document.querySelectorAll('.file-msg-audio-el');
            all.forEach((candidate) => {
                if (candidate !== audio) {
                    candidate.dataset.playRequested = '0';
                    try { candidate.pause(); } catch (_) {}
                    stopAudioPlayerUiLoop(candidate);
                    scheduleAudioPlayerUiSync(candidate);
                }
            });
            reportVoiceListened(audio);
            audio.dataset.playRequested = '1';
            audio.playbackRate = getPreferredAudioPlaybackRate();
            applyPreferredVolumeToAudio(audio);
            setActiveVoicePlaybackAudio(audio);
            scheduleAudioPlayerUiSync(audio);
            try {
                await audio.play();
            } catch (_) {
                audio.dataset.playRequested = '0';
                stopAudioPlayerUiLoop(audio);
                showToast('\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0432\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u0435\u0441\u0442\u0438 \u0430\u0443\u0434\u0438\u043E.', 'warning');
            }
        } else {
            audio.dataset.playRequested = '0';
            audio.pause();
            stopAudioPlayerUiLoop(audio);
        }
        syncAudioPlayerUi(audio);
        syncVoicePlaybackBar(audio);
    };

    function seekActiveVoicePlaybackByPercent(percent) {
        const audio = resolveActiveVoicePlaybackAudio();
        if (!audio) return;
        const { durationLabel } = resolveAudioPlayerElements(audio);
        const knownDuration = resolveKnownAudioDuration(audio, durationLabel);
        if (!Number.isFinite(knownDuration) || knownDuration <= 0) return;
        const safePercent = clampAudioSeekPercent(percent);
        audio.currentTime = (safePercent / 100) * knownDuration;
        syncAudioPlayerUi(audio);
        syncVoicePlaybackBar(audio);
    }

    function findAdjacentVoiceAudio(sourceAudio, direction = 1) {
        const messageEl = resolveAudioMessageElement(sourceAudio);
        if (!messageEl) return null;
        let node = messageEl;
        const step = direction >= 0 ? 'nextElementSibling' : 'previousElementSibling';
        while (node && node[step]) {
            node = node[step];
            if (!(node instanceof HTMLElement)) continue;
            const candidate = node.querySelector('.file-msg-audio-el');
            if (candidate instanceof HTMLAudioElement) {
                return candidate;
            }
        }
        return null;
    }

    function advanceToNextVoicePlayback() {
        const current = resolveActiveVoicePlaybackAudio();
        if (!current) return;
        const targetAudio = findAdjacentVoiceAudio(current, 1);
        if (!targetAudio) {
            clearActiveVoicePlaybackAudio({ pause: true });
            return;
        }
        const targetToggle = targetAudio.closest('.file-msg-audio-player')?.querySelector('.audio-player-toggle');
        if (!targetToggle) return;
        window._toggleAudioPlayer(targetToggle);
    }

    if (voicePlaybackPlayBtn) {
        voicePlaybackPlayBtn.addEventListener('click', () => {
            const audio = resolveActiveVoicePlaybackAudio();
            if (!audio) return;
            const toggleBtn = audio.closest('.file-msg-audio-player')?.querySelector('.audio-player-toggle');
            if (!toggleBtn) return;
            window._toggleAudioPlayer(toggleBtn);
        });
    }

    if (voicePlaybackBackBtn) {
        voicePlaybackBackBtn.addEventListener('click', () => advanceToNextVoicePlayback());
    }

    if (voicePlaybackForwardBtn) {
        voicePlaybackForwardBtn.addEventListener('click', () => advanceToNextVoicePlayback());
    }

    if (voicePlaybackSpeedBtn) {
        voicePlaybackSpeedBtn.addEventListener('click', () => {
            window._cycleAudioPlaybackRate?.(null);
            syncVoicePlaybackBar();
        });
    }

    if (voicePlaybackVolume) {
        voicePlaybackVolume.addEventListener('pointerdown', () => {
            voicePlaybackVolume.dataset.seeking = '1';
        });
        voicePlaybackVolume.addEventListener('pointerup', () => {
            voicePlaybackVolume.dataset.seeking = '0';
        });
        voicePlaybackVolume.addEventListener('input', () => {
            const normalized = setPreferredAudioVolume((Number(voicePlaybackVolume.value) || 0) / 100);
            document.querySelectorAll('.file-msg-audio-el').forEach((audioEl) => {
                audioEl.volume = normalized;
            });
            const activeAudio = resolveActiveVoicePlaybackAudio();
            if (activeAudio) {
                syncVoicePlaybackBar(activeAudio);
            }
        });
    }

    if (voicePlaybackProgress) {
        voicePlaybackProgress.addEventListener('pointerdown', () => {
            voicePlaybackProgress.dataset.seeking = '1';
        });
        voicePlaybackProgress.addEventListener('pointerup', () => {
            voicePlaybackProgress.dataset.seeking = '0';
        });
        voicePlaybackProgress.addEventListener('input', () => {
            seekActiveVoicePlaybackByPercent(Number(voicePlaybackProgress.value) || 0);
        });
    }

    if (voicePlaybackCloseBtn) {
        voicePlaybackCloseBtn.addEventListener('click', () => {
            clearActiveVoicePlaybackAudio({ pause: true });
        });
    }

    window._onMessageMediaLoaded = function(mediaEl) {
        if (!mediaEl) return;
        mediaEl.setAttribute('data-loaded', '1');
        const mediaWrap = mediaEl.closest('.image-wrapper, .video-preview');
        mediaWrap?.classList.add('is-loaded');

        const naturalWidth = Number(mediaEl.naturalWidth || mediaEl.videoWidth);
        const naturalHeight = Number(mediaEl.naturalHeight || mediaEl.videoHeight);
        if (mediaWrap && Number.isFinite(naturalWidth) && naturalWidth > 0 && Number.isFinite(naturalHeight) && naturalHeight > 0) {
            const ratio = String(Math.max(0.56, Math.min(1.91, naturalWidth / naturalHeight)));
            mediaWrap.style.setProperty('--media-aspect-ratio', ratio);
            mediaWrap.closest('.bubble')?.style.setProperty('--media-aspect-ratio', ratio);
            persistPendingMediaDimensions(mediaEl.closest('.message'), naturalWidth, naturalHeight);
        }

        if (!chatMessages || !currentChatId) return;

        const messageEl = mediaEl.closest('.message');
        const state = getChatState(currentChatId);
        if (messageEl) {
            const key = messageEl.getAttribute('data-message-key');
            // \u041E\u0431\u043D\u043E\u0432\u043B\u044F\u0435\u043C \u043A\u0435\u0448 \u0432\u044B\u0441\u043E\u0442\u044B \u0431\u0435\u0437 \u043F\u0435\u0440\u0435\u0440\u0435\u043D\u0434\u0435\u0440\u0430 - \u0432\u044B\u0441\u043E\u0442\u0430 \u0443\u0436\u0435 \u0441\u0442\u0430\u0431\u0438\u043B\u044C\u043D\u0430
            requestAnimationFrame(() => {
                const height = Math.ceil(messageEl.getBoundingClientRect().height);
                if (key && Number.isFinite(height) && height > 0) {
                    state.messageHeights.set(key, height);
                }
                if (keepChatPinnedToBottom) {
                    // \u0422\u043E\u043B\u044C\u043A\u043E \u043A\u043E\u0440\u0440\u0435\u043A\u0442\u0438\u0440\u0443\u0435\u043C scrollTop \u0431\u0435\u0437 \u043F\u043E\u043B\u043D\u043E\u0433\u043E \u043F\u0435\u0440\u0435\u0440\u0435\u043D\u0434\u0435\u0440\u0430
                    setChatScrollTop(chatMessages.scrollHeight);
                    saveChatScrollPosition(currentChatId);
                    updateJumpToNewMessagesButton();
                } else {
                    saveChatScrollPosition(currentChatId);
                    updateJumpToNewMessagesButton();
                }
            });
        }
    };

    window._onMessageMediaLoadError = function(mediaEl) {
        if (!mediaEl) return;
        const mediaWrap = mediaEl.closest('.image-wrapper, .video-preview');
        mediaWrap?.classList.add('is-loaded');
        mediaEl.setAttribute('data-loaded', '1');
    };

    window._preventInlineVideoPlay = function(videoEl) {
        if (!videoEl) return;
        videoEl.pause();
    };

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
    const ATTACH_MODE_FILE = 'file';
    const ATTACH_MODE_MEDIA = 'media';
    const FILE_ATTACH_ACCEPT_ALL = String(fileAttachInput?.getAttribute('accept') || '*/*');
    const FILE_ATTACH_ACCEPT_MEDIA = 'image/*,video/*';
    const attachMenuController = initAttachMenuPortal({ attachMenu, trigger: attachBtn });

    function resolveAttachMode(value) {
        return value === ATTACH_MODE_MEDIA ? ATTACH_MODE_MEDIA : ATTACH_MODE_FILE;
    }

    function isVisualAttachCandidate(file) {
        const mime = String(file?.type || '').toLowerCase();
        if (mime.startsWith('image/') || mime.startsWith('video/')) return true;
        const name = String(file?.name || '').toLowerCase();
        return /\.(png|jpe?g|webp|gif|bmp|svg|heic|heif|avif|mp4|mov|m4v|avi|mkv|webm|ogv)$/i.test(name);
    }

    function resolveAttachModeForFile(file, preferredMode = null) {
        const normalizedPreferredMode = preferredMode === null || preferredMode === undefined
            ? null
            : resolveAttachMode(preferredMode);
        if (normalizedPreferredMode === ATTACH_MODE_MEDIA) return ATTACH_MODE_MEDIA;
        if (normalizedPreferredMode === ATTACH_MODE_FILE) return ATTACH_MODE_FILE;
        return isVisualAttachCandidate(file) ? ATTACH_MODE_MEDIA : ATTACH_MODE_FILE;
    }

    function setAttachMenuOpen(open) {
        attachMenuController.setOpen(open);
    }

    function isAttachMenuOpen() {
        return attachMenuController.isOpen();
    }

    function closeAttachMenu() {
        attachMenuController.close();
    }

    function applyAttachInputMode(mode) {
        if (!fileAttachInput) return;
        const normalizedMode = resolveAttachMode(mode);
        fileAttachInput.dataset.attachMode = normalizedMode;
        fileAttachInput.setAttribute(
            'accept',
            normalizedMode === ATTACH_MODE_MEDIA ? FILE_ATTACH_ACCEPT_MEDIA : FILE_ATTACH_ACCEPT_ALL,
        );
    }

    function openAttachMenu() {
        if (!attachMenu || !attachBtn || isChatBlocked()) return;
        if (attachBtn.classList.contains('disabled') || attachBtn.disabled) return;
        setAttachMenuOpen(true);
    }

    function triggerAttachPicker(mode) {
        if (!fileAttachInput) return;
        applyAttachInputMode(mode);
        closeAttachMenu();
        fileAttachInput.click();
    }

    attachBtn?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (isAttachMenuOpen()) {
            closeAttachMenu();
            return;
        }
        openAttachMenu();
    });

    attachMenuItems.forEach((item) => {
        item.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const mode = item.getAttribute('data-attach-mode') || ATTACH_MODE_FILE;
            triggerAttachPicker(mode);
        });
    });

    document.addEventListener('pointerdown', (event) => {
        if (!isAttachMenuOpen()) return;
        if (!(event.target instanceof Element)) {
            closeAttachMenu();
            return;
        }
        if (event.target.closest('#attachMenu') || event.target.closest('#attachBtn')) return;
        closeAttachMenu();
    });

    if (fileAttachInput) {
        applyAttachInputMode(ATTACH_MODE_FILE);
        fileAttachInput.addEventListener('change', async function() {
            const files = Array.from(this.files || []);
            if (!files.length) return;

            const attachMode = resolveAttachMode(this.dataset.attachMode);
            if (files.length === 1) {
                await handleFileUpload(files[0], { allowCaption: true, attachMode });
            } else {
                for (const file of files) {
                    await handleFileUpload(file, { allowCaption: false, attachMode });
                }
            }
            this.value = '';
            applyAttachInputMode(ATTACH_MODE_FILE);
        });
    }
    if (voiceRecordBtn) {
        voiceRecordBtn.addEventListener('click', () => {
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
        if (normalizedAttachMode !== ATTACH_MODE_MEDIA && file.size > MAX_CHAT_MEDIA_SIZE) {
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
            notifyIncomingMessage: ({ chatId, isCurrentChat }) => {
                notifyIncomingChatMessage({
                    chatId,
                    isCurrentChat,
                    isChatMuted,
                    isWindowActive: isWindowActiveForUnreadHandling,
                    pushTabAlert: (targetChatId) => tabAlertController.pushAlert(targetChatId),
                    showToast,
                    newMessageToastText: '\u041D\u043E\u0432\u043E\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435',
                });
            },
            onIncomingRawMessage: ({ chatId, rawMessage }) => {
                const encryptedRawMessage = buildEncryptedCacheMessageFromSocketPayload(rawMessage);
                if (!encryptedRawMessage) return;
                appendEncryptedMessagesToCache(chatId, [encryptedRawMessage]).catch(() => {});
                ChatIdb.pruneCachedChats(100).catch(() => {});
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
    if (hasSsrContacts) {
        sortContactsList();
        hideAppBootOverlay();
    } else {
        loadContacts({
            limit: CONTACTS_BOOTSTRAP_SYNC_LIMIT,
            attemptInitialChatRestore: false,
        });
    }
    scheduleNonCriticalTask(() => {
        loadContacts({ immediate: true });
    }, CONTACTS_FULL_SYNC_IDLE_TIMEOUT_MS);

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
            pruneCachedChats: (limit) => ChatIdb.pruneCachedChats(limit),
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

    function renderPaletteLocalMatches(query) {
        if (!paletteLocalSection || !paletteLocalResults) return;

        const normalizedQuery = String(query || '').trim().toLowerCase();
        if (!normalizedQuery) {
            paletteLocalSection.style.display = 'none';
            paletteLocalResults.innerHTML = '';
            return;
        }

        const items = Array.from(document.querySelectorAll('#contactsList .contact-item'));
        const matches = items.filter((item) => {
            const name = String(item.querySelector('.contact-name')?.textContent || '').toLowerCase();
            const username = String(item.querySelector('.contact-last-msg')?.textContent || '').toLowerCase();
            const publicKey = String(item.getAttribute('data-public-key') || '').toLowerCase();
            return name.includes(normalizedQuery) || username.includes(normalizedQuery) || publicKey.includes(normalizedQuery);
        }).slice(0, 6);

        if (!matches.length) {
            paletteLocalSection.style.display = 'none';
            paletteLocalResults.innerHTML = '';
            return;
        }

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
                        <div class="contact-avatar"${avatarTintAttr} style="width:40px;height:40px;flex-shrink:0;">${avatarHtml}</div>
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
        closeAnimatedDialog(document.getElementById('newChatModal'));
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

    const groupCreateMembers = new Map();
    let groupCreateSearchRequestSeq = 0;
    let groupCreateSubmitting = false;

    function normalizeSearchUser(user) {
        if (!user || typeof user !== 'object') return null;
        const parsedId = Number.parseInt(user.userId ?? user.user_id, 10);
        if (!Number.isFinite(parsedId) || parsedId <= 0) return null;
        const displayName = String(user.display_name || user.username || `Пользователь ${parsedId}`).trim();
        const username = String(user.username || '').trim();
        const avatarUrl = String(user.avatar_url || '').trim();
        return {
            user_id: parsedId,
            display_name: displayName || `Пользователь ${parsedId}`,
            username,
            avatar_url: avatarUrl,
        };
    }

    function updateGroupCreateSubmitState() {
        if (!groupCreateSubmitBtn) return;
        const titleLength = String(groupTitleInput?.value || '').trim().length;
        const canSubmit = !groupCreateSubmitting && titleLength >= 2 && titleLength <= 120 && groupCreateMembers.size > 0;
        groupCreateSubmitBtn.disabled = !canSubmit;
        groupCreateSubmitBtn.textContent = groupCreateSubmitting ? 'Создание...' : 'Создать';
    }

    function renderGroupCreateSelectedMembers() {
        if (!groupCreateSelected) return;
        const selected = Array.from(groupCreateMembers.values());
        if (!selected.length) {
            groupCreateSelected.innerHTML = '<span class="group-create-result-username">Участники пока не выбраны.</span>';
            return;
        }

        groupCreateSelected.innerHTML = selected
            .map((member) => `
                <span class="group-create-member-chip">
                    <span>${escapeHtml(member.display_name)}</span>
                    <button type="button" data-group-remove-member-id="${member.user_id}" aria-label="Удалить участника">&times;</button>
                </span>
            `)
            .join('');
    }

    function renderGroupCreateSearchResults(users) {
        if (!groupCreateSearchResults) return;
        const normalizedUsers = Array.isArray(users)
            ? users.map(normalizeSearchUser).filter(Boolean).filter((entry) => !groupCreateMembers.has(entry.user_id))
            : [];

        if (!normalizedUsers.length) {
            groupCreateSearchResults.innerHTML = '<p class="text-center">Пользователи не найдены.</p>';
            return;
        }

        groupCreateSearchResults.innerHTML = normalizedUsers
            .map((user) => `
                <button type="button" class="group-create-result-item" data-group-add-member-id="${user.user_id}">
                    <span>
                        <span class="group-create-result-name">${escapeHtml(user.display_name)}</span><br>
                        <span class="group-create-result-username">@${escapeHtml(user.username || 'неизвестно')}</span>
                    </span>
                    <span class="group-create-result-username">Добавить</span>
                </button>
            `)
            .join('');
    }

    function resetGroupCreateModal() {
        groupCreateMembers.clear();
        groupCreateSearchRequestSeq += 1;
        groupCreateSubmitting = false;
        if (groupTitleInput) groupTitleInput.value = '';
        if (groupMemberSearchInput) groupMemberSearchInput.value = '';
        if (groupCreateSearchResults) groupCreateSearchResults.innerHTML = '';
        renderGroupCreateSelectedMembers();
        updateGroupCreateSubmitState();
    }

    function openGroupCreateModal() {
        if (!groupCreateModal) return;
        resetGroupCreateModal();
        openAnimatedDialog(groupCreateModal, { focusTarget: groupTitleInput || groupMemberSearchInput });
    }

    async function searchGroupMembers(query) {
        if (!groupCreateSearchResults) return;
        const normalized = String(query || '').trim();
        const requestSeq = ++groupCreateSearchRequestSeq;

        if (!normalized) {
            groupCreateSearchResults.innerHTML = '';
            return;
        }
        if (normalized.length < 3) {
            groupCreateSearchResults.innerHTML = '<p class="text-center">Введите минимум 3 символа.</p>';
            return;
        }

        groupCreateSearchResults.innerHTML = buildSearchResultsLoaderHtml();
        try {
            const response = await fetch(withAppRoot(`/search_users?q=${encodeURIComponent(normalized)}&limit=20`), {
                credentials: 'same-origin',
            });
            const payload = await response.json().catch(() => ({}));
            if (requestSeq !== groupCreateSearchRequestSeq) return;
            const users = payload.results || payload.users || [];
            if (!response.ok || !payload.success) {
                groupCreateSearchResults.innerHTML = `<p class="text-center">${escapeHtml(payload.error || 'Поиск не удался.')}</p>`;
                return;
            }
            renderGroupCreateSearchResults(users);
        } catch (_) {
            if (requestSeq !== groupCreateSearchRequestSeq) return;
            groupCreateSearchResults.innerHTML = '<p class="text-center">Поиск не удался. Попробуйте снова.</p>';
        }
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

    async function submitGroupCreate() {
        if (groupCreateSubmitting) return;
        const title = String(groupTitleInput?.value || '').trim();
        const memberIds = Array.from(groupCreateMembers.keys());
        if (title.length < 2 || title.length > 120) {
            showToast('Название группы должно быть от 2 до 120 символов.', 'warning');
            updateGroupCreateSubmitState();
            return;
        }
        if (!memberIds.length) {
            showToast('Добавьте хотя бы одного участника.', 'warning');
            updateGroupCreateSubmitState();
            return;
        }

        groupCreateSubmitting = true;
        updateGroupCreateSubmitState();
        try {
            const response = await fetch(withAppRoot('/api/chats/group/create'), {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken(),
                },
                body: JSON.stringify({
                    title,
                    member_user_ids: memberIds,
                }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload.success) {
                throw new Error(String(payload.error || 'Не удалось создать группу.'));
            }

            closeAnimatedDialog(groupCreateModal);
            showToast('Группа создана.', 'success');
            await loadContacts({ immediate: true, attemptInitialChatRestore: false });
            await openChatByIdWhenReady(payload.chat_id);
        } catch (error) {
            showToast(error?.message || 'Не удалось создать группу.', 'danger');
        } finally {
            groupCreateSubmitting = false;
            updateGroupCreateSubmitState();
        }
    }

    let groupEditSubmitting = false;
    let groupEditAvatarUploading = false;

    function getGroupEditNormalizedTitle() {
        return String(groupEditTitleInput?.value || '').trim();
    }

    function getGroupEditNormalizedDescription() {
        return String(groupEditDescriptionInput?.value || '').trim();
    }

    function hasGroupEditChanges() {
        if (!currentGroupProfile) return false;
        const nextTitle = getGroupEditNormalizedTitle();
        const nextDescription = getGroupEditNormalizedDescription();
        const prevTitle = String(currentGroupProfile.display_name || '').trim();
        const prevDescription = String(currentGroupProfile.description || '').trim();
        return nextTitle !== prevTitle || nextDescription !== prevDescription;
    }

    function updateGroupEditSubmitState() {
        if (!groupEditSubmitBtn) return;
        const titleLength = getGroupEditNormalizedTitle().length;
        const descriptionLength = getGroupEditNormalizedDescription().length;
        const canSubmit = !groupEditSubmitting
            && !groupEditAvatarUploading
            && titleLength >= 2
            && titleLength <= 120
            && descriptionLength <= 600
            && hasGroupEditChanges();
        groupEditSubmitBtn.disabled = !canSubmit;
        groupEditSubmitBtn.textContent = groupEditSubmitting ? 'Сохранение...' : 'Сохранить';
    }

    async function uploadGroupAvatar(file) {
        if (!file || !currentGroupProfile) return;
        const chatId = String(currentGroupProfile.chat_id || currentChatId || '').trim();
        if (!chatId) return;
        groupEditAvatarUploading = true;
        updateGroupEditSubmitState();
        try {
            const formData = new FormData();
            formData.append('chat_id', chatId);
            formData.append('avatar', file);
            const response = await fetch(withAppRoot('/api/chats/group/upload_avatar'), {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'X-CSRFToken': getCsrfToken(),
                },
                body: formData,
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload?.success) {
                throw new Error(payload?.error || 'Не удалось загрузить фото группы.');
            }
            const nextAvatarUrl = String(payload.chat_avatar_url || '').trim();
            if (currentGroupProfile) currentGroupProfile.avatar_url = nextAvatarUrl;
            if (window.currentPartnerData && window.currentPartnerData._group_profile) {
                window.currentPartnerData.avatar_url = nextAvatarUrl;
            }
            renderGroupEditAvatar(currentGroupProfile);
            if (profileLargeAvatar && nextAvatarUrl) {
                profileLargeAvatar.removeAttribute('data-avatar-tint');
                profileLargeAvatar.innerHTML = `<img src="${escapeHtml(nextAvatarUrl)}" alt="${escapeHtml(currentGroupProfile?.display_name || 'Group')}">`;
            }
            await loadContacts({ immediate: true, attemptInitialChatRestore: false });
            showToast('Фото группы обновлено.', 'success');
        } catch (error) {
            showToast(error?.message || 'Не удалось загрузить фото группы.', 'danger');
        } finally {
            groupEditAvatarUploading = false;
            if (groupEditAvatarInput) groupEditAvatarInput.value = '';
            updateGroupEditSubmitState();
        }
    }

    function openGroupEditModal() {
        if (!groupEditModal || !currentGroupProfile) return;
        const permissions = currentGroupProfile?.permissions || {};
        const canOpenManagePanel = Boolean(
            currentGroupProfile.can_edit_group
            || permissions?.can_manage_roles
            || permissions?.can_kick
            || permissions?.can_ban,
        );
        if (!canOpenManagePanel) {
            showToast('\u0423 \u0432\u0430\u0441 \u043D\u0435\u0442 \u043F\u0440\u0430\u0432 \u043D\u0430 \u0443\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0433\u0440\u0443\u043F\u043F\u043E\u0439.', 'warning');
            return;
        }
        groupEditSubmitting = false;
        groupEditAvatarUploading = false;
        if (groupEditTitleInput) {
            groupEditTitleInput.value = String(currentGroupProfile.display_name || '').trim();
            groupEditTitleInput.setSelectionRange(0, groupEditTitleInput.value.length);
        }
        if (groupEditDescriptionInput) {
            groupEditDescriptionInput.value = String(currentGroupProfile.description || '').trim();
        }
        renderGroupEditAvatar(currentGroupProfile);
        renderGroupEditMembers(currentGroupProfile);
        updateGroupEditSubmitState();
        openAnimatedDialog(groupEditModal, { focusTarget: groupEditTitleInput });
    }

    async function submitGroupEdit() {
        if (groupEditSubmitting || !currentGroupProfile) return;
        const nextTitle = getGroupEditNormalizedTitle();
        const nextDescription = getGroupEditNormalizedDescription();
        if (nextTitle.length < 2 || nextTitle.length > 120) {
            showToast('\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u0433\u0440\u0443\u043F\u043F\u044B \u0434\u043E\u043B\u0436\u043D\u043E \u0431\u044B\u0442\u044C \u0434\u043B\u0438\u043D\u043E\u0439 \u043E\u0442 2 \u0434\u043E 120 \u0441\u0438\u043C\u0432\u043E\u043B\u043E\u0432.', 'warning');
            updateGroupEditSubmitState();
            return;
        }
        if (nextDescription.length > 600) {
            showToast('\u041E\u043F\u0438\u0441\u0430\u043D\u0438\u0435 \u0441\u043B\u0438\u0448\u043A\u043E\u043C \u0434\u043B\u0438\u043D\u043D\u043E\u0435.', 'warning');
            updateGroupEditSubmitState();
            return;
        }
        const chatId = String(currentGroupProfile.chat_id || currentChatId || '').trim();
        if (!chatId) return;

        groupEditSubmitting = true;
        updateGroupEditSubmitState();
        try {
            const response = await fetch(withAppRoot('/api/chats/group/update'), {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken(),
                },
                body: JSON.stringify({ chat_id: chatId, title: nextTitle, description: nextDescription }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload.success) {
                throw new Error(String(payload.error || '\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0433\u0440\u0443\u043F\u043F\u0443.'));
            }

            closeAnimatedDialog(groupEditModal);
            showToast('\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u0433\u0440\u0443\u043F\u043F\u044B \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u044B.', 'success');
            if (chatTitle) chatTitle.textContent = nextTitle;
            if (currentGroupProfile) {
                currentGroupProfile.display_name = nextTitle;
                currentGroupProfile.description = nextDescription;
            }
            if (window.currentPartnerData && window.currentPartnerData._group_profile) {
                window.currentPartnerData.display_name = nextTitle;
                window.currentPartnerData.description = nextDescription;
            }
            if (profileDisplayName) profileDisplayName.textContent = nextTitle;
            await loadContacts({ immediate: true, attemptInitialChatRestore: false });
        } catch (error) {
            showToast(error?.message || '\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0433\u0440\u0443\u043F\u043F\u0443.', 'danger');
        } finally {
            groupEditSubmitting = false;
            updateGroupEditSubmitState();
        }
    }

    groupTitleInput?.addEventListener('input', () => {
        updateGroupCreateSubmitState();
    });

    groupMemberSearchInput?.addEventListener('input', () => {
        void searchGroupMembers(groupMemberSearchInput.value);
    });

    groupCreateSearchResults?.addEventListener('click', (event) => {
        const addButton = event.target.closest('[data-group-add-member-id]');
        if (!addButton) return;
        const memberId = Number.parseInt(addButton.getAttribute('data-group-add-member-id') || '', 10);
        if (!Number.isFinite(memberId) || memberId <= 0 || groupCreateMembers.has(memberId)) return;

        const resultName = String(addButton.querySelector('.group-create-result-name')?.textContent || `Пользователь ${memberId}`).trim();
        const resultUsername = String(
            addButton.querySelector('.group-create-result-username')?.textContent || '',
        ).replace(/^@/, '').trim();
        groupCreateMembers.set(memberId, {
            user_id: memberId,
            display_name: resultName || `Пользователь ${memberId}`,
            username: resultUsername,
            avatar_url: '',
        });
        renderGroupCreateSelectedMembers();
        updateGroupCreateSubmitState();
        addButton.remove();
    });

    groupCreateSelected?.addEventListener('click', (event) => {
        const removeButton = event.target.closest('[data-group-remove-member-id]');
        if (!removeButton) return;
        const memberId = Number.parseInt(removeButton.getAttribute('data-group-remove-member-id') || '', 10);
        if (!Number.isFinite(memberId) || memberId <= 0) return;
        groupCreateMembers.delete(memberId);
        renderGroupCreateSelectedMembers();
        updateGroupCreateSubmitState();
        void searchGroupMembers(groupMemberSearchInput?.value || '');
    });

    groupCreateSubmitBtn?.addEventListener('click', () => {
        void submitGroupCreate();
    });

    groupMemberSearchInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            const firstResult = groupCreateSearchResults?.querySelector('[data-group-add-member-id]');
            if (firstResult) {
                firstResult.click();
                return;
            }
            if (!groupCreateSubmitBtn?.disabled) {
                void submitGroupCreate();
            }
        }
    });

    groupCreateModal?.addEventListener('close', () => {
        resetGroupCreateModal();
    });

    groupEditTitleInput?.addEventListener('input', () => {
        updateGroupEditSubmitState();
    });
    groupEditDescriptionInput?.addEventListener('input', () => {
        updateGroupEditSubmitState();
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
    });

    groupEditAvatarInput?.addEventListener('change', () => {
        const file = groupEditAvatarInput.files?.[0];
        if (!file) return;
        void uploadGroupAvatar(file);
    });

    groupEditSubmitBtn?.addEventListener('click', () => {
        void submitGroupEdit();
    });

    groupEditTitleInput?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        void submitGroupEdit();
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
            window.openSettingsOverlay?.('profile');
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

    // \u041E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0430 \u043F\u043E\u0438\u0441\u043A\u0430 \u0432 \u0440\u0435\u0430\u043B\u044C\u043D\u043E\u043C \u0432\u0440\u0435\u043C\u0435\u043D\u0438
    if (modalSearchInput) {
        modalSearchInput.addEventListener('input', function() {
            const query = modalSearchInput.value.trim();
            renderPaletteLocalMatches(query);
            if (query.length === 0) {
                modalSearchResults.innerHTML = '';
                return;
            }
            if (query.length < 3) {
                modalSearchResults.innerHTML = '<p class="text-center">\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043C\u0438\u043D\u0438\u043C\u0443\u043C 3 \u0441\u0438\u043C\u0432\u043E\u043B\u0430.</p>';
                return;
            }

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
                ? `<img src="${escapeHtml(user.avatar_url)}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;flex-shrink:0;">`
                : `<div class="contact-avatar" style="width:40px;height:40px;font-size:14px;flex-shrink:0;">${escapeHtml(initials)}</div>`;

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

    // Expose to window so sidebar-brand-quick-actions.js can find it
    window.openCommandPalette = openCommandPaletteModal;

    emptyStatePrimaryBtn?.addEventListener('click', () => {
        openCommandPaletteModal();
    });

    emptyStateSecondaryBtn?.addEventListener('click', () => {
        window.openMyQrModal?.();
    });
    // ===================================================

    function extractClipboardFiles(event) {
        const clipboardData = event.clipboardData || event.originalEvent?.clipboardData;
        if (!clipboardData) return [];

        // Prefer items API (more reliable); fall back to files.
        // Never read BOTH - they contain the same data and cause duplicates.
        if (clipboardData.items && clipboardData.items.length) {
            const files = [];
            for (const item of clipboardData.items) {
                if (item.kind === 'file') {
                    const file = item.getAsFile();
                    if (file) files.push(file);
                }
            }
            if (files.length) return files;
        }

        if (clipboardData.files && clipboardData.files.length) {
            return Array.from(clipboardData.files);
        }

        return [];
    }

    function handleClipboardPaste(e) {
        const files = extractClipboardFiles(e);
        if (!files.length) return;

        e.preventDefault();
        const allowCaption = files.length === 1;
        files.forEach((file) => handleFileUpload(file, { allowCaption }));
    }

    if (messageInput) {
        messageInput.addEventListener('paste', handleClipboardPaste);
    }

    document.addEventListener('paste', (e) => {
        if (!currentChatId) return;
        if (e.target === messageInput) return;
        handleClipboardPaste(e);
    });

    // Drag & Drop - fix dragleave flickering by tracking drag depth
    if (chatArea && dragDropOverlay) {
        let dragDepth = 0;

        chatArea.addEventListener('dragenter', (e) => {
            if (!currentChatId) return;
            if (isProfileDrawerOpen()) return;
            // Only handle real file drags, not browser image drags
            if (!e.dataTransfer.types.includes('Files')) return;
            e.preventDefault();
            dragDepth++;
            dragDropOverlay.classList.add('active');
        });

        chatArea.addEventListener('dragover', (e) => {
            if (!currentChatId) return;
            if (isProfileDrawerOpen()) return;
            if (!e.dataTransfer.types.includes('Files')) return;
            e.preventDefault(); // required to allow drop
        });

        chatArea.addEventListener('dragleave', (e) => {
            dragDepth--;
            if (dragDepth <= 0) {
                dragDepth = 0;
                dragDropOverlay.classList.remove('active');
            }
        });

        chatArea.addEventListener('drop', (e) => {
            e.preventDefault();
            dragDepth = 0;
            dragDropOverlay.classList.remove('active');
            if (!currentChatId) {
                showToast('\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0447\u0430\u0442 \u043F\u0435\u0440\u0435\u0434 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u043E\u0439 \u0444\u0430\u0439\u043B\u0430.', 'warning');
                return;
            }
            if (isProfileDrawerOpen()) return;
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                const allowCaption = files.length === 1;
                for (let file of files) handleFileUpload(file, { allowCaption });
            }
        });
    }

    // \u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0439
    // Controller for message edit state and edit window validation.
    const messageEditController = createMessageEditController({
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
        getChatSurfaceEnterRafId: () => chatSurfaceEnterRafId,
        setChatSurfaceEnterRafId: (value) => { chatSurfaceEnterRafId = Number(value) || 0; },
        getChatSurfaceEnterTimerId: () => chatSurfaceEnterTimerId,
        setChatSurfaceEnterTimerId: (value) => { chatSurfaceEnterTimerId = Number(value) || 0; },
        isChatIdbReady,
        chatIdbRuntime,
        getExistingChatHistoryRuntime: () => chatHistoryRuntime,
    });

};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initChatPage, { once: true });
} else {
    initChatPage();
}
