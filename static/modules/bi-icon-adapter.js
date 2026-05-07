(function () {
    const BI_TO_SUN = Object.freeze({
        'bi-arrow-clockwise': 'sun-i-arrow-clockwise',
        'bi-arrow-counterclockwise': 'sun-i-arrow-counterclockwise',
        'bi-arrow-left': 'sun-i-arrow-left',
        'bi-arrow-left-circle': 'sun-i-arrow-left-circle',
        'bi-arrow-repeat': 'sun-i-arrow-repeat',
        'bi-arrow-up-right-square': 'sun-i-external-link',
        'bi-arrows-fullscreen': 'sun-i-arrows-fullscreen',
        'bi-at': 'sun-i-at',
        'bi-bell': 'sun-i-bell',
        'bi-bell-slash': 'sun-i-bell-slash',
        'bi-bell-slash-fill': 'sun-i-bell-slash',
        'bi-bookmark-fill': 'sun-i-bookmark',
        'bi-box-arrow-in-right': 'sun-i-external-link',
        'bi-box-arrow-right': 'sun-i-external-link',
        'bi-camera': 'sun-i-camera',
        'bi-chat-dots': 'sun-i-chat-dots',
        'bi-chat-square-text': 'sun-i-chat-square-text',
        'bi-check2-all': 'sun-i-check2-all',
        'bi-check2-circle': 'sun-i-check-square',
        'bi-chevron-down': 'sun-i-chevron-down',
        'bi-chevron-left': 'sun-i-chevron-left',
        'bi-chevron-right': 'sun-i-chevron-right',
        'bi-circle-half': 'sun-i-half',
        'bi-clipboard': 'sun-i-copy',
        'bi-clock': 'sun-i-clock',
        'bi-clock-history': 'sun-i-clock-history',
        'bi-crop': 'sun-i-crop',
        'bi-dash-lg': 'sun-i-minus',
        'bi-download': 'sun-i-download',
        'bi-emoji-smile': 'sun-i-emoji',
        'bi-exclamation-circle': 'sun-i-info-circle',
        'bi-exclamation-circle-fill': 'sun-i-info-circle',
        'bi-exclamation-octagon': 'sun-i-warning',
        'bi-exclamation-triangle': 'sun-i-warning',
        'bi-exclamation-triangle-fill': 'sun-i-warning',
        'bi-file-earmark': 'sun-i-file',
        'bi-file-earmark-arrow-down': 'sun-i-file',
        'bi-file-earmark-excel': 'sun-i-file',
        'bi-file-earmark-music': 'sun-i-file',
        'bi-file-earmark-pdf': 'sun-i-file',
        'bi-file-earmark-spreadsheet': 'sun-i-file',
        'bi-file-earmark-text': 'sun-i-file',
        'bi-file-earmark-word': 'sun-i-file',
        'bi-file-earmark-zip': 'sun-i-file',
        'bi-fingerprint': 'sun-i-fingerprint',
        'bi-flag': 'sun-i-flag',
        'bi-folder2-open': 'sun-i-file',
        'bi-forward-fill': 'sun-i-share',
        'bi-gear': 'sun-i-gear',
        'bi-grid': 'sun-i-grid',
        'bi-hourglass-split': 'sun-i-hourglass',
        'bi-image': 'sun-i-image',
        'bi-info-circle': 'sun-i-info-circle',
        'bi-info-circle-fill': 'sun-i-info-circle',
        'bi-key': 'sun-i-key',
        'bi-key-fill': 'sun-i-key',
        'bi-keyboard': 'sun-i-keyboard',
        'bi-lock': 'sun-i-lock',
        'bi-lock-fill': 'sun-i-lock',
        'bi-mic-fill': 'sun-i-mic',
        'bi-moon-stars': 'sun-i-moon-stars',
        'bi-paperclip': 'sun-i-paperclip',
        'bi-pause-fill': 'sun-i-pause',
        'bi-pencil': 'sun-i-pencil',
        'bi-pencil-square': 'sun-i-pencil-square',
        'bi-people': 'sun-i-people',
        'bi-people-fill': 'sun-i-people',
        'bi-person-badge': 'sun-i-person-badge',
        'bi-person-circle': 'sun-i-person-circle',
        'bi-person-plus': 'sun-i-user-plus',
        'bi-person-plus-fill': 'sun-i-user-plus',
        'bi-person-search': 'sun-i-person-search',
        'bi-person-x': 'sun-i-person-x',
        'bi-phone': 'sun-i-phone',
        'bi-pin': 'sun-i-pin-angle',
        'bi-pin-angle': 'sun-i-pin-angle',
        'bi-pin-angle-fill': 'sun-i-pin-angle',
        'bi-play-fill': 'sun-i-play',
        'bi-qr-code': 'sun-i-qr',
        'bi-qr-code-scan': 'sun-i-qr',
        'bi-reply-fill': 'sun-i-chat',
        'bi-search': 'sun-i-search',
        'bi-send': 'sun-i-send',
        'bi-send-fill': 'sun-i-send',
        'bi-share': 'sun-i-share',
        'bi-star': 'sun-i-bookmark',
        'bi-star-fill': 'sun-i-bookmark',
        'bi-shield-lock': 'sun-i-shield-lock',
        'bi-shield-slash': 'sun-i-shield-slash',
        'bi-shuffle': 'sun-i-shuffle',
        'bi-slash-circle': 'sun-i-slash-circle',
        'bi-square': 'sun-i-square',
        'bi-translate': 'sun-i-translate',
        'bi-trash3': 'sun-i-trash',
        'bi-trash-fill': 'sun-i-trash',
        'bi-unlock': 'sun-i-unlock',
        'bi-unlock-fill': 'sun-i-unlock',
        'bi-upload': 'sun-i-upload-file',
        'bi-x-circle': 'sun-i-x-circle',
        'bi-x-circle-fill': 'sun-i-x-circle',
        'bi-x-lg': 'sun-i-x',
    });

    function findBiToken(classList) {
        for (const className of classList) {
            if (className.startsWith('bi-')) return className;
        }
        return '';
    }

    function createSunIcon(symbolId) {
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('class', 'sun-icon');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        svg.dataset.sunBiIcon = '1';
        const use = document.createElementNS(ns, 'use');
        use.setAttribute('href', `#${symbolId}`);
        svg.appendChild(use);
        return svg;
    }

    function hydrateBiIconHost(iconHost) {
        if (!(iconHost instanceof HTMLElement)) return;
        if (!iconHost.classList.contains('bi')) return;
        const biToken = findBiToken(iconHost.classList);
        if (!biToken) return;
        const symbolId = BI_TO_SUN[biToken];
        if (!symbolId) return;

        const signature = `${biToken}|${symbolId}`;
        if (iconHost.dataset.sunBiSignature === signature) return;

        const svg = createSunIcon(symbolId);
        iconHost.replaceChildren(svg);
        iconHost.classList.add('sun-icon-host');
        iconHost.dataset.sunBiSignature = signature;
    }

    function hydrateBiIcons(root) {
        if (!(root instanceof Element || root instanceof Document)) return;
        root.querySelectorAll('i.bi').forEach(hydrateBiIconHost);
    }

    function setupObserver() {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes') {
                    const target = mutation.target;
                    if (target instanceof HTMLElement && target.matches('i.bi')) {
                        hydrateBiIconHost(target);
                    }
                    return;
                }

                mutation.addedNodes.forEach((node) => {
                    if (!(node instanceof Element)) return;
                    if (node.matches('i.bi')) {
                        hydrateBiIconHost(node);
                    }
                    hydrateBiIcons(node);
                });
            });
        });

        observer.observe(document.documentElement, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['class'],
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            hydrateBiIcons(document);
            setupObserver();
        }, { once: true });
    } else {
        hydrateBiIcons(document);
        setupObserver();
    }
})();
