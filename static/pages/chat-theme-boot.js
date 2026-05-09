(() => {
    const PERFORMANCE_PREFERENCE_KEY = 'sun_performance_mode';
    const MOTION_PREFERENCE_KEY = 'sun_motion_level';

    function readStoredPerformancePreference() {
        try {
            const raw = String(localStorage.getItem(PERFORMANCE_PREFERENCE_KEY) || '').trim().toLowerCase();
            if (raw === 'lite' || raw === 'full' || raw === 'auto') return raw;
        } catch (_) {}
        return 'auto';
    }

    function readStoredMotionPreference() {
        try {
            const raw = String(localStorage.getItem(MOTION_PREFERENCE_KEY) || '').trim().toLowerCase();
            if (raw === 'full' || raw === 'balanced' || raw === 'lite' || raw === 'auto') return raw;
        } catch (_) {}
        return 'auto';
    }

    function detectHardwareProfile() {
        const hardwareConcurrency = Number(navigator.hardwareConcurrency || 0);
        const deviceMemory = Number(navigator.deviceMemory || 0);
        const saveData = Boolean(navigator.connection?.saveData);

        const weakCpu = hardwareConcurrency > 0 && hardwareConcurrency <= 2;
        const lowMemory = deviceMemory > 0 && deviceMemory <= 2;
        const mediumCpu = hardwareConcurrency > 0 && hardwareConcurrency <= 4;
        const mediumMemory = deviceMemory > 0 && deviceMemory <= 4;

        return {
            saveData,
            weakCpu,
            lowMemory,
            mediumCpu,
            mediumMemory,
        };
    }

    function shouldUseLiteMode(preference) {
        if (preference === 'lite') return true;
        if (preference === 'full') return false;
        const profile = detectHardwareProfile();
        return profile.weakCpu || profile.lowMemory || profile.saveData;
    }

    function resolveMotionLevel(preference) {
        if (preference === 'full' || preference === 'balanced' || preference === 'lite') {
            return preference;
        }
        const profile = detectHardwareProfile();
        if (profile.weakCpu || profile.lowMemory || profile.saveData) return 'lite';
        if (profile.mediumCpu || profile.mediumMemory) return 'balanced';
        return 'full';
    }

    function installReducedMotionRuntimeBridge() {
        if (window.__sunMotionMatchMediaPatched) return;
        if (typeof window.matchMedia !== 'function') return;
        const nativeMatchMedia = window.matchMedia.bind(window);
        window.__sunMotionMatchMediaPatched = true;
        window.__sunMotionNativeMatchMedia = nativeMatchMedia;
        window.matchMedia = (query) => {
            const mediaQuery = String(query || '');
            const list = nativeMatchMedia(mediaQuery);
            if (!/prefers-reduced-motion\s*:\s*reduce/i.test(mediaQuery)) {
                return list;
            }
            const currentLevel = String(
                document.documentElement.getAttribute('data-motion-level')
                || window.SUN_MOTION?.level
                || 'full'
            ).trim().toLowerCase();
            if (currentLevel === 'lite') {
                return list;
            }
            return {
                media: list.media,
                get matches() { return false; },
                get onchange() { return list.onchange; },
                set onchange(value) { list.onchange = value; },
                addListener(listener) {
                    if (typeof list.addListener === 'function') list.addListener(listener);
                },
                removeListener(listener) {
                    if (typeof list.removeListener === 'function') list.removeListener(listener);
                },
                addEventListener(type, listener, options) {
                    if (typeof list.addEventListener === 'function') {
                        list.addEventListener(type, listener, options);
                    }
                },
                removeEventListener(type, listener, options) {
                    if (typeof list.removeEventListener === 'function') {
                        list.removeEventListener(type, listener, options);
                    }
                },
                dispatchEvent(event) {
                    return typeof list.dispatchEvent === 'function' ? list.dispatchEvent(event) : false;
                },
            };
        };
    }

    const performancePreference = readStoredPerformancePreference();
    const motionPreference = readStoredMotionPreference();
    const motionLevel = resolveMotionLevel(motionPreference);
    const isLitePerformance = shouldUseLiteMode(performancePreference);
    document.documentElement.classList.toggle('perf-lite', isLitePerformance);
    document.documentElement.setAttribute('data-performance-mode', isLitePerformance ? 'lite' : 'full');
    document.documentElement.setAttribute('data-motion-level', motionLevel);
    installReducedMotionRuntimeBridge();
    window.SUN_PERFORMANCE_MODE = {
        preference: performancePreference,
        isLite: isLitePerformance,
    };
    window.SUN_MOTION = {
        preference: motionPreference,
        level: motionLevel,
        forceAnimations: motionLevel !== 'lite',
    };

    try {
        if (localStorage.getItem('darkMode') === 'true') {
            document.documentElement.classList.add('dark-mode');
        } else {
            document.documentElement.classList.remove('dark-mode');
        }
    } catch (_error) {
        document.documentElement.classList.remove('dark-mode');
    }
})();
