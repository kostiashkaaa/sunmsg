function roundedPx(value) {
    return Math.max(0, Math.round(Number(value) || 0));
}

function isCoarsePointer() {
    return Boolean(window.matchMedia?.('(pointer: coarse)')?.matches);
}

export function createVisualViewportCssSyncer({
    appVhVar = '--app-vh',
    appVwVar = '--app-vw',
    topOffsetVar = '--vv-top-offset',
    leftOffsetVar = '--vv-left-offset',
    keyboardInsetVar = '--vv-keyboard-inset',
    composerBottomInsetVar = '--mobile-composer-bottom-inset',
    layoutKeyboardInsetVar = '--mobile-keyboard-layout-inset',
} = {}) {
    let stableMobileViewportHeight = 0;
    let stableMobileViewportOrientation = '';

    return function syncVisualViewportCssVars() {
        const root = document.documentElement;
        if (!root) return;

        const vv = window.visualViewport;
        if (!vv) {
            root.style.setProperty(appVhVar, `${roundedPx(window.innerHeight)}px`);
            root.style.setProperty(appVwVar, `${roundedPx(window.innerWidth)}px`);
            root.style.setProperty(topOffsetVar, '0px');
            root.style.setProperty(leftOffsetVar, '0px');
            root.style.setProperty(keyboardInsetVar, '0px');
            root.style.setProperty(composerBottomInsetVar, '0px');
            root.style.setProperty(layoutKeyboardInsetVar, '0px');
            root.classList.remove('mobile-keyboard-active');
            return;
        }

        const vvWidth = roundedPx(vv.width);
        const vvHeight = roundedPx(vv.height);
        const vvLeft = roundedPx(vv.offsetLeft);
        const vvTop = roundedPx(vv.offsetTop);
        const active = document.activeElement;
        const isComposerActive = Boolean(active?.closest?.('#messageForm, #composerRow'));
        const isTouchViewport = isCoarsePointer();
        const isLandscape = Boolean(window.matchMedia?.('(orientation: landscape)')?.matches);
        const orientationKey = isLandscape ? 'landscape' : 'portrait';
        if (orientationKey !== stableMobileViewportOrientation) {
            stableMobileViewportOrientation = orientationKey;
            stableMobileViewportHeight = 0;
        }

        const layoutViewportHeight = Math.max(
            vvHeight,
            roundedPx(window.innerHeight),
            roundedPx(root.clientHeight)
        );
        const layoutViewportWidth = Math.max(
            vvWidth,
            roundedPx(window.innerWidth),
            roundedPx(root.clientWidth)
        );
        if (!isTouchViewport) {
            stableMobileViewportHeight = 0;
        }
        if (isTouchViewport && layoutViewportHeight > stableMobileViewportHeight) {
            stableMobileViewportHeight = layoutViewportHeight;
        }

        const viewportBaseHeight = stableMobileViewportHeight || layoutViewportHeight;
        const visibleBottom = Math.max(0, vvTop + vvHeight);
        const rawComposerBottomInset = Math.max(0, viewportBaseHeight - visibleBottom);
        // Не привязываемся к isComposerActive — на iOS тап по play-кнопке
        // временно снимает фокус с textarea, и если бы условие требовало
        // composer-focus, мы бы «разжимали» chat-area пока клавиатура
        // ещё открыта, и UI прыгал бы. Достаточно факта, что
        // visualViewport реально меньше базового — значит клава поднята.
        const hasKeyboardViewport = isTouchViewport
            && viewportBaseHeight > 0
            && (rawComposerBottomInset > 80 || vvHeight < viewportBaseHeight * 0.82);
        const keyboardInset = hasKeyboardViewport ? rawComposerBottomInset : 0;
        const appHeight = hasKeyboardViewport ? vvHeight : layoutViewportHeight;
        const appTopOffset = hasKeyboardViewport ? vvTop : 0;
        const appWidth = hasKeyboardViewport && vvWidth > 0 ? vvWidth : layoutViewportWidth;
        const appLeftOffset = hasKeyboardViewport ? vvLeft : 0;

        root.style.setProperty(appVhVar, `${appHeight}px`);
        root.style.setProperty(appVwVar, `${appWidth}px`);
        root.style.setProperty(topOffsetVar, `${appTopOffset}px`);
        root.style.setProperty(leftOffsetVar, `${appLeftOffset}px`);
        root.style.setProperty(keyboardInsetVar, `${keyboardInset}px`);
        root.style.setProperty(composerBottomInsetVar, `${keyboardInset}px`);
        root.style.setProperty(layoutKeyboardInsetVar, '0px');
        root.classList.toggle('mobile-keyboard-active', hasKeyboardViewport);
    };
}
