import { waitForMotionEnd } from './motion.js';
import { tr, activeLocale } from './utils.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_OLDER_BATCH_LOADS = 180;

const UI_TEXT = {
    selectDate: '\u0412\u044B\u0431\u043E\u0440 \u0434\u0430\u0442\u044B',
    prevMonth: '\u041F\u0440\u0435\u0434\u044B\u0434\u0443\u0449\u0438\u0439 \u043C\u0435\u0441\u044F\u0446',
    nextMonth: '\u0421\u043B\u0435\u0434\u0443\u044E\u0449\u0438\u0439 \u043C\u0435\u0441\u044F\u0446',
    cancel: '\u041E\u0442\u043C\u0435\u043D\u0430',
    jumpToDate: '\u041F\u0435\u0440\u0435\u0439\u0442\u0438 \u043A \u0434\u0430\u0442\u0435',
    chooseDate: '\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0434\u0430\u0442\u0443',
    jumping: '\u041F\u0435\u0440\u0435\u0445\u043E\u0434...',
};

function normalizeDayKey(rawValue) {
    const raw = String(rawValue || '').trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return '';

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return '';

    const probe = new Date(Date.UTC(year, month - 1, day));
    const isValid = probe.getUTCFullYear() === year
        && (probe.getUTCMonth() + 1) === month
        && probe.getUTCDate() === day;
    if (!isValid) return '';

    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function buildDayKeyFromDate(dateLike) {
    const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
    if (!Number.isFinite(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function dayKeyToEpochDay(dayKey) {
    const normalized = normalizeDayKey(dayKey);
    if (!normalized) return null;
    const [yearRaw, monthRaw, dayRaw] = normalized.split('-');
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    const day = Number(dayRaw);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
    return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

function dayKeyToLocalDate(dayKey) {
    const normalized = normalizeDayKey(dayKey);
    if (!normalized) return null;
    const [yearRaw, monthRaw, dayRaw] = normalized.split('-');
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    const day = Number(dayRaw);
    const date = new Date(year, month - 1, day);
    return Number.isFinite(date.getTime()) ? date : null;
}

function capitalizeFirst(value) {
    const str = String(value || '').trim();
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatSelectedDateText(dayKey) {
    const date = dayKeyToLocalDate(dayKey);
    if (!date) return '';
    return capitalizeFirst(new Intl.DateTimeFormat(activeLocale(), {
        weekday: 'short',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    }).format(date));
}

function formatMonthLabel(year, monthIndex) {
    const date = new Date(year, monthIndex, 1);
    if (!Number.isFinite(date.getTime())) return '';
    return capitalizeFirst(new Intl.DateTimeFormat(activeLocale(), {
        month: 'long',
        year: 'numeric',
    }).format(date));
}

function collectDayEntries(chatId, getChatState, getMessageDayKey) {
    if (!chatId || typeof getChatState !== 'function' || typeof getMessageDayKey !== 'function') {
        return [];
    }
    const state = getChatState(chatId);
    const messages = Array.isArray(state?.messages) ? state.messages : [];
    const byDayKey = new Map();

    for (const message of messages) {
        const dayKey = normalizeDayKey(getMessageDayKey(message?.created_at));
        const messageId = Number(message?.id);
        if (!dayKey || !Number.isFinite(messageId) || messageId <= 0) continue;
        if (byDayKey.has(dayKey)) continue;
        const dayEpoch = dayKeyToEpochDay(dayKey);
        if (dayEpoch === null) continue;
        byDayKey.set(dayKey, {
            dayKey,
            dayEpoch,
            firstMessageId: messageId,
        });
    }

    return Array.from(byDayKey.values()).sort((left, right) => {
        if (left.dayEpoch !== right.dayEpoch) return left.dayEpoch - right.dayEpoch;
        return left.firstMessageId - right.firstMessageId;
    });
}

function resolveFirstLoadedDayKey(chatId, getChatState, getMessageDayKey) {
    if (!chatId) return '';
    const state = getChatState(chatId);
    const messages = Array.isArray(state?.messages) ? state.messages : [];
    for (let index = 0; index < messages.length; index += 1) {
        const dayKey = normalizeDayKey(getMessageDayKey(messages[index]?.created_at));
        if (dayKey) return dayKey;
    }
    return '';
}

function resolveWeekdayLabels() {
    const locale = activeLocale();
    const mondayUtc = new Date(Date.UTC(2024, 0, 1)); // Monday.
    const labels = [];
    for (let offset = 0; offset < 7; offset += 1) {
        const probe = new Date(mondayUtc.getTime() + (offset * DAY_MS));
        const label = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(probe);
        labels.push(capitalizeFirst(String(label || '').replace('.', '')));
    }
    return labels;
}

function buildMonthGridCells(year, monthIndex) {
    const firstDay = new Date(year, monthIndex, 1);
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    if (!Number.isFinite(firstDay.getTime()) || !Number.isFinite(daysInMonth) || daysInMonth <= 0) {
        return [];
    }

    const leadingEmptyCells = (firstDay.getDay() + 6) % 7; // Monday starts at index 0.
    const cells = [];

    for (let index = 0; index < leadingEmptyCells; index += 1) {
        cells.push({ type: 'empty' });
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
        const dayKey = normalizeDayKey(`${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
        cells.push({ type: 'day', dayKey, dayNumber: day });
    }

    const trailingCells = (7 - (cells.length % 7)) % 7;
    for (let index = 0; index < trailingCells; index += 1) {
        cells.push({ type: 'empty' });
    }

    return cells;
}

function createCalendarUi() {
    const root = document.createElement('div');
    root.className = 'chat-date-picker-overlay';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = `
        <div class="chat-date-picker-overlay__backdrop" data-date-picker-action="close"></div>
        <section class="chat-date-picker-panel" role="dialog" aria-modal="true" aria-label="${tr(UI_TEXT.selectDate)}">
            <div class="chat-date-picker-panel__selected" data-calendar-selected></div>
            <div class="chat-date-picker-panel__month-row">
                <button type="button" class="chat-date-picker-panel__month-btn" data-date-picker-action="prev-month" aria-label="${tr(UI_TEXT.prevMonth)}">
                    <i class="bi bi-chevron-left" aria-hidden="true"></i>
                </button>
                <div class="chat-date-picker-panel__month-label" data-calendar-month></div>
                <button type="button" class="chat-date-picker-panel__month-btn" data-date-picker-action="next-month" aria-label="${tr(UI_TEXT.nextMonth)}">
                    <i class="bi bi-chevron-right" aria-hidden="true"></i>
                </button>
            </div>
            <div class="chat-date-picker-panel__weekdays" data-calendar-weekdays></div>
            <div class="chat-date-picker-panel__days" data-calendar-days></div>
            <div class="chat-date-picker-panel__actions">
                <button type="button" class="chat-date-picker-panel__action" data-date-picker-action="cancel">${tr(UI_TEXT.cancel)}</button>
                <button type="button" class="chat-date-picker-panel__action chat-date-picker-panel__action--primary" data-date-picker-action="jump">${tr(UI_TEXT.jumpToDate)}</button>
            </div>
        </section>
    `;
    document.body.appendChild(root);

    return {
        root,
        selectedEl: root.querySelector('[data-calendar-selected]'),
        monthEl: root.querySelector('[data-calendar-month]'),
        weekdaysEl: root.querySelector('[data-calendar-weekdays]'),
        daysEl: root.querySelector('[data-calendar-days]'),
        jumpButtonEl: root.querySelector('[data-date-picker-action="jump"]'),
    };
}

function resolveClosestEntry(entries, targetDayKey) {
    if (!Array.isArray(entries) || entries.length === 0) return null;

    const exact = entries.find((entry) => entry.dayKey === targetDayKey);
    if (exact) return { ...exact, exactMatch: true };

    const targetEpoch = dayKeyToEpochDay(targetDayKey);
    if (targetEpoch === null) return null;

    let best = null;
    let bestDiff = Number.POSITIVE_INFINITY;
    for (const entry of entries) {
        const diff = Math.abs(entry.dayEpoch - targetEpoch);
        if (!best || diff < bestDiff || (diff === bestDiff && entry.dayEpoch < best.dayEpoch)) {
            best = entry;
            bestDiff = diff;
        }
    }

    return best ? { ...best, exactMatch: false } : null;
}

export function initChatDateNavigator({
    chatMessagesEl,
    getCurrentChatId,
    getChatState,
    getMessageDayKey,
    loadOlderMessages,
    scrollToMessage,
} = {}) {
    if (!chatMessagesEl || typeof getCurrentChatId !== 'function') {
        return {
            refreshLocale() {},
            close() {},
            destroy() {},
        };
    }

    const ui = createCalendarUi();
    let isOpen = false;
    let isJumpInFlight = false;
    let calendarMotionSeq = 0;
    let selectedDayKey = normalizeDayKey(buildDayKeyFromDate(new Date()));
    let monthYear = dayKeyToLocalDate(selectedDayKey)?.getFullYear() ?? new Date().getFullYear();
    let monthIndex = dayKeyToLocalDate(selectedDayKey)?.getMonth() ?? new Date().getMonth();

    function setMonthFromDay(dayKey) {
        const date = dayKeyToLocalDate(dayKey);
        if (!date) return;
        monthYear = date.getFullYear();
        monthIndex = date.getMonth();
    }

    function renderWeekdays() {
        if (!ui.weekdaysEl) return;
        const labels = resolveWeekdayLabels();
        ui.weekdaysEl.innerHTML = labels
            .map((label) => `<span class="chat-date-picker-panel__weekday">${label}</span>`)
            .join('');
    }

    function renderCalendarDays(chatId) {
        if (!ui.daysEl) return;

        const entries = collectDayEntries(chatId, getChatState, getMessageDayKey);
        const availableByDayKey = new Map(entries.map((entry) => [entry.dayKey, entry]));
        const todayDayKey = normalizeDayKey(buildDayKeyFromDate(new Date()));
        const cells = buildMonthGridCells(monthYear, monthIndex);

        ui.daysEl.innerHTML = cells.map((cell) => {
            if (cell.type === 'empty') {
                return '<span class="chat-date-picker-panel__day is-empty" aria-hidden="true"></span>';
            }

            const classes = ['chat-date-picker-panel__day'];
            if (cell.dayKey === selectedDayKey) classes.push('is-selected');
            if (cell.dayKey === todayDayKey) classes.push('is-today');
            if (availableByDayKey.has(cell.dayKey)) classes.push('has-messages');

            return `
                <button
                    type="button"
                    class="${classes.join(' ')}"
                    data-calendar-day="${cell.dayKey}"
                    aria-label="${formatSelectedDateText(cell.dayKey)}"
                >${cell.dayNumber}</button>
            `;
        }).join('');
    }

    function renderCalendar() {
        const chatId = String(getCurrentChatId() || '').trim();
        if (ui.selectedEl) {
            ui.selectedEl.textContent = formatSelectedDateText(selectedDayKey) || tr(UI_TEXT.chooseDate);
        }
        if (ui.monthEl) {
            ui.monthEl.textContent = formatMonthLabel(monthYear, monthIndex);
        }
        if (ui.jumpButtonEl) {
            ui.jumpButtonEl.disabled = !chatId || isJumpInFlight;
            ui.jumpButtonEl.textContent = isJumpInFlight ? tr(UI_TEXT.jumping) : tr(UI_TEXT.jumpToDate);
        }
        renderWeekdays();
        renderCalendarDays(chatId);
    }

    function openCalendar(initialDayKey = '') {
        const fallback = normalizeDayKey(buildDayKeyFromDate(new Date()));
        selectedDayKey = normalizeDayKey(initialDayKey) || fallback || selectedDayKey;
        setMonthFromDay(selectedDayKey);
        renderCalendar();
        const seq = ++calendarMotionSeq;
        ui.root.classList.remove('is-open', 'is-closing');
        ui.root.classList.add('is-opening');
        ui.root.setAttribute('aria-hidden', 'false');
        window.requestAnimationFrame(() => {
            if (seq !== calendarMotionSeq) return;
            ui.root.classList.add('is-open');
            window.requestAnimationFrame(() => {
                if (seq !== calendarMotionSeq) return;
                ui.root.classList.remove('is-opening');
            });
        });
        isOpen = true;
    }

    function closeCalendar() {
        const seq = ++calendarMotionSeq;
        ui.root.classList.remove('is-open', 'is-opening');
        ui.root.classList.add('is-closing');
        ui.root.setAttribute('aria-hidden', 'true');
        isOpen = false;
        waitForMotionEnd(ui.root, 320).then(() => {
            if (seq !== calendarMotionSeq) return;
            ui.root.classList.remove('is-closing');
        });
    }

    function shiftMonth(delta) {
        const probe = new Date(monthYear, monthIndex + delta, 1);
        if (!Number.isFinite(probe.getTime())) return;
        monthYear = probe.getFullYear();
        monthIndex = probe.getMonth();
        renderCalendar();
    }

    async function ensureOlderHistoryForTargetDay(chatId, targetDayKey) {
        if (!chatId || typeof loadOlderMessages !== 'function') return;
        const targetEpoch = dayKeyToEpochDay(targetDayKey);
        if (targetEpoch === null) return;

        let guard = 0;
        while (guard < MAX_OLDER_BATCH_LOADS) {
            guard += 1;
            const state = getChatState(chatId);
            if (!state || !state.hasMoreBefore) break;

            const firstLoadedDayKey = resolveFirstLoadedDayKey(chatId, getChatState, getMessageDayKey);
            const firstLoadedEpoch = dayKeyToEpochDay(firstLoadedDayKey);
            if (firstLoadedEpoch === null || targetEpoch >= firstLoadedEpoch) {
                break;
            }

            const loaded = await loadOlderMessages(chatId);
            if (!loaded) break;
        }
    }

    async function jumpToSelectedDay() {
        if (isJumpInFlight) return;

        const chatId = String(getCurrentChatId() || '').trim();
        if (!chatId) return;

        const normalizedDayKey = normalizeDayKey(selectedDayKey);
        if (!normalizedDayKey) return;

        isJumpInFlight = true;
        renderCalendar();
        try {
            await ensureOlderHistoryForTargetDay(chatId, normalizedDayKey);
            const entries = collectDayEntries(chatId, getChatState, getMessageDayKey);
            if (!entries.length) return;

            const target = resolveClosestEntry(entries, normalizedDayKey);
            if (!target) return;

            if (typeof scrollToMessage === 'function') {
                await scrollToMessage(target.firstMessageId, { source: 'date-picker', smooth: true });
            }
            closeCalendar();
        } finally {
            isJumpInFlight = false;
            if (isOpen) renderCalendar();
        }
    }

    function handleSeparatorClick(event) {
        const labelEl = event.target.closest('.chat-day-separator__label');
        if (!labelEl || !chatMessagesEl.contains(labelEl)) return;
        const dayKey = normalizeDayKey(labelEl.closest('.chat-day-separator')?.getAttribute('data-day-key'));
        if (!dayKey) return;
        event.preventDefault();
        event.stopPropagation();
        openCalendar(dayKey);
    }

    function handleOverlayClick(event) {
        const actionEl = event.target.closest('[data-date-picker-action]');
        if (actionEl) {
            const action = actionEl.getAttribute('data-date-picker-action');
            if (action === 'close' || action === 'cancel') {
                closeCalendar();
                return;
            }
            if (action === 'prev-month') {
                shiftMonth(-1);
                return;
            }
            if (action === 'next-month') {
                shiftMonth(1);
                return;
            }
            if (action === 'jump') {
                jumpToSelectedDay();
                return;
            }
        }

        const dayButton = event.target.closest('[data-calendar-day]');
        if (!dayButton || !ui.root.contains(dayButton)) return;
        const dayKey = normalizeDayKey(dayButton.getAttribute('data-calendar-day'));
        if (!dayKey) return;
        selectedDayKey = dayKey;
        renderCalendar();
    }

    function handleKeydown(event) {
        if (!isOpen) return;
        if (event.key !== 'Escape') return;
        event.preventDefault();
        closeCalendar();
    }

    chatMessagesEl.classList.add('chat-date-nav-enabled');
    chatMessagesEl.addEventListener('click', handleSeparatorClick);
    ui.root.addEventListener('click', handleOverlayClick);
    document.addEventListener('keydown', handleKeydown);

    return {
        refreshLocale() {
            if (isOpen) renderCalendar();
        },
        open(initialDayKey = '') {
            openCalendar(initialDayKey);
        },
        close() {
            closeCalendar();
        },
        destroy() {
            closeCalendar();
            chatMessagesEl.classList.remove('chat-date-nav-enabled');
            chatMessagesEl.removeEventListener('click', handleSeparatorClick);
            ui.root.removeEventListener('click', handleOverlayClick);
            document.removeEventListener('keydown', handleKeydown);
            ui.root.remove();
        },
    };
}
