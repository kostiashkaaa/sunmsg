from __future__ import annotations

import hashlib
import time
import uuid

MAX_GROUP_TITLE_LENGTH = 120
MAX_GROUP_DESCRIPTION_LENGTH = 600
MAX_GROUP_MEMBERS = 200_000


def new_group_chat_id(*, creator_user_id: int) -> str:
    seed = f'group:{creator_user_id}:{time.time_ns()}:{uuid.uuid4().hex}'
    return hashlib.sha256(seed.encode('utf-8')).hexdigest()


def normalize_member_ids(value) -> list[int]:
    if not isinstance(value, (list, tuple, set)):
        return []
    result = []
    seen = set()
    for raw in value:
        try:
            parsed = int(raw)
        except (TypeError, ValueError):
            continue
        if parsed <= 0 or parsed in seen:
            continue
        seen.add(parsed)
        result.append(parsed)
    return result


def normalize_group_description(value) -> str:
    return str(value or '').strip()
