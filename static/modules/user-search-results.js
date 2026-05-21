const RELATIONSHIP_CONTACT = 'contact';
const RELATIONSHIP_INCOMING = 'incoming_request';
const RELATIONSHIP_OUTGOING = 'outgoing_request';

function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeSearchText(value) {
    return normalizeText(value).toLowerCase();
}

function getInitials(displayName, username) {
    const source = normalizeText(displayName || username || '?');
    return source
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0] || '')
        .join('')
        .toUpperCase() || '?';
}

function parsePositiveInt(value) {
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function isKeyQuery(query) {
    return query.length > 40 || query.includes('BEGIN') || query.includes('PUBLIC');
}

function collectLocalContacts(contactsRoot, query) {
    if (!contactsRoot) return [];
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) return [];
    return Array.from(contactsRoot.querySelectorAll('.contact-item[data-chat-id]'))
        .filter((item) => String(item.getAttribute('data-is-group') || '') !== '1')
        .map((item) => {
            const displayName = normalizeText(item.querySelector('.contact-name')?.textContent || '');
            const username = normalizeText(item.getAttribute('data-contact-username') || item.getAttribute('data-username') || '');
            const publicKey = normalizeText(item.getAttribute('data-public-key') || '');
            const searchBlob = normalizeSearchText(`${displayName} ${username} ${publicKey}`);
            if (!searchBlob.includes(normalizedQuery)) return null;
            const avatarEl = item.querySelector('.contact-avatar');
            const avatarImgSrc = normalizeText(avatarEl?.querySelector('img.contact-avatar__img')?.getAttribute('src') || '');
            const avatarTint = normalizeText(avatarEl?.getAttribute('data-avatar-tint') || '');
            return {
                source: 'local',
                userId: parsePositiveInt(item.getAttribute('data-contact-id')),
                display_name: displayName,
                username,
                avatar_url: avatarImgSrc,
                avatar_tint: avatarTint,
                chat_id: normalizeText(item.getAttribute('data-chat-id') || ''),
                relationship_status: RELATIONSHIP_CONTACT,
            };
        })
        .filter(Boolean)
        .slice(0, 8);
}

function resolveRelationship(user, existingContact) {
    if (existingContact || user?.is_contact || user?.relationship_status === RELATIONSHIP_CONTACT) {
        return RELATIONSHIP_CONTACT;
    }
    if (user?.pending_incoming_request || user?.relationship_status === RELATIONSHIP_INCOMING) {
        return RELATIONSHIP_INCOMING;
    }
    if (user?.pending_outgoing_request || user?.relationship_status === RELATIONSHIP_OUTGOING) {
        return RELATIONSHIP_OUTGOING;
    }
    return 'none';
}

export function createUserSearchResultsRuntime({
    contactsRoot = null,
    resultsRoot = null,
    escapeHtml = (value) => String(value ?? ''),
    applyFallbackAvatarTint = () => {},
    translateLabel = (value) => String(value ?? ''),
    resolveContactItemByUserId = () => null,
    openChatById = () => {},
    sendDialogRequest = null,
    cancelDialogRequest = null,
    acceptDialogRequest = null,
    showToast = () => {},
} = {}) {
    const copy = {
        peopleSection: 'Люди в SUN',
        contactsSection: 'Ваши контакты',
        promptTitle: 'Найти человека',
        promptText: 'Имя, @username или публичный ключ',
        minQuery: 'Введите минимум 3 символа.',
        emptyTitle: 'Ничего не найдено',
        emptyText: 'Проверьте @username или попросите собеседника показать QR.',
        loading: 'Ищем людей...',
        searchFailed: 'Поиск не удался. Попробуйте снова.',
        open: 'Написать',
        add: 'Добавить',
        accept: 'Принять',
        adding: 'Отправка...',
        cancel: 'Отменить',
        canceling: 'Отмена...',
        accepting: 'Принимаем...',
        requestSent: 'Запрос отправлен',
        requestCanceled: 'Запрос отменён',
        requestAccepted: 'Запрос принят',
        contactStatus: 'Уже в контактах',
        incomingStatus: 'Входящий запрос',
        outgoingStatus: 'Запрос отправлен',
        noneStatus: 'Можно отправить запрос',
        unavailable: 'Недоступно',
        userFallback: 'Пользователь',
        sendFailed: 'Не удалось отправить запрос.',
        cancelFailed: 'Не удалось отменить запрос.',
        acceptFailed: 'Не удалось принять запрос.',
    };

    function t(key) {
        return translateLabel(copy[key] || key);
    }

    function renderState({ icon, title, text }) {
        return `
            <div class="user-search-state">
                <span class="user-search-state__icon"><i class="bi ${escapeHtml(icon)}"></i></span>
                <strong>${escapeHtml(title)}</strong>
                <span>${escapeHtml(text)}</span>
            </div>
        `;
    }

    function renderAvatar(person) {
        const displayName = normalizeText(person.display_name || person.username || t('userFallback'));
        if (person.avatar_url) {
            return `
                <div class="contact-avatar command-palette-result-avatar">
                    <img class="contact-avatar__img" src="${escapeHtml(person.avatar_url)}" alt="${escapeHtml(displayName)}" loading="lazy" decoding="async">
                </div>
            `;
        }
        const tintAttr = person.avatar_tint ? ` data-avatar-tint="${escapeHtml(person.avatar_tint)}"` : '';
        return `<div class="contact-avatar command-palette-result-avatar"${tintAttr}>${escapeHtml(getInitials(displayName, person.username))}</div>`;
    }

    function resolvePerson(user) {
        const userId = parsePositiveInt(user.userId || user.user_id);
        const existingContact = userId ? resolveContactItemByUserId?.(userId) : null;
        const relationship = resolveRelationship(user, existingContact);
        const chatId = normalizeText(user.chat_id || user.chatId || existingContact?.getAttribute('data-chat-id') || '');
        return {
            userId,
            display_name: normalizeText(user.display_name || user.username || `${t('userFallback')} ${userId || ''}`),
            username: normalizeText(user.username || ''),
            avatar_url: normalizeText(user.avatar_url || ''),
            public_key: normalizeText(user.public_key || ''),
            chat_id: chatId,
            relationship_status: relationship,
            source: user.source || 'remote',
        };
    }

    function renderAction(person) {
        if (person.relationship_status === RELATIONSHIP_CONTACT && person.chat_id) {
            return `
                <button type="button" class="command-palette-result-btn user-search-action open-chat-btn" data-chat-id="${escapeHtml(person.chat_id)}">
                    <i class="bi bi-send"></i>
                    <span>${escapeHtml(t('open'))}</span>
                </button>
            `;
        }
        if (person.relationship_status === RELATIONSHIP_INCOMING) {
            const disabled = person.public_key ? '' : ' disabled';
            return `
                <button type="button" class="command-palette-result-btn user-search-action accept-request-btn" data-public-key="${escapeHtml(person.public_key)}"${disabled}>
                    <i class="bi bi-check2"></i>
                    <span>${escapeHtml(person.public_key ? t('accept') : t('unavailable'))}</span>
                </button>
            `;
        }
        if (person.relationship_status === RELATIONSHIP_OUTGOING) {
            return `
                <button type="button" class="command-palette-result-btn user-search-action cancel-request-btn" data-user-id="${escapeHtml(String(person.userId || ''))}" data-public-key="${escapeHtml(person.public_key)}" data-display-name="${escapeHtml(person.display_name)}">
                    <i class="bi bi-x-lg"></i>
                    <span>${escapeHtml(t('cancel'))}</span>
                </button>
            `;
        }
        return `
            <button type="button" class="command-palette-result-btn user-search-action send-request-btn" data-user-id="${escapeHtml(String(person.userId || ''))}" data-public-key="${escapeHtml(person.public_key)}" data-display-name="${escapeHtml(person.display_name)}">
                <i class="bi bi-person-plus"></i>
                <span>${escapeHtml(t('add'))}</span>
            </button>
        `;
    }

    function statusTextFor(person) {
        if (person.relationship_status === RELATIONSHIP_CONTACT) return t('contactStatus');
        if (person.relationship_status === RELATIONSHIP_INCOMING) return t('incomingStatus');
        if (person.relationship_status === RELATIONSHIP_OUTGOING) return t('outgoingStatus');
        return t('noneStatus');
    }

    function renderPersonCard(rawPerson) {
        const person = resolvePerson(rawPerson);
        const username = person.username ? `@${person.username.replace(/^@+/, '')}` : '';
        const subtitle = [username, statusTextFor(person)].filter(Boolean).join(' · ');
        return `
            <div class="command-palette-result user-search-card" data-user-id="${escapeHtml(String(person.userId || ''))}" data-relationship="${escapeHtml(person.relationship_status)}">
                <div class="command-palette-result-meta user-search-card__meta">
                    ${renderAvatar(person)}
                    <div class="command-palette-result-copy user-search-card__copy">
                        <strong>${escapeHtml(person.display_name)}</strong>
                        <span class="user-search-card__subtitle">${escapeHtml(subtitle)}</span>
                    </div>
                </div>
                <div class="user-search-card__actions">
                    ${renderAction(person)}
                </div>
            </div>
        `;
    }

    function renderSection(title, people) {
        if (!people.length) return '';
        return `
            <section class="user-search-section">
                <div class="user-search-section__title">${escapeHtml(title)}</div>
                <div class="user-search-section__list">
                    ${people.map((person) => renderPersonCard(person)).join('')}
                </div>
            </section>
        `;
    }

    function hydrateAvatarTints() {
        resultsRoot?.querySelectorAll('.command-palette-result .contact-avatar').forEach((avatarEl) => {
            if (avatarEl.querySelector('img')) return;
            const label = normalizeText(
                avatarEl.closest('.command-palette-result')?.querySelector('.command-palette-result-copy strong')?.textContent || '',
            );
            applyFallbackAvatarTint(avatarEl, label);
        });
    }

    function render({ query = '', remoteResults = [], remoteState = 'idle', minQueryLength = 3 } = {}) {
        if (!resultsRoot) return;
        const normalizedQuery = normalizeText(query);
        if (!normalizedQuery) {
            resultsRoot.innerHTML = renderState({
                icon: 'bi-person-search',
                title: t('promptTitle'),
                text: t('promptText'),
            });
            return;
        }

        const localPeople = collectLocalContacts(contactsRoot, normalizedQuery);
        const localIds = new Set(localPeople.map((person) => person.userId).filter(Boolean));
        const remotePeople = Array.isArray(remoteResults)
            ? remoteResults.filter((person) => !localIds.has(parsePositiveInt(person.userId || person.user_id)))
            : [];

        const sections = [
            renderSection(t('contactsSection'), localPeople),
        ];

        if (normalizedQuery.length < minQueryLength && !isKeyQuery(normalizedQuery)) {
            sections.push(renderState({
                icon: 'bi-keyboard',
                title: t('minQuery'),
                text: t('promptText'),
            }));
        } else if (remoteState === 'loading') {
            sections.push(renderState({
                icon: 'bi-search',
                title: t('loading'),
                text: normalizedQuery,
            }));
        } else if (remoteState === 'error') {
            sections.push(renderState({
                icon: 'bi-exclamation-circle',
                title: t('searchFailed'),
                text: normalizedQuery,
            }));
        } else {
            sections.push(renderSection(t('peopleSection'), remotePeople));
        }

        if (!localPeople.length && !remotePeople.length && remoteState === 'loaded') {
            sections.push(renderState({
                icon: 'bi-person-x',
                title: t('emptyTitle'),
                text: t('emptyText'),
            }));
        }

        resultsRoot.innerHTML = `<div class="user-search-results">${sections.filter(Boolean).join('')}</div>`;
        hydrateAvatarTints();
    }

    function setButtonBusy(button, labelKey) {
        button.dataset.originalHtml = button.innerHTML;
        button.disabled = true;
        button.innerHTML = `<i class="bi bi-arrow-repeat"></i><span>${escapeHtml(t(labelKey))}</span>`;
    }

    function restoreButton(button) {
        if (button.dataset.originalHtml) {
            button.innerHTML = button.dataset.originalHtml;
            delete button.dataset.originalHtml;
        }
        button.disabled = false;
    }

    function markRequestSent(button) {
        const card = button.closest('.user-search-card');
        card?.setAttribute('data-relationship', RELATIONSHIP_OUTGOING);
        const subtitle = card?.querySelector('.user-search-card__subtitle');
        const username = normalizeText(subtitle?.textContent || '').split(' · ')[0];
        if (subtitle) {
            subtitle.textContent = [username, t('requestSent')].filter(Boolean).join(' · ');
        }
        button.className = 'command-palette-result-btn user-search-action cancel-request-btn';
        button.disabled = false;
        delete button.dataset.originalHtml;
        button.innerHTML = `<i class="bi bi-x-lg"></i><span>${escapeHtml(t('cancel'))}</span>`;
    }

    function markRequestCanceled(button) {
        const card = button.closest('.user-search-card');
        card?.setAttribute('data-relationship', 'none');
        const subtitle = card?.querySelector('.user-search-card__subtitle');
        const username = normalizeText(subtitle?.textContent || '').split(' · ')[0];
        if (subtitle) {
            subtitle.textContent = [username, t('noneStatus')].filter(Boolean).join(' · ');
        }
        const userId = button.getAttribute('data-user-id') || card?.getAttribute('data-user-id') || '';
        const displayName = button.getAttribute('data-display-name')
            || card?.querySelector('.command-palette-result-copy strong')?.textContent
            || t('userFallback');
        button.className = 'command-palette-result-btn user-search-action send-request-btn';
        button.setAttribute('data-user-id', userId);
        button.setAttribute('data-display-name', displayName);
        button.disabled = false;
        delete button.dataset.originalHtml;
        button.innerHTML = `<i class="bi bi-person-plus"></i><span>${escapeHtml(t('add'))}</span>`;
    }

    async function handleSendRequest(button) {
        const userId = button.getAttribute('data-user-id');
        const displayName = button.getAttribute('data-display-name') || t('userFallback');
        if (!sendDialogRequest || !userId) return;
        setButtonBusy(button, 'adding');
        const response = await sendDialogRequest(userId, displayName, {
            confirmBeforeSend: false,
            updateButton: false,
        });
        if (response?.success) {
            markRequestSent(button);
            showToast?.(t('requestSent'), 'success');
            return;
        }
        restoreButton(button);
        showToast?.(response?.error || t('sendFailed'), 'danger');
    }

    async function handleCancelRequest(button) {
        const userId = button.getAttribute('data-user-id');
        const publicKey = button.getAttribute('data-public-key');
        if (!cancelDialogRequest || (!userId && !publicKey)) return;
        setButtonBusy(button, 'canceling');
        const response = await cancelDialogRequest({
            receiverUserId: userId,
            receiverPublicKey: publicKey,
        });
        if (response?.success) {
            markRequestCanceled(button);
            showToast?.(t('requestCanceled'), 'success');
            return;
        }
        restoreButton(button);
        showToast?.(response?.error || t('cancelFailed'), 'danger');
    }

    async function handleAcceptRequest(button) {
        const publicKey = button.getAttribute('data-public-key');
        if (!acceptDialogRequest || !publicKey) return;
        setButtonBusy(button, 'accepting');
        const response = await acceptDialogRequest(publicKey);
        if (response?.success) {
            button.innerHTML = `<i class="bi bi-check2"></i><span>${escapeHtml(t('requestAccepted'))}</span>`;
            showToast?.(t('requestAccepted'), 'success');
            return;
        }
        restoreButton(button);
        showToast?.(response?.error || t('acceptFailed'), 'danger');
    }

    function handleClick(event) {
        const target = event.target;
        if (!(target instanceof Element)) return false;
        const openBtn = target.closest('.open-chat-btn');
        if (openBtn) {
            openChatById(openBtn.getAttribute('data-chat-id'));
            return true;
        }
        const sendBtn = target.closest('.send-request-btn');
        if (sendBtn) {
            void handleSendRequest(sendBtn);
            return true;
        }
        const cancelBtn = target.closest('.cancel-request-btn');
        if (cancelBtn) {
            void handleCancelRequest(cancelBtn);
            return true;
        }
        const acceptBtn = target.closest('.accept-request-btn');
        if (acceptBtn) {
            void handleAcceptRequest(acceptBtn);
            return true;
        }
        return false;
    }

    return {
        render,
        handleClick,
    };
}
