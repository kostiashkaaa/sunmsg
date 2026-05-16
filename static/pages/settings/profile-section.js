import { initAvatarEditor } from './avatar-editor.js';
import { createAvatarUploadController } from './avatar-upload.js';
import { createProfilePreviewController } from './profile-preview.js';
import { initAvatarLightbox } from './avatar-lightbox.js';

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
    const settingsNavAvatarPreviewEl = document.getElementById('settingsNavAvatarPreview');
    const displayNameEl = document.getElementById('displayName');
    const usernameEl = document.getElementById('username');
    const bioInputEl = document.getElementById('bioInput');
    const previewNameEl = document.getElementById('previewName');
    const settingsNavNameValueEl = document.getElementById('settingsNavNameValue');
    const settingsNavProfileNameEl = document.getElementById('settingsNavProfileName');
    const settingsNavUsernameValueEl = document.getElementById('settingsNavUsernameValue');
    const settingsNavBioValueEl = document.getElementById('settingsNavBioValue');
    const avatarFileInputEl = document.getElementById('avatarFileInput');

    const preview = createProfilePreviewController({
        avatarPreviewEl,
        displayNameEl,
        previewNameEl,
        usernameEl,
        previewUsernameEl: settingsNavUsernameValueEl,
        secondaryAvatarEls: [settingsNavAvatarPreviewEl],
        secondaryNameEls: [settingsNavNameValueEl, settingsNavProfileNameEl],
    });

    function syncProfileSummaryBio() {
        if (!settingsNavBioValueEl) return;
        const bio = String(bioInputEl?.value || '').trim();
        settingsNavBioValueEl.textContent = bio || '-';
    }

    displayNameEl?.addEventListener('input', () => {
        preview.updateAvatarInitials();
        if (typeof onFieldDirtyChange === 'function') {
            onFieldDirtyChange();
        }
    });
    usernameEl?.addEventListener('input', () => {
        preview.updateAvatarInitials();
        if (typeof onFieldDirtyChange === 'function') {
            onFieldDirtyChange();
        }
    });
    bioInputEl?.addEventListener('input', () => {
        syncProfileSummaryBio();
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

    // Клик по фото профиля открывает полноэкранный предпросмотр (как в Telegram).
    initAvatarLightbox([avatarPreviewEl, settingsNavAvatarPreviewEl]);

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
            syncProfileSummaryBio();
        },
    };
}
