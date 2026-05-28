const runtimeSrc = window.SUN_BOOTSTRAP?.assets?.chatRuntimeSrc
    || new URL('./chat-runtime.js', import.meta.url).href;

function bootChatRuntime(initChatPage) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initChatPage, { once: true });
    } else {
        initChatPage();
    }
}

import(runtimeSrc)
    .then(({ initChatPage }) => bootChatRuntime(initChatPage))
    .catch((error) => {
        console.error('[chat] Failed to load chat runtime', error);
    });
