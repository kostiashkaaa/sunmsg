/* Просмотр фото профиля в настройках — в стиле просмотрщика фото чата:
   тёмный фон, фото в оригинальной форме (квадрат, не круг), плавная
   анимация и инфо-плашка сверху, как в Telegram.
   Закрытие надёжное (по таймеру, без зависимости от transitionend),
   поэтому курсор/оверлей не «залипают». */

let lightboxEl = null;
let closeTimer = 0;

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
        // клик по фону или по кнопке закрытия — закрыть; по самому фото — нет
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

/* Пытаемся вытащить дату из ?t=timestamp в URL аватара (его ставит preview). */
function describeAvatarDate(src) {
    try {
        const url = new URL(src, window.location.origin);
        const ts = Number(url.searchParams.get('t'));
        if (Number.isFinite(ts) && ts > 0) {
            return new Date(ts).toLocaleDateString('ru-RU', {
                day: 'numeric', month: 'long', year: 'numeric',
            });
        }
    } catch { /* игнорируем — просто не покажем дату */ }
    return '';
}

function openLightbox(src) {
    const box = ensureLightbox();
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = 0; }
    const img = box.querySelector('.avatar-lightbox-img');
    const sub = box.querySelector('.avatar-lightbox-sub');
    img.src = src;
    const dateText = describeAvatarDate(src);
    sub.textContent = dateText ? `Загружено ${dateText}` : '';
    sub.style.display = dateText ? '' : 'none';

    box.removeAttribute('hidden');
    requestAnimationFrame(() => box.classList.add('is-open'));
}

function closeLightbox() {
    if (!lightboxEl) return;
    lightboxEl.classList.remove('is-open');
    // Надёжное скрытие по таймеру — не ждём transitionend, который может
    // не сработать. Это устраняет «залипание» курсора и невидимый оверлей.
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = window.setTimeout(() => {
        if (!lightboxEl) return;
        lightboxEl.setAttribute('hidden', '');
        const img = lightboxEl.querySelector('.avatar-lightbox-img');
        if (img) img.removeAttribute('src');
        closeTimer = 0;
    }, 220);
}

/* Делает контейнеры аватара кликабельными для просмотра фото. */
export function initAvatarLightbox(containers = []) {
    containers.filter(Boolean).forEach((container) => {
        if (container.dataset.lightboxBound === '1') return;
        container.dataset.lightboxBound = '1';
        container.addEventListener('click', (event) => {
            // не перехватываем клик по кнопке-камере / загрузке файла
            if (event.target.closest('.settings-avatar-edit-btn, label')) return;
            const img = container.querySelector('img');
            if (!img || !img.src) return;
            event.preventDefault();
            openLightbox(img.src);
        });
    });
}
