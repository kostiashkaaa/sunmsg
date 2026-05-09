// Floating pill that shows the number of messages waiting in the outbox.
// Visible only when count > 0. CSS is defined in static styles.

const PILL_ID = 'sunOutboxPill';

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
