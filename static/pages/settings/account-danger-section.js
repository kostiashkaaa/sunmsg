export function initAccountDangerSection({
    api,
    tr,
    currentUsername,
    navigateOut,
}) {
    const deleteAccountBtn = document.getElementById('deleteAccountBtn');
    if (!deleteAccountBtn) return;

    deleteAccountBtn.addEventListener('click', async () => {
        const username = currentUsername;
        const confirmPrompt = `${tr('ВНИМАНИЕ: Это удалит ваш аккаунт навсегда.\nВсе сообщения и данные будут стёрты.\n\nДля подтверждения введите ваше имя пользователя:')} ${username}`;
        const confirmName = prompt(confirmPrompt);

        if (confirmName === username) {
            if (confirm(tr('Вы абсолютно уверены? Это действие НЕВОЗМОЖНО отменить.'))) {
                try {
                    await api.deleteAccount();
                    alert(tr('Ваш аккаунт был успешно удален. Прощайте!'));
                    navigateOut('/');
                } catch (err) {
                    alert(`${tr('Ошибка при удалении:')} ${tr(String(err?.message || 'Неизвестная ошибка'))}`.trim());
                }
            }
        } else if (confirmName !== null) {
            alert(tr('Имя пользователя введено неверно. Удаление отменено.'));
        }
    });
}
