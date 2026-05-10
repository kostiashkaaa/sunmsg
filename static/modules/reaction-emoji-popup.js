import { withAppRoot } from './app-url.js';
import {
    DEFAULT_EMOJI_CATEGORY,
    EMOJI_CATEGORY_META,
    EMOJI_CATEGORY_ORDER,
    EMOJI_PICKER_I18N,
    resolvePickerLocale,
} from './emoji-picker-data.js';

const RECENT_STORAGE_KEY = 'sun_recent_reaction_emojis_v1';
const MAX_RECENT = 40;
const GRID_CHUNK_SIZE = 120;
const GRID_SCROLL_PRELOAD_PX = 140;

function normalizeEmojiList(values, allowedSet) {
    const seen = new Set();
    const result = [];
    (Array.isArray(values) ? values : []).forEach((value) => {
        const emoji = String(value || '').trim();
        if (!emoji || !allowedSet.has(emoji) || seen.has(emoji)) return;
        seen.add(emoji);
        result.push(emoji);
    });
    return result;
}

function getLocaleCode() {
    const explicitLanguage = window.SUN_I18N?.getLanguage?.()
        || window.SUN_BOOTSTRAP?.user?.uiLanguage
        || document.documentElement.lang
        || '';
    return resolvePickerLocale(explicitLanguage);
}

function getLocaleStrings() {
    const localeCode = getLocaleCode();
    return {
        localeCode,
        strings: EMOJI_PICKER_I18N[localeCode] || EMOJI_PICKER_I18N.ru,
    };
}

function readRecentEmojis(allowedSet) {
    try {
        const parsed = JSON.parse(localStorage.getItem(RECENT_STORAGE_KEY) || '[]');
        return normalizeEmojiList(parsed, allowedSet).slice(0, MAX_RECENT);
    } catch (_) {
        return [];
    }
}

function saveRecentEmojis(values) {
    try {
        localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(values.slice(0, MAX_RECENT)));
    } catch (_) {
        // ignore quota/runtime storage errors
    }
}

function rememberRecentEmoji(emoji, allowedSet) {
    const normalized = String(emoji || '').trim();
    if (!normalized || !allowedSet.has(normalized)) return;
    const next = readRecentEmojis(allowedSet).filter((value) => value !== normalized);
    next.unshift(normalized);
    saveRecentEmojis(next);
}

function buildQuickEmojiList(allowedEmojis, allowedSet, limit) {
    const recents = readRecentEmojis(allowedSet);
    const merged = [];
    const seen = new Set();

    [...recents, ...allowedEmojis].forEach((emoji) => {
        const normalized = String(emoji || '').trim();
        if (!normalized || !allowedSet.has(normalized) || seen.has(normalized)) return;
        seen.add(normalized);
        merged.push(normalized);
    });

    return merged.slice(0, Math.max(1, Number(limit) || 9));
}

async function loadCategoryBuckets(allowedEmojis, allowedSet) {
    const fallback = new Map();
    fallback.set('peoples', [...allowedEmojis]);

    try {
        const response = await fetch(withAppRoot('/static/emojis.json'));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const buckets = new Map();

        EMOJI_CATEGORY_ORDER
            .filter((category) => category !== DEFAULT_EMOJI_CATEGORY)
            .forEach((category) => {
                const source = Array.isArray(data?.[category]) ? data[category] : [];
                const items = normalizeEmojiList(source, allowedSet);
                if (items.length) {
                    buckets.set(category, items);
                }
            });

        if (!buckets.size) {
            return fallback;
        }
        return buckets;
    } catch (_) {
        return fallback;
    }
}

function createEmojiButton(emoji) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'reaction-emoji-popup__item';
    button.setAttribute('data-reaction-emoji', emoji);
    button.setAttribute('aria-label', `Reaction ${emoji}`);
    button.textContent = emoji;
    return button;
}

export function initReactionEmojiPopup({
    allowedEmojis,
    getAnchorRect,
    getViewportBounds,
    onSelectEmoji,
    onOpen,
    onClose,
    onQuickListChange,
} = {}) {
    const normalizedAllowed = Array.isArray(allowedEmojis)
        ? allowedEmojis.map((value) => String(value || '').trim()).filter(Boolean)
        : [];
    const allowedSet = new Set(normalizedAllowed);
    if (!normalizedAllowed.length) {
        return {
            open() {},
            close() {},
            isOpen() { return false; },
            position() {},
            rememberEmoji() {},
            getQuickEmojis(limit = 9) { return buildQuickEmojiList([], new Set(), limit); },
            contains() { return false; },
        };
    }

    let categoryBucketsPromise = null;
    let categoryBuckets = new Map();
    let popupEl = null;
    let searchInputEl = null;
    let clearSearchEl = null;
    let categoriesEl = null;
    let viewportEl = null;
    let gridEl = null;

    let activeCategory = DEFAULT_EMOJI_CATEGORY;
    let searchQuery = '';
    let visible = false;
    let renderedList = [];
    let renderedCount = 0;
    let renderFrameId = 0;

    function ensureCategoryBuckets() {
        if (categoryBucketsPromise) return categoryBucketsPromise;
        categoryBucketsPromise = loadCategoryBuckets(normalizedAllowed, allowedSet)
            .then((buckets) => {
                categoryBuckets = buckets;
                return categoryBuckets;
            })
            .catch(() => {
                categoryBuckets = new Map([['peoples', [...normalizedAllowed]]]);
                return categoryBuckets;
            });
        return categoryBucketsPromise;
    }

    function getQuickEmojis(limit = 9) {
        return buildQuickEmojiList(normalizedAllowed, allowedSet, limit);
    }

    function syncQuickList() {
        onQuickListChange?.(getQuickEmojis(9));
    }

    function ensurePopupElement() {
        if (popupEl) return;
        popupEl = document.createElement('div');
        popupEl.className = 'reaction-emoji-popup telegram-popup';
        popupEl.setAttribute('aria-hidden', 'true');
        popupEl.innerHTML = `
            <div class="reaction-emoji-popup__search-wrap">
                <label class="reaction-emoji-popup__search" for="reactionEmojiSearchInput">
                    <i class="bi bi-search" aria-hidden="true"></i>
                    <input id="reactionEmojiSearchInput" type="search" autocomplete="off" spellcheck="false" />
                    <button type="button" class="reaction-emoji-popup__search-clear" aria-label="Clear" hidden>
                        <i class="bi bi-x" aria-hidden="true"></i>
                    </button>
                </label>
                <div class="reaction-emoji-popup__categories" role="tablist" aria-label="Reaction categories"></div>
            </div>
            <div class="reaction-emoji-popup__viewport">
                <div class="reaction-emoji-popup__grid"></div>
            </div>
        `;
        document.body.appendChild(popupEl);

        searchInputEl = popupEl.querySelector('#reactionEmojiSearchInput');
        clearSearchEl = popupEl.querySelector('.reaction-emoji-popup__search-clear');
        categoriesEl = popupEl.querySelector('.reaction-emoji-popup__categories');
        viewportEl = popupEl.querySelector('.reaction-emoji-popup__viewport');
        gridEl = popupEl.querySelector('.reaction-emoji-popup__grid');

        searchInputEl?.addEventListener('input', () => {
            searchQuery = String(searchInputEl.value || '').trim().toLowerCase();
            clearSearchEl.hidden = !searchQuery;
            rebuildGrid();
        });

        clearSearchEl?.addEventListener('click', (event) => {
            event.preventDefault();
            searchQuery = '';
            if (searchInputEl) {
                searchInputEl.value = '';
            }
            clearSearchEl.hidden = true;
            rebuildGrid();
        });

        categoriesEl?.addEventListener('click', (event) => {
            const button = event.target.closest('.reaction-emoji-popup__category-btn');
            if (!button || !categoriesEl.contains(button)) return;
            const category = String(button.getAttribute('data-category') || '').trim();
            if (!category) return;
            activeCategory = category;
            syncCategoryButtons();
            rebuildGrid();
        });

        viewportEl?.addEventListener('scroll', () => {
            if (!viewportEl) return;
            if (renderedCount >= renderedList.length) return;
            const remaining = viewportEl.scrollHeight - (viewportEl.scrollTop + viewportEl.clientHeight);
            if (remaining <= GRID_SCROLL_PRELOAD_PX) {
                renderNextChunk();
            }
        }, { passive: true });

        gridEl?.addEventListener('click', (event) => {
            const button = event.target.closest('.reaction-emoji-popup__item[data-reaction-emoji]');
            if (!button || !gridEl.contains(button)) return;
            const emoji = String(button.getAttribute('data-reaction-emoji') || '').trim();
            if (!emoji || !allowedSet.has(emoji)) return;
            rememberRecentEmoji(emoji, allowedSet);
            syncQuickList();
            onSelectEmoji?.(emoji);
        });
    }

    function buildCategoryCandidates() {
        const recents = getQuickEmojis(MAX_RECENT);
        const byCategory = new Map(categoryBuckets);
        byCategory.set(DEFAULT_EMOJI_CATEGORY, recents);
        return byCategory;
    }

    function getDisplayItems() {
        const byCategory = buildCategoryCandidates();
        if (searchQuery) {
            const needle = searchQuery;
            const seen = new Set();
            const merged = [];
            byCategory.forEach((items, category) => {
                const meta = EMOJI_CATEGORY_META[category] || EMOJI_CATEGORY_META.peoples;
                const tags = Array.isArray(meta?.searchTags) ? meta.searchTags : [];
                items.forEach((emoji) => {
                    if (seen.has(emoji)) return;
                    const matchEmoji = emoji.includes(needle);
                    const matchTag = tags.some((tag) => String(tag || '').toLowerCase().includes(needle));
                    if (!matchEmoji && !matchTag) return;
                    seen.add(emoji);
                    merged.push(emoji);
                });
            });
            return merged;
        }

        const categoryItems = byCategory.get(activeCategory);
        if (Array.isArray(categoryItems) && categoryItems.length) {
            return categoryItems;
        }

        return normalizedAllowed;
    }

    function cancelPendingChunkRender() {
        if (!renderFrameId) return;
        window.cancelAnimationFrame(renderFrameId);
        renderFrameId = 0;
    }

    function renderNextChunk() {
        if (!gridEl) return;
        if (renderedCount >= renderedList.length) return;
        const from = renderedCount;
        const to = Math.min(renderedList.length, from + GRID_CHUNK_SIZE);
        const fragment = document.createDocumentFragment();
        for (let i = from; i < to; i += 1) {
            fragment.appendChild(createEmojiButton(renderedList[i]));
        }
        gridEl.appendChild(fragment);
        renderedCount = to;

        if (renderedCount < renderedList.length && viewportEl && viewportEl.scrollHeight <= viewportEl.clientHeight + GRID_SCROLL_PRELOAD_PX) {
            cancelPendingChunkRender();
            renderFrameId = window.requestAnimationFrame(() => {
                renderFrameId = 0;
                renderNextChunk();
            });
        }
    }

    function syncCategoryButtons() {
        if (!categoriesEl) return;
        categoriesEl.querySelectorAll('.reaction-emoji-popup__category-btn').forEach((button) => {
            const category = String(button.getAttribute('data-category') || '').trim();
            const isActive = !searchQuery && category === activeCategory;
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
    }

    function renderCategoryButtons() {
        if (!categoriesEl) return;
        const byCategory = buildCategoryCandidates();
        const { localeCode } = getLocaleStrings();
        const fragment = document.createDocumentFragment();

        EMOJI_CATEGORY_ORDER.forEach((category) => {
            if (!byCategory.has(category) && category !== DEFAULT_EMOJI_CATEGORY) return;
            const meta = EMOJI_CATEGORY_META[category] || EMOJI_CATEGORY_META.peoples;
            const label = localeCode === 'en' ? meta.titleEn : meta.titleRu;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'reaction-emoji-popup__category-btn';
            button.setAttribute('data-category', category);
            button.setAttribute('title', label);
            button.setAttribute('aria-label', label);
            button.textContent = String(meta.icon || category);
            fragment.appendChild(button);
        });

        categoriesEl.replaceChildren(fragment);
        syncCategoryButtons();
    }

    function renderEmptyState() {
        if (!gridEl) return;
        const { strings } = getLocaleStrings();
        const fallback = searchQuery ? strings.emptySearch : strings.emptyRecent;
        gridEl.innerHTML = `<div class="reaction-emoji-popup__status">${fallback}</div>`;
        renderedCount = renderedList.length;
    }

    function rebuildGrid() {
        if (!gridEl || !viewportEl) return;
        cancelPendingChunkRender();
        renderedList = getDisplayItems();
        renderedCount = 0;
        viewportEl.scrollTop = 0;
        gridEl.innerHTML = '';
        syncCategoryButtons();

        if (!renderedList.length) {
            renderEmptyState();
            return;
        }

        renderNextChunk();
    }

    function position() {
        if (!popupEl || !visible) return;
        const anchorRect = getAnchorRect?.();
        const viewportBounds = getViewportBounds?.();
        if (!anchorRect || !viewportBounds) return;

        const margin = 10;
        const gap = 8;
        const popupRect = popupEl.getBoundingClientRect();
        const popupWidth = Math.max(280, Math.ceil(popupRect.width || 0));
        const popupHeight = Math.max(220, Math.ceil(popupRect.height || 0));
        const maxLeft = viewportBounds.right - popupWidth - margin;
        const minLeft = viewportBounds.left + margin;
        const maxTop = viewportBounds.bottom - popupHeight - margin;
        const minTop = viewportBounds.top + margin;

        let left = anchorRect.left + (anchorRect.width / 2) - (popupWidth / 2);
        let top = anchorRect.bottom + gap;
        if (top + popupHeight > viewportBounds.bottom - margin) {
            top = anchorRect.top - popupHeight - gap;
        }

        left = Math.min(maxLeft, Math.max(minLeft, left));
        top = Math.min(maxTop, Math.max(minTop, top));
        popupEl.style.left = `${Math.round(left)}px`;
        popupEl.style.top = `${Math.round(top)}px`;
    }

    function close() {
        ensurePopupElement();
        if (!visible) return;
        visible = false;
        cancelPendingChunkRender();
        popupEl.classList.remove('active', 'is-opening');
        popupEl.classList.add('is-closing');
        popupEl.setAttribute('aria-hidden', 'true');
        window.setTimeout(() => {
            if (visible) return;
            popupEl.classList.remove('is-closing');
            popupEl.style.left = '-9999px';
            popupEl.style.top = '-9999px';
        }, 180);
        onClose?.();
    }

    async function open() {
        ensurePopupElement();
        await ensureCategoryBuckets();
        const { strings } = getLocaleStrings();
        if (searchInputEl) {
            searchInputEl.placeholder = strings.searchPlaceholder;
        }
        searchQuery = '';
        activeCategory = DEFAULT_EMOJI_CATEGORY;
        if (searchInputEl) {
            searchInputEl.value = '';
        }
        if (clearSearchEl) {
            clearSearchEl.hidden = true;
        }
        renderCategoryButtons();
        rebuildGrid();

        visible = true;
        popupEl.classList.remove('is-closing');
        popupEl.classList.add('is-opening');
        popupEl.setAttribute('aria-hidden', 'false');
        position();
        window.requestAnimationFrame(() => {
            if (!visible) return;
            popupEl.classList.add('active');
            popupEl.classList.remove('is-opening');
        });
        onOpen?.();
    }

    function isOpen() {
        return visible;
    }

    function rememberEmoji(emoji) {
        rememberRecentEmoji(emoji, allowedSet);
        syncQuickList();
    }

    syncQuickList();

    return {
        open,
        close,
        isOpen,
        position,
        rememberEmoji,
        getQuickEmojis,
        contains(target) {
            return Boolean(popupEl?.contains(target));
        },
    };
}
