from flask import render_template, request, session

from app.services.locale import detect_auth_language, normalize_language
from .context import auth_bp


_ONBOARDING_COPY = {
    'ru': {
        'eyebrow': 'Start Guide',
        'title': 'Как зарегистрироваться и войти без ошибок',
        'subtitle': 'Короткая инструкция для первого запуска: от создания аккаунта до безопасного входа.',
        'back': 'Вернуться ко входу',
        'steps_title': 'Пошагово',
        'tips_title': 'Частые ошибки',
        'actions_title': 'Быстрые действия',
        'actions_text': 'После инструкции вернитесь на экран входа и создайте аккаунт во вкладке «Создать аккаунт».',
        'go_auth': 'Открыть страницу входа',
        'steps': [
            {
                'title': 'Откройте вкладку «Создать аккаунт»',
                'text': 'На главной странице переключитесь на регистрацию и введите username и отображаемое имя.',
            },
            {
                'title': 'Сохраните 24 слова',
                'text': 'После создания аккаунта вы получите мнемоническую фразу из 24 слов. Это ваш ключ восстановления.',
            },
            {
                'title': 'Подключите приложение-аутентификатор',
                'text': 'Отсканируйте QR-код в Google Authenticator или Microsoft Authenticator и сохраните 6-значный код.',
            },
            {
                'title': 'Проверьте вход',
                'text': 'Войти можно через QR или по 24 словам. Для полной расшифровки истории на новом устройстве нужны именно 24 слова.',
            },
        ],
        'tips': [
            'Не используйте пробелы и заглавные буквы в username: допустимы только `a-z`, `0-9`, `_`.',
            'Не храните 24 слова только в заметках телефона: сделайте офлайн-копию.',
            'Если код TOTP не подходит, проверьте точность времени на телефоне.',
            'Если потеряли доступ, сначала попробуйте вход по 24 словам, затем напишите в поддержку через блок «Обратная связь».',
        ],
    },
    'en': {
        'eyebrow': 'Start Guide',
        'title': 'How to register and sign in without errors',
        'subtitle': 'A short first-run guide: from account creation to secure sign in.',
        'back': 'Back to sign in',
        'steps_title': 'Step by step',
        'tips_title': 'Common mistakes',
        'actions_title': 'Quick actions',
        'actions_text': 'After reading, return to auth and create an account from the “Create account” tab.',
        'go_auth': 'Open sign-in page',
        'steps': [
            {
                'title': 'Open the “Create account” tab',
                'text': 'On the main auth page, switch to registration and enter your username and display name.',
            },
            {
                'title': 'Save your 24 words',
                'text': 'After registration you will get a 24-word mnemonic. This is your recovery key.',
            },
            {
                'title': 'Connect an authenticator app',
                'text': 'Scan the QR code in Google Authenticator or Microsoft Authenticator and keep the 6-digit code ready.',
            },
            {
                'title': 'Validate sign in',
                'text': 'You can sign in via QR or 24 words. On a new device, full history decryption requires the 24 words.',
            },
        ],
        'tips': [
            'Do not use spaces or uppercase letters in username: only `a-z`, `0-9`, `_` are valid.',
            'Do not store the 24 words only in phone notes: keep an offline backup.',
            'If TOTP code fails, check your phone time sync.',
            'If access is lost, try 24-word sign in first, then contact support from the “Feedback” block.',
        ],
    },
}


def _resolve_onboarding_language() -> str:
    session_language = session.get('ui_language') or session.get('guest_ui_language')
    return normalize_language(session_language, default=detect_auth_language(request))


@auth_bp.route('/onboarding-guide', methods=['GET'])
def onboarding_guide():
    language = _resolve_onboarding_language()
    return render_template(
        'onboarding_guide.html',
        ui_language=language,
        ui_copy=_ONBOARDING_COPY[language],
    )
