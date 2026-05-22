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


def test_global_search_content_ignores_stale_tab_jump_and_audio_completions() -> None:
    source = (ROOT / 'static' / 'modules' / 'search-overlay-global-content.js').read_text(encoding='utf-8')

    assert 'let tabRenderSeq = 0;' in source
    assert 'let jumpSeq = 0;' in source
    assert 'let audioPlaySeq = 0;' in source
    assert 'const currentJumpSeq = ++jumpSeq;' in source
    assert source.count('if (currentJumpSeq !== jumpSeq) return;') >= 4
    assert 'const playSeq = ++audioPlaySeq;' in source
    assert "row.dataset.searchGlobalAudioPlaySeq = String(playSeq);" in source
    assert 'if (renderSeq !== tabRenderSeq || activeTab !== tabId) return;' in source
    assert 'tabRenderSeq += 1;' in source


def test_search_overlay_timers_do_not_reopen_closed_or_stale_queries() -> None:
    source = (ROOT / 'static' / 'modules' / 'search-overlay.js').read_text(encoding='utf-8')

    assert 'clearAutoSwitch();' in source
    assert 'sidebar.classList.remove(SIDEBAR_DIMMED_CLASS);' in source
    assert "if (!isOpen || query !== String(visibleInput.value || '').trim()) return;" in source


def test_reaction_picker_expand_and_open_raf_are_lifecycle_guarded() -> None:
    source = (ROOT / 'static' / 'modules' / 'reaction-picker.js').read_text(encoding='utf-8')

    assert "if (!expandToggleEl || !pickerEl?.classList.contains('active')) return;" in source
    assert 'activeAnchorEl !== anchorEl || !document.body.contains(anchorEl)' in source
    assert 'const expandSeq = pickerTransitionSeq;' in source
    assert 'const expandMessageId = msgId;' in source
    assert 'if (expandSeq !== pickerTransitionSeq || Number(activeMessageId) !== expandMessageId || !reactionEmojiPopup.isOpen()) return;' in source


def test_profile_spotify_and_profile_actions_are_lifecycle_guarded() -> None:
    source = (ROOT / 'static' / 'modules' / 'profile-drawer.js').read_text(encoding='utf-8')
    orchestrator = (ROOT / 'static' / 'chat' / 'profile-orchestrator.js').read_text(encoding='utf-8')

    assert 'let profileSpotifyVisibilitySeq = 0;' in source
    assert 'let profileSpotifyActionSeq = 0;' in source
    assert 'let profileSpotifyPlaylistSeq = 0;' in source
    assert 'function syncProfileSpotifyTrackLifecycle(nextTrackKey = \'\')' in source
    assert 'function isProfileSpotifyTrackCurrent(seq, trackId)' in source
    assert 'if (visibilitySeq !== profileSpotifyVisibilitySeq || card.hidden) return;' in source
    assert 'if (!isProfileSpotifyTrackCurrent(seq, trackId)) return;' in source
    assert 'if (!isCurrentProfileAction()) return;' in source
    assert 'isProfileCurrent = () => true' in source
    assert 'const profileActionToken = typeof getProfileLoadToken === \'function\' ? getProfileLoadToken() : null;' in orchestrator
    assert 'isProfileCurrent: (profileKey) =>' in orchestrator


def test_user_search_actions_ignore_stale_detached_buttons() -> None:
    source = (ROOT / 'static' / 'modules' / 'user-search-results.js').read_text(encoding='utf-8')

    assert 'function nextButtonActionSeq(button)' in source
    assert 'button.dataset.userSearchActionSeq = String(seq);' in source
    assert 'function isButtonActionCurrent(button, seq)' in source
    assert 'button?.isConnected' in source
    assert source.count('if (!isButtonActionCurrent(button, actionSeq)) return;') >= 3


def test_contacts_hydration_mask_is_sequence_guarded() -> None:
    source = (ROOT / 'static' / 'modules' / 'chat-contacts-sidebar.js').read_text(encoding='utf-8')

    assert 'let contactsHydrationSeq = 0;' in source
    assert 'const hydrationSeq = shouldBatchHydrate ? ++contactsHydrationSeq : contactsHydrationSeq;' in source
    assert 'if (hydrationSeq !== contactsHydrationSeq) return;' in source
    assert 'if (shouldBatchHydrate && hydrationSeq === contactsHydrationSeq)' in source


def test_message_link_preview_image_error_is_sequence_guarded() -> None:
    source = (ROOT / 'static' / 'modules' / 'message-link-preview.js').read_text(encoding='utf-8')

    assert 'const imageSeq = Number(imageEl.dataset?.previewImageSeq || 0) + 1;' in source
    assert 'imageEl.dataset.previewImageSeq = String(imageSeq);' in source
    assert "imageEl.dataset?.previewImageSeq !== String(imageSeq)" in source
    assert '!node.isConnected' in source
    assert "String(imageEl.getAttribute('src') || '') !== nextImageSrc" in source


def test_chat_scroll_suppression_release_is_token_guarded() -> None:
    source = (ROOT / 'static' / 'modules' / 'chat-message-render-runtime.js').read_text(encoding='utf-8')

    assert 'let suppressChatScrollToken = 0;' in source
    assert 'function beginSuppressChatScrollHandling()' in source
    assert 'function releaseSuppressChatScrollHandling(token)' in source
    assert 'if (token !== suppressChatScrollToken) return;' in source
    assert source.count('releaseSuppressChatScrollHandling(suppressToken);') >= 3


def test_private_key_ui_refresh_skips_stale_chat_completions() -> None:
    source = (ROOT / 'static' / 'modules' / 'private-key-ui-refresh.js').read_text(encoding='utf-8')

    assert 'let refreshSeq = 0;' in source
    assert 'let refreshQueued = false;' in source
    assert 'function isCurrentRefresh(seq, chatId, privateKeyPem)' in source
    assert 'refreshQueued = true;' in source
    assert 'const seq = ++refreshSeq;' in source
    assert 'await redecryptCurrentChatState(seq);' in source
    assert '} while (refreshQueued && getPrivateKeyPem());' in source
    assert source.count('if (!isCurrentRefresh(seq, chatId, privateKeyPem)) return false;') >= 3


def test_spotify_realtime_refresh_skips_stale_stop_completions() -> None:
    source = (ROOT / 'static' / 'modules' / 'spotify-realtime-refresh.js').read_text(encoding='utf-8')

    assert 'let refreshSeq = 0;' in source
    assert 'refreshSeq += 1;' in source
    assert 'const seq = ++refreshSeq;' in source
    assert 'const isCurrentRefresh = () => seq === refreshSeq && !stopped && isVisible();' in source
    assert source.count('if (!isCurrentRefresh()) return;') >= 2
    assert 'if (isCurrentRefresh()) {' in source


def test_settings_paste_all_ignores_stale_clipboard_and_feedback() -> None:
    source = (ROOT / 'static' / 'modules' / 'settings-premium-ux.js').read_text(encoding='utf-8')

    assert 'let pasteFeedbackSeq = 0;' in source
    assert 'const actionSeq = ++pasteFeedbackSeq;' in source
    assert 'if (actionSeq !== pasteFeedbackSeq || !pasteBtn.isConnected || !grid.isConnected) return;' in source
    assert 'if (actionSeq !== pasteFeedbackSeq || !pasteBtn.isConnected) return;' in source
    assert 'const feedbackSeq = ++pasteFeedbackSeq;' in source
    assert 'if (feedbackSeq !== pasteFeedbackSeq || !btn.isConnected) return;' in source


def test_message_touch_context_deferred_reactions_are_sequence_guarded() -> None:
    source = (ROOT / 'static' / 'chat' / 'message-touch-context.js').read_text(encoding='utf-8')

    assert 'let messageContextGestureSeq = 0;' in source
    assert 'messageContextGestureSeq += 1;' in source
    assert 'const contextSeq = ++messageContextGestureSeq;' in source
    assert 'if (!msg || !msg.isConnected || !chatMessages.contains(msg)) return;' in source
    assert 'contextSeq !== messageContextGestureSeq' in source
    assert "!contextMenu?.classList.contains('is-open')" in source
    assert 'if (!messageEl.isConnected || !chatMessages.contains(messageEl)) {' in source
