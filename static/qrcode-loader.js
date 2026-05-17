(() => {
    let qrCodeLoadPromise = null;
    let jsQrLoadPromise = null;
    const loaderScript = document.currentScript;
    const loaderNonce = loaderScript?.nonce || loaderScript?.getAttribute('nonce') || '';

    function readCspNonce() {
        if (loaderNonce) {
            return loaderNonce;
        }
        const nonceHost = document.querySelector('script[nonce],style[nonce]');
        return nonceHost?.nonce || nonceHost?.getAttribute('nonce') || '';
    }

    function applyCspNonce(script) {
        const nonce = readCspNonce();
        if (nonce) {
            script.setAttribute('nonce', nonce);
        }
    }

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
            applyCspNonce(script);
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

    window.ensureJsQrLibrary = function ensureJsQrLibrary() {
        if (typeof window.jsQR === 'function') {
            return Promise.resolve(window.jsQR);
        }

        if (jsQrLoadPromise) {
            return jsQrLoadPromise;
        }

        jsQrLoadPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            const bootstrapJsQrSrc = window.SUN_BOOTSTRAP?.assets?.jsQrSrc;
            script.src = String(bootstrapJsQrSrc || window.SUN_JSQR_SRC || '/static/vendor/js/jsQR.min.js');
            script.async = true;
            applyCspNonce(script);
            script.onload = () => {
                if (typeof window.jsQR !== 'function') {
                    reject(new Error('jsQR library did not initialize.'));
                    return;
                }
                resolve(window.jsQR);
            };
            script.onerror = () => {
                reject(new Error('Failed to load jsQR library.'));
            };
            document.head.appendChild(script);
        }).catch((error) => {
            jsQrLoadPromise = null;
            throw error;
        });

        return jsQrLoadPromise;
    };
})();
