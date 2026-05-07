from flask import render_template, request, session

from app.services.locale import detect_auth_language, normalize_language
from .context import auth_bp

_DOC_ORDER = ('privacy', 'terms', 'faq', 'about')

_UI_COPY = {
    'ru': {
        'eyebrow': 'Trust Center',
        'title': 'Прозрачность и юридические документы',
        'subtitle': 'Ключевые правила, модель приватности и ответы по безопасности в одном месте.',
        'back': 'Вернуться ко входу',
        'nav_title': 'Разделы',
        'updated': 'Обновлено',
    },
    'en': {
        'eyebrow': 'Trust Center',
        'title': 'Transparency and Legal Documents',
        'subtitle': 'Core rules, privacy model, and security answers in one place.',
        'back': 'Back to sign in',
        'nav_title': 'Sections',
        'updated': 'Updated',
    },
}

_TRUST_DOCS = {
    'privacy': {
        'title': {
            'ru': 'Политика конфиденциальности (Privacy Policy)',
            'en': 'Privacy Policy',
        },
        'summary': {
            'ru': 'Какие данные мы обрабатываем, зачем это нужно и как вы можете управлять ими.',
            'en': 'What data we process, why it is needed, and how you can control it.',
        },
        'sections': {
            'ru': [
                {
                    'heading': '1. Какие данные мы получаем',
                    'points': [
                        'Данные аккаунта: username, отображаемое имя, язык интерфейса, настройки приватности.',
                        'Технические данные сессий: время входов, сведения об устройствах и токены сессий.',
                        'Служебные метаданные доставки: идентификаторы диалогов и события доставки, необходимые для работы мессенджера.',
                    ],
                },
                {
                    'heading': '2. Что мы не видим',
                    'points': [
                        'Содержимое личных сообщений, зашифрованных end-to-end, недоступно серверу.',
                        'Секретные ключи и mnemonic-фразы не передаются в открытом виде и не используются как пароль на сервере.',
                    ],
                },
                {
                    'heading': '3. Цели обработки',
                    'points': [
                        'Аутентификация и поддержание активных сессий.',
                        'Маршрутизация сообщений, уведомлений и запросов контакта.',
                        'Безопасность сервиса: антиабьюз, ограничение частоты запросов, расследование инцидентов.',
                    ],
                },
                {
                    'heading': '4. Хранение и удаление',
                    'points': [
                        'Данные хранятся столько, сколько это необходимо для работы аккаунта и соблюдения законных обязательств.',
                        'При удалении аккаунта удаляются профиль, ключевые настройки и связанные серверные данные, кроме записей, которые мы обязаны хранить по закону.',
                    ],
                },
                {
                    'heading': '5. Ваши права',
                    'points': [
                        'Запросить экспорт или удаление данных аккаунта.',
                        'Изменять приватность и видимость профиля в настройках.',
                        'Отключить лишние устройства и завершить активные сессии.',
                    ],
                },
            ],
            'en': [
                {
                    'heading': '1. Data we collect',
                    'points': [
                        'Account data: username, display name, UI language, privacy settings.',
                        'Session technical data: login times, device records, session tokens.',
                        'Delivery metadata: chat identifiers and delivery events required to operate messaging.',
                    ],
                },
                {
                    'heading': '2. What we cannot read',
                    'points': [
                        'End-to-end encrypted personal message content is not readable by the server.',
                        'Secret keys and mnemonic phrases are not stored as plain server passwords.',
                    ],
                },
                {
                    'heading': '3. Processing purposes',
                    'points': [
                        'Authentication and active session management.',
                        'Message, notification, and contact-request routing.',
                        'Service security: abuse prevention, rate limiting, and incident response.',
                    ],
                },
                {
                    'heading': '4. Retention and deletion',
                    'points': [
                        'Data is retained only as long as needed for account operation and legal obligations.',
                        'When an account is deleted, profile data and related server state are removed except records required by law.',
                    ],
                },
                {
                    'heading': '5. Your rights',
                    'points': [
                        'Request account data export or deletion.',
                        'Manage profile visibility and privacy in settings.',
                        'Sign out unnecessary devices and terminate active sessions.',
                    ],
                },
            ],
        },
    },
    'terms': {
        'title': {
            'ru': 'Пользовательское соглашение (Terms of Service)',
            'en': 'Terms of Service',
        },
        'summary': {
            'ru': 'Правила использования сервиса, ответственность сторон и ограничения.',
            'en': 'Rules of service usage, responsibilities, and restrictions.',
        },
        'sections': {
            'ru': [
                {
                    'heading': '1. Принятие условий',
                    'points': [
                        'Используя сервис, вы соглашаетесь с настоящими условиями и политикой конфиденциальности.',
                        'Если вы не согласны с условиями, использование сервиса должно быть прекращено.',
                    ],
                },
                {
                    'heading': '2. Допустимое использование',
                    'points': [
                        'Запрещены спам, мошенничество, распространение вредоносного ПО и попытки несанкционированного доступа.',
                        'Запрещено использовать сервис для деятельности, нарушающей применимое законодательство.',
                    ],
                },
                {
                    'heading': '3. Аккаунт и безопасность',
                    'points': [
                        'Вы отвечаете за сохранность ключей доступа и устройств, с которых входите в аккаунт.',
                        'При подозрении на компрометацию нужно немедленно завершить сессии и обновить ключевые данные.',
                    ],
                },
                {
                    'heading': '4. Ограничение ответственности',
                    'points': [
                        'Сервис предоставляется по модели "как есть" без гарантии абсолютной бесперебойности.',
                        'Мы не несем ответственности за косвенный ущерб, если иное не требуется законом.',
                    ],
                },
                {
                    'heading': '5. Изменение условий',
                    'points': [
                        'Условия могут обновляться при развитии функциональности или изменении требований безопасности.',
                        'Актуальная версия публикуется в этом разделе с датой обновления.',
                    ],
                },
            ],
            'en': [
                {
                    'heading': '1. Acceptance of terms',
                    'points': [
                        'By using the service, you accept these terms and the privacy policy.',
                        'If you disagree with the terms, you must stop using the service.',
                    ],
                },
                {
                    'heading': '2. Acceptable use',
                    'points': [
                        'Spam, fraud, malware distribution, and unauthorized access attempts are prohibited.',
                        'The service may not be used for activity violating applicable law.',
                    ],
                },
                {
                    'heading': '3. Account and security',
                    'points': [
                        'You are responsible for protecting your access keys and trusted devices.',
                        'If compromise is suspected, immediately terminate sessions and rotate critical credentials.',
                    ],
                },
                {
                    'heading': '4. Limitation of liability',
                    'points': [
                        'The service is provided on an "as is" basis without an absolute uptime guarantee.',
                        'We are not liable for indirect damages unless required by law.',
                    ],
                },
                {
                    'heading': '5. Terms updates',
                    'points': [
                        'Terms may change as features evolve or security requirements change.',
                        'The latest version is published in this section with an updated date.',
                    ],
                },
            ],
        },
    },
    'faq': {
        'title': {
            'ru': 'FAQ: анонимность и безопасность',
            'en': 'FAQ: Anonymity and Security',
        },
        'summary': {
            'ru': 'Практические ответы по приватности, угрозам и безопасной работе с аккаунтом.',
            'en': 'Practical answers on privacy, threats, and secure account operation.',
        },
        'sections': {
            'ru': [
                {
                    'heading': 'Сообщения действительно защищены?',
                    'points': [
                        'Личные сообщения шифруются end-to-end: сервер доставляет, но не читает содержимое.',
                        'Для доступа к истории на новом устройстве нужен корректный ключевой материал.',
                    ],
                },
                {
                    'heading': 'Как повысить анонимность?',
                    'points': [
                        'Используйте отдельный username без персональных данных.',
                        'Отключите публичный профиль и скройте онлайн-статус в настройках.',
                        'Периодически завершайте лишние сессии и проверяйте активные устройства.',
                    ],
                },
                {
                    'heading': 'Что делать при подозрении на взлом?',
                    'points': [
                        'Немедленно выйдите со всех устройств, кроме текущего, через раздел устройств.',
                        'Проверьте активные сессии и отключите неизвестные.',
                        'Обновите ключевые данные и свяжитесь с поддержкой безопасности.',
                    ],
                },
                {
                    'heading': 'Куда писать по security-вопросам?',
                    'points': [
                        'Контакт поддержки: security@sun-messenger.local',
                        'В обращении укажите время инцидента, вашу версию клиента и краткое описание проблемы.',
                    ],
                },
            ],
            'en': [
                {
                    'heading': 'Are messages actually protected?',
                    'points': [
                        'Personal chats use end-to-end encryption: the server routes data but cannot read content.',
                        'To restore history on a new device, valid key material is required.',
                    ],
                },
                {
                    'heading': 'How can I improve anonymity?',
                    'points': [
                        'Use a dedicated username without personal identifiers.',
                        'Disable public profile visibility and hide online status in settings.',
                        'Regularly review active sessions and remove unknown devices.',
                    ],
                },
                {
                    'heading': 'What if I suspect account compromise?',
                    'points': [
                        'Immediately sign out other sessions from the devices section.',
                        'Review active sessions and revoke unknown devices.',
                        'Rotate critical key material and contact security support.',
                    ],
                },
                {
                    'heading': 'How do I contact security support?',
                    'points': [
                        'Security contact: security@sun-messenger.local',
                        'Include incident time, client version, and a short description.',
                    ],
                },
            ],
        },
    },
    'about': {
        'title': {
            'ru': 'О проекте и модель приватности',
            'en': 'About the Project and Privacy Model',
        },
        'summary': {
            'ru': 'Как устроен сервис, какие принципы мы соблюдаем и какие угрозы считаем приоритетными.',
            'en': 'How the service is built, what principles we follow, and which threats we prioritize.',
        },
        'sections': {
            'ru': [
                {
                    'heading': '1. Миссия',
                    'points': [
                        'SUN Messenger строится как приватный мессенджер с акцентом на безопасность по умолчанию и минимизацию доверия к серверу.',
                    ],
                },
                {
                    'heading': '2. Модель приватности',
                    'points': [
                        'Доступ к содержимому сообщений ограничен конечными устройствами пользователей.',
                        'Сервер хранит только данные, необходимые для идентификации, маршрутизации и обеспечения работоспособности.',
                        'Критичные операции защищены дополнительной аутентификацией и ограничением частоты запросов.',
                    ],
                },
                {
                    'heading': '3. Границы угроз',
                    'points': [
                        'Приоритет: защита от компрометации пользовательских сессий и несанкционированного доступа.',
                        'Отдельное внимание уделяется защите API от перебора, спама и злоупотребления автоматизацией.',
                    ],
                },
                {
                    'heading': '4. Whitepaper (краткая публичная версия)',
                    'points': [
                        'Криптографическая модель: E2EE для личных сообщений.',
                        'Операционная модель: принцип минимально необходимых данных и ограниченное время хранения метаданных.',
                        'Организационная модель: аудит инцидентов, журналирование событий безопасности, регулярные обновления.',
                    ],
                },
            ],
            'en': [
                {
                    'heading': '1. Mission',
                    'points': [
                        'SUN Messenger is designed as a privacy-first messenger focused on secure defaults and minimal server trust.',
                    ],
                },
                {
                    'heading': '2. Privacy model',
                    'points': [
                        'Message content access is limited to end-user devices.',
                        'The server stores only data required for identity, routing, and operational stability.',
                        'Sensitive actions are protected with additional authentication and rate controls.',
                    ],
                },
                {
                    'heading': '3. Threat boundaries',
                    'points': [
                        'Primary focus: protection against session compromise and unauthorized account access.',
                        'Special focus: API defense against brute-force, spam, and abuse automation.',
                    ],
                },
                {
                    'heading': '4. Whitepaper (public short form)',
                    'points': [
                        'Cryptographic model: E2EE for private messages.',
                        'Operational model: minimal required data and bounded metadata retention.',
                        'Governance model: security incident logging, response workflows, and regular updates.',
                    ],
                },
            ],
        },
    },
}


def _resolve_trust_language() -> str:
    session_language = session.get('ui_language') or session.get('guest_ui_language')
    return normalize_language(session_language, default=detect_auth_language(request))


def _build_doc_payload(slug: str, lang: str) -> dict:
    source = _TRUST_DOCS[slug]
    return {
        'slug': slug,
        'title': source['title'][lang],
        'summary': source['summary'][lang],
        'sections': source['sections'][lang],
    }


def _render_doc(slug: str):
    resolved_slug = slug if slug in _TRUST_DOCS else 'privacy'
    lang = _resolve_trust_language()
    nav_docs = [_build_doc_payload(item, lang) for item in _DOC_ORDER]
    current_doc = _build_doc_payload(resolved_slug, lang)
    ui_copy = _UI_COPY[lang]
    updated_at = '2026-05-04'
    return render_template(
        'trust_center.html',
        ui_language=lang,
        ui_copy=ui_copy,
        nav_docs=nav_docs,
        current_doc=current_doc,
        current_slug=resolved_slug,
        updated_at=updated_at,
    )


@auth_bp.route('/trust', methods=['GET'])
def trust_center():
    return _render_doc('privacy')


@auth_bp.route('/privacy', methods=['GET'])
def privacy_policy():
    return _render_doc('privacy')


@auth_bp.route('/terms', methods=['GET'])
def terms_of_service():
    return _render_doc('terms')


@auth_bp.route('/security-faq', methods=['GET'])
def security_faq():
    return _render_doc('faq')


@auth_bp.route('/about', methods=['GET'])
def about_project():
    return _render_doc('about')
