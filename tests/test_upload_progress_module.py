from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def _run_node_harness(source: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ['node', '--input-type=module', '-e', source],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


def test_upload_progress_helper_and_composer_state_share_bounds(tmp_path):
    modules_dir = ROOT / 'static' / 'modules'
    upload_source = (modules_dir / 'upload-progress.js').read_text(encoding='utf-8')
    composer_source = (modules_dir / 'chat-composer-upload-state.js').read_text(encoding='utf-8')
    pending_source = (modules_dir / 'chat-pending-upload-runtime.js').read_text(encoding='utf-8')
    composer_source = composer_source.replace('./upload-progress.js', './upload-progress.mjs')
    pending_source = pending_source.replace('./upload-progress.js', './upload-progress.mjs')

    upload_module = tmp_path / 'upload-progress.mjs'
    composer_module = tmp_path / 'chat-composer-upload-state.mjs'
    pending_module = tmp_path / 'chat-pending-upload-runtime.mjs'
    upload_module.write_text(upload_source, encoding='utf-8')
    composer_module.write_text(composer_source, encoding='utf-8')
    pending_module.write_text(pending_source, encoding='utf-8')

    node_harness = f"""
const upload = await import({upload_module.as_uri()!r});
const composer = await import({composer_module.as_uri()!r});
const pending = await import({pending_module.as_uri()!r});

const cases = [
  [undefined, 0],
  [-1, 0],
  [0.4, 0],
  [44.6, 45],
  [101, 100],
  ['x', 0],
];
for (const [input, expected] of cases) {{
  const actual = upload.clampUploadProgress(input);
  if (actual !== expected) {{
    throw new Error(`clamp ${{String(input)}} expected ${{expected}}, got ${{actual}}`);
  }}
}}

const state = composer.createComposerUploadState();
if (!state.setActive({{ clientId: 'upload-1', progress: 140 }})) {{
  throw new Error('expected active upload to be accepted');
}}
if (state.getProgress() !== 100) {{
  throw new Error(`expected active progress 100, got ${{state.getProgress()}}`);
}}
if (state.updateProgress('other-upload', 20)) {{
  throw new Error('wrong client id must not update active upload');
}}
if (!state.updateProgress('upload-1', 22.5)) {{
  throw new Error('expected active upload progress update');
}}
if (state.getProgress() !== 23) {{
  throw new Error(`expected rounded progress 23, got ${{state.getProgress()}}`);
}}
if (!state.clear('upload-1') || state.getProgress() !== 0) {{
  throw new Error('expected active upload clear to reset progress');
}}

const message = {{
  clientId: 'pending-1',
  message: JSON.stringify({{ __sunfile: true, uploading: true, upload_progress: 0 }}),
}};
const chatState = {{ messages: [message] }};
const uploadInline = {{
  classList: {{ toggle() {{}} }},
  setAttribute(name, value) {{ this[name] = String(value); }},
  style: {{ setProperty() {{}} }},
  querySelector(selector) {{
    return selector === '.file-upload-inline-percent' ? {{ textContent: '' }} : null;
  }},
}};
const messageEl = {{
  querySelector(selector) {{
    if (selector === '.image-wrapper, .video-preview') return null;
    if (selector === '[data-file-upload-inline="1"]') return uploadInline;
    if (selector === '.file-msg-link') return {{ classList: {{ toggle() {{}} }}, setAttribute() {{}} }};
    return null;
  }},
}};
const runtime = pending.createPendingUploadRuntime({{
  getCurrentChatId: () => 'chat-1',
  getChatState: () => chatState,
  findMessageIndex: (state, predicate) => state.messages.findIndex(predicate),
  getChatMessages: () => ({{
    querySelector: () => messageEl,
  }}),
  parseSunFilePayload: (value) => JSON.parse(value),
}});
runtime.updatePendingFileUploadProgress('pending-1', -20);
let payload = JSON.parse(chatState.messages[0].message);
if (payload.upload_progress !== 0) {{
  throw new Error(`expected pending progress lower bound 0, got ${{payload.upload_progress}}`);
}}
runtime.updatePendingFileUploadProgress('pending-1', 150);
payload = JSON.parse(chatState.messages[0].message);
if (payload.upload_progress !== 100) {{
  throw new Error(`expected pending progress upper bound 100, got ${{payload.upload_progress}}`);
}}
"""
    result = _run_node_harness(node_harness)
    assert result.returncode == 0, result.stderr or result.stdout
