function asNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function formatPercent(value) {
    const number = asNumber(value);
    return number === null ? 'н/д' : `${Math.max(0, Math.min(100, number)).toFixed(1)}%`;
}

function formatBytes(value) {
    const bytes = asNumber(value);
    if (bytes === null || bytes < 0) return 'н/д';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
    }
    return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDuration(seconds) {
    const value = asNumber(seconds);
    if (value === null || value < 0) return 'н/д';
    const total = Math.floor(value);
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    if (days > 0) return `${days} д ${hours} ч`;
    if (hours > 0) return `${hours} ч ${minutes} мин`;
    return `${minutes} мин`;
}

function setText(root, selector, value) {
    const element = root?.querySelector(selector);
    if (element) element.textContent = value;
}

export function renderServerStats(root, payload) {
    const server = payload?.server;
    if (!root || !server || typeof server !== 'object') return;

    const cpu = server.cpu || {};
    const memory = server.memory || {};
    const disk = server.disk || {};
    const process = server.process || {};
    const cpuPercent = asNumber(cpu.usage_percent) ?? asNumber(cpu.load_percent_1m);

    setText(root, '[data-server-metric="cpu_load"]', formatPercent(cpuPercent));
    const cpuDetail = [
        asNumber(cpu.logical_count) === null ? null : `${Math.trunc(Number(cpu.logical_count))} лог. CPU`,
        asNumber(cpu.load_average_1m) === null ? null : `load ${Number(cpu.load_average_1m).toFixed(2)}`,
    ].filter(Boolean).join(' · ');
    setText(root, '[data-server-metric-detail="cpu_load"]', cpuDetail || 'нет данных');

    setText(root, '[data-server-metric="memory_used"]', formatPercent(memory.used_percent));
    setText(
        root,
        '[data-server-metric-detail="memory_used"]',
        `${formatBytes(memory.used_bytes)} / ${formatBytes(memory.total_bytes)}`
    );

    setText(root, '[data-server-metric="disk_used"]', formatPercent(disk.used_percent));
    setText(
        root,
        '[data-server-metric-detail="disk_used"]',
        `${formatBytes(disk.used_bytes)} / ${formatBytes(disk.total_bytes)}`
    );

    setText(root, '[data-server-metric="process_uptime"]', formatDuration(process.uptime_seconds));
    const rss = asNumber(process.rss_bytes) === null ? null : `RSS ${formatBytes(process.rss_bytes)}`;
    const threads = asNumber(process.python_threads) === null ? null : `threads ${Math.trunc(Number(process.python_threads))}`;
    setText(root, '[data-server-metric-detail="process_uptime"]', [rss, threads].filter(Boolean).join(' · ') || 'нет данных');

    if (server.collected_at) {
        setText(root, '[data-server-collected-at]', `обновлено: ${server.collected_at}`);
    }
}

export function initModerationServerStats(doc = document, win = window) {
    const root = doc.querySelector('[data-server-stats]');
    if (!root) return;

    win.addEventListener('sun:moderation-metrics', (event) => {
        renderServerStats(root, event.detail);
    });
    if (win.SUN_LAST_MODERATION_METRICS) {
        renderServerStats(root, win.SUN_LAST_MODERATION_METRICS);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initModerationServerStats(), { once: true });
} else {
    initModerationServerStats();
}
