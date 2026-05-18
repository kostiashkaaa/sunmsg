from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_call_message_card_is_aligned_and_redials_current_direct_chat() -> None:
    rendering = (ROOT / 'static' / 'modules' / 'message-rendering.js').read_text(encoding='utf-8')
    runtime = (ROOT / 'static' / 'chat-runtime.js').read_text(encoding='utf-8')
    touch_context = (ROOT / 'static' / 'chat' / 'message-touch-context.js').read_text(encoding='utf-8')
    calls_css = (ROOT / 'static' / 'calls.css').read_text(encoding='utf-8')

    assert "const callType = String(callPayload?.call_type || '').trim() === 'video' ? 'video' : 'audio';" in rendering
    assert 'data-call-message-trigger="1"' in rendering
    assert "new CustomEvent('sun:call-message-start'" in rendering
    assert '[data-call-message-trigger]' in touch_context

    assert "document.addEventListener('sun:call-message-start'" in runtime
    assert 'const _hasDirectCallTarget = () => {' in runtime
    assert "activeItem.getAttribute('data-is-group') === '1'" in runtime
    assert "activeItem.getAttribute('data-saved-messages') === '1'" in runtime
    assert "callManager.startCall(chatId, callType, _resolvePartnerInfo())" in runtime

    assert 'grid-template-columns: minmax(0, 1fr) auto;' in calls_css
    assert '.bubble--call > .message-footer' in calls_css
    assert '.call-message-card__icon svg,' in calls_css
