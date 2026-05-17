import { waitForMotionEnd } from './motion.js';

/**
 * Attach menu controller.
 *
 * The menu is NOT portaled anymore and is NOT positioned by JS. It stays in
 * the DOM next to its trigger (inside .composer-controls) and CSS anchors it
 * with `position: absolute` directly above the attach button. Because the
 * composer is a normal flow row at the bottom of the chat column, the menu
 * always opens into visible space — no viewport math, no drift.
 *
 * This module now only toggles the `is-opening` / `is-open` / `is-closing`
 * classes and keeps the item labels localized.
 */
export function initAttachMenuPortal({ attachMenu, trigger } = {}) {
    const noop = {
        setOpen() {},
        close() {},
        isOpen() { return false; },
        position() {},
    };

    if (!attachMenu || !trigger) return noop;

    let transitionSeq = 0;

    function getLanguage() {
        const i18nApi = window.SUN_I18N;
        const raw = typeof i18nApi?.getLanguage === 'function'
            ? i18nApi.getLanguage()
            : (window.SUN_BOOTSTRAP?.user?.uiLanguage || document.documentElement.lang || 'ru');
        return String(raw || '').toLowerCase().startsWith('en') ? 'en' : 'ru';
    }

    function syncLabels() {
        const labels = getLanguage() === 'en'
            ? { media: 'Photo or video', file: 'File' }
            : { media: 'Фото или видео', file: 'Файл' };
        attachMenu.querySelector('[data-attach-mode="media"] .attach-menu-item__text')?.replaceChildren(labels.media);
        attachMenu.querySelector('[data-attach-mode="file"] .attach-menu-item__text')?.replaceChildren(labels.file);
    }

    function setOpen(open) {
        const shouldOpen = Boolean(open);
        transitionSeq += 1;
        const seq = transitionSeq;

        if (shouldOpen) {
            syncLabels();
            attachMenu.classList.remove('is-open', 'is-closing');
            attachMenu.classList.add('is-opening');
        } else if (attachMenu.classList.contains('is-open') || attachMenu.classList.contains('is-opening')) {
            attachMenu.classList.remove('is-open', 'is-opening');
            attachMenu.classList.add('is-closing');
            waitForMotionEnd(attachMenu, 180).then(() => {
                if (seq !== transitionSeq) return;
                attachMenu.classList.remove('is-closing');
            });
        }

        attachMenu.setAttribute('aria-hidden', shouldOpen ? 'false' : 'true');
        trigger.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');

        if (shouldOpen) {
            requestAnimationFrame(() => {
                if (seq !== transitionSeq) return;
                attachMenu.classList.add('is-open');
                requestAnimationFrame(() => {
                    if (seq !== transitionSeq) return;
                    attachMenu.classList.remove('is-opening');
                });
            });
        }
    }

    window.addEventListener('sun-ui-language-changed', syncLabels);
    syncLabels();

    return {
        setOpen,
        close() { setOpen(false); },
        isOpen() { return attachMenu.classList.contains('is-open'); },
        position() {},
    };
}
