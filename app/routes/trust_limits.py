from __future__ import annotations

from flask import current_app, session

from app.services.abuse_protection import trust_limited_rate_rule


def trust_ramped_limit(
    *,
    get_db_connection_func,
    standard_rule: str,
    limited_config_key: str,
    limited_default_rule: str,
):
    def _limit_rule() -> str:
        user_id = session.get('user_id')
        if user_id is None:
            return str(standard_rule)

        cfg = current_app.config
        limited_rule = str(cfg.get(limited_config_key) or limited_default_rule).strip() or limited_default_rule
        conn = None
        try:
            conn = get_db_connection_func()
            return trust_limited_rate_rule(
                conn,
                user_id=int(user_id),
                standard_rule=str(standard_rule),
                limited_rule=limited_rule,
                new_account_seconds=int(cfg.get('TRUST_RAMP_NEW_ACCOUNT_SECONDS', 0) or 0),
                signal_window_seconds=int(cfg.get('TRUST_RAMP_SIGNAL_WINDOW_SECONDS', 86400) or 86400),
                min_confirmed_contacts=int(cfg.get('TRUST_RAMP_MIN_CONFIRMED_CONTACTS', 0) or 0),
                min_inbound_repliers=int(cfg.get('TRUST_RAMP_MIN_INBOUND_REPLIERS', 0) or 0),
            )
        except Exception:  # noqa: BLE001 - route limit callbacks must not break the endpoint
            return str(standard_rule)
        finally:
            if conn is not None:
                conn.close()

    return _limit_rule
