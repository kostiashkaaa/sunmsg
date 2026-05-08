import {
    detectFileCategory,
    getMessageTypeByCategory,
    optimizeFileForAttachMode,
    uploadChatMedia,
    probeAudioDurationSeconds,
    buildAudioWaveformPeaks,
    probeVisualMediaMetadata,
} from './chat-media-upload.js?v=2.1.0';

export async function sendFileMessageFlow({
    file,
    caption = '',
    options = {},
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
} = {}) {
    if (isChatBlocked()) {
        showToast(getBlockedNoticeText(currentBlockState), 'warning');
        return;
    }
    if (!file) return;
    if (typeof isRealtimeConnected === 'function' && !isRealtimeConnected()) {
        showToast('\u0421\u0432\u044F\u0437\u044C \u0441 \u0441\u0435\u0440\u0432\u0435\u0440\u043E\u043C \u0435\u0449\u0451 \u043D\u0435 \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u043B\u0430\u0441\u044C. \u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u0435 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0443 \u0447\u0435\u0440\u0435\u0437 \u043F\u0430\u0440\u0443 \u0441\u0435\u043A\u0443\u043D\u0434.', 'warning');
        return;
    }
    const attachMode = options?.attachMode === 'media' ? 'media' : 'file';
    const optimizationResult = await optimizeFileForAttachMode(file, { attachMode });
    const uploadFile = optimizationResult?.file || file;

    if (uploadFile.size > maxChatMediaSize) {
        throw new Error(`\u0424\u0430\u0439\u043B \u0441\u043B\u0438\u0448\u043A\u043E\u043C \u0431\u043E\u043B\u044C\u0448\u043E\u0439. \u041C\u0430\u043A\u0441\u0438\u043C\u0443\u043C ${Math.round(maxChatMediaSize / (1024 * 1024))} \u041C\u0411.`);
    }

    const sourceCategory = detectFileCategory(uploadFile);
    const forceDocumentVisual = attachMode === 'file'
        && (sourceCategory === 'image' || sourceCategory === 'video');
    const category = forceDocumentVisual ? 'file' : sourceCategory;
    const msgType = getMessageTypeByCategory(category);
    const providedAudioDuration = Number(options?.audioDurationSeconds);
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
    const clientId = crypto.randomUUID();
    const pendingTimestamp = new Date().toISOString();
    const {
        replyToId: snapReplyId,
        replyToText: snapReplyText,
        replyToSender: snapReplySender,
    } = getReplyState();
    const optimisticMime = String(uploadFile?.type || '').toLowerCase()
        || (sourceCategory === 'audio' ? 'audio/webm' : 'application/octet-stream');
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
        replyToId: snapReplyId,
        replyToText: snapReplyText,
        replyToSender: snapReplySender,
        reactions: [],
    }, { renderOptions: { force: true, scrollToBottom: true } });
    setKeepChatPinnedToBottom(true);
    updateActiveContactLastMessage(
        optimisticPayloadText,
        true,
        { pending: true, is_read: false, is_delivered: false },
        pendingTimestamp,
    );

    setSendingState(true);
    try {
        const [uploaded, audioWaveform] = await Promise.all([
            uploadChatMedia(uploadFile, {
                chatId: currentChatId || '',
                csrfToken: getCsrfToken(),
                onProgress: (percent) => {
                    updatePendingFileUploadProgress?.(clientId, percent);
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
            ...(visualMeta || {}),
        };
        const payload = JSON.stringify(finalPayload);
        commitPendingFileUpload?.(clientId, finalPayload);

        const encrypted = await encryptForCurrentChat(payload);
        const emitted = emitSocket('send_message', {
            message: encrypted,
            chat_id: currentChatId,
            message_type: msgType,
            client_id: clientId,
            reply_to_id: snapReplyId,
        }, { requireConnected: true });
        if (!emitted) {
            failPendingMessage?.(clientId);
            throw new Error('\u0421\u0432\u044F\u0437\u044C \u0441 \u0441\u0435\u0440\u0432\u0435\u0440\u043E\u043C \u0435\u0449\u0451 \u043D\u0435 \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u043B\u0430\u0441\u044C. \u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u0435 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0443 \u0447\u0435\u0440\u0435\u0437 \u043F\u0430\u0440\u0443 \u0441\u0435\u043A\u0443\u043D\u0434.');
        }

        updateActiveContactLastMessage(
            payload,
            true,
            { pending: true, is_read: false, is_delivered: false },
            pendingTimestamp,
        );
        schedulePendingTimeout(clientId);
        window.setTimeout(() => {
            try { URL.revokeObjectURL(previewUrl); } catch (_) {}
        }, 30000);
    } catch (error) {
        failPendingMessage?.(clientId);
        throw error;
    } finally {
        setSendingState(false);
    }
}
