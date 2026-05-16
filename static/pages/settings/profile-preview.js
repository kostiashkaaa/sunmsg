import { applyFallbackAvatarTint, buildAvatarInitials } from '../../modules/utils.js';

export function createProfilePreviewController({
    avatarPreviewEl,
    displayNameEl,
    previewNameEl,
    usernameEl = null,
    previewUsernameEl = null,
    secondaryAvatarEls = [],
    secondaryNameEls = [],
}) {
    const avatarTargets = [avatarPreviewEl, ...secondaryAvatarEls].filter(Boolean);
    const nameTargets = [previewNameEl, ...secondaryNameEls].filter(Boolean);

    function setAvatarImageForTargets(avatarUrl) {
        const cleanUrl = String(avatarUrl || '').trim();
        if (!cleanUrl) return;
        avatarTargets.forEach((target) => {
            const sep = cleanUrl.includes('?') ? '&' : '?';
            const img = document.createElement('img');
            img.src = `${cleanUrl}${sep}t=${Date.now()}`;
            img.alt = 'Avatar';
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';
            img.style.borderRadius = '50%';
            target.replaceChildren(img);
            target.removeAttribute('data-avatar-tint');
        });
    }

    function setAvatarPreviewImage(avatarUrl) {
        if (!avatarUrl) return;
        setAvatarImageForTargets(avatarUrl);
    }

    function updateAvatarInitials() {
        const name = String(displayNameEl?.value || '').trim();
        const initials = buildAvatarInitials(name);
        avatarTargets.forEach((target) => {
            if (target.querySelector('img')) return;
            target.textContent = initials;
            applyFallbackAvatarTint(target, name || initials);
        });
        nameTargets.forEach((target) => {
            target.textContent = name || '-';
        });
        if (previewUsernameEl) {
            // убираем любые ведущие «@», чтобы не получить «@@username»
            const username = String(usernameEl?.value || '').trim().replace(/^@+/, '');
            previewUsernameEl.textContent = username ? `@${username}` : '@-';
        }
    }

    return {
        setAvatarPreviewImage,
        updateAvatarInitials,
    };
}
