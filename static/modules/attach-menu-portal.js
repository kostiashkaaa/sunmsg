import { waitForMotionEnd } from './motion.js';

export function initAttachMenuPortal({ attachMenu, trigger, viewportGap = 8, triggerGap = 12 } = {}) {
    const noop = {
        setOpen() {},
        close() {},
        isOpen() { return false; },
        position() {},
    };

    if (!attachMenu || !trigger) return noop;

    let transitionSeq = 0;
    const alignElement = trigger.closest('#messageForm') || trigger;

    if (attachMenu.parentElement !== document.body) {
        attachMenu.classList.add('attach-menu--portal');
        document.body.appendChild(attachMenu);
    }

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
            : { media: '\u0424\u043e\u0442\u043e \u0438\u043b\u0438 \u0432\u0438\u0434\u0435\u043e', file: '\u0424\u0430\u0439\u043b' };
        attachMenu.querySelector('[data-attach-mode="media"] .attach-menu-item__text')?.replaceChildren(labels.media);
        attachMenu.querySelector('[data-attach-mode="file"] .attach-menu-item__text')?.replaceChildren(labels.file);
    }

    function position() {
        attachMenu.classList.add('attach-menu--portal');
        const vv = window.visualViewport;
        const viewport = {
            left: Number(vv?.offsetLeft || 0),
            top: Number(vv?.offsetTop || 0),
            width: Number(vv?.width || window.innerWidth || document.documentElement.clientWidth || 0),
            height: Number(vv?.height || window.innerHeight || document.documentElement.clientHeight || 0),
        };
        const menuWidth = Math.min(216, Math.max(190, viewport.width - viewportGap * 2));
        attachMenu.style.setProperty('--attach-menu-width', `${menuWidth}px`);

        const triggerRect = trigger.getBoundingClientRect();
        const alignRect = alignElement.getBoundingClientRect();
        const menuHeight = Math.max(attachMenu.offsetHeight || 0, attachMenu.scrollHeight || 0, 96);
        const minLeft = viewport.left + viewportGap;
        const maxLeft = Math.max(minLeft, viewport.left + viewport.width - menuWidth - viewportGap);
        const minTop = viewport.top + viewportGap;
        const maxTop = Math.max(minTop, viewport.top + viewport.height - menuHeight - viewportGap);
        const topAbove = alignRect.top - menuHeight - triggerGap;
        const topBelow = alignRect.bottom + triggerGap;
        const opensAbove = topAbove >= minTop || topBelow > maxTop;
        const left = Math.min(Math.max(alignRect.right - menuWidth, minLeft), maxLeft);
        const preferredTop = opensAbove ? topAbove : topBelow;
        const anchorToComposerDuringKeyboard = opensAbove
            && document.documentElement.classList.contains('mobile-keyboard-active')
            && Boolean(document.activeElement?.closest?.('#messageForm, #composerRow'));
        const top = anchorToComposerDuringKeyboard
            ? Math.max(preferredTop, minTop)
            : Math.min(Math.max(preferredTop, minTop), maxTop);

        attachMenu.style.setProperty('--attach-menu-left', `${left}px`);
        attachMenu.style.setProperty('--attach-menu-top', `${top}px`);
        attachMenu.style.setProperty('--attach-menu-origin', opensAbove ? 'bottom right' : 'top right');
    }

    function setOpen(open) {
        const shouldOpen = Boolean(open);
        transitionSeq += 1;
        const seq = transitionSeq;
        if (shouldOpen) {
            syncLabels();
            attachMenu.classList.remove('is-open', 'is-closing');
            attachMenu.classList.add('is-opening');
            position();
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
                position();
                attachMenu.classList.add('is-open');
                requestAnimationFrame(() => {
                    if (seq !== transitionSeq) return;
                    position();
                    attachMenu.classList.remove('is-opening');
                });
            });
        }
    }

    const repositionIfOpen = () => {
        if (attachMenu.classList.contains('is-open')) position();
    };
    window.addEventListener('resize', repositionIfOpen);
    window.addEventListener('orientationchange', repositionIfOpen);
    window.visualViewport?.addEventListener('resize', repositionIfOpen);
    window.visualViewport?.addEventListener('scroll', repositionIfOpen);
    window.addEventListener('sun-ui-language-changed', syncLabels);
    syncLabels();

    return {
        setOpen,
        close() { setOpen(false); },
        isOpen() { return attachMenu.classList.contains('is-open'); },
        position,
    };
}
