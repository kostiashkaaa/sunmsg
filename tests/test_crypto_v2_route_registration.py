from __future__ import annotations

from flask import Flask

from app.routes.crypto_v2_routes import crypto_v2_bp


def _registered_methods(app: Flask, path: str) -> set[str]:
    methods: set[str] = set()
    for rule in app.url_map.iter_rules():
        if rule.rule == path:
            methods.update(rule.methods or set())
    return methods - {'HEAD', 'OPTIONS'}


def test_crypto_v2_claim_routes_are_not_registered_as_preview_posts():
    app = Flask(__name__)
    app.register_blueprint(crypto_v2_bp)

    assert _registered_methods(app, '/api/crypto/prekey-bundle/<int:peer_user_id>') == {'GET'}
    assert _registered_methods(app, '/api/crypto/prekey-bundle/<int:peer_user_id>/claim') == {'POST'}

    assert _registered_methods(app, '/api/crypto/mls/key-packages/<int:peer_user_id>') == {'GET'}
    assert _registered_methods(app, '/api/crypto/mls/key-packages/<int:peer_user_id>/claim') == {'POST'}

    assert _registered_methods(app, '/api/crypto/mls/pending/<chat_id>') == {'GET'}
    assert _registered_methods(app, '/api/crypto/mls/pending/<chat_id>/claim') == {'POST'}
