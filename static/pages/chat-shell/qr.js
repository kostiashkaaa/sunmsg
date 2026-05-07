import { applySunQrBrand } from '../qr-brand.js';

export function initChatShellQr(options = {}) {
    const withAppRoot = options.withAppRoot || ((value) => value);
    const currentUserState = options.currentUserState || {};
    const markFirstRunCompleted = options.markFirstRunCompleted || (() => {});
    const openAnimatedDialog = options.openAnimatedDialog || (() => {});
    const closeAnimatedDialog = options.closeAnimatedDialog || (() => Promise.resolve(false));
    const attachAnimatedDialog = options.attachAnimatedDialog || (() => {});

    const myQrModal = document.getElementById('myQrModal');
    const deviceQrHubModal = document.getElementById('deviceQrHubModal');
    const myQrCodeContainer = document.getElementById('myQrCodeContainer');
    const saveMyQrBtn = document.getElementById('saveMyQrBtn');
    const deviceQrHubShowBtn = document.getElementById('deviceQrHubShowBtn');
    const deviceQrHubScanBtn = document.getElementById('deviceQrHubScanBtn');

    let myQrGenerated = false;

    function renderQrPlaceholder() {
        if (!myQrCodeContainer) return;
        myQrCodeContainer.innerHTML = `
            <div class="sun-fade-enter" style="display:flex; flex-direction:column; align-items:center; gap:14px; color:#15140e;">
                <div class="sun-skeleton-block" style="width:176px; height:176px; border-radius:20px; background:rgba(21,20,14,0.08); border-color:rgba(21,20,14,0.08);"></div>
                <div class="sun-dot-loader" aria-hidden="true"><span></span><span></span><span></span></div>
            </div>
        `;
    }

    function buildProfileCardLink() {
        const username = String(currentUserState.username || '').trim().toLowerCase();
        if (!username) return String(currentUserState.publicKey || '');
        return `su:${username}`;
    }

    async function ensureMyQrCode() {
        if (myQrGenerated || !myQrCodeContainer) return;
        await window.ensureQrCodeLibrary();
        myQrCodeContainer.innerHTML = '';
        new QRCode(myQrCodeContainer, {
            text: buildProfileCardLink(),
            width: 216,
            height: 216,
            colorDark: '#15140e',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.M,
        });
        applySunQrBrand(myQrCodeContainer, { logoRatio: 0.26 });
        myQrGenerated = true;
    }

    async function openMyQrModal() {
        if (!myQrModal) return;
        if (!myQrGenerated) {
            renderQrPlaceholder();
            window.setTimeout(() => {
                ensureMyQrCode().catch(() => {
                    if (myQrCodeContainer) {
                        myQrCodeContainer.innerHTML = '<p style="font-size:12px;color:var(--danger);">Не удалось загрузить QR-код.</p>';
                    }
                });
            }, 80);
        }
        openAnimatedDialog(myQrModal);
        markFirstRunCompleted();
    }

    function openDeviceQrHub() {
        if (!deviceQrHubModal) {
            openMyQrModal();
            return;
        }
        openAnimatedDialog(deviceQrHubModal);
        markFirstRunCompleted();
    }

    function hasRuntimePrivateKey() {
        return Boolean(
            window.sunPrivateKeySession
            && typeof window.sunPrivateKeySession.getPrivateKeyPem === 'function'
            && window.sunPrivateKeySession.getPrivateKeyPem(),
        );
    }

    saveMyQrBtn?.addEventListener('click', () => {
        const canvas = myQrCodeContainer?.querySelector('canvas');
        const image = myQrCodeContainer?.querySelector('img');
        const href = canvas?.toDataURL('image/png') || image?.getAttribute('src') || '';
        if (!href) return;
        const link = document.createElement('a');
        link.href = href;
        link.download = `${currentUserState.username || 'sun-user'}-qr.png`;
        document.body.appendChild(link);
        link.click();
        link.remove();
    });

    deviceQrHubShowBtn?.addEventListener('click', async () => {
        await closeAnimatedDialog(deviceQrHubModal);
        await openMyQrModal();
    });
    deviceQrHubScanBtn?.addEventListener('click', async () => {
        await closeAnimatedDialog(deviceQrHubModal);
        const keyTransferApi = window.sunKeyTransfer || null;
        if (!keyTransferApi || typeof keyTransferApi.openScanModal !== 'function') {
            return;
        }
        await keyTransferApi.openScanModal();
    });

    attachAnimatedDialog(myQrModal);
    attachAnimatedDialog(deviceQrHubModal);
    document.querySelectorAll('[data-dialog-close]').forEach((button) => {
        button.addEventListener('click', function () {
            const dialogId = this.getAttribute('data-dialog-close');
            const dialog = dialogId ? document.getElementById(dialogId) : null;
            if (dialog && dialog.tagName === 'DIALOG') {
                closeAnimatedDialog(dialog);
            }
        });
    });

    window.openMyQrModal = openMyQrModal;
    window.openDeviceQrHub = openDeviceQrHub;

    return {
        openMyQrModal,
        openDeviceQrHub,
        hasRuntimePrivateKey,
    };
}
