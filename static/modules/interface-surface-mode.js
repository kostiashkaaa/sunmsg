export const INTERFACE_SURFACE_MODE_STORAGE_KEY = 'sun_interface_surface_mode_v1';
export const INTERFACE_SURFACE_MODE_GLASS = 'glass';
export const INTERFACE_SURFACE_MODE_SOLID = 'solid';

export function normalizeInterfaceSurfaceMode(value) {
    return String(value || '').trim().toLowerCase() === INTERFACE_SURFACE_MODE_SOLID
        ? INTERFACE_SURFACE_MODE_SOLID
        : INTERFACE_SURFACE_MODE_GLASS;
}

export function readStoredInterfaceSurfaceMode(fallback = INTERFACE_SURFACE_MODE_GLASS) {
    try {
        const raw = window.localStorage.getItem(INTERFACE_SURFACE_MODE_STORAGE_KEY);
        if (raw === INTERFACE_SURFACE_MODE_GLASS || raw === INTERFACE_SURFACE_MODE_SOLID) return raw;
    } catch (_) {}
    return normalizeInterfaceSurfaceMode(fallback);
}

export function applyInterfaceSurfaceMode(mode, { persist = false, notify = false } = {}) {
    const safeMode = normalizeInterfaceSurfaceMode(mode);
    const root = document.documentElement;
    if (root) root.setAttribute('data-interface-surface', safeMode);
    if (document.body) document.body.setAttribute('data-interface-surface', safeMode);

    if (persist) {
        try {
            window.localStorage.setItem(INTERFACE_SURFACE_MODE_STORAGE_KEY, safeMode);
        } catch (_) {}
    }

    if (notify) {
        document.dispatchEvent(new CustomEvent('sun-interface-surface-mode-changed', {
            detail: { mode: safeMode },
        }));
    }
    return safeMode;
}

export function resolveInterfaceSurfaceMode(preferences = {}) {
    const raw = preferences && typeof preferences === 'object'
        ? preferences.interfaceSurfaceMode
        : '';
    return readStoredInterfaceSurfaceMode(raw || INTERFACE_SURFACE_MODE_GLASS);
}
