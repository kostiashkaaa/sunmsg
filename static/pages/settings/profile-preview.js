import { applyFallbackAvatarTint, buildAvatarInitials } from '../../modules/utils.js';

export function createProfilePreviewController({
    avatarPreviewEl,
    displayNameEl,
    previewNameEl,
}) {
    function setAvatarPreviewImage(avatarUrl) {
        if (!avatarPreviewEl || !avatarUrl) return;
        const cleanUrl = String(avatarUrl).trim();
        if (!cleanUrl) return;
        const sep = cleanUrl.includes('?') ? '&' : '?';
        const img = document.createElement('img');
        img.src = `${cleanUrl}${sep}t=${Date.now()}`;
        img.alt = 'Avatar';
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        img.style.borderRadius = '50%';
        avatarPreviewEl.replaceChildren(img);
        avatarPreviewEl.removeAttribute('data-avatar-tint');
    }

    function updateAvatarInitials() {
        const name = String(displayNameEl?.value || '').trim();
        const initials = buildAvatarInitials(name);
        if (avatarPreviewEl && !avatarPreviewEl.querySelector('img')) {
            avatarPreviewEl.textContent = initials;
            applyFallbackAvatarTint(avatarPreviewEl, name || initials);
        }
        if (previewNameEl) {
            previewNameEl.textContent = name || '—';
        }
    }

    return {
        setAvatarPreviewImage,
        updateAvatarInitials,
    };
}
