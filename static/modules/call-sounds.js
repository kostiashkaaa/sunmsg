/**
 * call-sounds.js
 * Plays ringtones, connection tones, and end-call sounds using the Web Audio API.
 * No external audio files required — tones are synthesized.
 */

let _ctx = null;

function getAudioCtx() {
    if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
    return _ctx;
}

function playTone(frequency, duration, type = 'sine', volume = 0.3) {
    try {
        const ctx = getAudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = type;
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(volume, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + duration);
    } catch (_) {}
}

// Ringing tone — repeating 440/480 Hz alternating (like Russian phone ring)
let _ringInterval = null;
let _ringAudioEl = null;

export function startRingtone() {
    stopRingtone();
    let phase = 0;
    _ringInterval = setInterval(() => {
        playTone(phase % 2 === 0 ? 440 : 480, 0.4, 'sine', 0.25);
        phase++;
    }, 500);
}

export function stopRingtone() {
    if (_ringInterval) { clearInterval(_ringInterval); _ringInterval = null; }
    if (_ringAudioEl) { _ringAudioEl.pause(); _ringAudioEl = null; }
}

// Connected sound — ascending two-tone
export function playConnectedSound() {
    playTone(660, 0.12, 'sine', 0.2);
    setTimeout(() => playTone(880, 0.15, 'sine', 0.2), 120);
}

// End-call sound — descending
export function playEndCallSound() {
    playTone(440, 0.1, 'sine', 0.2);
    setTimeout(() => playTone(330, 0.1, 'sine', 0.2), 100);
    setTimeout(() => playTone(220, 0.15, 'sine', 0.15), 200);
}

// Busy tone — 425 Hz pulses
export function playBusyTone() {
    let n = 0;
    const interval = setInterval(() => {
        playTone(425, 0.3, 'sine', 0.2);
        if (++n >= 3) clearInterval(interval);
    }, 600);
}
