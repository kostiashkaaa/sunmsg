import { runMessageStateMotion } from './message-action-motion.js';
import { isLikelyVoiceAudioPayload } from './message-rendering.js';
import { withStableChatScroll } from './chat-scroll-stability.js';

export function createChatMessageMutations({
    documentRef,
    windowRef,
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
    getCurrentChatId,
    getChatState,
    updateActiveContactLastMessage,
    findMessageIndex,
    scheduleForcedCurrentChatRerender,
    cancelPendingTimeout,
    parseSunFilePayload,
    resolvePendingMessageByClientId,
    applyTickToElement,
}) {
    const doc = documentRef || document;
    const win = windowRef || window;

    function updateMessageContent(msgDiv, plainText, isRedecrypt = false) {
        if (!msgDiv) return;
        return withStableChatScroll(msgDiv, () => updateMessageContentUnstable(msgDiv, plainText, isRedecrypt));
    }

    function updateMessageContentUnstable(msgDiv, plainText, isRedecrypt = false) {
        if (!msgDiv) return;

        const filePayload = typeof parseSunFilePayload === 'function'
            ? parseSunFilePayload(plainText)
            : null;

        if (filePayload) {
            const bubbleEl = msgDiv.querySelector('.bubble');
            const imageEl = msgDiv.querySelector('.file-msg-img');
            const videoEl = msgDiv.querySelector('.file-msg-video-preview');
            const audioEl = msgDiv.querySelector('.file-msg-audio-el');
            const fileLinkEl = msgDiv.querySelector('.file-msg-link');
            const mediaTrigger = msgDiv.querySelector('.file-msg-media-trigger');
            const mediaWrap = msgDiv.querySelector('.image-wrapper, .video-preview');
            const rawIsImageFile = !!(filePayload.mime && filePayload.mime.startsWith('image/'));
            const rawIsVideoFile = !!(filePayload.mime && filePayload.mime.startsWith('video/'));
            const isAudioFile = !!(filePayload.mime && filePayload.mime.startsWith('audio/'));
            const attachMode = filePayload.attach_mode === 'file' ? 'file' : 'media';
            const isDocumentVisual = attachMode === 'file' && (rawIsImageFile || rawIsVideoFile);
            const isImageFile = rawIsImageFile && !isDocumentVisual;
            const isVideoFile = rawIsVideoFile && !isDocumentVisual;

            // Keep data-is-* attrs in sync so the edit / context-menu logic stays correct
            const isVoiceFile = isAudioFile && isLikelyVoiceAudioPayload(filePayload);
            const isVisualMedia = (isImageFile || isVideoFile);
            msgDiv.setAttribute('data-is-sunfile', '1');
            msgDiv.setAttribute('data-is-voice', isVoiceFile ? '1' : '0');
            msgDiv.setAttribute('data-is-media', isVisualMedia ? '1' : '0');
            const placeReactionsOutside = true;
            const ratioWidth = Number(filePayload.preview_width);
            const ratioHeight = Number(filePayload.preview_height);
            const ratioValue = Number(filePayload.preview_aspect_ratio);
            msgDiv.classList.toggle('message-reactions-outside', placeReactionsOutside);

            if (bubbleEl) {
                bubbleEl.classList.toggle('bubble--image', isImageFile);
                bubbleEl.classList.toggle('bubble--image-has-caption', isImageFile && !!filePayload.caption);
                bubbleEl.classList.toggle('bubble--video', isVideoFile);
                bubbleEl.classList.toggle('bubble--video-has-caption', isVideoFile && !!filePayload.caption);
                bubbleEl.classList.toggle('bubble--audio', isAudioFile);
                bubbleEl.classList.toggle('bubble--audio-has-caption', isAudioFile && !!filePayload.caption);
                bubbleEl.classList.toggle('bubble--file', !isImageFile && !isVideoFile && !isAudioFile);
            }

            if (mediaWrap) {
                let aspectRatio = ratioValue;
                if (Number.isFinite(ratioWidth) && ratioWidth > 0 && Number.isFinite(ratioHeight) && ratioHeight > 0) {
                    aspectRatio = ratioWidth / ratioHeight;
                }
                if (Number.isFinite(aspectRatio) && aspectRatio > 0) {
                    const safeAspectRatio = String(Math.max(0.46, Math.min(1.91, aspectRatio)));
                    mediaWrap.style.setProperty('--media-aspect-ratio', safeAspectRatio);
                    bubbleEl?.style.setProperty('--media-aspect-ratio', safeAspectRatio);
                }
            }

            if (imageEl && isImageFile) {
                const imageSrc = sanitizeFileUri(filePayload.data, { imageOnlyData: true });
                if (imageSrc) {
                    imageEl.setAttribute('data-src', imageSrc);
                    mediaTrigger?.setAttribute('data-media-src', imageSrc);
                }
                const currentImageSrc = String(imageEl.getAttribute('src') || '').trim();
                if (imageSrc && currentImageSrc && currentImageSrc !== imageSrc) {
                    imageEl.removeAttribute('data-loaded');
                    mediaWrap?.classList.remove('is-loaded');
                    imageEl.removeAttribute('src');
                }
                const bgLayer = msgDiv.querySelector('.background-layer');
                if (bgLayer) {
                    bgLayer.style.removeProperty('background-image');
                }
            }

            if (mediaTrigger) {
                mediaTrigger.setAttribute('data-caption', filePayload.caption || '');
            }

            if (videoEl && isVideoFile) {
                const videoSrc = sanitizeFileUri(filePayload.data, { imageOnlyData: false });
                if (videoSrc) {
                    videoEl.setAttribute('data-src', videoSrc);
                    mediaTrigger?.setAttribute('data-media-src', videoSrc);
                    const currentVideoSrc = String(videoEl.getAttribute('src') || '').trim();
                    if (currentVideoSrc && currentVideoSrc !== videoSrc) {
                        videoEl.removeAttribute('data-loaded');
                        mediaWrap?.classList.remove('is-loaded');
                        videoEl.setAttribute('src', videoSrc);
                    }
                }
            }

            if (audioEl && isAudioFile) {
                const audioPlayerEl = msgDiv.querySelector('.file-msg-audio-player');
                const waveformSource = hasProvidedWaveformPayload(filePayload.waveform) ? 'provided' : 'fallback';
                if (audioPlayerEl) {
                    audioPlayerEl.dataset.waveformSource = waveformSource;
                    if (waveformSource !== 'generated') {
                        delete audioPlayerEl.dataset.waveformGeneratedSrc;
                    }
                }
                const audioSrc = sanitizeFileUri(filePayload.data, { imageOnlyData: false });
                if (audioSrc) {
                    audioEl.setAttribute('data-src', audioSrc);
                    const currentAudioSrc = String(audioEl.getAttribute('src') || '').trim();
                    if (currentAudioSrc && currentAudioSrc !== audioSrc) {
                        audioEl.setAttribute('src', audioSrc);
                        if (audioPlayerEl) {
                            delete audioPlayerEl.dataset.waveformGeneratedSrc;
                            if (waveformSource === 'fallback') {
                                audioPlayerEl.dataset.waveformSource = 'fallback';
                            }
                        }
                    }
                }
                const rawDuration = Number(filePayload.duration_seconds);
                if (Number.isFinite(rawDuration) && rawDuration > 0) {
                    audioEl.dataset.durationSeconds = String(Math.max(1, Math.floor(rawDuration)));
                    const durationLabel = msgDiv.querySelector('.audio-message-duration');
                    if (durationLabel) {
                        durationLabel.dataset.audioDuration = audioEl.dataset.durationSeconds;
                        durationLabel.textContent = formatAudioPlayerTime(Number(audioEl.dataset.durationSeconds));
                    }
                }
                win._onAudioPlayerMeta?.(audioEl);
                win._onAudioPlayerState?.(audioEl);
            }

            registerMediaElementsForLazyHydration(msgDiv);

            if (fileLinkEl && !isImageFile && !isVideoFile && !isAudioFile) {
                const fileSrc = sanitizeFileUri(filePayload.data, { imageOnlyData: false });
                if (fileSrc) {
                    fileLinkEl.setAttribute('href', fileSrc);
                }
                const thumbImgEl = fileLinkEl.querySelector('.file-card-thumb-image');
                if (thumbImgEl && isDocumentVisual && rawIsImageFile) {
                    const thumbSrc = sanitizeFileUri(filePayload.data, { imageOnlyData: true });
                    if (thumbSrc) {
                        thumbImgEl.setAttribute('data-src', thumbSrc);
                        const currentThumbSrc = String(thumbImgEl.getAttribute('src') || '').trim();
                        if (thumbSrc.includes('sun_media_e2ee=')) {
                            if (!currentThumbSrc || currentThumbSrc.includes('sun_media_e2ee=')) {
                                thumbImgEl.removeAttribute('src');
                            }
                        } else if (currentThumbSrc !== thumbSrc) {
                            thumbImgEl.setAttribute('src', thumbSrc);
                        }
                    }
                }
                const thumbVideoEl = fileLinkEl.querySelector('.file-card-thumb-video');
                if (thumbVideoEl && isDocumentVisual && rawIsVideoFile) {
                    if (fileSrc) {
                        thumbVideoEl.setAttribute('data-src', fileSrc);
                        const currentThumbSrc = String(thumbVideoEl.getAttribute('src') || '').trim();
                        if (fileSrc.includes('sun_media_e2ee=')) {
                            if (!currentThumbSrc || currentThumbSrc.includes('sun_media_e2ee=')) {
                                thumbVideoEl.removeAttribute('src');
                            }
                        } else if (currentThumbSrc !== fileSrc) {
                            thumbVideoEl.setAttribute('src', fileSrc);
                        }
                    }
                }
                win._hydrateMediaPreviewThumbs?.(fileLinkEl);
                if (filePayload.name) {
                    fileLinkEl.setAttribute('download', String(filePayload.name));
                    const nameEl = fileLinkEl.querySelector('.file-info-name');
                    if (nameEl) {
                        nameEl.textContent = String(filePayload.name);
                    }
                }
                const sizeEl = fileLinkEl.querySelector('.file-info-size');
                const sizeValue = Number(filePayload.size);
                if (sizeEl && Number.isFinite(sizeValue) && sizeValue > 0) {
                    sizeEl.textContent = sizeValue < 1048576
                        ? `${(sizeValue / 1024).toFixed(1)} KB`
                        : `${(sizeValue / 1048576).toFixed(1)} MB`;
                }
            }

            syncPendingUploadIndicators(msgDiv, filePayload);

            const legacyVideoCaption = msgDiv.querySelector('.video-preview-caption');
            if (legacyVideoCaption) legacyVideoCaption.remove();

            let captionEl = msgDiv.querySelector('.file-caption');
            if (filePayload.caption) {
                if (captionEl) {
                    captionEl.textContent = filePayload.caption;
                } else {
                    captionEl = doc.createElement('div');
                    captionEl.className = 'file-caption';
                    captionEl.textContent = filePayload.caption;
                }
                if (bubbleEl) {
                    const audioBodyEl = isAudioFile
                        ? bubbleEl.querySelector(':scope > .audio-message-body')
                        : null;
                    const captionContainer = audioBodyEl || bubbleEl;
                    const layoutAnchor = audioBodyEl
                        ? audioBodyEl.querySelector(':scope > .msg-meta, :scope > .message-meta')
                        : bubbleEl.querySelector(':scope > .message-footer, :scope > .msg-meta, :scope > .message-meta');
                    if (captionEl.parentElement !== captionContainer) {
                        captionEl.remove();
                    }
                    if (layoutAnchor) {
                        captionContainer.insertBefore(captionEl, layoutAnchor);
                    } else if (captionEl.parentElement !== captionContainer) {
                        captionContainer.append(captionEl);
                    }
                }
            } else if (captionEl) {
                captionEl.remove();
            }

            const stackEl = msgDiv.querySelector('.message-stack');
            if (stackEl && bubbleEl) {
                const targetContainer = stackEl;
                let keptRow = null;
                let rowToMove = null;
                const rows = Array.from(stackEl.querySelectorAll('.message-reactions'));
                rows.forEach((row) => {
                    const isInTarget = row.parentElement === targetContainer;
                    if (isInTarget && !keptRow) {
                        keptRow = row;
                        return;
                    }
                    if (!rowToMove) {
                        rowToMove = row;
                        return;
                    }
                    row.remove();
                });
                if (!keptRow && rowToMove) {
                    rowToMove.remove();
                    targetContainer.append(rowToMove);
                }
            }

            const bubbleBody = msgDiv.querySelector('.bubble');
            if (bubbleBody) applyEmojiGraphics(bubbleBody);
            msgDiv.setAttribute('data-message-content', plainText);
        } else {
            msgDiv.classList.add('message-reactions-outside');
            const bubbleText = msgDiv.querySelector('.message-text');
            if (bubbleText) {
                renderMessageTextContent(bubbleText, plainText);
                applyEmojiGraphics(bubbleText);
            }
            renderMessageLinkPreview(msgDiv, { message: plainText });
            msgDiv.setAttribute('data-message-content', plainText);
        }

        if (!isRedecrypt && !msgDiv.querySelector('.msg-edited')) {
            const meta = msgDiv.querySelector('.msg-meta');
            if (meta) {
                const edited = doc.createElement('span');
                edited.className = 'msg-edited';
                edited.textContent = '(\u0438\u0437\u043c\u0435\u043d\u0435\u043d\u043e)';
                const timeEl = meta.querySelector('.msg-time');
                if (timeEl) {
                    timeEl.before(edited);
                } else {
                    meta.prepend(edited);
                }
            }
        }

        syncMessageBubbleLayoutClasses(msgDiv);
        refreshMessageHeightCache(msgDiv);
        if (!isRedecrypt) {
            runMessageStateMotion(msgDiv, 'edit-applied');
        }

        if (msgDiv.classList.contains('self')) {
            const state = getCurrentChatId() ? getChatState(getCurrentChatId()) : null;
            const lastMessage = state?.messages?.[state.messages.length - 1];
            if (lastMessage && Number(lastMessage.id) === Number(msgDiv.getAttribute('data-msg-id'))) {
                updateActiveContactLastMessage(plainText);
            }
        }
    }

    function applyEditedMessageLocally(msgId, plainText) {
        const currentChatId = getCurrentChatId();
        const state = getChatState(currentChatId);
        const index = findMessageIndex(state, (msg) => Number(msg.id) === Number(msgId));
        if (index >= 0) {
            state.messages[index] = {
                ...state.messages[index],
                message: plainText,
                is_edited: true,
            };
        }
        const msgIdToken = String(msgId ?? '');
        const msgDiv = msgIdToken
            ? doc.querySelector(`.message[data-msg-id="${CSS.escape(msgIdToken)}"]`)
            : null;
        if (msgDiv) {
            updateMessageContent(msgDiv, plainText);
            return;
        }
        scheduleForcedCurrentChatRerender();
    }

    function failPendingMessage(clientId) {
        if (!clientId) return;

        cancelPendingTimeout(clientId);
        let failedFilePayload = null;
        let failedMessageText = '';
        const resolved = resolvePendingMessageByClientId(clientId);
        if (resolved) {
            failedFilePayload = parseSunFilePayload(resolved.message.message);
            if (failedFilePayload?.uploading) {
                failedFilePayload = {
                    ...failedFilePayload,
                    uploading: false,
                };
                failedMessageText = JSON.stringify(failedFilePayload);
            } else {
                failedFilePayload = null;
            }
        }

        const nextMessage = resolved
            ? {
                ...resolved.message,
                ...(failedMessageText ? { message: failedMessageText } : {}),
                pending: false,
                failed: true,
            }
            : null;

        if (resolved && nextMessage) {
            resolved.state.messages[resolved.index] = nextMessage;
        }

        const selector = `.message.self[data-client-id="${CSS.escape(clientId)}"]`;
        const el = resolved?.element || doc.querySelector(selector);
        if (!el) return;

        if (failedFilePayload) {
            syncPendingUploadIndicators(el, failedFilePayload);
            if (failedMessageText) {
                el.setAttribute('data-message-content', failedMessageText);
            }
        }

        el.removeAttribute('data-pending');
        const tick = el.querySelector('.msg-tick');
        if (tick) {
            applyTickToElement(tick, nextMessage || { failed: true, pending: false });
        }
    }

    return {
        updateMessageContent,
        applyEditedMessageLocally,
        failPendingMessage,
    };
}
