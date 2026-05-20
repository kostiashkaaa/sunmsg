const activeScrollLocks = [];

function readScrollY() {
    return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
}

export function lockPageScroll(lockClass = 'sun-modal-scroll-locked') {
    const snapshot = {
        lockClass,
        scrollY: readScrollY(),
        htmlClassHadLock: document.documentElement.classList.contains(lockClass),
        htmlOverflow: document.documentElement.style.overflow,
        bodyPosition: document.body.style.position,
        bodyTop: document.body.style.top,
        bodyLeft: document.body.style.left,
        bodyRight: document.body.style.right,
        bodyWidth: document.body.style.width,
        bodyOverflow: document.body.style.overflow,
        bodyPaddingRight: document.body.style.paddingRight,
    };
    activeScrollLocks.push(snapshot);

    const scrollbarCompensation = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    document.documentElement.classList.add(lockClass);
    document.documentElement.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${snapshot.scrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';
    if (scrollbarCompensation > 0) {
        document.body.style.paddingRight = `${scrollbarCompensation}px`;
    }

    return () => unlockPageScroll(snapshot);
}

export function unlockPageScroll(snapshot = activeScrollLocks[activeScrollLocks.length - 1]) {
    if (!snapshot) return;
    const index = activeScrollLocks.indexOf(snapshot);
    if (index !== -1) activeScrollLocks.splice(index, 1);
    if (activeScrollLocks.length > 0) return;

    if (!snapshot.htmlClassHadLock) {
        document.documentElement.classList.remove(snapshot.lockClass);
    }
    document.documentElement.style.overflow = snapshot.htmlOverflow;
    document.body.style.position = snapshot.bodyPosition;
    document.body.style.top = snapshot.bodyTop;
    document.body.style.left = snapshot.bodyLeft;
    document.body.style.right = snapshot.bodyRight;
    document.body.style.width = snapshot.bodyWidth;
    document.body.style.overflow = snapshot.bodyOverflow;
    document.body.style.paddingRight = snapshot.bodyPaddingRight;
    window.scrollTo(0, snapshot.scrollY);
}
