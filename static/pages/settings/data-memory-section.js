import {
    buildChatCacheBreakdown,
    formatBytesCompact,
    normalizeDataMemoryStore,
    readDataMemoryStore,
    writeDataMemoryStore,
} from '../../modules/chat-cache-policy.js';
import {
    applyDataMemoryPolicy,
    clearAllManagedCache,
    clearChatCacheOnly,
    clearStreamFragmentCacheOnly,
    computeDataMemorySnapshot,
} from '../../modules/chat-cache-manager.js';

function toFixedOne(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '0.0';
    return numeric.toFixed(1);
}

function parseNumber(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function retentionLabel(days) {
    const value = Number(days) || 0;
    if (value <= 0) return 'Никогда';
    if (value === 1) return '1 день';
    if (value >= 2 && value <= 4) return `${value} дня`;
    return `${value} дней`;
}

export function initDataMemorySection({
    tr,
    showAlert,
    currentUserId,
}) {
    const root = document.getElementById('section-data-memory');
    if (!root) return;

    const autoDownloadSwitchEl = document.getElementById('dataMemoryAutoDownloadSwitch');
    const photosSwitchEl = document.getElementById('dataMemoryPhotosSwitch');
    const videosSwitchEl = document.getElementById('dataMemoryVideosSwitch');
    const filesLimitInputEl = document.getElementById('dataMemoryFilesLimitMb');
    const filesLimitValueEl = document.getElementById('dataMemoryFilesLimitValue');
    const retentionSelectEl = document.getElementById('dataMemoryRetentionSelect');
    const retentionValueEl = document.getElementById('dataMemoryRetentionValue');
    const maxCacheInputEl = document.getElementById('dataMemoryMaxCacheMb');
    const maxCacheValueEl = document.getElementById('dataMemoryMaxCacheValue');

    const cacheTotalEl = document.getElementById('dataMemoryCacheTotal');
    const cachePhotosEl = document.getElementById('dataMemoryCachePhotos');
    const cacheVideosEl = document.getElementById('dataMemoryCacheVideos');
    const cacheStickersEl = document.getElementById('dataMemoryCacheStickers');
    const cacheOtherEl = document.getElementById('dataMemoryCacheOther');
    const streamFragmentsEl = document.getElementById('dataMemoryStreamFragments');

    const clearCachedFilesBtnEl = document.getElementById('dataMemoryClearCachedFilesBtn');
    const clearStreamBtnEl = document.getElementById('dataMemoryClearStreamBtn');
    const clearAllBtnEl = document.getElementById('dataMemoryClearAllBtn');
    const refreshBtnEl = document.getElementById('dataMemoryRefreshBtn');

    let persistTimerId = 0;
    let policyRunInFlight = false;
    let policyRunQueued = false;
    let refreshSeq = 0;

    function updateFilesLimitLabel(value) {
        if (!filesLimitValueEl) return;
        filesLimitValueEl.textContent = `${toFixedOne(value)} MB`;
    }

    function updateRetentionLabel(days) {
        if (!retentionValueEl) return;
        retentionValueEl.textContent = retentionLabel(days);
    }

    function updateMaxCacheLabel(value) {
        if (!maxCacheValueEl) return;
        const numeric = Number(value) || 0;
        maxCacheValueEl.textContent = numeric <= 0 ? 'Авто' : `${numeric} MB`;
    }

    function updateAutoDownloadChildrenEnabled() {
        const enabled = !!autoDownloadSwitchEl?.checked;
        if (photosSwitchEl) photosSwitchEl.disabled = !enabled;
        if (videosSwitchEl) videosSwitchEl.disabled = !enabled;
        if (filesLimitInputEl) filesLimitInputEl.disabled = !enabled;
    }

    function readPrefsFromControls() {
        const existing = readDataMemoryStore();
        const next = normalizeDataMemoryStore({
            ...existing,
            autoDownloadMedia: !!autoDownloadSwitchEl?.checked,
            autoDownloadPhotos: !!photosSwitchEl?.checked,
            autoDownloadVideos: !!videosSwitchEl?.checked,
            autoDownloadFilesMaxMb: parseNumber(filesLimitInputEl?.value, existing.autoDownloadFilesMaxMb),
            cacheRetentionDays: parseNumber(retentionSelectEl?.value, existing.cacheRetentionDays),
            maxCacheMb: parseNumber(maxCacheInputEl?.value, existing.maxCacheMb),
        });
        return next;
    }

    function applyPrefsToControls(rawValue) {
        const prefs = normalizeDataMemoryStore(rawValue);

        if (autoDownloadSwitchEl) autoDownloadSwitchEl.checked = !!prefs.autoDownloadMedia;
        if (photosSwitchEl) photosSwitchEl.checked = !!prefs.autoDownloadPhotos;
        if (videosSwitchEl) videosSwitchEl.checked = !!prefs.autoDownloadVideos;
        if (filesLimitInputEl) filesLimitInputEl.value = String(prefs.autoDownloadFilesMaxMb);
        if (retentionSelectEl) retentionSelectEl.value = String(prefs.cacheRetentionDays);
        if (maxCacheInputEl) maxCacheInputEl.value = String(prefs.maxCacheMb);

        updateFilesLimitLabel(prefs.autoDownloadFilesMaxMb);
        updateRetentionLabel(prefs.cacheRetentionDays);
        updateMaxCacheLabel(prefs.maxCacheMb);
        updateAutoDownloadChildrenEnabled();
    }

    async function refreshUsageSnapshot() {
        const token = ++refreshSeq;
        const snapshot = await computeDataMemorySnapshot({
            userId: currentUserId,
        });
        if (token !== refreshSeq) return;

        const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
        const breakdown = snapshot.chatCache || buildChatCacheBreakdown(rows);
        if (cacheTotalEl) cacheTotalEl.textContent = formatBytesCompact(breakdown.totalBytes);
        if (cachePhotosEl) cachePhotosEl.textContent = formatBytesCompact(breakdown.categories.photos);
        if (cacheVideosEl) cacheVideosEl.textContent = formatBytesCompact(breakdown.categories.videos);
        if (cacheStickersEl) cacheStickersEl.textContent = formatBytesCompact(breakdown.categories.stickers);
        if (cacheOtherEl) cacheOtherEl.textContent = formatBytesCompact(breakdown.categories.other);
        if (streamFragmentsEl) streamFragmentsEl.textContent = formatBytesCompact(snapshot.streamCacheBytes);
    }

    async function runPolicyNow() {
        if (policyRunInFlight) {
            policyRunQueued = true;
            return;
        }
        policyRunInFlight = true;
        try {
            const prefs = readDataMemoryStore();
            await applyDataMemoryPolicy({
                userId: currentUserId,
                preferences: prefs,
            });
            await refreshUsageSnapshot();
        } finally {
            policyRunInFlight = false;
            if (policyRunQueued) {
                policyRunQueued = false;
                window.setTimeout(() => {
                    runPolicyNow().catch(() => {});
                }, 120);
            }
        }
    }

    function persistPrefsDebounced(delayMs = 260) {
        if (persistTimerId) {
            window.clearTimeout(persistTimerId);
        }
        persistTimerId = window.setTimeout(() => {
            persistTimerId = 0;
            const prefs = readPrefsFromControls();
            writeDataMemoryStore(prefs);
            runPolicyNow().catch(() => {});
        }, delayMs);
    }

    function bindControlEvents() {
        autoDownloadSwitchEl?.addEventListener('change', () => {
            updateAutoDownloadChildrenEnabled();
            persistPrefsDebounced(120);
        });
        photosSwitchEl?.addEventListener('change', () => persistPrefsDebounced(120));
        videosSwitchEl?.addEventListener('change', () => persistPrefsDebounced(120));

        filesLimitInputEl?.addEventListener('input', () => {
            updateFilesLimitLabel(filesLimitInputEl.value);
        });
        filesLimitInputEl?.addEventListener('change', () => persistPrefsDebounced(120));

        retentionSelectEl?.addEventListener('change', () => {
            updateRetentionLabel(retentionSelectEl.value);
            persistPrefsDebounced(60);
        });

        maxCacheInputEl?.addEventListener('input', () => {
            updateMaxCacheLabel(maxCacheInputEl.value);
        });
        maxCacheInputEl?.addEventListener('change', () => persistPrefsDebounced(60));
    }

    bindControlEvents();
    applyPrefsToControls(readDataMemoryStore());

    clearCachedFilesBtnEl?.addEventListener('click', async () => {
        clearCachedFilesBtnEl.disabled = true;
        try {
            await clearChatCacheOnly({ userId: currentUserId });
            await refreshUsageSnapshot();
            showAlert(tr('\u041A\u044D\u0448 \u0444\u0430\u0439\u043B\u043E\u0432 \u043E\u0447\u0438\u0449\u0435\u043D.'), 'success');
        } catch (_) {
            showAlert(tr('\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u043A\u044D\u0448 \u0444\u0430\u0439\u043B\u043E\u0432.'), 'danger');
        } finally {
            clearCachedFilesBtnEl.disabled = false;
        }
    });

    clearStreamBtnEl?.addEventListener('click', async () => {
        clearStreamBtnEl.disabled = true;
        try {
            await clearStreamFragmentCacheOnly();
            await refreshUsageSnapshot();
            showAlert(tr('\u041A\u044D\u0448 \u0432\u0438\u0434\u0435\u043E\u0444\u0440\u0430\u0433\u043C\u0435\u043D\u0442\u043E\u0432 \u043E\u0447\u0438\u0449\u0435\u043D.'), 'success');
        } catch (_) {
            showAlert(tr('\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u043A\u044D\u0448 \u0432\u0438\u0434\u0435\u043E\u0444\u0440\u0430\u0433\u043C\u0435\u043D\u0442\u043E\u0432.'), 'danger');
        } finally {
            clearStreamBtnEl.disabled = false;
        }
    });

    clearAllBtnEl?.addEventListener('click', async () => {
        clearAllBtnEl.disabled = true;
        try {
            await clearAllManagedCache({ userId: currentUserId });
            await refreshUsageSnapshot();
            showAlert(tr('\u0412\u0435\u0441\u044C \u043A\u044D\u0448 \u043E\u0447\u0438\u0449\u0435\u043D.'), 'success');
        } catch (_) {
            showAlert(tr('\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u0432\u0435\u0441\u044C \u043A\u044D\u0448.'), 'danger');
        } finally {
            clearAllBtnEl.disabled = false;
        }
    });

    refreshBtnEl?.addEventListener('click', () => {
        refreshUsageSnapshot().catch(() => {});
    });

    runPolicyNow().catch(() => {});
}
