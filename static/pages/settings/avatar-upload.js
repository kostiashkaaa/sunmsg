export function createAvatarUploadController({
    api,
    tr,
    notifyParent,
    currentUsername,
    displayNameEl,
    usernameEl,
    setLatestUploadedAvatarUrl,
    setAvatarPreviewImage,
}) {
    function setAvatarUploadStatus(message, color = 'var(--accent)') {
        const statusEl = document.getElementById('avatarUploadStatus');
        if (!statusEl) return null;
        statusEl.style.display = 'block';
        statusEl.textContent = tr(message);
        statusEl.style.color = color;
        return statusEl;
    }

    function uploadAvatarBlob(blob, filename, inputEl) {
        const statusEl = setAvatarUploadStatus('Загрузка…');
        const fd = new FormData();
        fd.append('avatar', blob, filename);

        return api.uploadAvatar(fd)
            .then((res) => {
                if (!statusEl) return;
                if (res.success) {
                    const uploadedAvatarUrl = String(res.avatar_url || '').trim();
                    if (uploadedAvatarUrl) {
                        setLatestUploadedAvatarUrl(uploadedAvatarUrl);
                        setAvatarPreviewImage(uploadedAvatarUrl);
                        notifyParent('sun-settings-avatar-updated', {
                            avatarUrl: uploadedAvatarUrl,
                            displayName: String(displayNameEl?.value || '').trim(),
                            username: String(usernameEl?.value || currentUsername || '').trim(),
                        });
                    }
                    statusEl.textContent = tr('Фото сохранено');
                    statusEl.style.color = 'var(--success)';
                    window.setTimeout(() => {
                        statusEl.style.display = 'none';
                    }, 3000);
                } else {
                    statusEl.textContent = `${tr('Ошибка:')} ${tr(res.error || '')}`.trim();
                    statusEl.style.color = 'var(--danger)';
                }
            })
            .catch((error) => {
                if (!statusEl) return;
                const message = String(error?.message || '').trim();
                statusEl.textContent = message
                    ? `${tr('Ошибка:')} ${tr(message)}`.trim()
                    : tr('Ошибка загрузки');
                statusEl.style.color = 'var(--danger)';
            })
            .finally(() => {
                if (inputEl) inputEl.value = '';
            });
    }

    return {
        setAvatarUploadStatus,
        uploadAvatarBlob,
    };
}
