/* Profile photo viewer in settings — styled like the chat photo viewer:
   dark background, photo in its original shape (square, not a circle), smooth
   animation and an info strip on top, messenger-style.
   Closing is reliable (timer-based, no dependency on transitionend),
   so the cursor/overlay never get stuck. */

let lightboxEl = null;
let closeTimer = 0;
let lightboxLifecycleSeq = 0;

function buildLightbox() {
    const el = document.createElement('div');
    el.className = 'avatar-lightbox';
    el.setAttribute('hidden', '');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Просмотр фото профиля');
    el.innerHTML = `
        <div class="avatar-lightbox-topbar">
            <div class="avatar-lightbox-meta">
                <span class="avatar-lightbox-title">Фото профиля</span>
                <span class="avatar-lightbox-sub"></span>
            </div>
            <button type="button" class="avatar-lightbox-close" aria-label="Закрыть">
                <svg class="sun-icon" aria-hidden="true"><use href="#sun-i-x"></use></svg>
            </button>
        </div>
        <div class="avatar-lightbox-stage">
            <img class="avatar-lightbox-img" alt="Фото профиля" draggable="false">
        </div>
    `;
    document.body.appendChild(el);

    el.addEventListener('click', (event) => {
        // click on the backdrop or close button closes; on the photo itself — no
        if (event.target.closest('.avatar-lightbox-img')) return;
        closeLightbox();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && lightboxEl && !lightboxEl.hasAttribute('hidden')) {
            closeLightbox();
        }
    });
    return el;
}

function ensureLightbox() {
    if (!lightboxEl) lightboxEl = buildLightbox();
    return lightboxEl;
}

/* Try to pull the date from ?t=timestamp in the avatar URL (set by preview). */
function describeAvatarDate(src) {
    try {
        const url = new URL(src, window.location.origin);
        const ts = Number(url.searchParams.get('t'));
        if (Number.isFinite(ts) && ts > 0) {
            return new Date(ts).toLocaleDateString('ru-RU', {
                day: 'numeric', month: 'long', year: 'numeric',
            });
        }
    } catch { /* ignore — just skip showing the date */ }
    return '';
}

function openLightbox(src) {
    const box = ensureLightbox();
    const openSeq = ++lightboxLifecycleSeq;
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = 0; }
    const img = box.querySelector('.avatar-lightbox-img');
    const sub = box.querySelector('.avatar-lightbox-sub');
    img.src = src;
    const dateText = describeAvatarDate(src);
    sub.textContent = dateText ? `Загружено ${dateText}` : '';
    sub.style.display = dateText ? '' : 'none';

    box.removeAttribute('hidden');
    requestAnimationFrame(() => {
        if (openSeq !== lightboxLifecycleSeq || box.hasAttribute('hidden')) return;
        box.classList.add('is-open');
    });
}

function closeLightbox() {
    if (!lightboxEl) return;
    const closeSeq = ++lightboxLifecycleSeq;
    lightboxEl.classList.remove('is-open');
    // Reliable timer-based hiding — we do not wait for transitionend, which may
    // never fire. This removes the stuck cursor and the invisible overlay.
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = window.setTimeout(() => {
        if (closeSeq !== lightboxLifecycleSeq) return;
        if (!lightboxEl) return;
        lightboxEl.setAttribute('hidden', '');
        const img = lightboxEl.querySelector('.avatar-lightbox-img');
        if (img) img.removeAttribute('src');
        closeTimer = 0;
    }, 220);
}

/* Makes avatar containers clickable to view the photo. */
export function initAvatarLightbox(containers = []) {
    containers.filter(Boolean).forEach((container) => {
        if (container.dataset.lightboxBound === '1') return;
        container.dataset.lightboxBound = '1';
        container.addEventListener('click', (event) => {
            // do not intercept clicks on the camera button / file upload
            if (event.target.closest('.settings-avatar-edit-btn, label')) return;
            const img = container.querySelector('img');
            if (!img || !img.src) return;
            event.preventDefault();
            openLightbox(img.src);
        });
    });
}
