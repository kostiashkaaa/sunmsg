// message-search.js — in-chat message search (highlight + navigate)

let searchMatchedMessageIds = [];
let searchActiveMatchIndex  = -1;

function _escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function _highlightInElement(el, query) {
    if (!el) return;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    const re = new RegExp('(' + _escapeRegex(query) + ')', 'gi');
    nodes.forEach(node => {
        if (!node.textContent.toLowerCase().includes(query.toLowerCase())) return;
        const frag = document.createDocumentFragment();
        const parts = node.textContent.split(re);
        parts.forEach(part => {
            if (part.toLowerCase() === query.toLowerCase()) {
                const mark = document.createElement('mark');
                mark.className = 'search-highlight';
                mark.textContent = part;
                frag.appendChild(mark);
            } else {
                frag.appendChild(document.createTextNode(part));
            }
        });
        node.parentNode.replaceChild(frag, node);
    });
}

function _clearSearchHighlights() {
    document.querySelectorAll('.message').forEach(m => {
        m.style.display = '';
        m.querySelectorAll('mark.search-highlight').forEach(mark => {
            mark.replaceWith(document.createTextNode(mark.textContent));
        });
    });
}

export function applyActiveMessageSearchFilter() {
    const headerSearchInput = document.getElementById('headerSearchInput');
    const query = headerSearchInput?.value.trim() || '';
    _clearSearchHighlights();
    if (!query) {
        document.querySelectorAll('.message').forEach(m => m.style.display = '');
        searchMatchedMessageIds = [];
        searchActiveMatchIndex  = -1;
        return;
    }
    const matched = [];
    document.querySelectorAll('.message').forEach(m => {
        const raw = m.getAttribute('data-message-content') || '';
        if (raw.toLowerCase().includes(query.toLowerCase())) {
            m.style.display = '';
            _highlightInElement(m.querySelector('.message-text, .file-caption'), query);
            const msgId = Number(m.getAttribute('data-msg-id'));
            if (Number.isFinite(msgId) && msgId > 0) matched.push(msgId);
        } else {
            m.style.display = 'none';
        }
    });
    searchMatchedMessageIds = matched;
    if (searchMatchedMessageIds.length === 0) {
        searchActiveMatchIndex = -1;
        return;
    }
    if (searchActiveMatchIndex >= searchMatchedMessageIds.length) {
        searchActiveMatchIndex = 0;
    }
}

export function initMessageSearch() {
    const chatHeader = document.getElementById('chatHeader');
    const headerSearchWrap  = document.getElementById('headerSearchWrap');
    const headerSearchInput = document.getElementById('headerSearchInput');
    const openSearch = () => {
        chatHeader?.classList.add('chat-header--search-active');
        headerSearchWrap?.classList.add('active');
        requestAnimationFrame(() => headerSearchInput?.focus());
    };
    const closeSearch = () => {
        chatHeader?.classList.remove('chat-header--search-active');
        headerSearchWrap?.classList.remove('active');
        if (headerSearchInput) headerSearchInput.value = '';
        searchMatchedMessageIds = [];
        searchActiveMatchIndex  = -1;
        _clearSearchHighlights();
    };

    document.getElementById('searchChatBtn')?.addEventListener('click', () => {
        openSearch();
    });

    document.getElementById('closeSearchBtn')?.addEventListener('click', () => {
        closeSearch();
    });

    headerSearchInput?.addEventListener('input', () => {
        applyActiveMessageSearchFilter();
    });

    headerSearchInput?.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        if (!searchMatchedMessageIds.length) return;
        e.preventDefault();
        if (e.shiftKey) {
            searchActiveMatchIndex = searchActiveMatchIndex <= 0
                ? (searchMatchedMessageIds.length - 1)
                : (searchActiveMatchIndex - 1);
        } else {
            searchActiveMatchIndex = (searchActiveMatchIndex + 1) % searchMatchedMessageIds.length;
        }
        const targetId = searchMatchedMessageIds[searchActiveMatchIndex];
        window._scrollToMsg(targetId, { source: 'search' });
    });

    headerSearchInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            closeSearch();
        }
    });
}
