const MIN_PULL_PX = 0;
const PULL_RESISTANCE = 0.72;

export function initProfilePullExpand() {
    const body = document.body;
    const panelBodyEl = document.querySelector('.settings-panel-body');
    const profileEl = document.getElementById('settingsNavProfile');
    if (!body || !panelBodyEl || !profileEl) return;

    let pullPx = 0;
    let touchStartY = 0;
    let touchStartPullPx = 0;
    let isTouchTracking = false;

    const maxPullPx = () => {
        const viewportHeight = Math.round(window.visualViewport?.height || window.innerHeight || 0);
        return Math.min(220, Math.max(118, Math.round(viewportHeight * 0.28)));
    };

    const isHomeOpen = () => body.classList.contains('settings-home-open');
    const isAtTop = () => panelBodyEl.scrollTop <= 0;
    const clampPull = (value) => Math.max(MIN_PULL_PX, Math.min(maxPullPx(), value));

    const applyPull = (nextPullPx) => {
        pullPx = clampPull(nextPullPx);
        profileEl.style.setProperty('--settings-profile-pull', `${Math.round(pullPx)}px`);
        profileEl.style.setProperty('--settings-profile-pull-pad', `${Math.round(pullPx * 0.16)}px`);
        profileEl.classList.toggle('is-pull-expanded', pullPx > 1);
    };

    const resetPull = () => applyPull(0);

    profileEl.style.setProperty('--settings-profile-pull', '0px');
    profileEl.style.setProperty('--settings-profile-pull-pad', '0px');

    panelBodyEl.addEventListener('wheel', (event) => {
        if (!isHomeOpen()) return;
        if (event.deltaY < 0 && isAtTop()) {
            event.preventDefault();
            applyPull(pullPx + Math.abs(event.deltaY) * PULL_RESISTANCE);
            return;
        }
        if (event.deltaY > 0 && pullPx > 0) {
            event.preventDefault();
            applyPull(pullPx - event.deltaY);
        }
    }, { passive: false });

    panelBodyEl.addEventListener('touchstart', (event) => {
        if (!isHomeOpen() || !isAtTop() || event.touches.length !== 1) return;
        touchStartY = event.touches[0].clientY;
        touchStartPullPx = pullPx;
        isTouchTracking = true;
    }, { passive: true });

    panelBodyEl.addEventListener('touchmove', (event) => {
        if (!isTouchTracking || event.touches.length !== 1 || !isHomeOpen()) return;
        const deltaY = event.touches[0].clientY - touchStartY;
        if (deltaY > 0 && isAtTop()) {
            event.preventDefault();
            applyPull(touchStartPullPx + deltaY * PULL_RESISTANCE);
            return;
        }
        if (pullPx > 0 && deltaY < 0) {
            event.preventDefault();
            applyPull(touchStartPullPx + deltaY);
        }
    }, { passive: false });

    panelBodyEl.addEventListener('touchend', () => {
        isTouchTracking = false;
    }, { passive: true });

    panelBodyEl.addEventListener('scroll', () => {
        if (!isHomeOpen() || !isAtTop()) {
            resetPull();
        }
    }, { passive: true });

    window.visualViewport?.addEventListener('resize', () => applyPull(pullPx), { passive: true });
    window.addEventListener('resize', () => applyPull(pullPx), { passive: true });

    const bodyObserver = new MutationObserver(() => {
        if (!isHomeOpen()) resetPull();
    });
    bodyObserver.observe(body, { attributes: true, attributeFilter: ['class'] });
}
