// sidebar-resize.js — drag-to-resize sidebar width, persisted in localStorage

export function initSidebarResize() {
    const sideResizer = document.getElementById('sideResizer');
    const sidebar     = document.getElementById('sidebar');
    if (!sideResizer || !sidebar) return;

    const DESKTOP_DEFAULT_WIDTH = 332;
    const DESKTOP_MIN_WIDTH = 132;
    const DESKTOP_MAX_WIDTH = 460;
    const SIDEBAR_COMPACT_THRESHOLD = 170;
    const clampWidth = (value) => Math.max(DESKTOP_MIN_WIDTH, Math.min(DESKTOP_MAX_WIDTH, value));
    const mobileSidebarQuery = typeof window.matchMedia === 'function'
        ? window.matchMedia('(max-width: 768px)')
        : null;
    const isMobileViewport = () => Boolean(mobileSidebarQuery?.matches);
    const readSidebarRenderedWidth = () => {
        const renderedWidth = Number.parseInt(getComputedStyle(sidebar).width, 10);
        return Number.isFinite(renderedWidth) ? renderedWidth : DESKTOP_DEFAULT_WIDTH;
    };
    const syncCompactSidebarState = (width) => {
        const nextWidth = Number.isFinite(Number(width)) ? Number(width) : readSidebarRenderedWidth();
        const shouldCompact = !isMobileViewport() && nextWidth <= SIDEBAR_COMPACT_THRESHOLD;
        sidebar.classList.toggle('sidebar--compact', shouldCompact);
    };

    const saved = localStorage.getItem('sidebarWidth');
    if (saved != null && saved !== '') {
        const parsed = Number.parseInt(saved, 10);
        const safeWidth = Number.isFinite(parsed) ? clampWidth(parsed) : DESKTOP_DEFAULT_WIDTH;
        document.documentElement.style.setProperty('--sidebar-width', `${safeWidth}px`);
        syncCompactSidebarState(safeWidth);
    } else {
        document.documentElement.style.setProperty('--sidebar-width', `${DESKTOP_DEFAULT_WIDTH}px`);
        syncCompactSidebarState(DESKTOP_DEFAULT_WIDTH);
    }

    let isResizing = false;

    sideResizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        document.body.style.cursor    = 'col-resize';
        document.body.style.userSelect = 'none';
        sideResizer.classList.add('active');
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const newWidth = clampWidth(e.clientX);
        document.documentElement.style.setProperty('--sidebar-width', newWidth + 'px');
        syncCompactSidebarState(newWidth);
    });

    document.addEventListener('mouseup', () => {
        if (!isResizing) return;
        isResizing = false;
        document.body.style.cursor    = '';
        document.body.style.userSelect = '';
        sideResizer.classList.remove('active');
        const persistedWidth = parseInt(getComputedStyle(sidebar).width, 10);
        localStorage.setItem('sidebarWidth', persistedWidth);
        syncCompactSidebarState(persistedWidth);
    });

    const handleViewportChange = () => syncCompactSidebarState(readSidebarRenderedWidth());
    if (mobileSidebarQuery) {
        if (typeof mobileSidebarQuery.addEventListener === 'function') {
            mobileSidebarQuery.addEventListener('change', handleViewportChange);
        } else if (typeof mobileSidebarQuery.addListener === 'function') {
            mobileSidebarQuery.addListener(handleViewportChange);
        }
    }
}
