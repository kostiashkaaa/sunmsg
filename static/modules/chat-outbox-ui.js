// Floating pill that shows the number of messages waiting in the outbox.
// Visible only when count > 0. Self-contained: creates its own DOM element and
// CSS via a single style tag. No template changes required.

const PILL_ID = 'sunOutboxPill';
const STYLE_ID = 'sunOutboxPillStyles';

const PILL_STYLES = `
#${PILL_ID} {
    position: fixed;
    right: 16px;
    bottom: 88px;
    z-index: 1000;
    display: none;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    border-radius: 999px;
    background: rgba(28, 28, 32, 0.92);
    color: #f3f3f5;
    font-size: 13px;
    font-weight: 500;
    line-height: 1;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.28);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    pointer-events: none;
    user-select: none;
}
#${PILL_ID}.is-visible {
    display: inline-flex;
}
#${PILL_ID} .sun-outbox-pill__icon {
    display: inline-flex;
    width: 14px;
    height: 14px;
}
#${PILL_ID} .sun-outbox-pill__count {
    font-variant-numeric: tabular-nums;
}
@media (max-width: 640px) {
    #${PILL_ID} {
        right: 12px;
        bottom: 96px;
        font-size: 12px;
        padding: 7px 12px;
    }
}
.message.self .msg-tick.failed {
    cursor: pointer;
}
.message.self .msg-tick.failed:hover {
    opacity: 0.85;
}
`;

function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = PILL_STYLES;
    document.head.appendChild(style);
}

function ensurePillElement() {
    let pill = document.getElementById(PILL_ID);
    if (pill) return pill;
    pill = document.createElement('div');
    pill.id = PILL_ID;
    pill.setAttribute('role', 'status');
    pill.setAttribute('aria-live', 'polite');
    pill.innerHTML = `
        <span class="sun-outbox-pill__icon" aria-hidden="true">
            <i class="bi bi-clock-history"></i>
        </span>
        <span class="sun-outbox-pill__label"></span>
        <span class="sun-outbox-pill__count"></span>
    `;
    document.body.appendChild(pill);
    return pill;
}

function pluralizeRu(n) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'сообщение в очереди';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'сообщения в очереди';
    return 'сообщений в очереди';
}

export function mountOutboxPill(outboxRuntime) {
    if (!outboxRuntime || typeof outboxRuntime.onCountChange !== 'function') {
        return () => {};
    }
    ensureStyles();
    const pill = ensurePillElement();
    const labelEl = pill.querySelector('.sun-outbox-pill__label');
    const countEl = pill.querySelector('.sun-outbox-pill__count');

    const render = (count) => {
        const safeCount = Math.max(0, Number(count) || 0);
        if (safeCount <= 0) {
            pill.classList.remove('is-visible');
            return;
        }
        if (countEl) countEl.textContent = String(safeCount);
        if (labelEl) labelEl.textContent = pluralizeRu(safeCount);
        pill.classList.add('is-visible');
    };

    const unsubscribe = outboxRuntime.onCountChange(render);
    return () => {
        try { unsubscribe?.(); } catch (_) {}
        pill.classList.remove('is-visible');
    };
}
