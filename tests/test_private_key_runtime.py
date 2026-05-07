from pathlib import Path
import subprocess


def test_runtime_private_key_resolution_handles_embed_parent_context():
    module_path = Path(__file__).resolve().parents[1] / 'static' / 'modules' / 'private-key-runtime.js'

    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

const moduleSource = await readFile({str(module_path)!r}, 'utf8');
const moduleUrl = `data:text/javascript;base64,${{Buffer.from(moduleSource, 'utf8').toString('base64')}}`;
const {{ readRuntimePrivateKeyPem, hasRuntimePrivateKey }} = await import(moduleUrl);

const localWindow = {{
  sunPrivateKeySession: {{ getPrivateKeyPem: () => 'local-pem' }},
}};
localWindow.parent = localWindow;

if (readRuntimePrivateKeyPem({{ isEmbedMode: false, scopeWindow: localWindow }}) !== 'local-pem') {{
  throw new Error('Expected local private key to be returned');
}}

const embedWindow = {{
  sunPrivateKeySession: {{ getPrivateKeyPem: () => '' }},
  parent: {{
    sunPrivateKeySession: {{ getPrivateKeyPem: () => 'parent-pem' }},
  }},
}};

if (readRuntimePrivateKeyPem({{ isEmbedMode: true, scopeWindow: embedWindow }}) !== 'parent-pem') {{
  throw new Error('Expected parent private key for embed context');
}}
if (!hasRuntimePrivateKey({{ isEmbedMode: true, scopeWindow: embedWindow }})) {{
  throw new Error('Expected hasRuntimePrivateKey to be true when parent has key');
}}

const blockedWindow = {{
  sunPrivateKeySession: {{ getPrivateKeyPem: () => '' }},
}};
Object.defineProperty(blockedWindow, 'parent', {{
  get() {{
    throw new Error('cross-origin access denied');
  }},
}});

if (readRuntimePrivateKeyPem({{ isEmbedMode: true, scopeWindow: blockedWindow }}) !== '') {{
  throw new Error('Expected empty key when parent is inaccessible');
}}
if (hasRuntimePrivateKey({{ isEmbedMode: true, scopeWindow: blockedWindow }})) {{
  throw new Error('Expected hasRuntimePrivateKey to be false when key is inaccessible');
}}
"""

    result = subprocess.run(
        ['node', '--input-type=module', '-e', node_harness],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr or result.stdout
