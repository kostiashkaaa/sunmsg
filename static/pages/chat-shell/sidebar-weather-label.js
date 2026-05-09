import { prefersReducedMotion } from '../../modules/motion.js';

const WEATHER_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const GEOLOCATION_TIMEOUT_MS = 8000;
const GEOLOCATION_MAX_AGE_MS = 10 * 60 * 1000;
const VALID_SOURCES = new Set(['auto', 'city']);
const VALID_ROTATE_SECONDS = new Set([30, 60]);
const VALID_METRICS = new Set([
    'temperature',
    'feels_like',
    'humidity',
    'wind',
    'precip',
    'uv',
    'aqi',
    'pressure',
    'sun_cycle',
]);
const DEFAULT_METRICS = Object.freeze(['temperature']);
const FORECAST_CURRENT_FIELDS = Object.freeze([
    'temperature_2m',
    'apparent_temperature',
    'relative_humidity_2m',
    'wind_speed_10m',
    'pressure_msl',
    'uv_index',
    'precipitation_probability',
]);
const FORECAST_DAILY_FIELDS = Object.freeze(['sunrise', 'sunset']);
const LABEL_SWAP_OUT_DURATION_MS = 160;
const LABEL_SWAP_IN_DURATION_MS = 220;
const LABEL_SWAP_OUT_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';
const LABEL_SWAP_IN_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

function normalizeMetricList(rawValue, { fallbackToDefault = true } = {}) {
    if (!Array.isArray(rawValue)) {
        return fallbackToDefault ? [...DEFAULT_METRICS] : [];
    }
    const result = [];
    const seen = new Set();
    rawValue.forEach((entry) => {
        const metric = String(entry || '').trim().toLowerCase();
        if (!VALID_METRICS.has(metric) || seen.has(metric)) return;
        seen.add(metric);
        result.push(metric);
    });
    return result;
}

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
    const hasExplicitMetrics = Object.prototype.hasOwnProperty.call(raw, 'sidebarWeatherMetrics');
    const sidebarWeatherMetrics = normalizeMetricList(raw.sidebarWeatherMetrics, {
        fallbackToDefault: !hasExplicitMetrics,
    });

    return {
        sidebarWeatherEnabled: enabled,
        sidebarWeatherSource: source,
        sidebarWeatherCity: city,
        sidebarWeatherRotateSeconds: rotateSeconds,
        sidebarWeatherMetrics,
    };
}

function formatTemperatureLabel(value) {
    if (!Number.isFinite(value)) return '';
    const rounded = Math.round(value);
    const prefix = rounded > 0 ? '+' : '';
    return `${prefix}${rounded}°`;
}

function normalizeLabelLanguage(value) {
    const raw = String(value || '').trim().toLowerCase();
    return raw.startsWith('en') ? 'en' : 'ru';
}

function formatFeelsLikeLabel(value, language = 'ru') {
    const temp = formatTemperatureLabel(value);
    if (!temp) return '';
    const prefix = language === 'en' ? 'feels' : 'ощ';
    return `${prefix} ${temp}`;
}

function formatHumidityLabel(value, language = 'ru') {
    if (!Number.isFinite(value)) return '';
    const prefix = language === 'en' ? 'hum' : 'вл';
    return `${prefix} ${Math.round(value)}%`;
}

function formatWindLabel(value, language = 'ru') {
    if (!Number.isFinite(value)) return '';
    const prefix = language === 'en' ? 'wind' : 'вет';
    const unit = language === 'en' ? 'm/s' : 'м/с';
    return `${prefix} ${Math.round(value)}${unit}`;
}

function formatPrecipitationLabel(value, language = 'ru') {
    if (!Number.isFinite(value)) return '';
    const prefix = language === 'en' ? 'rain' : 'дождь';
    return `${prefix} ${Math.round(value)}%`;
}

function formatUvLabel(value) {
    if (!Number.isFinite(value)) return '';
    return `UV ${Math.round(value)}`;
}

function formatAqiLabel(value) {
    if (!Number.isFinite(value)) return '';
    return `AQI ${Math.round(value)}`;
}

function formatPressureLabel(value, language = 'ru') {
    if (!Number.isFinite(value)) return '';
    const mmHg = Math.round(value * 0.75006156);
    const prefix = language === 'en' ? 'pres' : 'давл';
    return `${prefix} ${mmHg}`;
}

function extractClockPart(value) {
    const text = String(value || '');
    const match = text.match(/T(\d{2}:\d{2})/);
    return match ? match[1] : '';
}

function formatSunCycleLabel(snapshot) {
    if (!snapshot) return '';
    const now = String(snapshot.currentTime || '');
    const sunriseToday = String(snapshot.sunriseToday || '');
    const sunsetToday = String(snapshot.sunsetToday || '');
    const sunriseTomorrow = String(snapshot.sunriseTomorrow || '');

    if (now && sunriseToday && now < sunriseToday) {
        const time = extractClockPart(sunriseToday);
        return time ? `☀ ${time}` : '';
    }
    if (now && sunsetToday && now < sunsetToday) {
        const time = extractClockPart(sunsetToday);
        return time ? `🌙 ${time}` : '';
    }
    if (sunriseTomorrow) {
        const time = extractClockPart(sunriseTomorrow);
        return time ? `☀ ${time}` : '';
    }
    if (sunriseToday) {
        const time = extractClockPart(sunriseToday);
        return time ? `☀ ${time}` : '';
    }
    if (sunsetToday) {
        const time = extractClockPart(sunsetToday);
        return time ? `🌙 ${time}` : '';
    }
    return '';
}

function firstNumeric(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
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
    const cityQuery = String(city || '')
        .split(',')[0]
        .replace(/\s+/g, ' ')
        .trim();
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

async function fetchAqiByCoordinates(coords) {
    if (!coords) return null;
    const latitude = Number(coords.latitude);
    const longitude = Number(coords.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

    const url = new URL('https://air-quality-api.open-meteo.com/v1/air-quality');
    url.searchParams.set('latitude', String(latitude));
    url.searchParams.set('longitude', String(longitude));
    url.searchParams.set('current', 'us_aqi');
    url.searchParams.set('timezone', 'auto');

    const response = await fetch(url.toString(), {
        method: 'GET',
        cache: 'no-store',
    });
    if (!response.ok) return null;

    const payload = await response.json().catch(() => null);
    return firstNumeric(payload?.current?.us_aqi);
}

async function fetchWeatherSnapshotByCoordinates(coords, { includeAqi = false } = {}) {
    if (!coords) return null;
    const latitude = Number(coords.latitude);
    const longitude = Number(coords.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', String(latitude));
    url.searchParams.set('longitude', String(longitude));
    url.searchParams.set('current', FORECAST_CURRENT_FIELDS.join(','));
    url.searchParams.set('daily', FORECAST_DAILY_FIELDS.join(','));
    url.searchParams.set('temperature_unit', 'celsius');
    url.searchParams.set('wind_speed_unit', 'ms');
    url.searchParams.set('timezone', 'auto');

    const response = await fetch(url.toString(), {
        method: 'GET',
        cache: 'no-store',
    });
    if (!response.ok) return null;

    const payload = await response.json().catch(() => null);
    const current = payload?.current || {};
    const daily = payload?.daily || {};
    const sunrise = Array.isArray(daily?.sunrise) ? daily.sunrise : [];
    const sunset = Array.isArray(daily?.sunset) ? daily.sunset : [];

    const snapshot = {
        temperature: firstNumeric(current?.temperature_2m),
        apparentTemperature: firstNumeric(current?.apparent_temperature),
        humidity: firstNumeric(current?.relative_humidity_2m),
        windSpeed: firstNumeric(current?.wind_speed_10m),
        pressureMsl: firstNumeric(current?.pressure_msl),
        uvIndex: firstNumeric(current?.uv_index),
        precipitationProbability: firstNumeric(current?.precipitation_probability),
        currentTime: String(current?.time || ''),
        sunriseToday: String(sunrise[0] || ''),
        sunriseTomorrow: String(sunrise[1] || ''),
        sunsetToday: String(sunset[0] || ''),
        usAqi: null,
    };

    if (includeAqi) {
        try {
            snapshot.usAqi = await fetchAqiByCoordinates(coords);
        } catch (_) {
            snapshot.usAqi = null;
        }
    }

    return snapshot;
}

function buildWeatherLabels(snapshot, metricKeys, language = 'ru') {
    if (!snapshot || !Array.isArray(metricKeys) || !metricKeys.length) return [];
    const labelLanguage = normalizeLabelLanguage(language);
    const labels = [];
    metricKeys.forEach((metric) => {
        let label = '';
        if (metric === 'temperature') {
            label = formatTemperatureLabel(snapshot.temperature);
        } else if (metric === 'feels_like') {
            label = formatFeelsLikeLabel(snapshot.apparentTemperature, labelLanguage);
        } else if (metric === 'humidity') {
            label = formatHumidityLabel(snapshot.humidity, labelLanguage);
        } else if (metric === 'wind') {
            label = formatWindLabel(snapshot.windSpeed, labelLanguage);
        } else if (metric === 'precip') {
            label = formatPrecipitationLabel(snapshot.precipitationProbability, labelLanguage);
        } else if (metric === 'uv') {
            label = formatUvLabel(snapshot.uvIndex);
        } else if (metric === 'aqi') {
            label = formatAqiLabel(snapshot.usAqi);
        } else if (metric === 'pressure') {
            label = formatPressureLabel(snapshot.pressureMsl, labelLanguage);
        } else if (metric === 'sun_cycle') {
            label = formatSunCycleLabel(snapshot);
        }
        if (label) {
            labels.push(label);
        }
    });
    return labels;
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
    let weatherLabels = [];
    let rotationCursor = 0;
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

    function buildRotationEntries() {
        if (!prefs.sidebarWeatherEnabled || !weatherLabels.length) {
            return [base];
        }
        return [base, ...weatherLabels];
    }

    function renderLabel() {
        const entries = buildRotationEntries();
        if (!entries.length) {
            setLabel(base);
            return;
        }
        if (!Number.isFinite(rotationCursor) || rotationCursor < 0 || rotationCursor >= entries.length) {
            rotationCursor = 0;
        }
        setLabel(entries[rotationCursor]);
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
            if (!prefs.sidebarWeatherEnabled) {
                rotationCursor = 0;
                renderLabel();
                return;
            }
            const entries = buildRotationEntries();
            if (entries.length <= 1) {
                rotationCursor = 0;
                renderLabel();
                return;
            }
            rotationCursor = (rotationCursor + 1) % entries.length;
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
            weatherLabels = [];
            rotationCursor = 0;
            renderLabel();
            return;
        }

        const seq = ++requestSeq;
        try {
            const coords = await resolveWeatherCoordinates();
            if (destroyed || seq !== requestSeq) return;
            if (!coords) {
                weatherLabels = [];
                rotationCursor = 0;
                renderLabel();
                return;
            }

            const metricKeys = normalizeMetricList(prefs.sidebarWeatherMetrics, { fallbackToDefault: false });
            const includeAqi = metricKeys.includes('aqi');
            const snapshot = await fetchWeatherSnapshotByCoordinates(coords, { includeAqi });
            if (destroyed || seq !== requestSeq) return;
            const currentLanguage = normalizeLabelLanguage(language());
            weatherLabels = buildWeatherLabels(snapshot, metricKeys, currentLanguage);
            if (!weatherLabels.length) {
                rotationCursor = 0;
            } else {
                const entriesLength = weatherLabels.length + 1;
                if (!Number.isFinite(rotationCursor) || rotationCursor < 0 || rotationCursor >= entriesLength) {
                    rotationCursor = 0;
                }
            }
            renderLabel();
        } catch (_) {
            if (destroyed || seq !== requestSeq) return;
            weatherLabels = [];
            rotationCursor = 0;
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
        weatherLabels = [];
        rotationCursor = 0;
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
