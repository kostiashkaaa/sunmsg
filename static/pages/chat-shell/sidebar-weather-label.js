import { prefersReducedMotion } from '../../modules/motion.js';

const WEATHER_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const GEOLOCATION_TIMEOUT_MS = 8000;
const GEOLOCATION_MAX_AGE_MS = 10 * 60 * 1000;
const VALID_SOURCES = new Set(['auto', 'city']);
const VALID_ROTATE_SECONDS = new Set([30, 60]);
const LABEL_SWAP_OUT_DURATION_MS = 160;
const LABEL_SWAP_IN_DURATION_MS = 220;
const LABEL_SWAP_OUT_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';
const LABEL_SWAP_IN_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

export function normalizeSidebarWeatherPreferences(rawValue) {
    const raw = rawValue && typeof rawValue === 'object'
        ? rawValue
        : {};
    const enabled = raw.sidebarWeatherEnabled === true;
    const sourceRaw = String(raw.sidebarWeatherSource || '').trim().toLowerCase();
    const source = VALID_SOURCES.has(sourceRaw) ? sourceRaw : 'auto';
    const city = String(raw.sidebarWeatherCity || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);

    const rotateRaw = Number.parseInt(String(raw.sidebarWeatherRotateSeconds || ''), 10);
    const rotateSeconds = VALID_ROTATE_SECONDS.has(rotateRaw) ? rotateRaw : 60;

    return {
        sidebarWeatherEnabled: enabled,
        sidebarWeatherSource: source,
        sidebarWeatherCity: city,
        sidebarWeatherRotateSeconds: rotateSeconds,
    };
}

function formatTemperatureLabel(value) {
    if (!Number.isFinite(value)) return '';
    const rounded = Math.round(value);
    const prefix = rounded > 0 ? '+' : '';
    return `${prefix}${rounded}°`;
}

function resolveCoordinatesFromGeolocation() {
    if (!navigator.geolocation || typeof navigator.geolocation.getCurrentPosition !== 'function') {
        return Promise.resolve({ coords: null, permissionDenied: false });
    }

    return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const latitude = Number(position?.coords?.latitude);
                const longitude = Number(position?.coords?.longitude);
                if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
                    resolve({ coords: null, permissionDenied: false });
                    return;
                }
                resolve({
                    coords: { latitude, longitude },
                    permissionDenied: false,
                });
            },
            (error) => {
                resolve({
                    coords: null,
                    permissionDenied: Number(error?.code) === 1,
                });
            },
            {
                enableHighAccuracy: false,
                timeout: GEOLOCATION_TIMEOUT_MS,
                maximumAge: GEOLOCATION_MAX_AGE_MS,
            },
        );
    });
}

async function resolveCoordinatesFromCity(city, language = 'ru') {
    const cityQuery = String(city || '').trim();
    if (cityQuery.length < 2) return null;

    const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.searchParams.set('name', cityQuery);
    url.searchParams.set('count', '1');
    url.searchParams.set('language', language === 'en' ? 'en' : 'ru');
    url.searchParams.set('format', 'json');

    const response = await fetch(url.toString(), {
        method: 'GET',
        cache: 'no-store',
    });
    if (!response.ok) return null;

    const payload = await response.json().catch(() => null);
    const first = Array.isArray(payload?.results) ? payload.results[0] : null;
    const latitude = Number(first?.latitude);
    const longitude = Number(first?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return { latitude, longitude };
}

async function fetchTemperatureByCoordinates(coords) {
    if (!coords) return null;
    const latitude = Number(coords.latitude);
    const longitude = Number(coords.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', String(latitude));
    url.searchParams.set('longitude', String(longitude));
    url.searchParams.set('current', 'temperature_2m');
    url.searchParams.set('temperature_unit', 'celsius');

    const response = await fetch(url.toString(), {
        method: 'GET',
        cache: 'no-store',
    });
    if (!response.ok) return null;

    const payload = await response.json().catch(() => null);
    const fromCurrent = Number(payload?.current?.temperature_2m);
    if (Number.isFinite(fromCurrent)) return fromCurrent;
    const fromLegacy = Number(payload?.current_weather?.temperature);
    if (Number.isFinite(fromLegacy)) return fromLegacy;
    return null;
}

export function initSidebarWeatherLabel({
    labelEl = document.querySelector('.sidebar-brand-name'),
    baseLabel = '',
    clientPreferences = {},
    language = () => String(document.documentElement.lang || 'ru').toLowerCase(),
} = {}) {
    if (!labelEl) return null;

    const base = String(baseLabel || labelEl.textContent || 'sun').trim() || 'sun';
    let prefs = normalizeSidebarWeatherPreferences(clientPreferences);
    let rotationTimerId = 0;
    let weatherTimerId = 0;
    let requestSeq = 0;
    let destroyed = false;
    let showWeatherLabel = false;
    let weatherLabel = '';
    let geolocationBlocked = false;
    let labelTransitionSeq = 0;
    let activeLabelAnimation = null;
    let hasRenderedLabel = false;
    const cityCoordinatesCache = new Map();

    function applyLabelText(next) {
        if (labelEl.textContent !== next) {
            labelEl.textContent = next;
        }
        labelEl.setAttribute('title', next);
    }

    function stopActiveLabelAnimation() {
        if (!activeLabelAnimation) return;
        try {
            activeLabelAnimation.cancel();
        } catch (_) {}
        activeLabelAnimation = null;
    }

    function canAnimateLabelTransition() {
        return typeof labelEl.animate === 'function' && !prefersReducedMotion();
    }

    async function animateLabelChange(next, seq) {
        stopActiveLabelAnimation();
        activeLabelAnimation = labelEl.animate(
            [
                {
                    opacity: 1,
                    transform: 'translate3d(0, 0, 0) scale(1)',
                    filter: 'blur(0px)',
                },
                {
                    opacity: 0,
                    transform: 'translate3d(0, -5px, 0) scale(0.985)',
                    filter: 'blur(1px)',
                },
            ],
            {
                duration: LABEL_SWAP_OUT_DURATION_MS,
                easing: LABEL_SWAP_OUT_EASING,
                fill: 'forwards',
            },
        );
        try {
            await activeLabelAnimation.finished;
        } catch (_) {}
        if (destroyed || seq !== labelTransitionSeq) return;

        applyLabelText(next);
        activeLabelAnimation = labelEl.animate(
            [
                {
                    opacity: 0,
                    transform: 'translate3d(0, 5px, 0) scale(0.985)',
                    filter: 'blur(1px)',
                },
                {
                    opacity: 1,
                    transform: 'translate3d(0, 0, 0) scale(1)',
                    filter: 'blur(0px)',
                },
            ],
            {
                duration: LABEL_SWAP_IN_DURATION_MS,
                easing: LABEL_SWAP_IN_EASING,
                fill: 'forwards',
            },
        );
        try {
            await activeLabelAnimation.finished;
        } catch (_) {}
        if (seq === labelTransitionSeq) {
            activeLabelAnimation = null;
        }
    }

    function setLabel(value, { immediate = false } = {}) {
        const next = String(value || base).trim() || base;
        if (!hasRenderedLabel || immediate || !canAnimateLabelTransition()) {
            stopActiveLabelAnimation();
            applyLabelText(next);
            hasRenderedLabel = true;
            return;
        }
        if (labelEl.textContent === next) {
            labelEl.setAttribute('title', next);
            return;
        }
        const seq = ++labelTransitionSeq;
        void animateLabelChange(next, seq).catch(() => {
            if (destroyed || seq !== labelTransitionSeq) return;
            stopActiveLabelAnimation();
            applyLabelText(next);
        });
    }

    function renderLabel() {
        if (!prefs.sidebarWeatherEnabled || !weatherLabel) {
            setLabel(base);
            return;
        }
        setLabel(showWeatherLabel ? weatherLabel : base);
    }

    function clearTimers() {
        if (rotationTimerId) {
            window.clearInterval(rotationTimerId);
            rotationTimerId = 0;
        }
        if (weatherTimerId) {
            window.clearInterval(weatherTimerId);
            weatherTimerId = 0;
        }
    }

    function startRotationTimer() {
        if (!prefs.sidebarWeatherEnabled) return;
        const intervalMs = Math.max(30, Number(prefs.sidebarWeatherRotateSeconds) || 60) * 1000;
        rotationTimerId = window.setInterval(() => {
            if (!prefs.sidebarWeatherEnabled || !weatherLabel) {
                showWeatherLabel = false;
                renderLabel();
                return;
            }
            showWeatherLabel = !showWeatherLabel;
            renderLabel();
        }, intervalMs);
    }

    async function resolveWeatherCoordinates() {
        if (prefs.sidebarWeatherSource === 'city') {
            const city = String(prefs.sidebarWeatherCity || '').trim();
            if (!city) return null;
            const cacheKey = city.toLowerCase();
            if (cityCoordinatesCache.has(cacheKey)) {
                return cityCoordinatesCache.get(cacheKey);
            }
            const coords = await resolveCoordinatesFromCity(city, language());
            if (coords) {
                cityCoordinatesCache.set(cacheKey, coords);
            }
            return coords;
        }

        if (geolocationBlocked) return null;
        const geo = await resolveCoordinatesFromGeolocation();
        if (geo.permissionDenied) {
            geolocationBlocked = true;
        }
        return geo.coords;
    }

    async function refreshWeatherNow() {
        if (destroyed) return;
        if (!prefs.sidebarWeatherEnabled) {
            weatherLabel = '';
            showWeatherLabel = false;
            renderLabel();
            return;
        }

        const seq = ++requestSeq;
        try {
            const coords = await resolveWeatherCoordinates();
            if (destroyed || seq !== requestSeq) return;
            if (!coords) {
                weatherLabel = '';
                showWeatherLabel = false;
                renderLabel();
                return;
            }

            const temperature = await fetchTemperatureByCoordinates(coords);
            if (destroyed || seq !== requestSeq) return;
            const formatted = formatTemperatureLabel(temperature);
            weatherLabel = formatted;
            if (!formatted) {
                showWeatherLabel = false;
            }
            renderLabel();
        } catch (_) {
            if (destroyed || seq !== requestSeq) return;
            weatherLabel = '';
            showWeatherLabel = false;
            renderLabel();
        }
    }

    function startWeatherRefreshTimer() {
        if (!prefs.sidebarWeatherEnabled) return;
        weatherTimerId = window.setInterval(() => {
            void refreshWeatherNow();
        }, WEATHER_REFRESH_INTERVAL_MS);
    }

    function applyPreferences(nextValue) {
        const rawPrefs = nextValue && typeof nextValue === 'object' && nextValue.clientPreferences
            ? nextValue.clientPreferences
            : nextValue;
        const nextPrefs = normalizeSidebarWeatherPreferences(rawPrefs);
        const sourceChanged = nextPrefs.sidebarWeatherSource !== prefs.sidebarWeatherSource;
        prefs = nextPrefs;
        if (sourceChanged) {
            geolocationBlocked = false;
        }
        showWeatherLabel = false;
        weatherLabel = '';
        clearTimers();
        renderLabel();
        if (prefs.sidebarWeatherEnabled) {
            startRotationTimer();
            startWeatherRefreshTimer();
            void refreshWeatherNow();
        }
    }

    applyPreferences(prefs);

    return {
        refresh: () => refreshWeatherNow(),
        updatePreferences(nextValue) {
            applyPreferences(nextValue);
        },
        destroy() {
            destroyed = true;
            clearTimers();
            setLabel(base, { immediate: true });
        },
    };
}
