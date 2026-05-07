import { waitForMotionEnd } from './motion.js';

export function initMessageActionsBar({
    barEl,
    previewEl,
    titleEl,
    editButtonEl,
    copyButtonEl,
    deleteButtonEl,
    selectButtonEl,
    isChatBlocked,
} = {}) {
    const state = {
        messageId: null,
        messageText: '',
        isFile: false,
        canEdit: false,
    };
    let barMotionSeq = 0;

    function setState(messageId, messageText, isFile, options = {}) {
        state.messageId = messageId;
        state.messageText = messageText || '';
        state.isFile = Boolean(isFile);
        const explicitCanEdit = options?.canEdit;
        state.canEdit = Boolean(messageId) && !state.isFile && explicitCanEdit !== false;
    }

    function openMessageActionsBar(messageId, messageText, isFile, options = {}) {
        setState(messageId, messageText, isFile, options);

        if (!barEl) return;

        const blocked = isChatBlocked();
        if (titleEl) titleEl.textContent = '\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F \u0441 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435\u043C';
        if (previewEl) {
            const preview = String(messageText || '').replace(/\s+/g, ' ').trim();
            previewEl.textContent = preview ? preview.slice(0, 72) : '\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435';
        }
        if (editButtonEl) editButtonEl.style.display = (!blocked && state.canEdit) ? 'inline-flex' : 'none';
        if (copyButtonEl) copyButtonEl.style.display = isFile ? 'none' : 'inline-flex';
        if (deleteButtonEl) deleteButtonEl.style.display = blocked ? 'none' : 'inline-flex';
        if (selectButtonEl) selectButtonEl.style.display = blocked ? 'none' : 'inline-flex';

        barEl.classList.remove('message-actions-bar--hidden', 'is-closing');
        barEl.style.display = 'flex';
        barEl.setAttribute('aria-hidden', 'false');
        const seq = ++barMotionSeq;
        requestAnimationFrame(() => {
            if (seq !== barMotionSeq) return;
            barEl.classList.add('is-visible');
        });
    }

    function closeMessageActionsBar({ immediate = false } = {}) {
        setState(null, '', false, { canEdit: false });
        if (!barEl) return;

        const seq = ++barMotionSeq;
        barEl.classList.remove('is-visible');
        barEl.setAttribute('aria-hidden', 'true');

        if (immediate) {
            barEl.classList.remove('is-closing');
            barEl.classList.add('message-actions-bar--hidden');
            barEl.style.display = 'none';
            return;
        }

        barEl.classList.add('is-closing');
        waitForMotionEnd(barEl, 300).then(() => {
            if (seq !== barMotionSeq) return;
            barEl.classList.remove('is-closing');
            barEl.classList.add('message-actions-bar--hidden');
            barEl.style.display = 'none';
        });
    }

    function getState() {
        return { ...state };
    }

    closeMessageActionsBar({ immediate: true });

    return {
        setState,
        openMessageActionsBar,
        closeMessageActionsBar,
        getState,
    };
}
