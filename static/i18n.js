(function () {
    if (window.SUN_I18N || window.__sunI18nRuntimeLoading) return;
    window.__sunI18nRuntimeLoading = true;

    const currentScript = document.currentScript;
    let runtimeSrc = '/static/i18n-runtime.js';

    try {
        if (currentScript && currentScript.src) {
            const url = new URL(currentScript.src, window.location.href);
            runtimeSrc = url.href.replace(/i18n(?:-runtime)?\.js(?:\?.*)?$/i, 'i18n-runtime.js');
        }
    } catch (_err) {}

    const script = document.createElement('script');
    script.src = runtimeSrc;
    script.onload = () => { window.__sunI18nRuntimeLoading = false; };
    script.onerror = () => { window.__sunI18nRuntimeLoading = false; };
    document.head.appendChild(script);
})();
