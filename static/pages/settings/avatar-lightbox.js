/* Полноэкранный предпросмотр аватара — клик по фото профиля открывает
   увеличенную картинку поверх настроек, как в Telegram.
   Подключается к контейнерам аватара, где фото вставлено как <img>. */

let lightboxEl = null;

function ensureLightbox() {
    if (lightboxEl) return lightboxEl;
    lightboxEl = document.createElement('div');
    lightboxEl.className = 'avatar-lightbox';
    lightboxEl.setAttribute('hidden', '');
    lightboxEl.setAttribute('role', 'dialog');
    lightboxEl.setAttribute('aria-modal', 'true');
    lightboxEl.setAttribute('aria-label', 'Просмотр фото профиля');
    lightboxEl.innerHTML = `
        <button type="button" class="avatar-lightbox-close" aria-label="Закрыть">
            <i class="bi bi-x-lg" aria-hidden="true"></i>
        </button>
        <img class="avatar-lightbox-img" alt="Фото профиля">
    `;
    document.body.appendChild(lightboxEl);

    const close = () => closeLightbox();
    lightboxEl.addEventListener('click', (event) => {
        // клик по подложке или по картинке закрывает просмотр
        if (event.target === lightboxEl
            || event.target.classList.contains('avatar-lightbox-img')
            || event.target.closest('.avatar-lightbox-close')) {
            close();
        }
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !lightboxEl.hasAttribute('hidden')) {
            close();
        }
    });
    return lightboxEl;
}

function openLightbox(src) {
    const box = ensureLightbox();
    const img = box.querySelector('.avatar-lightbox-img');
    img.src = src;
    box.removeAttribute('hidden');
    // запуск анимации появления на следующем кадре
    requestAnimationFrame(() => box.classList.add('is-open'));
}

function closeLightbox() {
    if (!lightboxEl) return;
    lightboxEl.classList.remove('is-open');
    const onEnd = () => {
        lightboxEl.setAttribute('hidden', '');
        lightboxEl.querySelector('.avatar-lightbox-img').removeAttribute('src');
        lightboxEl.removeEventListener('transitionend', onEnd);
    };
    lightboxEl.addEventListener('transitionend', onEnd);
}

/* Делает контейнеры аватара кликабельными для предпросмотра. */
export function initAvatarLightbox(containers = []) {
    const targets = containers.filter(Boolean);
    targets.forEach((container) => {
        if (container.dataset.lightboxBound === '1') return;
        container.dataset.lightboxBound = '1';
        container.addEventListener('click', (event) => {
            // не перехватываем клик по кнопке-камере поверх аватара
            if (event.target.closest('.settings-avatar-edit-btn, label')) return;
            const img = container.querySelector('img');
            if (!img || !img.src) return;
            event.preventDefault();
            openLightbox(img.src);
        });
    });
}
