import {
    detectFileCategory,
    getMessageTypeByCategory,
    optimizeFileForAttachMode,
    uploadChatMedia,
    isUploadAbortedError,
    probeAudioDurationSeconds,
    buildAudioWaveformPeaks,
    probeVisualMediaMetadata,
} from './chat-media-upload.js';
import { createTypingSignalHeartbeat } from './chat-typing-signal-heartbeat.js';
import { generateRequestId } from './utils.js';

const OFFLINE_RETRY_MESSAGE = '\u0421\u0432\u044F\u0437\u044C \u0441 \u0441\u0435\u0440\u0432\u0435\u0440\u043E\u043C \u0435\u0449\u0451 \u043D\u0435 \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u043B\u0430\u0441\u044C. \u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u0435 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0443 \u0447\u0435\u0440\u0435\u0437 \u043F\u0430\u0440\u0443 \u0441\u0435\u043A\u0443\u043D\u0434.';
const OFFLINE_QUEUED_MESSAGE = '\u0421\u0432\u044F\u0437\u044C \u0441 \u0441\u0435\u0440\u0432\u0435\u0440\u043E\u043C \u0435\u0449\u0451 \u043D\u0435 \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u043B\u0430\u0441\u044C. \u0421\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u043E \u0434\u043B\u044F \u043F\u043E\u0432\u0442\u043E\u0440\u043D\u043E\u0439 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0438.';

function resolveTransferPresenceKinds(options = {}) {
    const hint = String(options?.typingKindHint || '').trim().toLowerCase();
    const isVoiceTransfer = hint === 'voice' || hint === 'voice_message';
    if (isVoiceTransfer) {
        return {
            upload: 'upload_voice',
            send: 'send_voice',
        };
    }
    return {
        upload: 'upload_file',
        send: 'send_file',
    };
}

export async function sendFileMessageFlow({
    file,
    caption = '',
    options = {},
    isGroupChat = false,
    isChatBlocked,
    getBlockedNoticeText,
    currentBlockState,
    showToast,
    maxChatMediaSize,
    currentChatId,
    getCsrfToken,
    setSendingState,
    getReplyState,
    cancelReply,
    encryptForCurrentChat,
    isRealtimeConnected,
    emitSocket,
    appendMessage,
    setKeepChatPinnedToBottom,
    updateActiveContactLastMessage,
    schedulePendingTimeout,
    updatePendingFileUploadProgress,
    commitPendingFileUpload,
    failPendingMessage,
    setActiveComposerUpload,
    updateActiveComposerUploadProgress,
    clearActiveComposerUpload,
    enqueueOutbox,
} = {}) {
    if (isChatBlocked()) {
        showToast(getBlockedNoticeText(currentBlockState), 'warning');
        return;
    }
    if (!file) return;
    if (typeof isRealtimeConnected === 'function' && !isRealtimeConnected()) {
        showToast(OFFLINE_RETRY_MESSAGE, 'warning');
        return;
    }
    const attachMode = options?.attachMode === 'media' ? 'media' : 'file';
    const optimizationResult = await optimizeFileForAttachMode(file, { attachMode });
    const uploadFile = optimizationResult?.file || file;

    if (uploadFile.size > maxChatMediaSize) {
        throw new Error(`\u0424\u0430\u0439\u043B \u0441\u043B\u0438\u0448\u043A\u043E\u043C \u0431\u043E\u043B\u044C\u0448\u043E\u0439. \u041C\u0430\u043A\u0441\u0438\u043C\u0443\u043C ${Math.round(maxChatMediaSize / (1024 * 1024))} \u041C\u0411.`);
    }

    const sourceCategory = detectFileCategory(uploadFile);
    const transferPresenceKinds = resolveTransferPresenceKinds(options);
    const transferPresenceSignal = createTypingSignalHeartbeat({
        emitSocket,
        getChatId: () => currentChatId,
    });
    const forceDocumentVisual = attachMode === 'file'
        && (sourceCategory === 'image' || sourceCategory === 'video');
    const category = forceDocumentVisual ? 'file' : sourceCategory;
    const msgType = getMessageTypeByCategory(category);
    const providedAudioDuration = Number(options?.audioDurationSeconds);
    const voiceTranscript = typeof options?.transcript === 'string' ? options.transcript.trim() : '';
    // Для голосовых сначала используем длительность от рекордера и не ждём декода
    // waveform — иначе на iOS Safari (webm/opus не декодируется) сообщение появлялось
    // с большой задержкой и казалось «потерянным».
    const audioDurationSeconds = sourceCategory === 'audio'
        ? (Number.isFinite(providedAudioDuration) && providedAudioDuration > 0
            ? Math.max(1, Math.floor(providedAudioDuration))
            : await probeAudioDurationSeconds(uploadFile, null))
        : null;
    const audioWaveformPromise = sourceCategory === 'audio'
        ? buildAudioWaveformPeaks(uploadFile, 48).catch(() => null)
        : Promise.resolve(null);
    const previewUrl = URL.createObjectURL(uploadFile);
    const visualMeta = (sourceCategory === 'image' || sourceCategory === 'video')
        ? await probeVisualMediaMetadata(uploadFile, { category: sourceCategory, objectUrl: previewUrl })
        : null;
    const clientId = generateRequestId();
    const pendingTimestamp = new Date().toISOString();
    const {
        replyToId: snapReplyId,
        replyToText: snapReplyText,
        replyToSender: snapReplySender,
    } = getReplyState();
    const optimisticMime = String(uploadFile?.type || '').toLowerCase()
        || (sourceCategory === 'audio' ? 'audio/webm' : 'application/octet-stream');
    const albumId = typeof options?.albumId === 'string' ? options.albumId : null;
    const albumSize = albumId && Number.isFinite(Number(options?.albumSize)) ? Number(options.albumSize) : null;
    const albumIndex = albumId && Number.isFinite(Number(options?.albumIndex)) ? Number(options.albumIndex) : null;
    const optimisticPayload = {
        __sunfile: true,
        name: uploadFile.name,
        mime: optimisticMime,
        attach_mode: attachMode,
        data: previewUrl,
        caption: caption || '',
        size: uploadFile.size,
        uploading: true,
        upload_progress: 0,
        ...(Number.isFinite(audioDurationSeconds) && audioDurationSeconds > 0
            ? { duration_seconds: Math.max(1, Math.floor(audioDurationSeconds)) }
            : {}),
        ...(voiceTranscript ? { transcript: voiceTranscript } : {}),
        ...(visualMeta || {}),
    };
    const optimisticPayloadText = JSON.stringify(optimisticPayload);

    cancelReply();
    appendMessage({
        sender: 'self',
        message: optimisticPayloadText,
        encrypted: true,
        is_read: false,
        is_delivered: false,
        created_at: pendingTimestamp,
        pending: true,
        clientId,
        album_id: albumId || undefined,
        album_size: albumSize || undefined,
        album_index: albumIndex ?? undefined,
        replyToId: snapReplyId,
        replyToText: snapReplyText,
        replyToSender: snapReplySender,
        ...(isGroupChat ? { group_read_count: 0, group_readers: [] } : {}),
        reactions: [],
    }, { renderOptions: { scrollToBottom: true } });
    setKeepChatPinnedToBottom(true);
    updateActiveContactLastMessage(
        optimisticPayloadText,
        true,
        { pending: true, is_read: false, is_delivered: false },
        pendingTimestamp,
    );

    setActiveComposerUpload?.({
        clientId,
        progress: 0,
    });
    transferPresenceSignal.start(transferPresenceKinds.upload);
    setSendingState(true);
    try {
        const [uploaded, audioWaveform] = await Promise.all([
            uploadChatMedia(uploadFile, {
                chatId: currentChatId || '',
                csrfToken: getCsrfToken(),
                onRequestReady: (cancelUpload) => {
                    setActiveComposerUpload?.({
                        clientId,
                        progress: 0,
                        cancel: cancelUpload,
                    });
                },
                onProgress: (percent) => {
                    updatePendingFileUploadProgress?.(clientId, percent);
                    updateActiveComposerUploadProgress?.(clientId, percent);
                },
            }),
            audioWaveformPromise,
        ]);

        let payloadMime = String(uploaded?.mime || uploadFile.type || 'application/octet-stream').toLowerCase();
        if (sourceCategory === 'audio' && !payloadMime.startsWith('audio/')) {
            payloadMime = 'audio/webm';
        }

        const finalPayload = {
            __sunfile: true,
            name: uploaded?.name || uploadFile.name,
            mime: payloadMime,
            attach_mode: attachMode,
            data: uploaded?.url || '',
            caption: caption || '',
            size: uploaded?.size || uploadFile.size,
            uploading: false,
            upload_progress: 100,
            ...(Number.isFinite(audioDurationSeconds) && audioDurationSeconds > 0
                ? { duration_seconds: Math.max(1, Math.floor(audioDurationSeconds)) }
                : {}),
            ...(Array.isArray(audioWaveform) && audioWaveform.length
                ? { waveform: audioWaveform }
                : {}),
            ...(voiceTranscript ? { transcript: voiceTranscript } : {}),
            ...(visualMeta || {}),
        };
        const payload = JSON.stringify(finalPayload);
        commitPendingFileUpload?.(clientId, finalPayload);
        transferPresenceSignal.start(transferPresenceKinds.send);

        const encrypted = await encryptForCurrentChat(payload);
        const albumId = typeof options?.albumId === 'string' ? options.albumId : null;
        const sendPayload = {
            message: encrypted,
            chat_id: currentChatId,
            message_type: msgType,
            client_id: clientId,
            reply_to_id: snapReplyId,
            request_id: clientId,
            ...(albumId ? { album_id: albumId } : {}),
        };
        const emitted = emitSocket('send_message', sendPayload, { requireConnected: true });
        let isQueuedOffline = false;
        if (!emitted) {
            let queued = false;
            if (typeof enqueueOutbox === 'function') {
                try {
                    queued = await enqueueOutbox({
                        clientId,
                        eventName: 'send_message',
                        payload: sendPayload,
                    });
                } catch (_) {
                    queued = false;
                }
            }
            if (!queued) {
                failPendingMessage?.(clientId);
                throw new Error(OFFLINE_RETRY_MESSAGE);
            }
            failPendingMessage?.(clientId);
            showToast?.(OFFLINE_QUEUED_MESSAGE, 'warning');
            isQueuedOffline = true;
        }

        updateActiveContactLastMessage(
            payload,
            true,
            { pending: true, is_read: false, is_delivered: false },
            pendingTimestamp,
        );
        if (!isQueuedOffline) {
            schedulePendingTimeout(clientId);
        }
        window.setTimeout(() => {
            try { URL.revokeObjectURL(previewUrl); } catch (_) {}
        }, 30000);
    } catch (error) {
        failPendingMessage?.(clientId);
        if (isUploadAbortedError(error)) return;
        throw error;
    } finally {
        transferPresenceSignal.stopAll();
        clearActiveComposerUpload?.(clientId);
        setSendingState(false);
    }
}
