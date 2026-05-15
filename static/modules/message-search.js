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
        m.classList.remove('search-active-match');
        m.querySelectorAll('mark.search-highlight').forEach(mark => {
            mark.replaceWith(document.createTextNode(mark.textContent));
        });
    });
}

function _updateCounter() {
    const counterEl = document.getElementById('headerSearchCounter');
    const prevBtn = document.getElementById('headerSearchPrevBtn');
    const nextBtn = document.getElementById('headerSearchNextBtn');
    const total = searchMatchedMessageIds.length;
    if (!counterEl) return;
    if (total === 0) {
        counterEl.hidden = true;
        if (prevBtn) prevBtn.hidden = true;
        if (nextBtn) nextBtn.hidden = true;
        return;
    }
    const current = searchActiveMatchIndex >= 0 ? searchActiveMatchIndex + 1 : 1;
    counterEl.textContent = `${current} из ${total}`;
    counterEl.hidden = false;
    if (prevBtn) prevBtn.hidden = false;
    if (nextBtn) nextBtn.hidden = false;
}

function _highlightActiveMatch() {
    document.querySelectorAll('.message.search-active-match').forEach(m => {
        m.classList.remove('search-active-match');
    });
    if (searchActiveMatchIndex < 0 || searchActiveMatchIndex >= searchMatchedMessageIds.length) return;
    const targetId = searchMatchedMessageIds[searchActiveMatchIndex];
    const msgEl = document.querySelector(`.message[data-msg-id="${CSS.escape(String(targetId))}"]`);
    if (msgEl) msgEl.classList.add('search-active-match');
}

function _navigateTo(index) {
    if (!searchMatchedMessageIds.length) return;
    searchActiveMatchIndex = ((index % searchMatchedMessageIds.length) + searchMatchedMessageIds.length) % searchMatchedMessageIds.length;
    _highlightActiveMatch();
    _updateCounter();
    const targetId = searchMatchedMessageIds[searchActiveMatchIndex];
    window._scrollToMsg?.(targetId, { source: 'search' });
}

export function applyActiveMessageSearchFilter() {
    const headerSearchInput = document.getElementById('headerSearchInput');
    const query = headerSearchInput?.value.trim() || '';
    _clearSearchHighlights();
    if (!query) {
        searchMatchedMessageIds = [];
        searchActiveMatchIndex  = -1;
        _updateCounter();
        return;
    }
    const matched = [];
    document.querySelectorAll('.message').forEach(m => {
        const raw = m.getAttribute('data-message-content') || '';
        if (raw.toLowerCase().includes(query.toLowerCase())) {
            _highlightInElement(m.querySelector('.message-text, .file-caption'), query);
            const msgId = Number(m.getAttribute('data-msg-id'));
            if (Number.isFinite(msgId) && msgId > 0) matched.push(msgId);
        }
    });
    // Newest first → reverse to chronological order for navigation
    searchMatchedMessageIds = matched.reverse();
    if (searchMatchedMessageIds.length === 0) {
        searchActiveMatchIndex = -1;
        _updateCounter();
        return;
    }
    // Jump to last (most recent) match
    searchActiveMatchIndex = searchMatchedMessageIds.length - 1;
    _highlightActiveMatch();
    _updateCounter();
    const targetId = searchMatchedMessageIds[searchActiveMatchIndex];
    window._scrollToMsg?.(targetId, { source: 'search' });
}

export function initMessageSearch() {
    const chatHeader       = document.getElementById('chatHeader');
    const headerSearchWrap = document.getElementById('headerSearchWrap');
    const headerSearchInput= document.getElementById('headerSearchInput');
    const prevBtn          = document.getElementById('headerSearchPrevBtn');
    const nextBtn          = document.getElementById('headerSearchNextBtn');

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
        _updateCounter();
    };

    document.getElementById('searchChatBtn')?.addEventListener('click', () => openSearch());
    document.getElementById('closeSearchBtn')?.addEventListener('click', () => closeSearch());

    headerSearchInput?.addEventListener('input', () => applyActiveMessageSearchFilter());

    headerSearchInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            closeSearch();
            return;
        }
        if (e.key !== 'Enter') return;
        if (!searchMatchedMessageIds.length) return;
        e.preventDefault();
        _navigateTo(e.shiftKey ? searchActiveMatchIndex - 1 : searchActiveMatchIndex + 1);
    });

    prevBtn?.addEventListener('click', () => _navigateTo(searchActiveMatchIndex - 1));
    nextBtn?.addEventListener('click', () => _navigateTo(searchActiveMatchIndex + 1));
}
