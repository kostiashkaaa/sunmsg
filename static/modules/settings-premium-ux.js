/**
 * settings-premium-ux.js
 * Premium UX improvements for Settings panel.
 * Вызывается один раз после инициализации панели настроек.
 */

export function initSettingsPremiumUX(doc = document) {
    initRangeInputs(doc);
    initPrivacyPanelTransition(doc);
    initSwipeBack(doc);
    initMnemonicPasteAll(doc);
    initFloatingSaveLabel(doc);
    initOnlineIndicator(doc);
    initRangeMinMaxLabels(doc);
    initNavScrollFade(doc);
    observeSettingsSections(doc);
}

/* ── 1. Range inputs: --range-pct CSS variable для progress fill ──────────── */
function initRangeInputs(doc) {
    function syncRange(input) {
        const min = parseFloat(input.min) || 0;
        const max = parseFloat(input.max) || 100;
        const val = parseFloat(input.value) || 0;
        const pct = Math.round(((val - min) / (max - min)) * 100);
        input.style.setProperty('--range-pct', `${pct}%`);
    }

    function attachRange(input) {
        if (input.dataset.premiumRangeInit) return;
        input.dataset.premiumRangeInit = '1';
        syncRange(input);
        input.addEventListener('input', () => syncRange(input));
        input.addEventListener('change', () => syncRange(input));
    }

    doc.querySelectorAll('.settings-scene input[type="range"]').forEach(attachRange);

    // MutationObserver для динамически добавленных range-inputs
    const mo = new MutationObserver(mutations => {
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (node.nodeType !== 1) continue;
                if (node.matches?.('input[type="range"]')) attachRange(node);
                node.querySelectorAll?.('input[type="range"]').forEach(attachRange);
            }
        }
    });
    const scene = doc.querySelector('.settings-scene');
    if (scene) mo.observe(scene, { childList: true, subtree: true });
}

/* ── 2. Range min/max labels ─────────────────────────────────────────────── */
function initRangeMinMaxLabels(doc) {
    doc.querySelectorAll('.settings-scene .data-memory-range-row input[type="range"]').forEach(input => {
        if (input.dataset.labelsInit) return;
        input.dataset.labelsInit = '1';

        const min = input.min || '0';
        const max = input.max || '100';
        const unit = input.id?.includes('Mb') || input.id?.includes('mb') ? ' MB' : '';

        const wrap = doc.createElement('div');
        wrap.className = 'settings-range-row-inner';

        const labels = doc.createElement('div');
        labels.className = 'settings-range-minmax';
        labels.innerHTML = `<span>${min}${unit}</span><span>${max}${unit}</span>`;

        const parent = input.parentNode;
        parent.insertBefore(wrap, input);
        wrap.appendChild(input);
        wrap.appendChild(labels);
    });
}

/* ── 3. Privacy detail — плавный crossfade вместо settings-hidden ─────────── */
function initPrivacyPanelTransition(doc) {
    const overview = doc.getElementById('privacyOverviewPanel');
    const detail = doc.getElementById('privacyDetailPanel');
    if (!overview || !detail) return;

    // Снимаем жёсткий display:none управляемый JS через settings-hidden
    // Заменяем на CSS-классы is-visible / is-hidden
    function patchPrivacyVisibility() {
        const obs = new MutationObserver(() => {
            const detailHidden = detail.classList.contains('settings-hidden');
            const overviewHidden = overview.classList.contains('settings-hidden');

            if (!detailHidden) {
                // Detail открывается
                overview.classList.add('is-hidden');
                detail.classList.remove('settings-hidden');
                detail.classList.add('is-visible');
            } else {
                // Возврат к overview
                detail.classList.remove('is-visible');
                overview.classList.remove('is-hidden');
            }
        });

        obs.observe(detail, { attributes: true, attributeFilter: ['class'] });
        obs.observe(overview, { attributes: true, attributeFilter: ['class'] });
    }

    patchPrivacyVisibility();

    // Кнопка «Назад» — focus management
    const backBtn = doc.getElementById('privacyDetailBackBtn');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            requestAnimationFrame(() => {
                const firstItem = overview.querySelector('.settings-privacy-item');
                firstItem?.focus();
            });
        });
    }
}

/* ── 4. Swipe-back жест для мобильного детального вида ──────────────────── */
function initSwipeBack(doc) {
    if (!('ontouchstart' in window)) return;

    const panelBody = doc.querySelector('.settings-scene .settings-panel-body');
    if (!panelBody) return;

    let startX = 0;
    let startY = 0;
    let tracking = false;

    panelBody.addEventListener('touchstart', e => {
        const touch = e.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;
        tracking = startX < 36; // только edge-свайп
    }, { passive: true });

    panelBody.addEventListener('touchmove', e => {
        if (!tracking) return;
        const dx = e.touches[0].clientX - startX;
        const dy = Math.abs(e.touches[0].clientY - startY);
        if (dx > 0 && dy < 50) {
            panelBody.classList.add('is-swipe-active');
        }
    }, { passive: true });

    panelBody.addEventListener('touchend', e => {
        if (!tracking) return;
        tracking = false;
        panelBody.classList.remove('is-swipe-active');

        const dx = e.changedTouches[0].clientX - startX;
        if (dx > 72 && startX < 36) {
            // Ищем кнопку «назад» в privacy detail или кнопку закрытия секции
            const backBtn = doc.getElementById('privacyDetailBackBtn');
            if (backBtn && !doc.getElementById('privacyDetailPanel')?.classList.contains('settings-hidden')) {
                backBtn.click();
                return;
            }
            // Возврат на home
            const closeBtn = doc.getElementById('settingsPanelCloseBtn');
            if (doc.body.classList.contains('settings-detail-open')) {
                // Имитируем навигацию назад — ищем функцию навигации
                const homeEvent = new CustomEvent('settings:navigate-home', { bubbles: true });
                panelBody.dispatchEvent(homeEvent);
            }
        }
    }, { passive: true });
}

/* ── 5. Mnemonic paste-all ───────────────────────────────────────────────── */
function initMnemonicPasteAll(doc) {
    const grid = doc.getElementById('mnemonicInputGrid');
    const unlockBody = doc.getElementById('mnemonicUnlockBody');
    if (!grid || !unlockBody) return;

    // Добавляем кнопку paste-all перед grid
    if (doc.getElementById('mnemonicPasteAllBtn')) return;

    const actionsWrap = doc.createElement('div');
    actionsWrap.className = 'mnemonic-paste-actions';

    const hint = doc.createElement('span');
    hint.className = 'settings-copy-muted-sm';
    hint.textContent = 'Введите каждое слово или вставьте всю фразу:';

    const pasteBtn = doc.createElement('button');
    pasteBtn.type = 'button';
    pasteBtn.id = 'mnemonicPasteAllBtn';
    pasteBtn.className = 'mnemonic-paste-all-btn';
    pasteBtn.innerHTML = `
        <svg class="sun-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none">
            <rect x="5" y="2" width="9" height="11" rx="2" stroke="currentColor" stroke-width="1.4"/>
            <path d="M2 4v9a2 2 0 002 2h7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
        Вставить фразу
    `;

    actionsWrap.appendChild(hint);
    actionsWrap.appendChild(pasteBtn);
    unlockBody.insertBefore(actionsWrap, grid);

    pasteBtn.addEventListener('click', async () => {
        try {
            const text = await navigator.clipboard.readText();
            const words = text.trim().split(/\s+/).filter(Boolean);
            if (words.length < 12) {
                showPasteFeedback(pasteBtn, 'Не похоже на мнемоническую фразу', 'warn');
                return;
            }
            const inputs = grid.querySelectorAll('.mnemonic-word-input');
            inputs.forEach((inp, i) => {
                if (words[i]) {
                    inp.value = words[i];
                    inp.dispatchEvent(new Event('input', { bubbles: true }));
                }
            });
            showPasteFeedback(pasteBtn, `Вставлено ${Math.min(words.length, inputs.length)} слов`, 'ok');
        } catch {
            showPasteFeedback(pasteBtn, 'Нет доступа к буферу', 'warn');
        }
    });

    function showPasteFeedback(btn, text, type) {
        const orig = btn.innerHTML;
        btn.textContent = text;
        btn.style.color = type === 'ok' ? 'var(--sx-good, #4e9a6f)' : 'var(--sx-danger, #c95a3a)';
        setTimeout(() => {
            btn.innerHTML = orig;
            btn.style.color = '';
        }, 2200);
    }
}

/* ── 6. Floating save — добавляем label если его нет ─────────────────────── */
function initFloatingSaveLabel(doc) {
    const fab = doc.querySelector('.settings-scene .settings-floating-save');
    if (!fab) return;
    if (fab.querySelector('.settings-floating-save-label')) return;

    const label = doc.createElement('span');
    label.className = 'settings-floating-save-label';
    label.textContent = 'Сохранить';
    fab.appendChild(label);

    // Aria label
    if (!fab.getAttribute('aria-label')) {
        fab.setAttribute('aria-label', 'Сохранить изменения');
    }
}

/* ── 7. Online indicator — показываем зелёную точку если онлайн ──────────── */
function initOnlineIndicator(doc) {
    const avatarWrap = doc.querySelector(
        'body.settings-home-open .settings-nav-avatar-wrap, .settings-nav-avatar-wrap'
    );
    if (!avatarWrap) return;

    // Используем socket presence или просто navigator.onLine
    function updateOnlineState() {
        if (navigator.onLine) {
            avatarWrap.classList.add('is-online');
        } else {
            avatarWrap.classList.remove('is-online');
        }
    }

    updateOnlineState();
    window.addEventListener('online', updateOnlineState);
    window.addEventListener('offline', updateOnlineState);
}

/* ── 8. Nav scroll fade — синхронизируем маску с позицией скролла ─────────── */
function initNavScrollFade(doc) {
    const navList = doc.querySelector('.settings-scene .settings-nav-list');
    if (!navList) return;

    function updateFade() {
        const atEnd = navList.scrollLeft + navList.clientWidth >= navList.scrollWidth - 8;
        if (atEnd) {
            navList.style.setProperty('--nav-fade-end', 'black');
        } else {
            navList.style.setProperty('--nav-fade-end', 'transparent');
        }
    }

    navList.addEventListener('scroll', updateFade, { passive: true });
    updateFade();
}

/* ── 9. MutationObserver — переинициализация при смене body-класса ──────── */
function observeSettingsSections(doc) {
    const observer = new MutationObserver(() => {
        initRangeInputs(doc);
        initFloatingSaveLabel(doc);
        initOnlineIndicator(doc);

        // Aria: privacy items
        doc.querySelectorAll('.settings-privacy-item').forEach(btn => {
            if (!btn.getAttribute('aria-label')) {
                const label = btn.querySelector('.settings-row-label')?.textContent?.trim();
                if (label) btn.setAttribute('aria-label', label);
            }
        });

        // Aria: toggles
        doc.querySelectorAll('.settings-scene .toggle').forEach(toggle => {
            const input = toggle.querySelector('input');
            const row = toggle.closest('.settings-row');
            const label = row?.querySelector('.settings-row-label')?.textContent?.trim();
            if (input && label && !input.getAttribute('aria-label')) {
                input.setAttribute('aria-label', label);
            }
        });

        // Aria: range inputs
        doc.querySelectorAll('.settings-scene input[type="range"]').forEach(input => {
            const row = input.closest('.settings-row');
            const label = row?.querySelector('.settings-row-label')?.textContent?.trim();
            if (label && !input.getAttribute('aria-label')) {
                input.setAttribute('aria-label', label);
            }
            if (!input.getAttribute('aria-valuemin')) {
                input.setAttribute('aria-valuemin', input.min || '0');
                input.setAttribute('aria-valuemax', input.max || '100');
            }
            input.setAttribute('aria-valuenow', input.value);
            input.addEventListener('input', () => {
                input.setAttribute('aria-valuenow', input.value);
            });
        });
    });

    observer.observe(doc.body, { attributes: true, attributeFilter: ['class'], subtree: false });

    // Первичный проход
    setTimeout(() => {
        doc.querySelectorAll('.settings-scene .toggle').forEach(toggle => {
            const input = toggle.querySelector('input');
            const row = toggle.closest('.settings-row');
            const label = row?.querySelector('.settings-row-label')?.textContent?.trim();
            if (input && label && !input.getAttribute('aria-label')) {
                input.setAttribute('aria-label', label);
            }
        });

        doc.querySelectorAll('.settings-privacy-item').forEach(btn => {
            if (!btn.getAttribute('aria-label')) {
                const label = btn.querySelector('.settings-row-label')?.textContent?.trim();
                if (label) btn.setAttribute('aria-label', label);
            }
            btn.setAttribute('aria-haspopup', 'true');
        });
    }, 500);
}
