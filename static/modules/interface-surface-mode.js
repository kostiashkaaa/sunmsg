export const INTERFACE_SURFACE_MODE_STORAGE_KEY = 'sun_interface_surface_mode_v1';
export const INTERFACE_SURFACE_MODE_GLASS = 'glass';
export const INTERFACE_SURFACE_MODE_SOLID = 'solid';

const SURFACE_TRANSITION_CLASS = 'is-interface-surface-transitioning';
const SURFACE_TRANSITION_MS = 520;
let surfaceTransitionTimer = 0;

export function canUseLiquidGlass() {
    if (typeof window === 'undefined') return false;
    return window.SUN_BOOTSTRAP?.app?.liquidGlassEnabled === true;
}

export function normalizeInterfaceSurfaceMode(value) {
    return String(value || '').trim().toLowerCase() === INTERFACE_SURFACE_MODE_GLASS && canUseLiquidGlass()
        ? INTERFACE_SURFACE_MODE_GLASS
        : INTERFACE_SURFACE_MODE_SOLID;
}

export function readStoredInterfaceSurfaceMode(fallback = INTERFACE_SURFACE_MODE_SOLID) {
    try {
        const raw = window.localStorage.getItem(INTERFACE_SURFACE_MODE_STORAGE_KEY);
        if (raw === INTERFACE_SURFACE_MODE_GLASS || raw === INTERFACE_SURFACE_MODE_SOLID) {
            return normalizeInterfaceSurfaceMode(raw);
        }
    } catch (_) {}
    return normalizeInterfaceSurfaceMode(fallback);
}

function setInterfaceSurfaceModeAttribute(mode) {
    const root = document.documentElement;
    if (root) root.setAttribute('data-interface-surface', mode);
    if (document.body) document.body.setAttribute('data-interface-surface', mode);
}

function canAnimateInterfaceSurfaceMode(root, currentMode, nextMode, animate) {
    if (!animate || !root || !currentMode || currentMode === nextMode) return false;
    if (root.dataset.motionLevel === 'lite') return false;
    try {
        return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (_) {
        return true;
    }
}

function finishInterfaceSurfaceTransition(root, delayMs = SURFACE_TRANSITION_MS) {
    window.clearTimeout(surfaceTransitionTimer);
    surfaceTransitionTimer = window.setTimeout(() => {
        root.classList.remove(SURFACE_TRANSITION_CLASS);
    }, delayMs);
}

export function applyInterfaceSurfaceMode(mode, { persist = false, notify = false, animate = notify } = {}) {
    const safeMode = normalizeInterfaceSurfaceMode(mode);
    const root = document.documentElement;
    const currentMode = root?.getAttribute('data-interface-surface') || '';
    const shouldAnimate = canAnimateInterfaceSurfaceMode(root, currentMode, safeMode, animate);

    if (shouldAnimate) {
        root.classList.add(SURFACE_TRANSITION_CLASS);
        window.clearTimeout(surfaceTransitionTimer);
        if (typeof document.startViewTransition === 'function') {
            try {
                const transition = document.startViewTransition(() => setInterfaceSurfaceModeAttribute(safeMode));
                transition.finished
                    .finally(() => finishInterfaceSurfaceTransition(root, 0))
                    .catch(() => {});
            } catch (_) {
                setInterfaceSurfaceModeAttribute(safeMode);
                finishInterfaceSurfaceTransition(root);
            }
        } else {
            setInterfaceSurfaceModeAttribute(safeMode);
            finishInterfaceSurfaceTransition(root);
        }
    } else {
        setInterfaceSurfaceModeAttribute(safeMode);
    }

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
    return readStoredInterfaceSurfaceMode(raw || INTERFACE_SURFACE_MODE_SOLID);
}
