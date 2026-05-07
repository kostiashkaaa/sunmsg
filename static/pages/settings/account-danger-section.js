import { showConfirmDialog } from '../../modules/confirm-dialog.js';

export function initAccountDangerSection({
    api,
    tr,
    currentUsername,
    navigateOut,
    showAlert,
}) {
    const deleteAccountBtn = document.getElementById('deleteAccountBtn');
    if (!deleteAccountBtn) return;

    deleteAccountBtn.addEventListener('click', async () => {
        const confirmed = await showConfirmDialog({
            title: tr('Удалить аккаунт?'),
            message: tr('ВНИМАНИЕ: Это удалит ваш аккаунт навсегда. Все сообщения и данные будут стёрты. Это действие НЕВОЗМОЖНО отменить.'),
            confirmText: tr('Удалить навсегда'),
            cancelText: tr('Отмена'),
            variant: 'danger',
        });
        if (!confirmed) return;

        try {
            await api.deleteAccount();
            showAlert(tr('Ваш аккаунт был успешно удалён.'), 'success');
            setTimeout(() => navigateOut('/'), 1200);
        } catch (err) {
            showAlert(`${tr('Ошибка при удалении:')} ${tr(String(err?.message || 'Неизвестная ошибка'))}`.trim(), 'danger');
        }
    });
}
