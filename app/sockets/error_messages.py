SOCKET_ERROR_MESSAGES_RU = {
    'Duplicate request ignored.': 'Повторный запрос уже обработан.',
    'CSRF token is required.': 'Требуется CSRF-токен.',
    'Invalid CSRF token.': 'Недействительный CSRF-токен.',
    'CSRF validation failed.': 'Не удалось проверить CSRF-токен.',
    'Invalid socket payload.': 'Некорректные данные socket-события.',
    'Messaging is temporarily restricted by moderation.': 'Отправка временно ограничена модерацией.',
    'Encrypted message payload is required.': 'Нужно зашифрованное сообщение.',
    'You are not a member of this chat.': 'Вы не участник этого чата.',
    'Messaging is restricted in this group by moderation.': (
        'Отправка сообщений в этой группе ограничена модерацией.'
    ),
    'Participants cannot send messages in this group.': (
        'Участники не могут отправлять сообщения в этой группе.'
    ),
    'Participants cannot send media in this group.': 'Участники не могут отправлять медиа в этой группе.',
    'Slow mode is enabled. Please wait before sending another message.': (
        'Включён медленный режим. Подождите перед отправкой следующего сообщения.'
    ),
    'Too many messages. Please wait a little.': 'Слишком много сообщений. Подождите немного.',
    'Invalid payload.': 'Некорректные данные сообщения.',
    'Message is too long (max 64000 characters).': (
        'Сообщение слишком длинное. Максимум 64000 символов.'
    ),
    'Invalid chat ID.': 'Некорректный ID чата.',
    'Invalid chat_id.': 'Некорректный ID чата.',
    'Invalid timer value.': 'Некорректное значение таймера.',
    'Not a member.': 'Вы не участник этого чата.',
    'No permission.': 'Недостаточно прав.',
    'This public link is blocked by moderation policy.': (
        'Эта публичная ссылка заблокирована правилами модерации.'
    ),
    'Messaging is unavailable because the user is blocked.': (
        'Отправка недоступна, потому что пользователь заблокирован.'
    ),
    'This user does not allow this message type.': (
        'Пользователь не разрешает этот тип сообщений.'
    ),
    'Failed to save message.': 'Не удалось сохранить сообщение.',
    'Deletion is unavailable because the user is blocked.': (
        'Удаление недоступно, потому что пользователь заблокирован.'
    ),
    'Too many messages selected. Maximum is 100.': 'Выбрано слишком много сообщений. Максимум 100.',
    'Editing is unavailable because the user is blocked.': (
        'Редактирование недоступно, потому что пользователь заблокирован.'
    ),
    'You can only edit your own messages.': 'Можно редактировать только свои сообщения.',
    'Editing window expired for this message.': 'Время редактирования этого сообщения истекло.',
    'Edit limit reached for this message.': 'Лимит редактирования этого сообщения исчерпан.',
    'Invalid reaction payload.': 'Некорректные данные реакции.',
    'Message not found.': 'Сообщение не найдено.',
    'Failed to update reaction.': 'Не удалось обновить реакцию.',
    'Reactions are unavailable because the user is blocked.': (
        'Реакции недоступны, потому что пользователь заблокирован.'
    ),
    'Pinning is unavailable because the user is blocked.': (
        'Закрепление недоступно, потому что пользователь заблокирован.'
    ),
    'Unpinning is unavailable because the user is blocked.': (
        'Открепление недоступно, потому что пользователь заблокирован.'
    ),
    'Favorites are unavailable because the user is blocked.': (
        'Избранное недоступно, потому что пользователь заблокирован.'
    ),
    'Insufficient role for pinning.': 'Недостаточно прав для закрепления сообщения.',
    'Insufficient role for unpinning.': 'Недостаточно прав для открепления сообщения.',
    'Only group admins can pin messages.': 'Только администраторы группы могут закреплять сообщения.',
    'Only group admins can unpin messages.': (
        'Только администраторы группы могут откреплять сообщения.'
    ),
    'Insufficient role for this action.': 'Недостаточно прав для этого действия.',
}


def localize_socket_error_message(message: str) -> str:
    normalized = str(message or '').strip()
    return SOCKET_ERROR_MESSAGES_RU.get(normalized, normalized)


def socket_error_payload(message: str, *, request_id: str | None = None, **extra) -> dict:
    payload = {'message': localize_socket_error_message(message)}
    normalized_request_id = str(request_id or '').strip()
    if normalized_request_id:
        payload['request_id'] = normalized_request_id
    payload.update(extra)
    return payload
