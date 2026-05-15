/**
 * chat-album-runtime.js
 *
 * After each virtual render pass, finds consecutive .message nodes that share
 * the same data-album-id from the same sender and wraps their bubble media
 * into a single .message-album-grid inside the first message's bubble,
 * hiding the remaining individual message nodes.
 *
 * Telegram-style album layout:
 *   1 photo  → full-width single bubble (normal)
 *   2 photos → side by side
 *   3 photos → 1 wide on top, 2 below
 *   4 photos → 2×2 grid
 *   5+ photos → 2 columns, last row fills remaining space
 */

const ALBUM_ATTR = 'data-album-id';
const ALBUM_PROCESSED_ATTR = 'data-album-processed';

/**
 * Collect groups of consecutive .message nodes with the same album-id
 * from the same sender (data-album-id + .self/.other).
 */
function collectAlbumGroups(container) {
    const nodes = Array.from(container.querySelectorAll(`.message[${ALBUM_ATTR}]`));
    if (!nodes.length) return [];

    const groups = [];
    let current = null;

    for (const node of nodes) {
        const albumId = node.getAttribute(ALBUM_ATTR);
        const sender = node.classList.contains('self') ? 'self' : 'other';
        const key = `${albumId}::${sender}`;

        if (current && current.key === key) {
            // Only group if siblings with no non-album messages between them
            const lastNode = current.nodes[current.nodes.length - 1];
            if (areConsecutiveInDOM(lastNode, node)) {
                current.nodes.push(node);
                continue;
            }
        }
        // Start new group
        current = { key, albumId, sender, nodes: [node] };
        groups.push(current);
    }

    return groups.filter((g) => g.nodes.length > 1);
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
    const wrapper = node.querySelector('.image-wrapper, .video-preview');
    const isVideo = Boolean(vid);

    const src = img?.getAttribute('data-src') || vid?.getAttribute('data-src') || '';
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

    return { src, mediaSrc, aspectRatio, kind, caption, isVideo, isUploading, uploadProgress, duration };
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

    let gridHtml = `<div class="message-album-grid" style="--album-rows:${totalRows};--album-cols:${totalCols}">`;

    for (let i = 0; i < count; i++) {
        const item = items[i];
        const cell = cells[i];
        const { src, mediaSrc, kind, caption, isVideo, duration } = item;
        const { row, col, rowspan = 1, colspan = 1 } = cell;

        const style = [
            `grid-row: ${row + 1} / span ${rowspan}`,
            `grid-column: ${col + 1} / span ${colspan}`,
        ].join('; ');

        const triggerAttrs = [
            `data-media-aspect-ratio="1"`,
            `data-media-kind="${kind}"`,
            `data-media-src="${escapeAttr(mediaSrc || src)}"`,
            `data-caption="${escapeAttr(caption)}"`,
        ].join(' ');

        const mediaEl = isVideo
            ? `<video class="album-cell-video file-msg-video-preview" data-src="${escapeAttr(src)}" preload="none" playsinline muted onloadeddata="this.classList.add('is-loaded')"></video>
               <div class="video-preview-gradient" aria-hidden="true"></div>
               <button class="video-preview-play" type="button" tabindex="-1" aria-hidden="true"><i class="bi bi-play-fill"></i></button>
               ${duration ? `<span class="video-duration video-preview-duration">${escapeAttr(duration)}</span>` : ''}`
            : `<img class="album-cell-img file-msg-img" data-src="${escapeAttr(src)}" loading="lazy" decoding="async" alt="" onload="this.classList.add('is-loaded')">`;

        gridHtml += `
            <div class="album-cell file-msg-media-trigger" style="${style}" ${triggerAttrs}>
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

    // Already processed and up-to-date?
    const existingGrid = primary.querySelector('.message-album-grid');
    const processedCount = primary.getAttribute(ALBUM_PROCESSED_ATTR);
    if (existingGrid && processedCount === String(nodes.length)) return;

    // Extract media from each node
    const items = nodes.map(extractMediaFromNode);

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

    // Insert grid before message-footer
    const footer = bubble.querySelector('.message-footer');
    if (footer) {
        bubble.insertAdjacentHTML('afterbegin', gridHtml + captionHtml);
    } else {
        bubble.insertAdjacentHTML('beforeend', gridHtml + captionHtml);
    }

    // Mark processed
    primary.setAttribute(ALBUM_PROCESSED_ATTR, String(nodes.length));

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
        n.querySelector('.message-album-grid')?.remove();
        n.querySelector('.album-caption')?.remove();
    });
}
