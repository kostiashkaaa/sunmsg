from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_settings_avatar_editor_ignores_stale_image_and_crop_completions() -> None:
    source = (ROOT / 'static' / 'pages' / 'settings' / 'avatar-editor.js').read_text(encoding='utf-8')

    assert 'let avatarEditorLifecycleSeq = 0;' in source
    assert 'const openSeq = ++avatarEditorLifecycleSeq;' in source
    assert 'if (openSeq !== avatarEditorLifecycleSeq) {' in source
    assert 'URL.revokeObjectURL(objectUrl);' in source
    assert 'if (openSeq !== avatarEditorLifecycleSeq) return;' in source
    assert 'const submitSeq = avatarEditorLifecycleSeq;' in source
    assert 'if (submitSeq !== avatarEditorLifecycleSeq || !avatarEditorState) return null;' in source


def test_settings_avatar_lightbox_raf_and_close_timer_are_sequence_guarded() -> None:
    source = (ROOT / 'static' / 'pages' / 'settings' / 'avatar-lightbox.js').read_text(encoding='utf-8')

    assert 'let lightboxLifecycleSeq = 0;' in source
    assert 'const openSeq = ++lightboxLifecycleSeq;' in source
    assert 'if (openSeq !== lightboxLifecycleSeq || box.hasAttribute' in source
    assert 'const closeSeq = ++lightboxLifecycleSeq;' in source
    assert 'if (closeSeq !== lightboxLifecycleSeq) return;' in source


def test_reaction_emoji_popup_open_async_paths_are_sequence_guarded() -> None:
    source = (ROOT / 'static' / 'modules' / 'reaction-emoji-popup.js').read_text(encoding='utf-8')

    assert 'const openSeq = ++popupTransitionSeq;' in source
    assert 'if (openSeq !== popupTransitionSeq || !visible) return;' in source
    assert source.count('if (openSeq !== popupTransitionSeq || !visible) return;') >= 2


def test_media_hydration_assignments_are_data_src_and_sequence_guarded() -> None:
    source = (ROOT / 'static' / 'modules' / 'media-hydration.js').read_text(encoding='utf-8')

    assert 'function nextHydrationSeq(element)' in source
    assert 'element.dataset.mediaHydrationSeq = String(seq);' in source
    assert "element.dataset?.mediaHydrationSeq !== String(expectedSeq)" in source
    assert "String(element.getAttribute('data-src') || '').trim() !== expectedDataSrc" in source
    assert 'assignHydratedSource(imageEl, resolvedSrc, dataSrc, hydrationSeq)' in source
    assert 'assignHydratedSource(mediaEl, resolvedSrc, dataSrc, hydrationSeq)' in source


def test_chat_drafts_save_and_load_async_completions_are_sequence_guarded() -> None:
    source = (ROOT / 'static' / 'modules' / 'chat-drafts.js').read_text(encoding='utf-8')

    assert 'const draftSaveSeqByChatId = new Map();' in source
    assert 'const saveSeq = Number(draftSaveSeqByChatId.get(normalizedChatId) || 0) + 1;' in source
    assert 'draftSaveSeqByChatId.set(normalizedChatId, saveSeq);' in source
    assert 'draftSaveSeqByChatId.get(normalizedChatId) !== saveSeq' in source
    assert source.count('if (requestId !== activeDraftLoadRequestId) return;') >= 2


def test_settings_devices_loads_ignore_stale_responses() -> None:
    source = (ROOT / 'static' / 'pages' / 'settings' / 'devices-section.js').read_text(encoding='utf-8')

    assert 'let sessionDevicesLoadSeq = 0;' in source
    assert 'const loadSeq = ++sessionDevicesLoadSeq;' in source
    assert source.count('if (loadSeq !== sessionDevicesLoadSeq) return;') >= 2


def test_settings_notifications_push_actions_are_sequence_guarded() -> None:
    source = (ROOT / 'static' / 'pages' / 'settings' / 'notifications-section.js').read_text(encoding='utf-8')

    assert 'let pushLifecycleSeq = 0;' in source
    assert 'const loadSeq = ++pushLifecycleSeq;' in source
    assert 'const actionSeq = ++pushLifecycleSeq;' in source
    assert source.count('if (loadSeq !== pushLifecycleSeq) return;') >= 2
    assert source.count('if (actionSeq !== pushLifecycleSeq) return;') >= 6


def test_voice_recorder_media_start_and_stop_are_lifecycle_guarded() -> None:
    source = (ROOT / 'static' / 'modules' / 'voice-recorder.js').read_text(encoding='utf-8')

    assert 'let voiceLifecycleSeq = 0;' in source
    assert 'let isStarting = false;' in source
    assert 'function isVoiceLifecycleCurrent(seq, chatIdAtStart)' in source
    assert 'const startSeq = ++voiceLifecycleSeq;' in source
    assert 'if (!isVoiceLifecycleCurrent(startSeq, chatIdAtStart) || isActive()) {' in source
    assert 'stopStreamTracks(stream);' in source
    assert 'voiceLifecycleSeq += 1;' in source
    assert 'const stopSeq = voiceLifecycleSeq;' in source
    assert 'if (stopSeq !== voiceLifecycleSeq || recorder !== activeRecorder)' in source


def test_message_context_menu_async_copy_and_focus_are_sequence_guarded() -> None:
    source = (ROOT / 'static' / 'modules' / 'message-context-menu.js').read_text(encoding='utf-8')

    assert 'const focusSeq = menuTransitionSeq;' in source
    assert "if (focusSeq !== menuTransitionSeq || !menuEl?.classList.contains('is-open')) return;" in source
    assert 'const copySeq = menuTransitionSeq;' in source
    assert 'if (copySeq !== menuTransitionSeq || currentMessageId !== msgId) return;' in source


def test_message_search_focus_raf_is_sequence_guarded() -> None:
    source = (ROOT / 'static' / 'modules' / 'message-search.js').read_text(encoding='utf-8')

    assert 'let searchUiSeq = 0;' in source
    assert 'const openSeq = ++searchUiSeq;' in source
    assert "if (openSeq !== searchUiSeq || !headerSearchWrap?.classList.contains('active')) return;" in source
    assert 'searchUiSeq += 1;' in source


def test_message_delete_motion_raf_skips_superseded_tokens() -> None:
    source = (ROOT / 'static' / 'modules' / 'message-delete-motion.js').read_text(encoding='utf-8')

    assert "if (node.dataset?.deleteMotionToken && node.dataset.deleteMotionToken !== motionToken) return;" in source
