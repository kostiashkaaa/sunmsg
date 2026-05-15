export function formatAudioPlayerTime(totalSeconds) {
    const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : 0;
    const mins = Math.floor(safe / 60);
    const secs = Math.floor(safe % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
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

export function hasProvidedWaveformPayload(rawWaveform) {
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

export function initChatMediaRuntime(deps = {}) {
    const {
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
        getCurrentChatId,
        getKeepChatPinnedToBottom,
        openChatByIdWhenReady,
        focusMessageById,
    } = deps;

    const getCurrentChatIdSafe = typeof getCurrentChatId === 'function'
        ? getCurrentChatId
        : () => null;
    const getKeepChatPinnedToBottomSafe = typeof getKeepChatPinnedToBottom === 'function'
        ? getKeepChatPinnedToBottom
        : () => false;
    const openChatByIdWhenReadySafe = typeof openChatByIdWhenReady === 'function'
        ? openChatByIdWhenReady
        : null;
    const focusMessageByIdSafe = typeof focusMessageById === 'function'
        ? focusMessageById
        : null;

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
            const ratio = String(Math.max(0.75, Math.min(1.91, videoWidth / videoHeight)));
            preview.style.setProperty('--media-aspect-ratio', ratio);
            preview.closest('.bubble')?.style.setProperty('--media-aspect-ratio', ratio);
            persistPendingMediaDimensions(videoEl.closest('.message'), videoWidth, videoHeight);
        }
        videoEl.currentTime = 0;
        videoEl.pause();
    };

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

    function resolveAudioMessageChatId(sourceEl) {
        const messageEl = resolveAudioMessageElement(sourceEl);
        const raw = messageEl?.getAttribute('data-chat-id') || getCurrentChatIdSafe() || '';
        return String(raw).trim();
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
        const chatId = getCurrentChatIdSafe() || messageEl.getAttribute('data-chat-id') || '';
        const msgId = resolveAudioMessageId(sourceEl);
        if (!chatId || !Number.isFinite(msgId)) return;
        const sent = emitSocket(
            'voice_message_listened',
            {
                chat_id: chatId,
                msg_id: Number(msgId),
            },
            { requireConnected: false },
        );
        if (sent) {
            messageEl.setAttribute('data-audio-listen-sent', '1');
        }
    }

    const audioUiFrameByElement = new WeakMap();
    const audioUiPlaybackLoopByElement = new WeakMap();
    const audioWaveformCacheBySource = new Map();
    const audioWaveformJobByPlayer = new WeakMap();
    const AUDIO_PLAYBACK_RATES = Object.freeze([1, 1.25, 1.5, 2]);
    const AUDIO_PLAYBACK_RATE_STORAGE_KEY = 'sun_audio_playback_rate';
    const AUDIO_VOLUME_STORAGE_KEY = 'sun_audio_volume';
    const AUDIO_REPEAT_STORAGE_KEY = 'sun_audio_repeat_enabled';
    const AUDIO_WAVEFORM_BARS_COUNT = 48;
    const VOICE_TRANSCRIPT_SHOW_LABEL = '\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u0442\u0435\u043A\u0441\u0442 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u043E\u0433\u043E \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F';
    const VOICE_TRANSCRIPT_HIDE_LABEL = '\u0421\u043A\u0440\u044B\u0442\u044C \u0442\u0435\u043A\u0441\u0442 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u043E\u0433\u043E \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F';
    const VOICE_TRANSCRIPT_SHOW_TITLE = '\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u0442\u0435\u043A\u0441\u0442';
    const VOICE_TRANSCRIPT_HIDE_TITLE = '\u0421\u043A\u0440\u044B\u0442\u044C \u0442\u0435\u043A\u0441\u0442';
    let activeVoicePlaybackAudioEl = null;
    let activeVoicePlaybackMeta = null;
    let voicePlaybackParkingHost = null;
    let voicePlaybackJumpPromise = null;
    let isAudioRepeatEnabled = false;

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
        // Не позволяем «случайному» 0 (слайдер мог уйти в 0 от тапа промазав)
        // тихо отключать звук во всех будущих сессиях. Минимум 0.05 — слышно.
        if (numeric < 0.05) return 1;
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

    function normalizeAudioRepeatEnabled(value) {
        if (value === true || value === false) return value;
        const normalized = String(value || '').trim().toLowerCase();
        return normalized === '1' || normalized === 'true';
    }

    function getPreferredAudioRepeatEnabled() {
        try {
            return normalizeAudioRepeatEnabled(window.localStorage?.getItem(AUDIO_REPEAT_STORAGE_KEY));
        } catch (_) {
            return false;
        }
    }

    function setPreferredAudioRepeatEnabled(value) {
        const normalized = Boolean(value);
        try {
            window.localStorage?.setItem(AUDIO_REPEAT_STORAGE_KEY, normalized ? '1' : '0');
        } catch (_) {}
        return normalized;
    }

    function syncVoicePlaybackRepeatButton() {
        if (!voicePlaybackRepeatBtn) return;
        const isEnabled = isAudioRepeatEnabled;
        voicePlaybackRepeatBtn.classList.toggle('is-active', isEnabled);
        voicePlaybackRepeatBtn.setAttribute('aria-pressed', isEnabled ? 'true' : 'false');
        voicePlaybackRepeatBtn.setAttribute('aria-label', isEnabled ? 'Повтор включен. Выключить' : 'Повтор выключен. Включить');
        voicePlaybackRepeatBtn.setAttribute('title', isEnabled ? 'Повтор включен' : 'Повтор выключен');
    }

    isAudioRepeatEnabled = getPreferredAudioRepeatEnabled();

    function resolveVoicePlaybackTimeLabelFromDom(audioEl) {
        const messageEl = resolveAudioMessageElement(audioEl);
        const timeEl = messageEl?.querySelector('.msg-time');
        const title = String(timeEl?.getAttribute('title') || '').trim();
        const raw = String(timeEl?.textContent || '').trim();
        return title || raw || '—';
    }

    function resolveVoicePlaybackSenderLabelFromDom(audioEl) {
        const messageEl = resolveAudioMessageElement(audioEl);
        if (!messageEl) return '—';
        const senderLabel = String(messageEl.querySelector('.message-sender-label')?.textContent || '').trim();
        if (senderLabel) return senderLabel;
        if (messageEl.classList.contains('self')) return 'Вы';
        const partner = String(chatTitle?.textContent || '').trim();
        return partner || 'Собеседник';
    }

    function captureVoicePlaybackMeta(audioEl) {
        return {
            chatId: resolveAudioMessageChatId(audioEl),
            messageId: resolveAudioMessageId(audioEl),
            time: resolveVoicePlaybackTimeLabelFromDom(audioEl),
            sender: resolveVoicePlaybackSenderLabelFromDom(audioEl),
        };
    }

    function resolveVoicePlaybackTimeLabel(audioEl) {
        if (audioEl === activeVoicePlaybackAudioEl && activeVoicePlaybackMeta?.time) {
            return activeVoicePlaybackMeta.time;
        }
        return resolveVoicePlaybackTimeLabelFromDom(audioEl);
    }

    function resolveVoicePlaybackSenderLabel(audioEl) {
        if (audioEl === activeVoicePlaybackAudioEl && activeVoicePlaybackMeta?.sender) {
            return activeVoicePlaybackMeta.sender;
        }
        return resolveVoicePlaybackSenderLabelFromDom(audioEl);
    }

    function resolveActiveVoicePlaybackAudio() {
        if (!activeVoicePlaybackAudioEl) return null;
        return activeVoicePlaybackAudioEl;
    }

    function getVoicePlaybackParkingHost() {
        if (voicePlaybackParkingHost?.isConnected) return voicePlaybackParkingHost;
        const host = document.createElement('div');
        host.id = 'voicePlaybackParkingHost';
        host.setAttribute('aria-hidden', 'true');
        host.style.position = 'absolute';
        host.style.width = '0';
        host.style.height = '0';
        host.style.overflow = 'hidden';
        host.style.opacity = '0';
        host.style.pointerEvents = 'none';
        (chatArea || document.body || document.documentElement)?.appendChild(host);
        voicePlaybackParkingHost = host;
        return voicePlaybackParkingHost;
    }

    function isParkedVoicePlaybackPlayer(audioEl) {
        const player = audioEl?.closest?.('.file-msg-audio-player');
        return Boolean(player && voicePlaybackParkingHost?.contains(player));
    }

    function removeParkedVoicePlaybackPlayer(audioEl) {
        const player = audioEl?.closest?.('.file-msg-audio-player');
        if (player && voicePlaybackParkingHost?.contains(player)) {
            player.remove();
        }
    }

    function parkActiveVoicePlaybackPlayerBeforeChatReplace() {
        const audio = resolveActiveVoicePlaybackAudio();
        if (!audio || audio.ended) return;
        const player = audio.closest?.('.file-msg-audio-player');
        if (!player || !chatMessages?.contains(player)) return;
        const host = getVoicePlaybackParkingHost();
        if (!host) return;
        host.appendChild(player);
        syncVoicePlaybackBar(audio);
    }

    function restoreActiveVoicePlaybackPlayerIntoMessage() {
        const audio = resolveActiveVoicePlaybackAudio();
        const messageId = activeVoicePlaybackMeta?.messageId;
        const chatId = activeVoicePlaybackMeta?.chatId;
        if (!audio || !messageId || !chatId || !chatMessages) return false;
        if (String(chatId) !== String(getCurrentChatIdSafe() || '')) return false;
        if (!isParkedVoicePlaybackPlayer(audio)) return false;

        const selectorId = String(messageId);
        const escaped = window.CSS?.escape ? window.CSS.escape(selectorId) : selectorId.replace(/["\\]/g, '\\$&');
        const messageEl = chatMessages.querySelector(`.message[data-msg-id="${escaped}"]`);
        const activePlayer = audio.closest?.('.file-msg-audio-player');
        const renderedPlayer = messageEl?.querySelector('.file-msg-audio-player');
        if (!messageEl || !activePlayer || !renderedPlayer || activePlayer === renderedPlayer) return false;

        renderedPlayer.replaceWith(activePlayer);
        syncAudioPlayerUi(audio);
        syncVoicePlaybackBar(audio);
        return true;
    }

    function patchChatMessagesReplaceChildrenForVoicePlayback() {
        if (!chatMessages || chatMessages.__sunVoicePlaybackReplaceChildrenPatched) return;
        const nativeReplaceChildren = chatMessages.replaceChildren.bind(chatMessages);
        Object.defineProperty(chatMessages, '__sunVoicePlaybackReplaceChildrenPatched', {
            value: true,
            configurable: true,
        });
        chatMessages.replaceChildren = (...nodes) => {
            parkActiveVoicePlaybackPlayerBeforeChatReplace();
            return nativeReplaceChildren(...nodes);
        };
    }

    patchChatMessagesReplaceChildrenForVoicePlayback();

    function setVoicePlaybackBarVisible(isVisible) {
        if (!voicePlaybackBar) return;
        const currentlyVisible = !voicePlaybackBar.classList.contains('voice-playback-bar--hidden');
        if (currentlyVisible === isVisible) return;
        // Сначала меняем visibility, чтобы offsetHeight корректно считался
        // (у скрытого через --hidden класса visibility:hidden и высота 0).
        voicePlaybackBar.classList.toggle('voice-playback-bar--hidden', !isVisible);
        voicePlaybackBar.setAttribute('aria-hidden', isVisible ? 'false' : 'true');
        if (chatArea) {
            // Читаем высоту уже видимого бара — иначе класс
            // chat-area--voice-playback-active не применится и шапка не сдвинется.
            const measuredHeight = isVisible ? Math.ceil(voicePlaybackBar.offsetHeight || 0) : 0;
            // На случай если высота ещё 0 (первый кадр) — фолбэк ~64px,
            // потом скорректируем после следующего frame.
            const nextOffset = isVisible ? (measuredHeight || 64) : 0;
            chatArea.style.setProperty('--voice-playback-offset', `${nextOffset}px`);
            chatArea.classList.toggle('chat-area--voice-playback-active', isVisible);
            if (isVisible) {
                requestAnimationFrame(() => {
                    const real = Math.ceil(voicePlaybackBar.offsetHeight || 0);
                    if (real > 0 && real !== nextOffset) {
                        chatArea.style.setProperty('--voice-playback-offset', `${real}px`);
                    }
                });
            }
        }
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
        removeParkedVoicePlaybackPlayer(audio);
        activeVoicePlaybackAudioEl = null;
        activeVoicePlaybackMeta = null;
        syncVoicePlaybackJumpState();
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
        if (!audioEl) return;
        const previousMeta = audioEl === activeVoicePlaybackAudioEl ? activeVoicePlaybackMeta : null;
        activeVoicePlaybackAudioEl = audioEl;
        activeVoicePlaybackMeta = previousMeta || captureVoicePlaybackMeta(audioEl);
        applyPreferredVolumeToAudio(audioEl);
        setVoicePlaybackBarVisible(true);
    }

    function syncVoicePlaybackJumpState() {
        if (!voicePlaybackBar) return;
        const canJump = Boolean(
            activeVoicePlaybackMeta?.chatId
            && activeVoicePlaybackMeta?.messageId
            && openChatByIdWhenReadySafe
            && focusMessageByIdSafe
        );
        voicePlaybackBar.classList.toggle('voice-playback-bar--jumpable', canJump);
        if (canJump) {
            voicePlaybackBar.dataset.canJump = '1';
            voicePlaybackBar.dataset.chatId = String(activeVoicePlaybackMeta.chatId);
            voicePlaybackBar.dataset.msgId = String(activeVoicePlaybackMeta.messageId);
            voicePlaybackBar.setAttribute('title', 'Открыть сообщение');
        } else {
            voicePlaybackBar.classList.remove('voice-playback-bar--jumpable');
            delete voicePlaybackBar.dataset.canJump;
            delete voicePlaybackBar.dataset.chatId;
            delete voicePlaybackBar.dataset.msgId;
            voicePlaybackBar.removeAttribute('title');
        }
    }

    function syncVoicePlaybackBar(audioEl = null) {
        if (!voicePlaybackBar || !voicePlaybackProgress || !voicePlaybackPlayBtn || !voicePlaybackDetails || !voicePlaybackSender || !voicePlaybackSpeedBtn || !voicePlaybackVolume) return;
        const activeAudio = audioEl || resolveActiveVoicePlaybackAudio();
        if (!activeAudio) {
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
        syncVoicePlaybackRepeatButton();
        voicePlaybackSpeedBtn.setAttribute('aria-label', `Скорость ${formatAudioPlaybackRateLabel(preferredRate)}. Изменить`);
        if (voicePlaybackVolume.dataset.seeking !== '1') {
            voicePlaybackVolume.value = String(Math.round((activeAudio.volume ?? 1) * 100));
        }
        syncVoicePlaybackJumpState();
    }

    function buildAudioWaveBarsHtml(values) {
        return values
            .map((height, index) => {
                const safeHeight = Math.max(8, Math.min(100, Math.round(Number(height) || 50)));
                return `<span class="audio-wave-bar audio-wave-bar--h${safeHeight}" data-wave-index="${index}"></span>`;
            })
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
            let energy = 0;
            let samples = 0;
            for (let i = start; i < end; i += stride) {
                const sample = channelData[i] || 0;
                energy += sample * sample;
                samples += 1;
            }
            const rms = samples > 0 ? Math.sqrt(energy / samples) : 0;
            raw[barIndex] = rms;
            if (rms > globalPeak) globalPeak = rms;
        }

        if (!(globalPeak > 0.000001)) return null;
        return raw.map((value) => Math.max(8, Math.min(100, Math.round((value / globalPeak) * 100))));
    }


    async function decodeAudioWaveformBySource(sourceUrl, barsCount = AUDIO_WAVEFORM_BARS_COUNT) {
        const src = String(sourceUrl || '').trim();
        if (!src) return null;
        // blob: URLs are local object URLs; fetching them is blocked by strict connect-src CSP.
        if (src.startsWith('blob:')) return null;
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
        const speedButton = player?.querySelector('.audio-player-speed:not(.audio-player-transcript-toggle)');
        const progress = player?.querySelector('.audio-player-progress');
        const wave = player?.querySelector('.audio-player-wave');
        const durationLabel = bubble?.querySelector('.audio-message-duration');
        return { player, audio, toggle, icon, speedButton, progress, wave, durationLabel };
    }

    function syncVoiceTranscriptToggle(toggleBtn, expanded) {
        if (!toggleBtn) return;
        toggleBtn.classList.toggle('is-active', expanded);
        toggleBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        toggleBtn.setAttribute('aria-label', expanded ? VOICE_TRANSCRIPT_HIDE_LABEL : VOICE_TRANSCRIPT_SHOW_LABEL);
        toggleBtn.title = expanded ? VOICE_TRANSCRIPT_HIDE_TITLE : VOICE_TRANSCRIPT_SHOW_TITLE;
    }

    async function ensureGeneratedAudioWaveform(audioEl) {
        const { player, audio, wave } = resolveAudioPlayerElements(audioEl);
        if (!player || !audio || !wave) return;
        const waveformSource = String(player.dataset.waveformSource || '').trim();
        if (waveformSource !== 'fallback') return;

        const sourceUrl = String(audio.getAttribute('src') || audio.dataset.src || '').trim();
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
                // Сбрасываем базу интерполяции, чтобы прогресс не «дёрнулся» назад
                if (typeof captureAudioInterpolationBase === 'function') {
                    captureAudioInterpolationBase(audio);
                }
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
            const mode = (isSeeking || isPlaybackActive) ? 'current' : 'duration';
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
        const pendingId = audioUiPlaybackLoopByElement.get(audioEl);
        if (pendingId != null) {
            cancelAnimationFrame(pendingId);
            audioUiPlaybackLoopByElement.delete(audioEl);
        }
    }

    // Лёгкий тик для прогресса во время воспроизведения: пишем ТОЛЬКО
    // две CSS-переменные. Никаких setAttribute/classList/textContent.
    // Используем интерполяцию: audio.currentTime на iOS обновляется
    // ~4 раза в секунду, поэтому между его обновлениями экстраполируем
    // позицию по performance.now(). Так ползунок движется плавно на 60fps,
    // не дожидаясь следующего timeupdate.
    function resolveAudioDurationFor(audioEl) {
        const dur = Number(audioEl.duration);
        if (Number.isFinite(dur) && dur > 0) return dur;
        const fallback = Number(audioEl.dataset?.durationSeconds || 0);
        return Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
    }

    function nowMs() {
        return typeof performance !== 'undefined' ? performance.now() : Date.now();
    }

    function captureAudioInterpolationBase(audioEl) {
        const real = Number(audioEl.currentTime) || 0;
        audioEl._sunPlayBaseTime = real;
        audioEl._sunPlayBasePerf = nowMs();
        audioEl._sunPlayLastReal = real;
        audioEl._sunPlayLastDisplay = real;
    }

    function getInterpolatedAudioPercent(audioEl) {
        const duration = resolveAudioDurationFor(audioEl);
        if (duration <= 0) return 0;
        const realCurrent = Number(audioEl.currentTime) || 0;
        let baseCurrent = Number(audioEl._sunPlayBaseTime);
        let basePerf = Number(audioEl._sunPlayBasePerf);
        const lastReal = Number(audioEl._sunPlayLastReal);
        const lastDisplay = Number(audioEl._sunPlayLastDisplay);

        if (!Number.isFinite(baseCurrent) || !Number.isFinite(basePerf)) {
            captureAudioInterpolationBase(audioEl);
            return Math.max(0, Math.min(100, (realCurrent / duration) * 100));
        }

        if (audioEl.paused || audioEl.ended) {
            return Math.max(0, Math.min(100, (realCurrent / duration) * 100));
        }

        // Когда движок реально обновил currentTime — пересинхронизируем базу.
        // Чтобы ползунок никогда не прыгал назад, новая база = max(real, lastDisplay):
        // если наша экстраполяция уже опередила реальный currentTime, остаёмся
        // на этой позиции и ждём, пока движок догонит.
        if (Math.abs(realCurrent - lastReal) > 0.02) {
            audioEl._sunPlayLastReal = realCurrent;
            const safeBase = Math.max(realCurrent, Number.isFinite(lastDisplay) ? lastDisplay : 0);
            audioEl._sunPlayBaseTime = safeBase;
            audioEl._sunPlayBasePerf = nowMs();
            baseCurrent = safeBase;
            basePerf = audioEl._sunPlayBasePerf;
        }

        const rate = Number(audioEl.playbackRate) || 1;
        const elapsed = Math.max(0, (nowMs() - basePerf) / 1000) * rate;
        let displayCurrent = baseCurrent + elapsed;

        // Не уходим вперёд от реального currentTime больше чем на ~280 мс,
        // чтобы при следующем timeupdate визуального отката не было.
        const cap = realCurrent + 0.28 * rate;
        if (displayCurrent > cap) displayCurrent = cap;
        if (displayCurrent > duration) displayCurrent = duration;

        // Никогда не двигаемся назад относительно прошлого кадра.
        if (Number.isFinite(lastDisplay) && displayCurrent < lastDisplay) {
            displayCurrent = lastDisplay;
        }
        audioEl._sunPlayLastDisplay = displayCurrent;
        return Math.max(0, Math.min(100, (displayCurrent / duration) * 100));
    }

    function tickAudioProgressOnly(audioEl) {
        const player = audioEl.closest?.('.file-msg-audio-player');
        const wave = player?.querySelector('.audio-player-wave');
        const percent = getInterpolatedAudioPercent(audioEl);
        if (wave) {
            wave.style.setProperty('--audio-played-percent', String(percent));
        }
        if (resolveActiveVoicePlaybackAudio() === audioEl && voicePlaybackProgress) {
            const isSeeking = voicePlaybackProgress.dataset?.seeking === '1';
            if (!isSeeking) {
                voicePlaybackProgress.value = String(percent);
                voicePlaybackProgressFill?.style.setProperty('--voice-playback-progress', String(percent));
            }
        }
    }

    function startAudioPlayerUiLoop(audioEl) {
        if (!audioEl || (audioEl !== activeVoicePlaybackAudioEl && !audioEl.isConnected) || audioEl.paused || audioEl.ended) return;
        stopAudioPlayerUiLoop(audioEl);
        captureAudioInterpolationBase(audioEl);
        // 60fps. Reflow нет — только запись CSS-переменных.
        const tick = () => {
            if (!audioEl || (audioEl !== activeVoicePlaybackAudioEl && !audioEl.isConnected) || audioEl.paused || audioEl.ended) {
                stopAudioPlayerUiLoop(audioEl);
                syncAudioPlayerUi(audioEl);
                return;
            }
            tickAudioProgressOnly(audioEl);
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
        if (audioEl.ended) {
            audioEl.dataset.playRequested = '0';
        }
        if (!audioEl.paused && !audioEl.ended) {
            startAudioPlayerUiLoop(audioEl);
        } else {
            stopAudioPlayerUiLoop(audioEl);
        }
        scheduleAudioPlayerUiSync(audioEl);

        // Trigger autoplay/close logic on `ended` once.
        if (audioEl.ended && resolveActiveVoicePlaybackAudio() === audioEl) {
            if (isAudioRepeatEnabled) {
                const repeatToggle = audioEl.closest('.file-msg-audio-player')?.querySelector('.audio-player-toggle');
                if (repeatToggle) {
                    window._toggleAudioPlayer(repeatToggle);
                    return;
                }
            }
            const next = findAdjacentVoiceAudio(audioEl, 1);
            if (next) {
                // Авто-переход на следующее голосовое (Telegram-style).
                const nextToggle = next.closest('.file-msg-audio-player')?.querySelector('.audio-player-toggle');
                if (nextToggle) {
                    const messageEl = resolveAudioMessageElement(next);
                    try { messageEl?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); } catch (_) {}
                    window._toggleAudioPlayer(nextToggle);
                    return;
                }
            }
            // Соседнего голосового нет — закрываем плеер.
            clearActiveVoicePlaybackAudio();
            return;
        }
        if (resolveActiveVoicePlaybackAudio() === audioEl) {
            syncVoicePlaybackBar(audioEl);
        }
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
        const activeAudio = resolveActiveVoicePlaybackAudio();
        if (activeAudio && !activeAudio.isConnected) {
            activeAudio.playbackRate = nextRate;
            scheduleAudioPlayerUiSync(activeAudio);
        }
        if (audio) {
            syncAudioPlayerUi(audio);
        }
        syncVoicePlaybackBar();
    };

    let chatCenterNoticeTimer = null;
    function showChatCenterNotice(text) {
        const chatArea = document.getElementById('chatArea');
        if (!chatArea) return;
        let notice = chatArea.querySelector('.chat-center-notice');
        if (notice) {
            clearTimeout(chatCenterNoticeTimer);
            notice.remove();
        }
        notice = document.createElement('div');
        notice.className = 'chat-center-notice';
        notice.textContent = text;
        chatArea.appendChild(notice);
        requestAnimationFrame(() => notice.classList.add('chat-center-notice--visible'));
        chatCenterNoticeTimer = setTimeout(() => {
            notice.classList.remove('chat-center-notice--visible');
            notice.addEventListener('transitionend', () => notice.remove(), { once: true });
        }, 2500);
    }

    window._toggleVoiceTranscript = function(toggleBtn) {
        const player = toggleBtn?.closest?.('.file-msg-audio-player');
        const transcript = player?.querySelector('.voice-transcript');
        if (!toggleBtn) return;
        if (!transcript) {
            showChatCenterNotice('Не удалось расшифровать голосовое сообщение');
            return;
        }
        const nextExpanded = !transcript.classList.contains('is-expanded');
        transcript.classList.toggle('is-expanded', nextExpanded);
        transcript.hidden = false;
        transcript.setAttribute('aria-hidden', nextExpanded ? 'false' : 'true');
        syncVoiceTranscriptToggle(toggleBtn, nextExpanded);
    };

    window._toggleAudioPlayer = function(toggleBtn) {
        // \u0412\u0410\u0416\u041D\u041E: \u0442\u0435\u043B\u043E \u044D\u0442\u043E\u0439 \u0444\u0443\u043D\u043A\u0446\u0438\u0438 \u043E\u0441\u0442\u0430\u0451\u0442\u0441\u044F \u0441\u0438\u043D\u0445\u0440\u043E\u043D\u043D\u044B\u043C \u0434\u043E audio.play(),
        // \u043F\u043E\u0442\u043E\u043C\u0443 \u0447\u0442\u043E iOS Safari \u0442\u0440\u0435\u0431\u0443\u0435\u0442 \u0447\u0442\u043E\u0431\u044B play() \u0432\u044B\u0437\u044B\u0432\u0430\u043B\u0441\u044F \u043F\u0440\u044F\u043C\u043E \u0438\u0437 user gesture
        // (click). \u041B\u044E\u0431\u043E\u0439 await/Promise \u043B\u043E\u043C\u0430\u0435\u0442 \u00AB\u0436\u0435\u0441\u0442\u00BB \u2014 \u043F\u043E\u0432\u0442\u043E\u0440\u043D\u044B\u0439 play \u0437\u0432\u0443\u0447\u0438\u0442 \u0431\u0435\u0437 \u0437\u0432\u0443\u043A\u0430
        // \u0438\u043B\u0438 \u043E\u0442\u0431\u0438\u0432\u0430\u0435\u0442\u0441\u044F AbortError.
        const { audio } = resolveAudioPlayerElements(toggleBtn);
        if (!audio) return;

        if (audio.paused) {
            ensureMediaElementHydrated(audio, { force: true });
            if (!audio.getAttribute('src')) {
                showToast('\u0410\u0443\u0434\u0438\u043E \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E \u0434\u043B\u044F \u0432\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u0435\u0434\u0435\u043D\u0438\u044F.', 'warning');
                return;
            }
            void ensureGeneratedAudioWaveform(audio);

            // \u041E\u0441\u0442\u0430\u043D\u0430\u0432\u043B\u0438\u0432\u0430\u0435\u043C \u0432\u0441\u0435 \u043E\u0441\u0442\u0430\u043B\u044C\u043D\u044B\u0435 \u0430\u0443\u0434\u0438\u043E \u0441\u0438\u043D\u0445\u0440\u043E\u043D\u043D\u043E.
            const activeAudio = resolveActiveVoicePlaybackAudio();
            if (activeAudio && activeAudio !== audio) {
                activeAudio.dataset.playRequested = '0';
                try { activeAudio.pause(); } catch (_) {}
                stopAudioPlayerUiLoop(activeAudio);
                scheduleAudioPlayerUiSync(activeAudio);
                removeParkedVoicePlaybackPlayer(activeAudio);
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

            // \u0421\u0431\u0440\u0430\u0441\u044B\u0432\u0430\u0435\u043C \u043F\u043E\u0437\u0438\u0446\u0438\u044E, \u0435\u0441\u043B\u0438 \u0442\u0440\u0435\u043A \u0431\u044B\u043B \u0434\u043E\u0438\u0433\u0440\u0430\u043D. \u041D\u0430 iOS \u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u043E
            // \u0414\u041E play(), \u0438\u043D\u0430\u0447\u0435 \u044D\u043B\u0435\u043C\u0435\u043D\u0442 \u043E\u0441\u0442\u0430\u0451\u0442\u0441\u044F \u0432 \u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0438 \u00ABended\u00BB \u0438 play() \u043C\u043E\u043B\u0447\u0438\u0442.
            const dur = Number(audio.duration);
            const atEnd = audio.ended
                || (Number.isFinite(dur) && dur > 0 && audio.currentTime >= Math.max(0, dur - 0.05));
            if (atEnd) {
                try { audio.currentTime = 0; } catch (_) {}
            }

            // \u041F\u0440\u0438\u043D\u0443\u0434\u0438\u0442\u0435\u043B\u044C\u043D\u043E \u00AB\u0440\u0430\u0437\u043C\u0443\u0447\u0438\u0432\u0430\u0435\u043C\u00BB \u2014 \u043D\u0430 iOS audio.muted \u043C\u043E\u0433 \u0437\u0430\u0441\u0442\u0440\u044F\u0442\u044C true
            // \u043F\u043E\u0441\u043B\u0435 \u043F\u0435\u0440\u0435\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F \u0432\u043A\u043B\u0430\u0434\u043E\u043A/silent-\u0440\u0435\u0436\u0438\u043C\u0430.
            try { audio.muted = false; } catch (_) {}
            try { audio.volume = 1; } catch (_) {}

            audio.dataset.playRequested = '1';
            audio.playbackRate = getPreferredAudioPlaybackRate();
            setActiveVoicePlaybackAudio(audio);
            scheduleAudioPlayerUiSync(audio);

            // \u0421\u0438\u043D\u0445\u0440\u043E\u043D\u043D\u044B\u0439 \u0432\u044B\u0437\u043E\u0432 play() \u2014 \u043A\u0440\u0438\u0442\u0438\u0447\u043D\u043E \u0434\u043B\u044F iOS user-gesture \u043A\u043E\u043D\u0442\u0435\u043A\u0441\u0442\u0430.
            let playPromise;
            try {
                playPromise = audio.play();
            } catch (err) {
                audio.dataset.playRequested = '0';
                stopAudioPlayerUiLoop(audio);
                showToast('\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0432\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u0435\u0441\u0442\u0438 \u0430\u0443\u0434\u0438\u043E.', 'warning');
            }
            if (playPromise && typeof playPromise.then === 'function') {
                playPromise.catch((err) => {
                    // AbortError \u0432\u043E\u0437\u043D\u0438\u043A\u0430\u0435\u0442 \u043A\u043E\u0433\u0434\u0430 play() \u043F\u0440\u0435\u0440\u0432\u0430\u043D pause()/load().
                    // \u042D\u0442\u043E \u043D\u043E\u0440\u043C\u0430\u043B\u044C\u043D\u043E \u2014 \u041D\u0415 \u043F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0435\u043C \u0442\u043E\u0441\u0442.
                    if (err && (err.name === 'AbortError' || err.code === 20)) return;
                    audio.dataset.playRequested = '0';
                    stopAudioPlayerUiLoop(audio);
                    showToast('\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0432\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u0435\u0441\u0442\u0438 \u0430\u0443\u0434\u0438\u043E.', 'warning');
                });
            }
        } else {
            audio.dataset.playRequested = '0';
            try { audio.pause(); } catch (_) {}
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
        captureAudioInterpolationBase(audio);
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

    function jumpToAdjacentVoicePlayback(direction = 1) {
        const current = resolveActiveVoicePlaybackAudio();
        if (!current) return;
        const targetAudio = findAdjacentVoiceAudio(current, direction);
        if (!targetAudio) {
            // Нет соседнего голосового — на forward завершаем сессию,
            // на back просто перематываем текущее на начало.
            if (direction >= 0) {
                clearActiveVoicePlaybackAudio({ pause: true });
            } else {
                try { current.currentTime = 0; } catch (_) {}
                syncAudioPlayerUi(current);
                syncVoicePlaybackBar(current);
            }
            return;
        }
        // Останавливаем текущее и запускаем соседнее.
        try { current.pause(); } catch (_) {}
        current.dataset.playRequested = '0';
        const targetToggle = targetAudio.closest('.file-msg-audio-player')?.querySelector('.audio-player-toggle');
        if (!targetToggle) return;
        // Прокручиваем сообщение в зону видимости.
        const messageEl = resolveAudioMessageElement(targetAudio);
        try { messageEl?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); } catch (_) {}
        window._toggleAudioPlayer(targetToggle);
    }

    function waitForVoicePlaybackJumpRetry(ms = 160) {
        return new Promise((resolve) => {
            setTimeout(resolve, ms);
        });
    }

    async function jumpToActiveVoicePlaybackMessage() {
        if (voicePlaybackJumpPromise) return voicePlaybackJumpPromise;
        voicePlaybackJumpPromise = (async () => {
            const chatId = String(activeVoicePlaybackMeta?.chatId || '').trim();
            const messageId = activeVoicePlaybackMeta?.messageId;
            if (!chatId || !messageId || !focusMessageByIdSafe) return false;

            if (String(getCurrentChatIdSafe() || '') !== chatId) {
                if (!openChatByIdWhenReadySafe) return false;
                await openChatByIdWhenReadySafe(chatId);
            }

            for (let attempt = 0; attempt < 10; attempt += 1) {
                restoreActiveVoicePlaybackPlayerIntoMessage();
                const focused = await focusMessageByIdSafe(messageId, {
                    smooth: true,
                    align: 'center',
                });
                restoreActiveVoicePlaybackPlayerIntoMessage();
                if (focused) return true;
                await waitForVoicePlaybackJumpRetry();
            }

            showToast?.('Не удалось открыть голосовое сообщение.', 'warning');
            return false;
        })().finally(() => {
            voicePlaybackJumpPromise = null;
        });
        return voicePlaybackJumpPromise;
    }

    function isVoicePlaybackJumpIgnoredTarget(target) {
        if (!(target instanceof Element)) return true;
        return Boolean(target.closest(
            'button,input,select,textarea,a,label,[role="button"],.voice-playback-bar__progress-wrap',
        ));
    }

    if (voicePlaybackPlayBtn) {
        voicePlaybackPlayBtn.addEventListener('click', () => {
            const audio = resolveActiveVoicePlaybackAudio();
            if (!audio) return;
            const toggleBtn = audio.closest('.file-msg-audio-player')?.querySelector('.audio-player-toggle');
            window._toggleAudioPlayer(toggleBtn || audio);
        });
    }

    if (voicePlaybackBar) {
        voicePlaybackBar.addEventListener('click', (event) => {
            if (isVoicePlaybackJumpIgnoredTarget(event.target)) return;
            void jumpToActiveVoicePlaybackMessage();
        });
    }

    if (voicePlaybackBackBtn) {
        voicePlaybackBackBtn.addEventListener('click', () => jumpToAdjacentVoicePlayback(-1));
    }

    if (voicePlaybackForwardBtn) {
        voicePlaybackForwardBtn.addEventListener('click', () => jumpToAdjacentVoicePlayback(1));
    }

    if (voicePlaybackSpeedBtn) {
        voicePlaybackSpeedBtn.addEventListener('click', () => {
            window._cycleAudioPlaybackRate?.(null);
            syncVoicePlaybackBar();
        });
    }

    if (voicePlaybackRepeatBtn) {
        syncVoicePlaybackRepeatButton();
        voicePlaybackRepeatBtn.addEventListener('click', () => {
            isAudioRepeatEnabled = setPreferredAudioRepeatEnabled(!isAudioRepeatEnabled);
            syncVoicePlaybackRepeatButton();
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
                activeAudio.volume = normalized;
                syncVoicePlaybackBar(activeAudio);
            }
        });
    }

    if (voicePlaybackProgress) {
        const seekToClientX = (clientX) => {
            const rect = voicePlaybackProgress.getBoundingClientRect();
            if (!Number.isFinite(rect.width) || rect.width <= 0) return;
            const localX = Number(clientX) - rect.left;
            const percent = clampAudioSeekPercent((localX / rect.width) * 100);
            voicePlaybackProgress.value = String(percent);
            seekActiveVoicePlaybackByPercent(percent);
        };
        voicePlaybackProgress.addEventListener('pointerdown', (event) => {
            voicePlaybackProgress.dataset.seeking = '1';
            // Немедленный seek по координате тапа — иначе на iOS/Android приходится
            // именно тянуть, простой тап в новую позицию не двигает аудио.
            if (Number.isFinite(event?.clientX)) seekToClientX(event.clientX);
            try { voicePlaybackProgress.setPointerCapture?.(event.pointerId); } catch (_) {}
        });
        voicePlaybackProgress.addEventListener('pointermove', (event) => {
            if (voicePlaybackProgress.dataset.seeking !== '1') return;
            if (Number.isFinite(event?.clientX)) seekToClientX(event.clientX);
        });
        const endProgressSeek = () => {
            voicePlaybackProgress.dataset.seeking = '0';
        };
        voicePlaybackProgress.addEventListener('pointerup', endProgressSeek);
        voicePlaybackProgress.addEventListener('pointercancel', endProgressSeek);
        voicePlaybackProgress.addEventListener('lostpointercapture', endProgressSeek);
        voicePlaybackProgress.addEventListener('input', () => {
            if (voicePlaybackProgress.dataset.seeking === '1') return;
            seekActiveVoicePlaybackByPercent(Number(voicePlaybackProgress.value) || 0);
        });
    }

    if (voicePlaybackCloseBtn) {
        voicePlaybackCloseBtn.addEventListener('click', () => {
            const audio = resolveActiveVoicePlaybackAudio();
            if (audio) {
                audio.dataset.playRequested = '0';
                try { audio.pause(); } catch (_) {}
                try { audio.currentTime = 0; } catch (_) {}
                stopAudioPlayerUiLoop(audio);
                scheduleAudioPlayerUiSync(audio);
            }
            clearActiveVoicePlaybackAudio();
        });
    }

    window._onMessageMediaLoaded = function(mediaEl) {
        if (!mediaEl) return;
        mediaEl.setAttribute('data-loaded', '1');
        const mediaWrap = mediaEl.closest('.image-wrapper, .video-preview');
        mediaWrap?.classList.add('is-loaded');
        try {
            window.__sunMediaCacheRememberElement?.(mediaEl);
        } catch (_) {}

        const resolvedSrc = String(mediaEl.currentSrc || mediaEl.getAttribute('src') || '').trim();
        if (resolvedSrc) {
            const bgLayer = mediaEl.closest('.bubble')?.querySelector('.background-layer');
            if (bgLayer instanceof HTMLElement) {
                const safeSrc = resolvedSrc.replace(/'/g, "\\'");
                bgLayer.style.setProperty('background-image', `url('${safeSrc}')`);
            }
        }

        const naturalWidth = Number(mediaEl.naturalWidth || mediaEl.videoWidth);
        const naturalHeight = Number(mediaEl.naturalHeight || mediaEl.videoHeight);
        if (mediaWrap && Number.isFinite(naturalWidth) && naturalWidth > 0 && Number.isFinite(naturalHeight) && naturalHeight > 0) {
            const ratio = String(Math.max(0.75, Math.min(1.91, naturalWidth / naturalHeight)));
            mediaWrap.style.setProperty('--media-aspect-ratio', ratio);
            mediaWrap.closest('.bubble')?.style.setProperty('--media-aspect-ratio', ratio);
            persistPendingMediaDimensions(mediaEl.closest('.message'), naturalWidth, naturalHeight);
        }

        const currentChatId = getCurrentChatIdSafe();
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
                if (getKeepChatPinnedToBottomSafe()) {
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
        if (mediaEl instanceof HTMLImageElement) {
            mediaEl.removeAttribute('data-loaded');
            return;
        }
        mediaEl.setAttribute('data-loaded', '1');
    };

    window._preventInlineVideoPlay = function(videoEl) {
        if (!videoEl) return;
        videoEl.pause();
    };
}
