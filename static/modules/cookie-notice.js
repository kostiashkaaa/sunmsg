/*
 * Cookie / data notice for the public landing page.
 *
 * SUN uses only strictly-necessary cookies (session, refresh token, CSRF),
 * which under GDPR don't require opt-in consent. We still display a brief
 * notice so users see — before signing up — that we set cookies and where
 * the privacy policy lives. Dismissal is recorded in localStorage so the
 * banner doesn't reappear on every visit.
 *
 * The banner is rendered lazily on DOMContentLoaded and removes itself
 * cleanly when accepted. No external dependencies.
 */

const STORAGE_KEY = 'sun.cookieNotice.ack.v1';
const BANNER_ID = 'sun-cookie-notice';

function alreadyAcknowledged() {
    try {
        return window.localStorage.getItem(STORAGE_KEY) === '1';
    } catch (_err) {
        return false;
    }
}

function markAcknowledged() {
    try {
        window.localStorage.setItem(STORAGE_KEY, '1');
    } catch (_err) {
        // Storage may be blocked (private mode). Falling back to in-memory
        // dismissal for the current session is acceptable.
    }
}

function tr(text) {
    if (typeof window !== 'undefined' && typeof window.t === 'function') {
        try {
            return window.t(text);
        } catch (_err) {
            return text;
        }
    }
    return text;
}

function buildBanner({ privacyHref, termsHref }) {
    const banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.className = 'sun-cookie-notice';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', tr('Уведомление об использовании cookies'));

    const text = document.createElement('div');
    text.className = 'sun-cookie-notice__text';
    text.innerHTML = `
        <strong>${tr('Cookies и приватность')}</strong>
        ${tr('SUN использует только технические cookies — для входа и защиты от подделки запросов. Аналитики и трекеров нет.')}
        <a href="${privacyHref}" class="sun-cookie-notice__link">${tr('Политика приватности')}</a>
        ·
        <a href="${termsHref}" class="sun-cookie-notice__link">${tr('Условия')}</a>
    `;

    const actions = document.createElement('div');
    actions.className = 'sun-cookie-notice__actions';
    const ackBtn = document.createElement('button');
    ackBtn.type = 'button';
    ackBtn.className = 'sun-cookie-notice__btn sun-cookie-notice__btn--primary';
    ackBtn.textContent = tr('Понятно');
    actions.appendChild(ackBtn);

    banner.appendChild(text);
    banner.appendChild(actions);

    ackBtn.addEventListener('click', () => {
        markAcknowledged();
        banner.classList.add('sun-cookie-notice--leaving');
        window.setTimeout(() => banner.remove(), 260);
    });

    return banner;
}

function resolveHrefs() {
    const root = document.documentElement?.dataset?.appRoot || '';
    return {
        privacyHref: `${root}/privacy`,
        termsHref: `${root}/terms`,
    };
}

export function initCookieNotice() {
    if (alreadyAcknowledged()) return;
    if (document.getElementById(BANNER_ID)) return;
    const banner = buildBanner(resolveHrefs());
    document.body.appendChild(banner);
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initCookieNotice, { once: true });
    } else {
        initCookieNotice();
    }
}
