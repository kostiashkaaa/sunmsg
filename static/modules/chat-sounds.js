let audioContext = null;

function resolveAudioContextConstructor() {
    const host = typeof window !== 'undefined' ? window : globalThis;
    return host?.AudioContext || host?.webkitAudioContext || null;
}

function getAudioContext() {
    const AudioContextCtor = resolveAudioContextConstructor();
    if (!AudioContextCtor) return null;
    if (!audioContext) {
        audioContext = new AudioContextCtor();
    }
    if (audioContext.state === 'suspended') {
        audioContext.resume?.().catch?.(() => {});
    }
    return audioContext;
}

function playTone(frequency, duration, volume, delay = 0) {
    try {
        const ctx = getAudioContext();
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = ctx.currentTime + Math.max(0, Number(delay) || 0);
        const end = start + Math.max(0.02, Number(duration) || 0.05);
        const peak = Math.max(0.0002, Math.min(0.12, Number(volume) || 0.03));

        osc.type = 'sine';
        osc.frequency.setValueAtTime(Math.max(40, Number(frequency) || 440), start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, end);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(end + 0.02);
    } catch (_) {}
}

export function playIncomingMessageSound() {
    playTone(880, 0.07, 0.035, 0);
    playTone(1174.66, 0.09, 0.03, 0.055);
}

export function playOutgoingMessageSound() {
    playTone(523.25, 0.045, 0.028, 0);
    playTone(659.25, 0.055, 0.026, 0.04);
}
