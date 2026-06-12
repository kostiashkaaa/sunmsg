/**
 * E2EE Status UI — the chat header badge + key verification dialog.
 *
 * Public API: window.e2eeStatusUI
 *   .setStatus(proto)   — 'dr' | 'mls' | 'x3dh' | 'legacy' | 'downgraded' | 'none' | null
 *   .setKeys(myEd, peerEd, peerName) — update fingerprints in the verification dialog
 *   .hide()             — hide the badge (when switching to a chat without v2)
 */

'use strict';

(function () {

    const badge      = document.getElementById('e2eeStatusBadge');
    const label      = document.getElementById('e2eeStatusLabel');
    const modal      = document.getElementById('e2eeVerifyModal');
    const closeBtn   = document.getElementById('e2eeVerifyCloseBtn');
    const doneBtn    = document.getElementById('e2eeVerifyDoneBtn');
    const myFp       = document.getElementById('e2eeMyFingerprint');
    const peerFp     = document.getElementById('e2eePeerFingerprint');
    const peerLabel  = document.getElementById('e2eePeerFingerprintLabel');
    const protoText  = document.getElementById('e2eeProtoText');

    if (!badge) return; // template not loaded

    // ── Protocol descriptions ──────────────────────────────────────────────────

    const PROTO_META = {
        dr: {
            label: 'Double Ratchet',
            title: 'E2EE · Double Ratchet (X25519 + AES-256-GCM)\nForward secrecy включён. Нажмите для верификации ключей.',
            badgeClass: '',
            icon: '#sun-i-shield-check',
            protoDesc: 'Double Ratchet (X3DH + X25519) — каждое сообщение зашифровано уникальным ключом. Forward secrecy активен.',
        },
        mls: {
            label: 'MLS',
            title: 'E2EE · MLS RFC 9420 (групповое шифрование)\nNажмите для верификации ключей.',
            badgeClass: '',
            icon: '#sun-i-shield-check',
            protoDesc: 'MLS RFC 9420 — групповое E2EE с TreeKEM. Каждый epoch имеет уникальный секрет.',
        },
        x3dh: {
            label: 'X3DH',
            title: 'E2EE · X3DH (первичный обмен ключами)\nDR сессия ещё не установлена.',
            badgeClass: '',
            icon: '#sun-i-shield-check',
            protoDesc: 'X3DH (Extended Triple Diffie-Hellman) — инициализация сессии. После первого ответа активируется Double Ratchet.',
        },
        legacy: {
            label: 'RSA',
            title: 'E2EE · RSA-OAEP (устаревший протокол)\nОтправитель или получатель не перешли на X25519.',
            badgeClass: 'e2ee-badge--legacy',
            icon: '#sun-i-shield',
            protoDesc: 'RSA-OAEP (2048) + AES-256-GCM — устаревший протокол. Нет forward secrecy.',
        },
        downgraded: {
            label: 'RSA (откат)',
            title: 'Внимание: современное шифрование (Double Ratchet/MLS) дало сбой,\nсообщение отправлено по устаревшему RSA. Forward secrecy потерян.\nПерезагрузите страницу или переустановите ключи.',
            badgeClass: 'e2ee-badge--legacy',
            icon: '#sun-i-shield-x',
            protoDesc: 'Откат на RSA-OAEP из-за сбоя Double Ratchet/MLS. Это нештатная ситуация — современное шифрование не сработало. Forward secrecy отсутствует.',
        },
        none: {
            label: 'Нет E2EE',
            title: 'Шифрование не установлено.',
            badgeClass: 'e2ee-badge--none',
            icon: '#sun-i-shield-x',
            protoDesc: 'Сообщения не зашифрованы сквозным шифрованием.',
        },
    };

    // ── Utilities ──────────────────────────────────────────────────────────────

    function _formatFingerprint(b64u) {
        if (!b64u) return '<em class="e2ee-status-muted">недоступен</em>';
        // SHA-256 hex fingerprint from raw key bytes
        return b64u
            .replace(/[^A-Za-z0-9_-]/g, '')
            .slice(0, 64)
            .match(/.{1,4}/g)
            ?.map(chunk => `<span class="e2ee-key-fingerprint__chunk">${chunk}</span>`)
            .join(' ') ?? b64u;
    }

    async function _ed25519Fingerprint(b64u) {
        if (!b64u || !window.cryptoV2) return b64u;
        try {
            const raw = window.cryptoV2.b64uDecode(b64u);
            const hash = await crypto.subtle.digest('SHA-256', raw);
            return window.cryptoV2.b64uEncode(hash);
        } catch {
            return b64u;
        }
    }

    function _clearBadgeClasses() {
        badge.classList.remove('e2ee-badge--legacy', 'e2ee-badge--none');
    }

    // ── Badge management ───────────────────────────────────────────────────

    let _currentProto = null;

    function setStatus(proto) {
        _currentProto = proto;
        const meta = PROTO_META[proto];

        if (!meta || proto === 'none') {
            if (!meta) {
                badge.classList.add('e2ee-badge--hidden');
                return;
            }
        }

        badge.classList.remove('e2ee-badge--hidden');
        _clearBadgeClasses();

        if (meta.badgeClass) badge.classList.add(meta.badgeClass);

        label.textContent = meta.label;
        badge.title = meta.title;
        badge.setAttribute('aria-label', `E2EE: ${meta.label}. ${meta.title}`);

        // Update the icon
        const use = badge.querySelector('.e2ee-badge__icon use');
        if (use) use.setAttribute('href', meta.icon);
    }

    function hide() {
        badge.classList.add('e2ee-badge--hidden');
        _currentProto = null;
    }

    // ── Verification dialog ────────────────────────────────────────────────────

    let _myEd   = null;
    let _peerEd = null;
    let _isLegacy = false;

    function setKeys(myEdB64u, peerKeyRaw, peerName, proto) {
        _myEd     = myEdB64u;
        _peerEd   = peerKeyRaw;
        _isLegacy = proto === 'legacy';

        if (peerLabel) {
            const keyType = _isLegacy ? 'RSA-2048' : 'Ed25519';
            peerLabel.textContent = `Ключ ${peerName || 'собеседника'} (${keyType})`;
        }
    }

    async function _fingerprintForProto(key) {
        if (!key) return null;
        if (_isLegacy) {
            // RSA public key — hash as a UTF-8 string
            try {
                const enc = new TextEncoder().encode(key.trim());
                const hash = await crypto.subtle.digest('SHA-256', enc);
                if (window.cryptoV2) return window.cryptoV2.b64uEncode(hash);
                return btoa(String.fromCharCode(...new Uint8Array(hash)))
                    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
            } catch { return null; }
        }
        return _ed25519Fingerprint(key);
    }

    async function _openVerifyModal() {
        if (!modal) return;

        const meta = PROTO_META[_currentProto] ?? PROTO_META.legacy;
        if (protoText) {
            protoText.innerHTML = `Протокол: <strong>${meta.protoDesc}</strong>`;
        }

        const myHash   = _isLegacy ? null : await _ed25519Fingerprint(_myEd);
        const peerHash = await _fingerprintForProto(_peerEd);

        if (myFp)   myFp.innerHTML   = _isLegacy
            ? '<em class="e2ee-status-muted">RSA — без Ed25519 отпечатка</em>'
            : _formatFingerprint(myHash);
        if (peerFp) peerFp.innerHTML = _formatFingerprint(peerHash);

        modal.showModal?.() ?? modal.setAttribute('open', '');
    }

    function _closeVerifyModal() {
        modal?.close?.() ?? modal?.removeAttribute('open');
    }

    // ── Event handlers ───────────────────────────────────────────────────

    badge.addEventListener('click', e => {
        e.stopPropagation();
        if (_currentProto && _currentProto !== 'none') _openVerifyModal();
    });

    badge.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            if (_currentProto && _currentProto !== 'none') _openVerifyModal();
        }
    });

    closeBtn?.addEventListener('click', _closeVerifyModal);
    doneBtn?.addEventListener('click',  _closeVerifyModal);

    modal?.addEventListener('click', e => {
        if (e.target === modal) _closeVerifyModal();
    });

    modal?.addEventListener('keydown', e => {
        if (e.key === 'Escape') _closeVerifyModal();
    });

    // ── Public API ────────────────────────────────────────────────────────────

    window.e2eeStatusUI = { setStatus, setKeys, hide };

})();
