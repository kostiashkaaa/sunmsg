from pathlib import Path
import subprocess


def test_stage_key_for_login_returns_warning_instead_of_throw_when_staging_fails():
    module_path = Path(__file__).resolve().parents[1] / 'static' / 'modules' / 'key-login-stage.js'

    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

const source = await readFile({str(module_path)!r}, 'utf8');
const moduleUrl = `data:text/javascript;base64,${{Buffer.from(source, 'utf8').toString('base64')}}`;
const {{ stageKeyForLogin }} = await import(moduleUrl);

const calls = [];
const stageFnSuccess = async (pem, options) => {{
  calls.push({{ pem, options }});
  return true;
}};
const success = await stageKeyForLogin({{
  privateKeyPem: 'pem-1',
  persistent: true,
  sessionAutoLogoutSeconds: 604800,
  sessionExpiresAt: 2000000000,
  stagePrivateKeyForRedirect: stageFnSuccess,
  tr: (v) => v,
}});
if (!success.staged || success.warningMessage) {{
  throw new Error('Expected successful staging result without warning');
}}
if (
  calls.length !== 1
  || calls[0].options.persistent !== true
  || calls[0].options.rememberDevice !== true
  || calls[0].options.sessionAutoLogoutSeconds !== 604800
  || calls[0].options.sessionExpiresAt !== 2000000000
  || calls[0].options.notify !== false
) {{
  throw new Error('Expected stagePrivateKeyForRedirect to receive persistent auto-logout metadata and notify=false');
}}

const fail = await stageKeyForLogin({{
  privateKeyPem: 'pem-2',
  rememberDevice: false,
  stagePrivateKeyForRedirect: async () => false,
  tr: (v) => v,
}});
if (fail.staged) {{
  throw new Error('Expected staged=false when staging returns false');
}}
if (!String(fail.warningMessage || '').trim()) {{
  throw new Error('Expected non-empty warning when staging fails');
}}

const thrown = await stageKeyForLogin({{
  privateKeyPem: 'pem-3',
  rememberDevice: false,
  stagePrivateKeyForRedirect: async () => {{ throw new Error('boom'); }},
  tr: (v) => `TR:${{v}}`,
}});
if (thrown.staged) {{
  throw new Error('Expected staged=false when staging throws');
}}
if (!String(thrown.warningMessage || '').startsWith('TR:')) {{
  throw new Error('Expected warning to pass through translator');
}}
"""

    result = subprocess.run(
        ['node', '--input-type=module', '-e', node_harness],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr or result.stdout
