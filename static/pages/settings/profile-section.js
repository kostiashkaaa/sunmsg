import { initAvatarEditor } from './avatar-editor.js';
import { createAvatarUploadController } from './avatar-upload.js';
import { createProfilePreviewController } from './profile-preview.js';

export function initProfileSection({
    api,
    tr,
    notifyParent,
    currentUsername,
    getLatestUploadedAvatarUrl,
    setLatestUploadedAvatarUrl,
    onFieldDirtyChange,
}) {
    const avatarPreviewEl = document.getElementById('avatarPreview');
    const displayNameEl = document.getElementById('displayName');
    const usernameEl = document.getElementById('username');
    const previewNameEl = document.getElementById('previewName');
    const avatarFileInputEl = document.getElementById('avatarFileInput');

    const preview = createProfilePreviewController({
        avatarPreviewEl,
        displayNameEl,
        previewNameEl,
    });

    displayNameEl?.addEventListener('input', () => {
        preview.updateAvatarInitials();
        if (typeof onFieldDirtyChange === 'function') {
            onFieldDirtyChange();
        }
    });

    const upload = createAvatarUploadController({
        api,
        tr,
        notifyParent,
        currentUsername,
        displayNameEl,
        usernameEl,
        setLatestUploadedAvatarUrl,
        setAvatarPreviewImage: preview.setAvatarPreviewImage,
    });

    initAvatarEditor({
        tr,
        avatarFileInputEl,
        setAvatarUploadStatus: upload.setAvatarUploadStatus,
        uploadAvatarBlob: upload.uploadAvatarBlob,
    });

    return {
        setAvatarPreviewImage: preview.setAvatarPreviewImage,
        updateAvatarInitials: preview.updateAvatarInitials,
        applyAvatarFromSettings(serverAvatarUrl) {
            const uploadedAvatarUrl = getLatestUploadedAvatarUrl();
            if (uploadedAvatarUrl) {
                preview.setAvatarPreviewImage(uploadedAvatarUrl);
            } else if (serverAvatarUrl) {
                setLatestUploadedAvatarUrl(serverAvatarUrl);
                preview.setAvatarPreviewImage(serverAvatarUrl);
            }
            preview.updateAvatarInitials();
        },
    };
}