from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CAPTION_MODAL_SRC = ROOT / 'static' / 'modules' / 'caption-modal.js'


def test_caption_modal_caps_attachment_count_before_preview_rendering():
    src = CAPTION_MODAL_SRC.read_text(encoding='utf-8')

    assert 'const MAX_CAPTION_ATTACHMENTS = 20;' in src

    show_start = src.index('function showCaptionModal')
    initial_limit = src.index('files.length > MAX_CAPTION_ATTACHMENTS', show_start)
    initial_payload = src.index('pendingPayload = {', show_start)
    assert initial_limit < initial_payload

    upsert_start = src.index('function upsertPendingFiles')
    append_limit = src.index('getPendingFiles().length + nextFiles.length > MAX_CAPTION_ATTACHMENTS', upsert_start)
    render_pending = src.index('renderPendingState();', upsert_start)
    assert append_limit < render_pending
