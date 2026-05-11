import { initChatPage } from './chat-runtime.js';

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initChatPage, { once: true });
} else {
    initChatPage();
}
