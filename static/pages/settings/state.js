import { waitForMotionEnd } from '../../modules/motion.js';

export function createSettingsState({ getCommonPayload, floatingSaveBtn }) {
    let settingsBaseline = null;
    let settingsLoaded = false;
    let isDirty = false;
    let latestUploadedAvatarUrl = '';
    let qrGenerated = false;
    let floatingVisibilitySeq = 0;
    let floatingSavedSeq = 0;

    function syncFloatingSaveButton() {
        if (!floatingSaveBtn) return;
        floatingVisibilitySeq += 1;
        floatingSaveBtn.disabled = !isDirty;
        floatingSaveBtn.hidden = false;
        floatingSaveBtn.classList.toggle('is-visible', isDirty);
        if (!isDirty) {
            const visibilitySeq = floatingVisibilitySeq;
            floatingSaveBtn.classList.remove('is-saving');
            waitForMotionEnd(floatingSaveBtn, 280).then(() => {
                if (visibilitySeq !== floatingVisibilitySeq) return;
                if (!isDirty && !floatingSaveBtn.classList.contains('is-visible')) {
                    floatingSaveBtn.hidden = true;
                }
            });
        }
    }

    function setFloatingSaveSaving(saving) {
        if (!floatingSaveBtn) return;
        floatingSaveBtn.disabled = !!saving;
        floatingSaveBtn.classList.toggle('is-saving', !!saving);
    }

    function animateFloatingSaveSuccess() {
        if (!floatingSaveBtn) return;
        const savedSeq = ++floatingSavedSeq;
        floatingSaveBtn.classList.remove('is-saving', 'is-saved');
        void floatingSaveBtn.offsetWidth;
        floatingSaveBtn.classList.add('is-saved');
        waitForMotionEnd(floatingSaveBtn, 540).then(() => {
            if (savedSeq !== floatingSavedSeq) return;
            floatingSaveBtn.classList.remove('is-saved');
        });
    }

    function syncDirtyState() {
        const nextDirty = settingsLoaded
            && Boolean(settingsBaseline)
            && JSON.stringify(getCommonPayload()) !== JSON.stringify(settingsBaseline);
        isDirty = nextDirty;
        syncFloatingSaveButton();
    }

    return {
        isLoaded: () => settingsLoaded,
        setLoaded(next) {
            settingsLoaded = !!next;
        },
        getBaseline: () => settingsBaseline,
        setBaseline(nextBaseline) {
            settingsBaseline = nextBaseline;
        },
        isDirty: () => isDirty,
        syncDirtyState,
        syncFloatingSaveButton,
        setFloatingSaveSaving,
        animateFloatingSaveSuccess,
        getLatestUploadedAvatarUrl: () => latestUploadedAvatarUrl,
        setLatestUploadedAvatarUrl(nextUrl) {
            latestUploadedAvatarUrl = String(nextUrl || '').trim();
        },
        isQrGenerated: () => qrGenerated,
        setQrGenerated(next) {
            qrGenerated = !!next;
        },
    };
}
