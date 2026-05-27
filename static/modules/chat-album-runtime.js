/**
 * chat-album-runtime.js
 *
 * After each virtual render pass, finds consecutive .message nodes that share
 * the same data-album-id from the same sender and wraps their bubble media
 * into a single .message-album-grid inside the first message's bubble,
 * hiding the remaining individual message nodes.
 *
 * messenger-style album layout:
 *   1 photo  → full-width single bubble (normal)
 *   2 photos → side by side
 *   3 photos → 1 wide on top, 2 below
 *   4 photos → 2×2 grid
 *   5+ photos → 2 columns, last row fills remaining space
 */

const ALBUM_ATTR = 'data-album-id';
const ALBUM_PROCESSED_ATTR = 'data-album-processed';
const ALBUM_SIGNATURE_ATTR = 'data-album-signature';

/**
 * Collect groups of consecutive .message nodes with the same album-id
 * from the same sender (data-album-id + .self/.other).
 */
function collectAlbumGroups(container) {
    const nodes = Array.from(container.querySelectorAll(`.message[${ALBUM_ATTR}]`));
    if (!nodes.length) return [];

    // Group by albumId+sender using a map, then sort each group by DOM order.
    // We don't rely on strict DOM adjacency — same album_id + same sender = same group.
    const groupMap = new Map();
    for (const node of nodes) {
        const albumId = node.getAttribute(ALBUM_ATTR);
        const sender = node.classList.contains('self') ? 'self' : 'other';
        const key = `${albumId}::${sender}`;
        if (!groupMap.has(key)) {
            groupMap.set(key, { key, albumId, sender, nodes: [] });
        }
        groupMap.get(key).nodes.push(node);
    }

    // Sort each group's nodes by DOM order (compareDocumentPosition)
    for (const group of groupMap.values()) {
        group.nodes.sort((a, b) => {
            const rel = a.compareDocumentPosition(b);
            // eslint-disable-next-line no-bitwise
            return rel & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
        });
    }

    return Array.from(groupMap.values()).filter((g) => g.nodes.length > 1);
}

/**
 * Returns true if `b` comes right after `a` in the DOM,
 * with only whitespace text nodes or .chat-virtual-spacer between them.
 */
function areConsecutiveInDOM(a, b) {
    let cursor = a.nextSibling;
    while (cursor) {
        if (cursor === b) return true;
        const isText = cursor.nodeType === Node.TEXT_NODE && cursor.textContent.trim() === '';
        const isSpacer = cursor.nodeType === Node.ELEMENT_NODE
            && cursor.classList.contains('chat-virtual-spacer');
        const isDaySep = cursor.nodeType === Node.ELEMENT_NODE
            && cursor.classList.contains('day-separator');
        if (isText || isSpacer || isDaySep) {
            cursor = cursor.nextSibling;
            continue;
        }
        // A real non-album element between a and b — they're not consecutive
        return false;
    }
    return false;
}

/**
 * Extract the media element (img or video thumbnail) src from a message node.
 */
function extractMediaFromNode(node) {
    const img = node.querySelector('.file-msg-img');
    const vid = node.querySelector('.file-msg-video-preview');
    const mediaEl = img || vid;
    const wrapper = node.querySelector('.image-wrapper, .video-preview');
    const isVideo = Boolean(vid);

    const src = img?.getAttribute('data-src') || vid?.getAttribute('data-src') || '';
    const resolvedSrc = getRestorableMediaSource(mediaEl);
    const isLoaded = isMediaLoaded(mediaEl);
    const trigger = node.querySelector('.file-msg-media-trigger');
    const aspectRatio = parseFloat(
        wrapper?.style.getPropertyValue('--media-aspect-ratio')
        || trigger?.getAttribute('data-media-aspect-ratio')
        || '1'
    ) || 1;

    const mediaSrc = trigger?.getAttribute('data-media-src') || src;
    const caption = trigger?.getAttribute('data-caption') || '';
    const kind = trigger?.getAttribute('data-media-kind') || (isVideo ? 'video' : 'image');

    const uploadOverlay = node.querySelector('.media-status-overlay');
    const isUploading = Boolean(uploadOverlay && !uploadOverlay.classList.contains('is-hidden'));
    const uploadProgress = isUploading
        ? parseFloat(node.querySelector('.media-status-ring')?.style.getPropertyValue('--upload-progress') || '0')
        : 100;

    // Duration badge for videos
    const durationEl = node.querySelector('.video-preview-duration');
    const duration = durationEl?.textContent?.trim() || '';

    return { src, resolvedSrc, isLoaded, mediaSrc, aspectRatio, kind, caption, isVideo, isUploading, uploadProgress, duration };
}

function normalizeMediaSource(src) {
    return String(src || '').trim();
}

function isEncryptedMediaSource(src) {
    return String(src || '').includes('sun_media_e2ee=');
}

function getRestorableMediaSource(mediaEl) {
    const resolvedSrc = normalizeMediaSource(mediaEl?.currentSrc)
        || normalizeMediaSource(mediaEl?.getAttribute?.('src'));
    return resolvedSrc && !isEncryptedMediaSource(resolvedSrc) ? resolvedSrc : '';
}

function isMediaLoaded(mediaEl) {
    if (!mediaEl) return false;
    if (normalizeMediaSource(mediaEl.getAttribute?.('data-loaded'))) return true;
    if (mediaEl.classList?.contains?.('is-loaded')) return true;
    if (mediaEl.closest?.('.image-wrapper, .video-preview, .album-cell')?.classList?.contains?.('is-loaded')) return true;
    if (mediaEl.complete === true && Number(mediaEl.naturalWidth) > 0) return true;
    return Number(mediaEl.readyState) >= 1;
}

function buildAlbumSignature(items) {
    return JSON.stringify(items.map((item) => [
        item.kind,
        item.src,
        item.mediaSrc,
        item.resolvedSrc,
        item.caption,
        item.duration,
    ].map((value) => String(value || ''))));
}

/**
 * Build the album grid HTML for N media items.
 * Returns { html, captionHtml }
 */
function buildAlbumGridHtml(items) {
    const count = items.length;

    // Grid layout: map index → { row, col, rowspan, colspan } based on count
    const cells = resolveGridCells(count);

    const totalRows = Math.max(...cells.map((c) => c.row + (c.rowspan || 1)));
    const totalCols = 2; // always 2 columns

    let gridHtml = `<div class="message-album-grid" data-album-rows="${totalRows}" data-album-cols="${totalCols}">`;

    for (let i = 0; i < count; i++) {
        const item = items[i];
        const cell = cells[i];
        const { src, resolvedSrc, isLoaded, mediaSrc, kind, caption, isVideo, duration } = item;
        const { row, col, rowspan = 1, colspan = 1 } = cell;
        const restoredSrc = getSafeRestoredAlbumSource(resolvedSrc);
        const loadedClass = restoredSrc && isLoaded ? ' is-loaded' : '';
        const loadedAttr = restoredSrc && isLoaded ? ' data-loaded="1"' : '';
        const restoredSrcAttr = restoredSrc ? ` src="${escapeAttr(restoredSrc)}"` : '';

        const triggerAttrs = [
            `data-media-aspect-ratio="1"`,
            `data-media-kind="${kind}"`,
            `data-media-src="${escapeAttr(mediaSrc || src)}"`,
            `data-caption="${escapeAttr(caption)}"`,
            `data-album-row="${row + 1}"`,
            `data-album-col="${col + 1}"`,
            `data-album-rowspan="${rowspan}"`,
            `data-album-colspan="${colspan}"`,
        ].join(' ');

        const mediaEl = isVideo
            ? `<video class="album-cell-video${loadedClass}" data-src="${escapeAttr(src)}"${restoredSrcAttr}${loadedAttr} preload="none" playsinline muted></video>
               <div class="video-preview-gradient" aria-hidden="true"></div>
               <button class="video-preview-play" type="button" tabindex="-1" aria-hidden="true"><i class="bi bi-play-fill"></i></button>
               ${duration ? `<span class="video-duration video-preview-duration">${escapeAttr(duration)}</span>` : ''}`
            : `<img class="album-cell-img${loadedClass}" data-src="${escapeAttr(src)}"${restoredSrcAttr}${loadedAttr} loading="lazy" decoding="async" alt="">`;

        gridHtml += `
            <div class="album-cell file-msg-media-trigger${loadedClass}" ${triggerAttrs}>
                ${mediaEl}
                <div class="album-cell-count-badge" aria-hidden="true"></div>
            </div>`;
    }

    gridHtml += '</div>';

    // Caption from first item that has one
    const captionText = items.find((it) => it.caption)?.caption || '';
    const captionHtml = captionText
        ? `<div class="file-caption album-caption">${escapeHtmlText(captionText)}</div>`
        : '';

    return { gridHtml, captionHtml };
}

function applyAlbumGridStyles(grid) {
    if (!grid) return;
    const rows = Number(grid.getAttribute('data-album-rows') || 0) || 1;
    const cols = Number(grid.getAttribute('data-album-cols') || 0) || 2;
    grid.style.setProperty('--album-rows', String(rows));
    grid.style.setProperty('--album-cols', String(cols));
    grid.querySelectorAll('.album-cell').forEach((cell) => {
        const row = Number(cell.getAttribute('data-album-row') || 0) || 1;
        const col = Number(cell.getAttribute('data-album-col') || 0) || 1;
        const rowspan = Number(cell.getAttribute('data-album-rowspan') || 0) || 1;
        const colspan = Number(cell.getAttribute('data-album-colspan') || 0) || 1;
        cell.style.gridRow = `${row} / span ${rowspan}`;
        cell.style.gridColumn = `${col} / span ${colspan}`;
    });
}

/**
 * Map N items to grid cells (row, col, rowspan, colspan).
 * Strategy: 2-column grid, last row may have 1 item spanning full width.
 */
function resolveGridCells(count) {
    if (count === 2) {
        return [
            { row: 0, col: 0, rowspan: 1, colspan: 1 },
            { row: 0, col: 1, rowspan: 1, colspan: 1 },
        ];
    }
    if (count === 3) {
        return [
            { row: 0, col: 0, rowspan: 1, colspan: 2 }, // top full width
            { row: 1, col: 0, rowspan: 1, colspan: 1 },
            { row: 1, col: 1, rowspan: 1, colspan: 1 },
        ];
    }
    if (count === 4) {
        return [
            { row: 0, col: 0 }, { row: 0, col: 1 },
            { row: 1, col: 0 }, { row: 1, col: 1 },
        ];
    }
    // 5+: fill 2 columns row by row, last odd item spans full width
    const cells = [];
    for (let i = 0; i < count; i++) {
        const isLast = i === count - 1;
        const isOddLast = isLast && count % 2 !== 0;
        cells.push({
            row: Math.floor(i / 2),
            col: isOddLast ? 0 : i % 2,
            colspan: isOddLast ? 2 : 1,
            rowspan: 1,
        });
    }
    return cells;
}

function escapeAttr(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function getSafeRestoredAlbumSource(src) {
    const restoredSrc = normalizeMediaSource(src);
    return restoredSrc && !isEncryptedMediaSource(restoredSrc) ? restoredSrc : '';
}

function escapeHtmlText(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Process one album group: take media from each node, render grid into first node,
 * hide subsequent nodes.
 */
function processAlbumGroup(group) {
    const { nodes } = group;
    const [primary, ...rest] = nodes;

    const items = nodes.map(extractMediaFromNode);
    const signature = buildAlbumSignature(items);

    const existingGrid = primary.querySelector('.message-album-grid');
    const processedCount = primary.getAttribute(ALBUM_PROCESSED_ATTR);
    const processedSignature = primary.getAttribute(ALBUM_SIGNATURE_ATTR);
    if (existingGrid && processedCount === String(nodes.length) && processedSignature === signature) return;

    // Build grid
    const { gridHtml, captionHtml } = buildAlbumGridHtml(items);

    // Replace bubble content inside primary
    const bubble = primary.querySelector('.bubble');
    if (!bubble) return;

    // Remove old album grid if present
    bubble.querySelector('.message-album-grid')?.remove();
    bubble.querySelector('.album-caption')?.remove();

    // Remove individual image/video wrappers from primary bubble
    bubble.querySelector('.image-wrapper')?.remove();
    bubble.querySelector('.video-preview')?.remove();
    bubble.querySelector('.background-layer')?.remove();
    bubble.querySelector('.file-caption:not(.album-caption)')?.remove();

    // Remove bubble--image/bubble--video classes, add album class
    bubble.classList.remove('bubble--image', 'bubble--video', 'bubble--image-has-caption', 'bubble--video-has-caption');
    bubble.classList.add('bubble--album');
    bubble.classList.toggle('bubble--album-has-caption', Boolean(captionHtml));

    // Insert grid before message-footer
    const footer = bubble.querySelector('.message-footer');
    if (footer) {
        bubble.insertAdjacentHTML('afterbegin', gridHtml + captionHtml);
    } else {
        bubble.insertAdjacentHTML('beforeend', gridHtml + captionHtml);
    }
    applyAlbumGridStyles(bubble.querySelector('.message-album-grid'));

    // Set cell height based on bubble width so cells are square-ish
    requestAnimationFrame(() => {
        const grid = bubble.querySelector('.message-album-grid');
        if (!grid) return;
        const bubbleWidth = bubble.getBoundingClientRect().width || bubble.offsetWidth;
        if (bubbleWidth > 0) {
            const cols = Number(grid.getAttribute('data-album-cols') || 2) || 2;
            const cellSize = Math.round((bubbleWidth - (cols - 1) * 2) / cols);
            grid.style.setProperty('--album-cell-height', `${cellSize}px`);
        }
    });

    // Wire load/error events for album cells (hydration wires them too, but cover the sync-complete case)
    bubble.querySelectorAll('.album-cell-img').forEach((img) => {
        const cell = img.closest('.album-cell');
        const markLoaded = () => { img.classList.add('is-loaded'); cell?.classList.add('is-loaded'); };
        const markError = () => { cell?.classList.add('is-loaded'); };
        if (img.complete && img.naturalWidth > 0) {
            markLoaded();
        } else if (img.complete) {
            markError();
        } else {
            img.addEventListener('load', markLoaded, { once: true });
            img.addEventListener('error', markError, { once: true });
        }
    });
    bubble.querySelectorAll('.album-cell-video').forEach((vid) => {
        const cell = vid.closest('.album-cell');
        const markLoaded = () => { vid.classList.add('is-loaded'); cell?.classList.add('is-loaded'); };
        vid.addEventListener('loadeddata', markLoaded, { once: true });
    });

    // Mark processed
    primary.setAttribute(ALBUM_PROCESSED_ATTR, String(nodes.length));
    primary.setAttribute(ALBUM_SIGNATURE_ATTR, signature);

    // Hide rest of the album nodes but keep them in DOM for data
    for (const node of rest) {
        node.classList.add('message-album-hidden');
        node.setAttribute('aria-hidden', 'true');
    }

    // Apply lazy hydration to new media elements via injected callback
    if (typeof processAlbumGroup._registerHydration === 'function') {
        processAlbumGroup._registerHydration(primary);
    }
}

/**
 * Main entry point: scan container for album groups and process them.
 * @param {Element} container
 * @param {{ registerHydration?: (el: Element) => void }} [opts]
 */
export function processAlbums(container, opts = {}) {
    if (!container) return;
    if (typeof opts.registerHydration === 'function') {
        processAlbumGroup._registerHydration = opts.registerHydration;
    }
    const groups = collectAlbumGroups(container);
    for (const group of groups) {
        try {
            processAlbumGroup(group);
        } catch (err) {
            // Never break the whole render for album processing errors
            console.warn('[album]', err);
        }
    }
}

/**
 * Reset album state for a container (e.g. on chat switch).
 */
export function resetAlbums(container) {
    if (!container) return;
    container.querySelectorAll('.message-album-hidden').forEach((n) => {
        n.classList.remove('message-album-hidden');
        n.removeAttribute('aria-hidden');
    });
    container.querySelectorAll(`[${ALBUM_PROCESSED_ATTR}]`).forEach((n) => {
        n.removeAttribute(ALBUM_PROCESSED_ATTR);
        n.removeAttribute(ALBUM_SIGNATURE_ATTR);
        n.querySelector('.message-album-grid')?.remove();
        n.querySelector('.album-caption')?.remove();
    });
}
