export async function stageKeyForLogin({
    privateKeyPem = '',
    rememberDevice = false,
    stagePrivateKeyForRedirect,
    tr = (value) => String(value ?? ''),
} = {}) {
    let staged = false;
    try {
        staged = await stagePrivateKeyForRedirect(privateKeyPem, {
            rememberDevice: !!rememberDevice,
            notify: false,
        });
    } catch (_) {
        staged = false;
    }

    if (staged) {
        return {
            staged: true,
            warningMessage: '',
        };
    }

    return {
        staged: false,
        warningMessage: tr('\u0412\u0445\u043E\u0434 \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D, \u043D\u043E \u043A\u043B\u044E\u0447 \u0448\u0438\u0444\u0440\u043E\u0432\u0430\u043D\u0438\u044F \u043D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0430\u043A\u0442\u0438\u0432\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043D\u0430 \u044D\u0442\u043E\u043C \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u0435. \u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u0447\u0430\u0442 \u0438 \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u0435 \u0434\u043E\u0441\u0442\u0443\u043F \u043F\u043E 24 \u0441\u043B\u043E\u0432\u0430\u043C.'),
    };
}
