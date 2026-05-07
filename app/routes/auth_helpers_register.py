import logging
import re

from app.routes.auth_session_utils import consume_register_challenge, issue_register_challenge
from app.routes.auth_utils import is_valid_b64_blob, normalize_login_vault
from app.services.favorites_chat import ensure_saved_messages_chat

logger = logging.getLogger(__name__)

USERNAME_MAX_LENGTH = 50
DISPLAY_NAME_MAX_LENGTH = 50
REGISTER_CHALLENGE_TTL_SECONDS = 5 * 60
_LOGIN_VAULT_MAX_BYTES = 24 * 1024
_B64_PATTERN = re.compile(r'^[A-Za-z0-9+/]+={0,2}$')


def issue_register_challenge_for_session(session_state) -> str:
    return issue_register_challenge(session_state)


def consume_register_challenge_from_session(session_state):
    return consume_register_challenge(session_state)


def normalize_login_vault_payload(raw_value):
    return normalize_login_vault(
        raw_value,
        login_vault_max_bytes=_LOGIN_VAULT_MAX_BYTES,
        is_valid_b64_blob_func=_is_valid_b64_blob,
    )


def ensure_default_saved_messages_chat(conn, *, user_id: int, public_key: str) -> str:
    return ensure_saved_messages_chat(
        conn,
        user_id=user_id,
        public_key=public_key,
    )


def _is_valid_b64_blob(value: str, *, min_bytes: int = 1, max_bytes: int = 16 * 1024) -> bool:
    return is_valid_b64_blob(
        value,
        pattern=_B64_PATTERN,
        min_bytes=min_bytes,
        max_bytes=max_bytes,
    )
