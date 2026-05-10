from pathlib import Path
import subprocess


def _run_reactions_harness(harness_body: str) -> subprocess.CompletedProcess[str]:
    project_root = Path(__file__).resolve().parents[1]
    module_path = project_root / 'static' / 'modules' / 'reactions.js'
    utils_path = project_root / 'static' / 'modules' / 'utils.js'
    node_harness = f"""
import {{ readFile }} from 'node:fs/promises';

const reactionsPath = {str(module_path)!r};
const utilsPath = {str(utils_path)!r};
const utilsSource = await readFile(utilsPath, 'utf8');
const utilsUrl = 'data:text/javascript;base64,' + Buffer.from(utilsSource, 'utf8').toString('base64');
let source = await readFile(reactionsPath, 'utf8');
source = source.replace(\"from './utils.js';\", `from '${{utilsUrl}}';`);
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64');
const moduleApi = await import(moduleUrl);

{harness_body}
"""
    return subprocess.run(
        ['node', '--input-type=module', '-e', node_harness],
        capture_output=True,
        text=True,
        check=False,
    )


def test_are_message_reactions_equal_ignores_reactor_order():
    harness_body = """
const left = [{
  emoji: '❤️',
  count: 2,
  reactedByMe: false,
  reactors: [
    { public_key: 'pk-a', display_name: 'Alice' },
    { public_key: 'pk-b', display_name: 'Bob' },
  ],
}];
const right = [{
  emoji: '❤️',
  count: 2,
  reactedByMe: false,
  reactors: [
    { public_key: 'pk-b', display_name: 'Bob' },
    { public_key: 'pk-a', display_name: 'Alice' },
  ],
}];
if (!moduleApi.areMessageReactionsEqual(left, right, { currentUserPublicKey: 'pk-z' })) {
  throw new Error('Expected equal reaction sets regardless of reactor order');
}
"""
    result = _run_reactions_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_are_message_reactions_equal_detects_reactor_payload_change():
    harness_body = """
const left = [{
  emoji: '❤️',
  count: 2,
  reactors: [
    { public_key: 'pk-a', display_name: 'Alice' },
    { public_key: 'pk-b', display_name: 'Bob' },
  ],
}];
const right = [{
  emoji: '❤️',
  count: 2,
  reactors: [
    { public_key: 'pk-a', display_name: 'Alice Cooper' },
    { public_key: 'pk-b', display_name: 'Bob' },
  ],
}];
if (moduleApi.areMessageReactionsEqual(left, right, { currentUserPublicKey: 'pk-z' })) {
  throw new Error('Expected unequal when reactor payload changed');
}
"""
    result = _run_reactions_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_compute_optimistic_reactions_moves_current_user_reaction_between_emojis():
    harness_body = """
const userContext = {
  currentUserPublicKey: 'pk-me',
  currentDisplayName: 'Me',
  currentUsername: 'me',
  currentAvatarUrl: '',
};
const current = [
  {
    emoji: '👍',
    count: 2,
    reactedByMe: true,
    reactors: [
      { public_key: 'pk-other-a', display_name: 'Other A' },
      { public_key: 'pk-me', display_name: 'Me' },
    ],
  },
  {
    emoji: '❤️',
    count: 1,
    reactedByMe: false,
    reactors: [
      { public_key: 'pk-other-b', display_name: 'Other B' },
    ],
  },
];
const next = moduleApi.computeOptimisticReactions(current, '❤️', userContext);
const thumbsUp = next.find((item) => item.emoji === '👍');
const heart = next.find((item) => item.emoji === '❤️');

if (!thumbsUp || thumbsUp.count !== 1 || thumbsUp.reactedByMe !== false) {
  throw new Error('Expected 👍 reaction to lose current user and keep count=1');
}
if ((thumbsUp.reactors || []).some((reactor) => String(reactor.publicKey || '') === 'pk-me')) {
  throw new Error('Expected 👍 reactors to exclude current user');
}
if (!heart || heart.count !== 2 || heart.reactedByMe !== true) {
  throw new Error('Expected ❤️ reaction to gain current user and count=2');
}
if (!(heart.reactors || []).some((reactor) => String(reactor.publicKey || '') === 'pk-me')) {
  throw new Error('Expected ❤️ reactors to include current user');
}
"""
    result = _run_reactions_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout
