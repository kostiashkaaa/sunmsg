// sidebar-resize.js — drag-to-resize sidebar width, persisted in localStorage

export function initSidebarResize() {
    const sideResizer = document.getElementById('sideResizer');
    const sidebar     = document.getElementById('sidebar');
    if (!sideResizer || !sidebar) return;

    const DESKTOP_DEFAULT_WIDTH = 420;
    const DESKTOP_MIN_WIDTH = 400;
    const DESKTOP_MAX_WIDTH = 700;
    const clampWidth = (value) => Math.max(DESKTOP_MIN_WIDTH, Math.min(DESKTOP_MAX_WIDTH, value));

    const saved = localStorage.getItem('sidebarWidth');
    if (saved != null && saved !== '') {
        const parsed = Number.parseInt(saved, 10);
        const safeWidth = Number.isFinite(parsed) ? clampWidth(parsed) : DESKTOP_DEFAULT_WIDTH;
        document.documentElement.style.setProperty('--sidebar-width', `${safeWidth}px`);
    } else {
        document.documentElement.style.setProperty('--sidebar-width', `${DESKTOP_DEFAULT_WIDTH}px`);
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
    });

    document.addEventListener('mouseup', () => {
        if (!isResizing) return;
        isResizing = false;
        document.body.style.cursor    = '';
        document.body.style.userSelect = '';
        sideResizer.classList.remove('active');
        localStorage.setItem('sidebarWidth', parseInt(getComputedStyle(sidebar).width));
    });
}
