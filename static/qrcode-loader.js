(() => {
    let qrCodeLoadPromise = null;

    window.ensureQrCodeLibrary = function ensureQrCodeLibrary() {
        if (typeof window.QRCode !== 'undefined') {
            return Promise.resolve(window.QRCode);
        }

        if (qrCodeLoadPromise) {
            return qrCodeLoadPromise;
        }

        qrCodeLoadPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            const bootstrapQrCodeSrc = window.SUN_BOOTSTRAP?.assets?.qrcodeSrc;
            script.src = String(bootstrapQrCodeSrc || window.SUN_QRCODE_SRC || '/static/vendor/js/qrcode.min.js');
            script.async = true;
            script.onload = () => {
                if (typeof window.QRCode === 'undefined') {
                    reject(new Error('QRCode library did not initialize.'));
                    return;
                }
                resolve(window.QRCode);
            };
            script.onerror = () => {
                reject(new Error('Failed to load QRCode library.'));
            };
            document.head.appendChild(script);
        }).catch((error) => {
            qrCodeLoadPromise = null;
            throw error;
        });

        return qrCodeLoadPromise;
    };
})();
